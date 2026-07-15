create table public.campaign_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  research_run_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'rejected')),
  version integer not null default 1 check (version > 0),
  brief jsonb not null,
  source_references jsonb not null default '[]'::jsonb,
  provider text not null check (provider in ('nvidia', 'source_retrieval', 'user')),
  model text,
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, research_run_id),
  foreign key (org_id, research_run_id)
    references public.research_runs(org_id, id) on delete cascade,
  check (jsonb_typeof(brief) = 'object'),
  check (jsonb_typeof(source_references) = 'array'),
  check ((status = 'approved') = (approved_at is not null))
);

create index campaign_briefs_org_status_idx
  on public.campaign_briefs(org_id, status, updated_at desc);

create trigger campaign_briefs_set_updated_at
before update on public.campaign_briefs
for each row execute function public.set_updated_at();

create function public.workspace_save_campaign_brief(
  p_org_id uuid,
  p_research_run_id uuid,
  p_actor_user_id uuid,
  p_brief jsonb,
  p_source_references jsonb,
  p_provider text,
  p_model text default null
)
returns public.campaign_briefs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  existing_brief public.campaign_briefs;
  saved_brief public.campaign_briefs;
  event_name text;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';

  if actor_role is null or actor_role not in ('owner', 'admin', 'marketer') then
    raise exception using errcode = '42501', message = 'A workspace manager role is required to prepare a campaign brief.';
  end if;
  if not exists (
    select 1 from public.research_runs
    where org_id = p_org_id and id = p_research_run_id
  ) then
    raise exception using errcode = 'P0002', message = 'Source research for this campaign brief was not found.';
  end if;
  if p_provider not in ('nvidia', 'source_retrieval', 'user') then
    raise exception using errcode = '22023', message = 'Choose a valid campaign brief provider.';
  end if;
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    raise exception using errcode = '22023', message = 'Campaign brief content must be a structured object.';
  end if;
  if coalesce(char_length(trim(p_brief ->> 'campaignName')), 0) not between 1 and 160
    or coalesce(char_length(trim(p_brief ->> 'objective')), 0) not between 1 and 1000
    or coalesce(char_length(trim(p_brief ->> 'audience')), 0) not between 1 and 500
    or coalesce(char_length(trim(p_brief ->> 'keyMessage')), 0) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Complete the campaign name, objective, audience, and key message.';
  end if;
  if jsonb_typeof(coalesce(p_brief -> 'platforms', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_brief -> 'deliverables', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_brief -> 'successMeasures', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_brief -> 'assumptions', 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Campaign brief lists must use structured arrays.';
  end if;
  if p_source_references is null or jsonb_typeof(p_source_references) <> 'array' then
    raise exception using errcode = '22023', message = 'Campaign brief sources must use a structured array.';
  end if;

  select * into existing_brief
  from public.campaign_briefs
  where org_id = p_org_id and research_run_id = p_research_run_id
  for update;

  insert into public.campaign_briefs (
    org_id,
    research_run_id,
    brief,
    source_references,
    provider,
    model,
    created_by
  ) values (
    p_org_id,
    p_research_run_id,
    p_brief,
    p_source_references,
    p_provider,
    nullif(trim(p_model), ''),
    p_actor_user_id
  )
  on conflict (org_id, research_run_id) do update set
    status = 'draft',
    version = public.campaign_briefs.version + 1,
    brief = excluded.brief,
    source_references = excluded.source_references,
    provider = excluded.provider,
    model = excluded.model,
    reviewed_by = null,
    reviewed_at = null,
    approved_by = null,
    approved_at = null
  returning * into saved_brief;

  event_name := case when existing_brief.id is null
    then 'campaign_brief.generated'
    else 'campaign_brief.revised'
  end;
  insert into public.audit_events (
    org_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_org_id,
    p_actor_user_id,
    event_name,
    'campaign_brief',
    saved_brief.id,
    jsonb_build_object(
      'research_run_id', p_research_run_id,
      'version', saved_brief.version,
      'provider', p_provider,
      'tools', case when p_provider = 'user'
        then '[]'::jsonb
        else jsonb_build_array('prepare_campaign_brief', 'search_research')
      end,
      'previous_status', existing_brief.status
    )
  );

  return saved_brief;
end;
$$;

create function public.workspace_transition_campaign_brief(
  p_org_id uuid,
  p_research_run_id uuid,
  p_actor_user_id uuid,
  p_status text
)
returns public.campaign_briefs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  current_brief public.campaign_briefs;
  next_brief public.campaign_briefs;
  event_name text;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id
    and user_id = p_actor_user_id
    and status = 'active';

  if actor_role is null then
    raise exception using errcode = '42501', message = 'An active workspace membership is required.';
  end if;
  if p_status not in ('draft', 'review', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Choose a valid campaign brief status.';
  end if;

  select * into current_brief
  from public.campaign_briefs
  where org_id = p_org_id and research_run_id = p_research_run_id
  for update;
  if current_brief.id is null then
    raise exception using errcode = 'P0002', message = 'Campaign brief not found.';
  end if;
  if current_brief.status = p_status then
    return current_brief;
  end if;

  if p_status = 'review' then
    if actor_role not in ('owner', 'admin', 'marketer') or current_brief.status not in ('draft', 'rejected') then
      raise exception using errcode = '42501', message = 'A workspace manager can submit only a draft or rejected brief for review.';
    end if;
    event_name := 'campaign_brief.review_requested';
  elsif p_status = 'approved' then
    if actor_role not in ('owner', 'admin', 'approver') or current_brief.status <> 'review' then
      raise exception using errcode = '42501', message = 'An approver must review the campaign brief before approval.';
    end if;
    event_name := 'campaign_brief.approved';
  elsif p_status = 'rejected' then
    if actor_role not in ('owner', 'admin', 'approver') or current_brief.status <> 'review' then
      raise exception using errcode = '42501', message = 'An approver can reject only a campaign brief in review.';
    end if;
    event_name := 'campaign_brief.rejected';
  else
    if actor_role not in ('owner', 'admin', 'marketer')
      or current_brief.status not in ('review', 'approved', 'rejected') then
      raise exception using errcode = '42501', message = 'A workspace manager is required to reopen this campaign brief.';
    end if;
    event_name := case when current_brief.status = 'approved'
      then 'campaign_brief.approval_reopened'
      else 'campaign_brief.returned_to_draft'
    end;
  end if;

  update public.campaign_briefs set
    status = p_status,
    reviewed_by = case when p_status = 'review' then p_actor_user_id else reviewed_by end,
    reviewed_at = case when p_status = 'review' then now() else reviewed_at end,
    approved_by = case when p_status = 'approved' then p_actor_user_id else null end,
    approved_at = case when p_status = 'approved' then now() else null end
  where id = current_brief.id
  returning * into next_brief;

  insert into public.audit_events (
    org_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    p_org_id,
    p_actor_user_id,
    event_name,
    'campaign_brief',
    next_brief.id,
    jsonb_build_object(
      'research_run_id', p_research_run_id,
      'version', next_brief.version,
      'from', current_brief.status,
      'to', p_status
    )
  );

  return next_brief;
end;
$$;

alter table public.campaign_briefs enable row level security;

create policy campaign_briefs_select_members on public.campaign_briefs
for select to authenticated
using (public.is_org_member(org_id));

revoke all on public.campaign_briefs from anon, authenticated;
grant select on public.campaign_briefs to authenticated;
grant all on public.campaign_briefs to service_role;

revoke all on function public.workspace_save_campaign_brief(uuid, uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.workspace_transition_campaign_brief(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.workspace_save_campaign_brief(uuid, uuid, uuid, jsonb, jsonb, text, text) to service_role;
grant execute on function public.workspace_transition_campaign_brief(uuid, uuid, uuid, text) to service_role;

comment on table public.campaign_briefs
  is 'Versioned, source-referenced campaign briefs with explicit human review and approval state.';
comment on function public.workspace_save_campaign_brief(uuid, uuid, uuid, jsonb, jsonb, text, text)
  is 'Server-only manager workflow for creating or revising a campaign brief with audit history.';
comment on function public.workspace_transition_campaign_brief(uuid, uuid, uuid, text)
  is 'Server-only role-separated campaign brief review and approval state machine.';
