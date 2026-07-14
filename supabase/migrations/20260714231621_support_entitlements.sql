create table public.organization_entitlements (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  plan text not null default 'pilot'
    check (plan in ('pilot', 'starter', 'growth', 'enterprise', 'internal')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  seat_limit integer not null default 5 check (seat_limit between 1 and 1000),
  research_runs_limit integer not null default 25 check (research_runs_limit between 0 and 1000000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.provider_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  research_run_id uuid references public.research_runs(id) on delete set null,
  provider text not null check (provider in ('bright_data', 'nvidia', 'source_retrieval')),
  operation text not null check (char_length(operation) between 1 and 100),
  status text not null default 'running'
    check (status in ('running', 'complete', 'degraded', 'failed')),
  request_id uuid not null default gen_random_uuid(),
  model text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  source_count integer not null default 0 check (source_count >= 0),
  error_category text,
  error_summary text check (error_summary is null or char_length(error_summary) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);

create index provider_jobs_org_created_idx
  on public.provider_jobs(org_id, created_at desc);
create index provider_jobs_attention_idx
  on public.provider_jobs(status, created_at desc)
  where status in ('degraded', 'failed');

insert into public.organization_entitlements (org_id, plan, status, ends_at)
select id, 'pilot', 'trialing', now() + interval '30 days'
from public.organizations
on conflict (org_id) do nothing;

create function public.create_default_organization_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_entitlements (org_id, plan, status, ends_at)
  values (new.id, 'pilot', 'trialing', now() + interval '30 days')
  on conflict (org_id) do nothing;
  return new;
end;
$$;

create trigger create_default_organization_entitlement_after_insert
after insert on public.organizations
for each row execute function public.create_default_organization_entitlement();

create trigger organization_entitlements_set_updated_at
before update on public.organization_entitlements
for each row execute function public.set_updated_at();

create function public.enforce_invitation_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_seats integer;
  reserved_seats integer;
begin
  select seat_limit into allowed_seats
  from public.organization_entitlements
  where org_id = new.org_id;
  if allowed_seats is null then
    return new;
  end if;

  select
    (select count(*) from public.memberships where org_id = new.org_id and status = 'active')
    +
    (select count(*) from public.invitations where org_id = new.org_id and status = 'pending')
  into reserved_seats;

  if reserved_seats >= allowed_seats then
    raise exception using errcode = '23514', message = 'This workspace has reached its seat limit.';
  end if;
  return new;
end;
$$;

create trigger enforce_invitation_seat_limit_before_insert
before insert on public.invitations
for each row execute function public.enforce_invitation_seat_limit();

create function public.enforce_membership_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_seats integer;
  active_seats integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  select seat_limit into allowed_seats
  from public.organization_entitlements
  where org_id = new.org_id;
  if allowed_seats is null then
    return new;
  end if;
  select count(*) into active_seats
  from public.memberships
  where org_id = new.org_id and status = 'active';
  if active_seats >= allowed_seats then
    raise exception using errcode = '23514', message = 'This workspace has reached its seat limit.';
  end if;
  return new;
end;
$$;

create trigger enforce_membership_seat_limit_before_activation
before insert or update of status on public.memberships
for each row execute function public.enforce_membership_seat_limit();

create function public.platform_update_entitlement(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_plan text,
  p_status text,
  p_seat_limit integer,
  p_research_runs_limit integer,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operator_role text;
  entitlement_row public.organization_entitlements%rowtype;
begin
  select raw_app_meta_data ->> 'platform_role' into operator_role
  from auth.users
  where id = p_actor_user_id;
  if operator_role is null or operator_role not in ('operator', 'admin') then
    raise exception using errcode = '42501', message = 'A platform operator role is required.';
  end if;
  if p_plan not in ('pilot', 'starter', 'growth', 'enterprise', 'internal') then
    raise exception using errcode = '22023', message = 'Choose a valid entitlement plan.';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'suspended', 'cancelled') then
    raise exception using errcode = '22023', message = 'Choose a valid entitlement status.';
  end if;
  if p_seat_limit not between 1 and 1000 or p_research_runs_limit not between 0 and 1000000 then
    raise exception using errcode = '22023', message = 'Entitlement limits are invalid.';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception using errcode = '22023', message = 'Entitlement end date must be in the future.';
  end if;

  insert into public.organization_entitlements (
    org_id, plan, status, seat_limit, research_runs_limit, ends_at, updated_by
  ) values (
    p_org_id, p_plan, p_status, p_seat_limit, p_research_runs_limit, p_ends_at, p_actor_user_id
  )
  on conflict (org_id) do update
  set plan = excluded.plan,
      status = excluded.status,
      seat_limit = excluded.seat_limit,
      research_runs_limit = excluded.research_runs_limit,
      ends_at = excluded.ends_at,
      updated_by = excluded.updated_by
  returning * into entitlement_row;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_org_id,
    p_actor_user_id,
    'platform.entitlement_updated',
    'organization_entitlement',
    p_org_id,
    jsonb_build_object(
      'plan', entitlement_row.plan,
      'status', entitlement_row.status,
      'seat_limit', entitlement_row.seat_limit,
      'research_runs_limit', entitlement_row.research_runs_limit,
      'ends_at', entitlement_row.ends_at
    )
  );

  return jsonb_build_object(
    'org_id', entitlement_row.org_id,
    'plan', entitlement_row.plan,
    'status', entitlement_row.status,
    'seat_limit', entitlement_row.seat_limit,
    'research_runs_limit', entitlement_row.research_runs_limit,
    'starts_at', entitlement_row.starts_at,
    'ends_at', entitlement_row.ends_at,
    'updated_at', entitlement_row.updated_at
  );
end;
$$;

alter table public.organization_entitlements enable row level security;
alter table public.provider_jobs enable row level security;

create policy organization_entitlements_select_members
on public.organization_entitlements
for select to authenticated
using (public.is_org_member(org_id));

revoke all on public.organization_entitlements from anon, authenticated;
revoke all on public.provider_jobs from anon, authenticated;
grant select on public.organization_entitlements to authenticated;
grant all on public.organization_entitlements to service_role;
grant all on public.provider_jobs to service_role;

revoke all on function public.create_default_organization_entitlement() from public;
revoke all on function public.enforce_invitation_seat_limit() from public;
revoke all on function public.enforce_membership_seat_limit() from public;
revoke all on function public.platform_update_entitlement(uuid, uuid, text, text, integer, integer, timestamptz) from public;
grant execute on function public.platform_update_entitlement(uuid, uuid, text, text, integer, integer, timestamptz) to service_role;

comment on table public.organization_entitlements
  is 'Workspace access and usage limits. Billing providers update this server-side after verification.';
comment on table public.provider_jobs
  is 'Server-only sanitized provider operation diagnostics for support and reliability monitoring.';
comment on function public.platform_update_entitlement(uuid, uuid, text, text, integer, integer, timestamptz)
  is 'Server-only entitlement update protected by auth app metadata and audit history.';
