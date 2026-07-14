begin;
select plan(25);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('41111111-1111-4111-8111-111111111111', 'team-owner@example.test', '{"full_name":"Team Owner","account_type":"business","organization_name":"Team Lab"}'::jsonb, '{}'::jsonb),
  ('42222222-2222-4222-8222-222222222222', 'team-admin@example.test', '{"full_name":"Team Admin","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('43333333-3333-4333-8333-333333333333', 'team-marketer@example.test', '{"full_name":"Team Marketer","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'invited-approver@example.test', '{"full_name":"Invited Approver","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('45555555-5555-4555-8555-555555555555', 'wrong-invitee@example.test', '{"full_name":"Wrong Invitee","account_type":"professional"}'::jsonb, '{}'::jsonb);

do $$
declare
  workspace_id uuid;
begin
  select id into workspace_id
  from public.organizations
  where created_by = '41111111-1111-4111-8111-111111111111';
  perform set_config('test.team_org', workspace_id::text, true);

  insert into public.memberships (org_id, user_id, role)
  values
    (workspace_id, '42222222-2222-4222-8222-222222222222', 'admin'),
    (workspace_id, '43333333-3333-4333-8333-333333333333', 'marketer');
end;
$$;

select ok(
  not has_function_privilege('authenticated', 'public.workspace_create_invitation(uuid,uuid,text,text,text,timestamptz)', 'execute'),
  'authenticated clients cannot call invitation creation directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'update'),
  'authenticated clients cannot bypass audited membership updates'
);

select ok(
  not has_table_privilege('authenticated', 'public.invitations', 'insert'),
  'authenticated clients cannot write invitation token hashes'
);

select ok(
  not has_table_privilege('authenticated', 'public.account_requests', 'insert'),
  'authenticated clients cannot bypass the account request workflow'
);

select lives_ok(
  format(
    $$select public.workspace_create_invitation(%L, %L, 'invited-approver@example.test', 'approver', %L, now() + interval '7 days')$$,
    current_setting('test.team_org')::uuid,
    '41111111-1111-4111-8111-111111111111'::uuid,
    repeat('a', 64)
  ),
  'an owner can create a seven-day invitation'
);

select is(
  (select token_hash from public.invitations where org_id = current_setting('test.team_org')::uuid and email = 'invited-approver@example.test'),
  repeat('a', 64),
  'only the invitation token hash is persisted'
);

select throws_ok(
  format(
    $$select public.workspace_create_invitation(%L, %L, 'someone@example.test', 'analyst', %L, now() + interval '7 days')$$,
    current_setting('test.team_org')::uuid,
    '43333333-3333-4333-8333-333333333333'::uuid,
    repeat('b', 64)
  ),
  '42501',
  'An owner or admin role is required.',
  'a marketer cannot invite workspace members'
);

select throws_ok(
  format(
    $$select public.workspace_accept_invitation(%L, %L)$$,
    repeat('a', 64),
    '45555555-5555-4555-8555-555555555555'::uuid
  ),
  '42501',
  'Sign in with the email address that received this invitation.',
  'an invitation cannot be accepted by a different email'
);

select lives_ok(
  format(
    $$select public.workspace_accept_invitation(%L, %L)$$,
    repeat('a', 64),
    '44444444-4444-4444-8444-444444444444'::uuid
  ),
  'the intended account can accept the invitation'
);

select is(
  (select role from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '44444444-4444-4444-8444-444444444444'),
  'approver',
  'invitation acceptance creates the requested membership role'
);

select is(
  (select status from public.invitations where org_id = current_setting('test.team_org')::uuid and email = 'invited-approver@example.test'),
  'accepted',
  'accepted invitations are closed atomically'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.team_org')::uuid and event_type in ('workspace.invitation_created', 'workspace.invitation_accepted')),
  2,
  'invitation creation and acceptance are both audited'
);

select throws_ok(
  format(
    $$select public.workspace_accept_invitation(%L, %L)$$,
    repeat('a', 64),
    '44444444-4444-4444-8444-444444444444'::uuid
  ),
  'P0001',
  'This invitation is no longer active.',
  'an accepted invitation cannot be replayed'
);

select throws_ok(
  format(
    $$select public.workspace_create_invitation(%L, %L, 'team-admin@example.test', 'admin', %L, now() + interval '7 days')$$,
    current_setting('test.team_org')::uuid,
    '41111111-1111-4111-8111-111111111111'::uuid,
    repeat('c', 64)
  ),
  '23505',
  'That person is already an active workspace member.',
  'an active member cannot receive a duplicate invitation'
);

select lives_ok(
  format(
    $$select public.workspace_create_invitation(%L, %L, 'pending@example.test', 'analyst', %L, now() + interval '7 days')$$,
    current_setting('test.team_org')::uuid,
    '42222222-2222-4222-8222-222222222222'::uuid,
    repeat('d', 64)
  ),
  'an admin can create an invitation'
);

select lives_ok(
  format(
    $$select public.workspace_revoke_invitation(%L, %L, %L)$$,
    current_setting('test.team_org')::uuid,
    (select id from public.invitations where email = 'pending@example.test'),
    '42222222-2222-4222-8222-222222222222'::uuid
  ),
  'an admin can revoke a pending invitation'
);

select is(
  (select status from public.invitations where email = 'pending@example.test'),
  'revoked',
  'the revoked invitation is no longer active'
);

select lives_ok(
  format(
    $$select public.workspace_update_member(%L, %L, %L, 'analyst', 'active')$$,
    current_setting('test.team_org')::uuid,
    (select id from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '43333333-3333-4333-8333-333333333333'),
    '42222222-2222-4222-8222-222222222222'::uuid
  ),
  'an admin can change a non-owner member role'
);

select is(
  (select role from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '43333333-3333-4333-8333-333333333333'),
  'analyst',
  'the new member role is persisted'
);

select throws_ok(
  format(
    $$select public.workspace_update_member(%L, %L, %L, 'admin', 'active')$$,
    current_setting('test.team_org')::uuid,
    (select id from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '41111111-1111-4111-8111-111111111111'),
    '42222222-2222-4222-8222-222222222222'::uuid
  ),
  '42501',
  'Only an owner can change owner access.',
  'an admin cannot change an owner role'
);

select lives_ok(
  format(
    $$select public.workspace_remove_member(%L, %L, %L)$$,
    current_setting('test.team_org')::uuid,
    (select id from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '43333333-3333-4333-8333-333333333333'),
    '42222222-2222-4222-8222-222222222222'::uuid
  ),
  'an admin can remove a non-owner member'
);

select is(
  (select count(*)::integer from public.memberships where org_id = current_setting('test.team_org')::uuid and user_id = '43333333-3333-4333-8333-333333333333'),
  0,
  'removed members no longer have workspace access'
);

select lives_ok(
  $$select public.account_create_request('44444444-4444-4444-8444-444444444444', 'export')$$,
  'a user can request an account export through the server workflow'
);

select lives_ok(
  $$select public.account_create_request('44444444-4444-4444-8444-444444444444', 'export')$$,
  'repeating an open account request is idempotent'
);

select is(
  (select count(*)::integer from public.account_requests where user_id = '44444444-4444-4444-8444-444444444444' and request_type = 'export'),
  1,
  'only one open export request is created'
);

select * from finish();
rollback;
