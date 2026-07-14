create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  account_type text not null default 'professional'
    check (account_type in ('creator', 'professional', 'business')),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  organization_type text not null default 'business'
    check (organization_type in ('personal', 'business', 'agency')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'marketer'
    check (role in ('owner', 'admin', 'marketer', 'approver', 'analyst')),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email extensions.citext not null,
  role text not null default 'marketer'
    check (role in ('admin', 'marketer', 'approver', 'analyst')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (accepted_at is null or status = 'accepted')
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  product text not null check (char_length(product) between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'sourcing', 'outreach', 'negotiation', 'contracted', 'active', 'review', 'complete', 'cancelled')),
  goal text,
  audience text,
  geography text,
  platform text,
  deliverable text,
  creator_budget_cents bigint check (creator_budget_cents is null or creator_budget_cents >= 0),
  service_budget_cents bigint check (service_budget_cents is null or service_budget_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  brief jsonb not null default '{}'::jsonb,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.research_runs (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'running'
    check (status in ('running', 'complete', 'partial', 'failed')),
  search_input jsonb not null,
  filter_state jsonb not null default '{}'::jsonb,
  product_brief jsonb,
  provider_snapshot jsonb not null default '{}'::jsonb,
  source_count integer not null default 0 check (source_count >= 0),
  creator_count integer not null default 0 check (creator_count >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete set null (campaign_id)
);

create table public.creator_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  handle text,
  platform text not null,
  profile_url text,
  niche text,
  identity_key text not null,
  verification_class text not null default 'public_evidence'
    check (verification_class in ('public_evidence', 'creator_declared', 'connected_verified', 'vendor_estimated', 'campaign_outcome')),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, identity_key)
);

create table public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  research_run_id uuid not null,
  creator_id uuid,
  provider text not null,
  source_url text not null check (source_url ~ '^https?://'),
  source_type text not null
    check (source_type in ('profile', 'post', 'article', 'search_result', 'product_source')),
  title text not null,
  excerpt text,
  verification_class text not null default 'public_evidence'
    check (verification_class in ('public_evidence', 'creator_declared', 'connected_verified', 'vendor_estimated', 'campaign_outcome')),
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  content_hash text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, research_run_id) references public.research_runs(org_id, id) on delete cascade,
  foreign key (org_id, creator_id) references public.creator_records(org_id, id) on delete cascade,
  unique (research_run_id, source_url)
);

create table public.creator_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  research_run_id uuid not null,
  creator_id uuid not null,
  primary_evidence_id uuid,
  rank integer check (rank is null or rank > 0),
  source_score numeric(5,2) check (source_score between 0 and 100),
  ai_score numeric(5,2) check (ai_score between 0 and 100),
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  match_reason text not null,
  strengths jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  recommended_use text,
  model_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, research_run_id) references public.research_runs(org_id, id) on delete cascade,
  foreign key (org_id, creator_id) references public.creator_records(org_id, id) on delete cascade,
  foreign key (primary_evidence_id) references public.evidence_sources(id) on delete set null,
  unique (research_run_id, creator_id)
);

create table public.shortlists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  research_run_id uuid,
  name text not null check (char_length(name) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete cascade,
  foreign key (org_id, research_run_id) references public.research_runs(org_id, id) on delete set null (research_run_id)
);

create table public.shortlist_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shortlist_id uuid not null,
  creator_id uuid not null,
  recommendation_id uuid,
  decision text not null default 'saved' check (decision in ('saved', 'rejected', 'restored', 'archived')),
  decision_reasons text[] not null default '{}',
  tags text[] not null default '{}',
  notes text,
  assigned_to uuid references auth.users(id) on delete set null,
  position integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, shortlist_id) references public.shortlists(org_id, id) on delete cascade,
  foreign key (org_id, creator_id) references public.creator_records(org_id, id) on delete cascade,
  foreign key (org_id, recommendation_id) references public.creator_recommendations(org_id, id) on delete set null (recommendation_id),
  unique (shortlist_id, creator_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid,
  research_run_id uuid,
  title text not null default 'Campaign copilot',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete cascade,
  foreign key (org_id, research_run_id) references public.research_runs(org_id, id) on delete set null (research_run_id)
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  author_user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  foreign key (org_id, conversation_id) references public.conversations(org_id, id) on delete cascade
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_message_id uuid not null,
  model text not null,
  provider text not null,
  status text not null check (status in ('running', 'complete', 'failed', 'degraded')),
  source_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  foreign key (org_id, conversation_id) references public.conversations(org_id, id) on delete cascade,
  unique (conversation_id, request_message_id)
);

create table public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  tool_name text not null,
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  status text not null check (status in ('complete', 'failed', 'denied')),
  created_at timestamptz not null default now()
);

create table public.campaign_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  owner_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete cascade
);

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  creator_id uuid not null,
  subject text,
  body text not null,
  source_references jsonb not null default '[]'::jsonb,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'review', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete cascade,
  foreign key (org_id, creator_id) references public.creator_records(org_id, id) on delete cascade
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create table public.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('export', 'deletion')),
  status text not null default 'requested' check (status in ('requested', 'processing', 'complete', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index memberships_user_id_idx on public.memberships(user_id) where status = 'active';
create unique index invitations_one_pending_per_email_idx on public.invitations(org_id, email) where status = 'pending';
create index campaigns_org_status_idx on public.campaigns(org_id, status, updated_at desc);
create index research_runs_org_updated_idx on public.research_runs(org_id, updated_at desc);
create index creator_records_org_observed_idx on public.creator_records(org_id, last_observed_at desc);
create index evidence_sources_creator_idx on public.evidence_sources(org_id, creator_id, observed_at desc);
create index recommendations_run_rank_idx on public.creator_recommendations(research_run_id, rank);
create unique index shortlists_one_active_run_idx on public.shortlists(org_id, research_run_id)
  where research_run_id is not null and status <> 'archived';
create index shortlist_entries_shortlist_position_idx on public.shortlist_entries(shortlist_id, position, created_at);
create index messages_conversation_created_idx on public.conversation_messages(conversation_id, created_at);
create index tasks_campaign_status_idx on public.campaign_tasks(campaign_id, status, due_at);
create index audit_events_org_created_idx on public.audit_events(org_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'memberships', 'campaigns', 'research_runs',
    'creator_records', 'shortlists', 'shortlist_entries', 'conversations',
    'campaign_tasks', 'outreach_drafts'
  ]
  loop
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create function public.add_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.memberships (org_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger add_organization_owner_after_insert
after insert on public.organizations
for each row execute function public.add_organization_owner();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_type text;
  workspace_name text;
  workspace_slug text;
begin
  selected_type := case
    when new.raw_user_meta_data ->> 'account_type' in ('creator', 'professional', 'business')
      then new.raw_user_meta_data ->> 'account_type'
    else 'professional'
  end;
  workspace_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'Workspace'), '@', 1)
  );
  workspace_name := left(workspace_name, 100);
  workspace_slug := coalesce(
    nullif(trim(both '-' from lower(regexp_replace(workspace_name, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
    'workspace'
  )
    || '-' || substr(new.id::text, 1, 8);

  insert into public.profiles (id, display_name, account_type)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), selected_type);

  insert into public.organizations (name, slug, organization_type, created_by)
  values (
    workspace_name,
    workspace_slug,
    case when selected_type = 'business' then 'business' else 'personal' end,
    new.id
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = target_org
      and user_id = (select auth.uid())
      and status = 'active'
  );
$$;

create function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = target_org
      and user_id = (select auth.uid())
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

create function public.is_workspace_colleague(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid()) or exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = target_user
      and theirs.status = 'active'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.is_workspace_colleague(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.is_workspace_colleague(uuid) to authenticated;

create function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removing_owner boolean;
  active_owner_count integer;
begin
  if not exists (select 1 from public.organizations where id = old.org_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  removing_owner := old.role = 'owner' and old.status = 'active' and (
    tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active'
  );
  if removing_owner then
    select count(*) into active_owner_count
    from public.memberships
    where org_id = old.org_id and role = 'owner' and status = 'active';
    if active_owner_count <= 1 then
      raise exception 'An organization must keep at least one active owner.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_last_owner_before_change
before update or delete on public.memberships
for each row execute function public.protect_last_owner();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.account_requests enable row level security;

create policy profiles_select_colleagues on public.profiles
for select to authenticated
using (public.is_workspace_colleague(id));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organizations_select_members on public.organizations
for select to authenticated
using (public.is_org_member(id));

create policy organizations_insert_owner on public.organizations
for insert to authenticated
with check (created_by = (select auth.uid()));

create policy organizations_update_admins on public.organizations
for update to authenticated
using (public.has_org_role(id, array['owner', 'admin']))
with check (public.has_org_role(id, array['owner', 'admin']));

create policy memberships_select_members on public.memberships
for select to authenticated
using (public.is_org_member(org_id));

create policy memberships_insert_admins on public.memberships
for insert to authenticated
with check (
  public.has_org_role(org_id, array['owner'])
  or (public.has_org_role(org_id, array['admin']) and role <> 'owner')
);

create policy memberships_update_admins on public.memberships
for update to authenticated
using (
  public.has_org_role(org_id, array['owner'])
  or (public.has_org_role(org_id, array['admin']) and role <> 'owner')
)
with check (
  public.has_org_role(org_id, array['owner'])
  or (public.has_org_role(org_id, array['admin']) and role <> 'owner')
);

create policy memberships_delete_admins on public.memberships
for delete to authenticated
using (
  public.has_org_role(org_id, array['owner'])
  or (public.has_org_role(org_id, array['admin']) and role <> 'owner')
);

create policy invitations_select_admins on public.invitations
for select to authenticated
using (public.has_org_role(org_id, array['owner', 'admin']));

create policy invitations_insert_admins on public.invitations
for insert to authenticated
with check (public.has_org_role(org_id, array['owner', 'admin']));

create policy invitations_update_admins on public.invitations
for update to authenticated
using (public.has_org_role(org_id, array['owner', 'admin']))
with check (public.has_org_role(org_id, array['owner', 'admin']));

create policy invitations_delete_admins on public.invitations
for delete to authenticated
using (public.has_org_role(org_id, array['owner', 'admin']));

create policy account_requests_select_self on public.account_requests
for select to authenticated
using (user_id = (select auth.uid()));

create policy account_requests_insert_self on public.account_requests
for insert to authenticated
with check (user_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'campaigns', 'shortlists', 'shortlist_entries', 'conversations',
    'campaign_tasks', 'outreach_drafts'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))',
      table_name || '_select_members', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_org_role(org_id, array[''owner'', ''admin'', ''marketer'']))',
      table_name || '_insert_managers', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_org_role(org_id, array[''owner'', ''admin'', ''marketer''])) with check (public.has_org_role(org_id, array[''owner'', ''admin'', ''marketer'']))',
      table_name || '_update_managers', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_org_role(org_id, array[''owner'', ''admin'', ''marketer'']))',
      table_name || '_delete_managers', table_name
    );
  end loop;

  foreach table_name in array array[
    'research_runs', 'creator_records', 'evidence_sources', 'creator_recommendations',
    'conversation_messages', 'agent_runs', 'agent_tool_calls', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))',
      table_name || '_select_members', table_name
    );
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.organizations to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select (id, org_id, email, role, invited_by, status, expires_at, accepted_at, created_at)
  on public.invitations to authenticated;
grant insert, update, delete on public.invitations to authenticated;
grant select, insert on public.account_requests to authenticated;
grant select, insert, update, delete on
  public.campaigns,
  public.shortlists,
  public.shortlist_entries,
  public.conversations,
  public.campaign_tasks,
  public.outreach_drafts
to authenticated;
grant select on
  public.research_runs,
  public.creator_records,
  public.evidence_sources,
  public.creator_recommendations,
  public.conversation_messages,
  public.agent_runs,
  public.agent_tool_calls,
  public.audit_events
to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke update, delete on public.audit_events from authenticated;
revoke update, delete on public.conversation_messages from authenticated;

comment on table public.evidence_sources is 'Immutable external observations with provider provenance and freshness metadata.';
comment on table public.audit_events is 'Append-only audit history for approvals and consequential actions.';
comment on column public.invitations.token_hash is 'Server-only hash; never return invitation secrets through the client Data API.';
