create unique index account_requests_one_open_per_type_idx
  on public.account_requests(user_id, request_type)
  where status in ('requested', 'processing');

create function public.workspace_create_invitation(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  normalized_email text := lower(btrim(p_email));
  invitation_row public.invitations%rowtype;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';

  if actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'An owner or admin role is required.';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid invitation email.';
  end if;
  if p_role not in ('admin', 'marketer', 'approver', 'analyst') then
    raise exception using errcode = '22023', message = 'Choose a valid workspace role.';
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invitation token hash is invalid.';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'Invitation expiry must be within 30 days.';
  end if;
  if exists (
    select 1
    from auth.users invited_user
    join public.memberships existing_membership
      on existing_membership.user_id = invited_user.id
     and existing_membership.org_id = p_org_id
     and existing_membership.status = 'active'
    where lower(invited_user.email) = normalized_email
  ) then
    raise exception using errcode = '23505', message = 'That person is already an active workspace member.';
  end if;

  select * into invitation_row
  from public.invitations
  where org_id = p_org_id
    and email = normalized_email
    and status = 'pending'
  for update;

  if found then
    update public.invitations
    set role = p_role,
        token_hash = p_token_hash,
        invited_by = p_actor_user_id,
        expires_at = p_expires_at
    where id = invitation_row.id
    returning * into invitation_row;
  else
    insert into public.invitations (
      org_id, email, role, token_hash, invited_by, expires_at
    ) values (
      p_org_id, normalized_email, p_role, p_token_hash, p_actor_user_id, p_expires_at
    )
    returning * into invitation_row;
  end if;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'workspace.invitation_created',
    'invitation',
    invitation_row.id,
    jsonb_build_object('role', invitation_row.role, 'expires_at', invitation_row.expires_at)
  );

  return jsonb_build_object(
    'id', invitation_row.id,
    'email', invitation_row.email,
    'role', invitation_row.role,
    'status', invitation_row.status,
    'expires_at', invitation_row.expires_at,
    'created_at', invitation_row.created_at
  );
end;
$$;

create function public.workspace_revoke_invitation(
  p_org_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  invitation_row public.invitations%rowtype;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';
  if actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'An owner or admin role is required.';
  end if;

  select * into invitation_row
  from public.invitations
  where id = p_invitation_id and org_id = p_org_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invitation not found.';
  end if;
  if invitation_row.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Only pending invitations can be revoked.';
  end if;

  update public.invitations
  set status = 'revoked'
  where id = p_invitation_id;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'workspace.invitation_revoked',
    'invitation',
    p_invitation_id,
    jsonb_build_object('role', invitation_row.role)
  );

  return jsonb_build_object('id', p_invitation_id, 'status', 'revoked');
end;
$$;

create function public.workspace_accept_invitation(
  p_token_hash text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.invitations%rowtype;
  actor_email text;
  organization_name text;
  membership_id uuid;
begin
  select lower(email) into actor_email
  from auth.users
  where id = p_actor_user_id;
  if actor_email is null then
    raise exception using errcode = '42501', message = 'A verified account is required.';
  end if;

  select * into invitation_row
  from public.invitations
  where token_hash = p_token_hash
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invitation not found.';
  end if;
  if invitation_row.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'This invitation is no longer active.';
  end if;
  if invitation_row.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'This invitation has expired. Ask the workspace owner for a new link.';
  end if;
  if actor_email <> lower(invitation_row.email::text) then
    raise exception using errcode = '42501', message = 'Sign in with the email address that received this invitation.';
  end if;

  insert into public.memberships (org_id, user_id, role, status)
  values (invitation_row.org_id, p_actor_user_id, invitation_row.role, 'active')
  on conflict (org_id, user_id) do update
  set role = case
        when public.memberships.role = 'owner' then public.memberships.role
        else excluded.role
      end,
      status = 'active',
      updated_at = now()
  returning id into membership_id;

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where id = invitation_row.id;

  select name into organization_name
  from public.organizations
  where id = invitation_row.org_id;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    invitation_row.org_id,
    p_actor_user_id,
    'workspace.invitation_accepted',
    'membership',
    membership_id,
    jsonb_build_object('invitation_id', invitation_row.id, 'role', invitation_row.role)
  );

  return jsonb_build_object(
    'organization_id', invitation_row.org_id,
    'organization_name', organization_name,
    'membership_id', membership_id,
    'role', invitation_row.role
  );
end;
$$;

create function public.workspace_update_member(
  p_org_id uuid,
  p_membership_id uuid,
  p_actor_user_id uuid,
  p_role text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_row public.memberships%rowtype;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';
  if actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'An owner or admin role is required.';
  end if;
  if p_role not in ('owner', 'admin', 'marketer', 'approver', 'analyst') then
    raise exception using errcode = '22023', message = 'Choose a valid workspace role.';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'Choose a valid membership status.';
  end if;

  select * into target_row
  from public.memberships
  where id = p_membership_id and org_id = p_org_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace member not found.';
  end if;
  if target_row.user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'Ask another owner or admin to change your access.';
  end if;
  if actor_role = 'admin' and (target_row.role = 'owner' or p_role = 'owner') then
    raise exception using errcode = '42501', message = 'Only an owner can change owner access.';
  end if;

  update public.memberships
  set role = p_role, status = p_status, updated_at = now()
  where id = p_membership_id
  returning * into target_row;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'workspace.member_updated',
    'membership',
    p_membership_id,
    jsonb_build_object('role', p_role, 'status', p_status)
  );

  return jsonb_build_object(
    'id', target_row.id,
    'user_id', target_row.user_id,
    'role', target_row.role,
    'status', target_row.status
  );
end;
$$;

create function public.workspace_remove_member(
  p_org_id uuid,
  p_membership_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_row public.memberships%rowtype;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';
  if actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'An owner or admin role is required.';
  end if;

  select * into target_row
  from public.memberships
  where id = p_membership_id and org_id = p_org_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace member not found.';
  end if;
  if target_row.user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'You cannot remove your own workspace access here.';
  end if;
  if actor_role = 'admin' and target_row.role = 'owner' then
    raise exception using errcode = '42501', message = 'Only an owner can remove another owner.';
  end if;

  delete from public.memberships where id = p_membership_id;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'workspace.member_removed',
    'membership',
    p_membership_id,
    jsonb_build_object('user_id', target_row.user_id, 'role', target_row.role)
  );

  return jsonb_build_object('id', p_membership_id, 'removed', true);
end;
$$;

create function public.account_create_request(
  p_actor_user_id uuid,
  p_request_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.account_requests%rowtype;
begin
  if not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '42501', message = 'A verified account is required.';
  end if;
  if p_request_type not in ('export', 'deletion') then
    raise exception using errcode = '22023', message = 'Choose a valid account request type.';
  end if;

  select * into request_row
  from public.account_requests
  where user_id = p_actor_user_id
    and request_type = p_request_type
    and status in ('requested', 'processing')
  order by requested_at desc
  limit 1;

  if not found then
    insert into public.account_requests (user_id, request_type)
    values (p_actor_user_id, p_request_type)
    returning * into request_row;
  end if;

  return jsonb_build_object(
    'id', request_row.id,
    'request_type', request_row.request_type,
    'status', request_row.status,
    'requested_at', request_row.requested_at,
    'completed_at', request_row.completed_at
  );
end;
$$;

create function public.account_cancel_request(
  p_actor_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.account_requests%rowtype;
begin
  select * into request_row
  from public.account_requests
  where id = p_request_id and user_id = p_actor_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Account request not found.';
  end if;
  if request_row.status <> 'requested' then
    raise exception using errcode = 'P0001', message = 'Only a pending account request can be cancelled.';
  end if;

  update public.account_requests
  set status = 'cancelled'
  where id = p_request_id;

  return jsonb_build_object('id', p_request_id, 'status', 'cancelled');
end;
$$;

revoke insert, update, delete on public.memberships from authenticated;
revoke insert, update, delete on public.invitations from authenticated;
revoke insert on public.account_requests from authenticated;

revoke all on function public.workspace_create_invitation(uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function public.workspace_revoke_invitation(uuid, uuid, uuid) from public;
revoke all on function public.workspace_accept_invitation(text, uuid) from public;
revoke all on function public.workspace_update_member(uuid, uuid, uuid, text, text) from public;
revoke all on function public.workspace_remove_member(uuid, uuid, uuid) from public;
revoke all on function public.account_create_request(uuid, text) from public;
revoke all on function public.account_cancel_request(uuid, uuid) from public;

grant execute on function public.workspace_create_invitation(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.workspace_revoke_invitation(uuid, uuid, uuid) to service_role;
grant execute on function public.workspace_accept_invitation(text, uuid) to service_role;
grant execute on function public.workspace_update_member(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.workspace_remove_member(uuid, uuid, uuid) to service_role;
grant execute on function public.account_create_request(uuid, text) to service_role;
grant execute on function public.account_cancel_request(uuid, uuid) to service_role;

comment on function public.workspace_create_invitation(uuid, uuid, text, text, text, timestamptz)
  is 'Server-only invitation creation with role checks, hashed tokens, and audit history.';
comment on function public.workspace_accept_invitation(text, uuid)
  is 'Server-only email-bound invitation acceptance that atomically creates workspace access.';
comment on function public.workspace_update_member(uuid, uuid, uuid, text, text)
  is 'Server-only membership administration with owner protections and audit history.';
