create function public.workspace_set_shortlist_entry_decision(
  p_org_id uuid,
  p_shortlist_id uuid,
  p_entry_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reasons text[] default '{}',
  p_notes text default null
)
returns public.shortlist_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  shortlist_status text;
  next_entry public.shortlist_entries;
begin
  if not exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;

  if p_decision not in ('saved', 'rejected', 'restored', 'archived') then
    raise exception using errcode = '22023', message = 'Choose a valid creator decision.';
  end if;
  if p_decision = 'rejected' and coalesce(cardinality(p_reasons), 0) = 0 then
    raise exception using errcode = '22023', message = 'Choose at least one rejection reason.';
  end if;

  select status into shortlist_status
  from public.shortlists
  where org_id = p_org_id and id = p_shortlist_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist not found.';
  end if;
  if shortlist_status not in ('draft', 'review') then
    raise exception using errcode = 'P0001', message = 'Reopen the shortlist before changing creator decisions.';
  end if;

  update public.shortlist_entries
  set
    decision = p_decision,
    decision_reasons = case when p_decision = 'rejected' then coalesce(p_reasons, '{}') else '{}' end,
    notes = nullif(trim(coalesce(p_notes, '')), '')
  where org_id = p_org_id
    and shortlist_id = p_shortlist_id
    and id = p_entry_id
  returning * into next_entry;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist creator not found.';
  end if;

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
    'shortlist.creator_decision_changed',
    'shortlist_entry',
    p_entry_id,
    jsonb_build_object(
      'shortlist_id', p_shortlist_id,
      'decision', p_decision,
      'reasons', coalesce(to_jsonb(p_reasons), '[]'::jsonb)
    )
  );

  return next_entry;
end;
$$;

create function public.workspace_transition_shortlist(
  p_org_id uuid,
  p_shortlist_id uuid,
  p_actor_user_id uuid,
  p_status text
)
returns public.shortlists
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  current_shortlist public.shortlists;
  next_shortlist public.shortlists;
  selected_count integer;
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

  select * into current_shortlist
  from public.shortlists
  where org_id = p_org_id and id = p_shortlist_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist not found.';
  end if;
  if current_shortlist.status = p_status then
    return current_shortlist;
  end if;

  if p_status = 'approved' then
    if actor_role not in ('owner', 'admin', 'approver') then
      raise exception using errcode = '42501', message = 'An approver role is required.';
    end if;
    if current_shortlist.status not in ('draft', 'review') then
      raise exception using errcode = 'P0001', message = 'Only a draft or review shortlist can be approved.';
    end if;
    select count(*) into selected_count
    from public.shortlist_entries
    where org_id = p_org_id
      and shortlist_id = p_shortlist_id
      and decision in ('saved', 'restored');
    if selected_count = 0 then
      raise exception using errcode = 'P0001', message = 'At least one creator must remain on the shortlist.';
    end if;
    event_name := 'shortlist.approved';
  elsif p_status = 'review' then
    if actor_role not in ('owner', 'admin', 'marketer') then
      raise exception using errcode = '42501', message = 'A workspace manager role is required.';
    end if;
    if current_shortlist.status not in ('draft', 'approved') then
      raise exception using errcode = 'P0001', message = 'This shortlist cannot enter review from its current state.';
    end if;
    select count(*) into selected_count
    from public.shortlist_entries
    where org_id = p_org_id
      and shortlist_id = p_shortlist_id
      and decision in ('saved', 'restored');
    if selected_count = 0 then
      raise exception using errcode = 'P0001', message = 'At least one creator must remain on the shortlist.';
    end if;
    event_name := case when current_shortlist.status = 'approved' then 'shortlist.review_reopened' else 'shortlist.review_requested' end;
  elsif p_status = 'draft' then
    if actor_role not in ('owner', 'admin', 'marketer') or current_shortlist.status <> 'review' then
      raise exception using errcode = '42501', message = 'Only a workspace manager can withdraw a shortlist from review.';
    end if;
    event_name := 'shortlist.review_withdrawn';
  elsif p_status = 'archived' then
    if actor_role not in ('owner', 'admin', 'marketer') then
      raise exception using errcode = '42501', message = 'A workspace manager role is required.';
    end if;
    event_name := 'shortlist.archived';
  else
    raise exception using errcode = '22023', message = 'Choose a valid shortlist status.';
  end if;

  update public.shortlists
  set
    status = p_status,
    approved_by = case when p_status = 'approved' then p_actor_user_id else null end,
    approved_at = case when p_status = 'approved' then now() else null end
  where org_id = p_org_id and id = p_shortlist_id
  returning * into next_shortlist;

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
    'shortlist',
    p_shortlist_id,
    jsonb_build_object('from', current_shortlist.status, 'to', p_status)
  );

  return next_shortlist;
end;
$$;

create function public.workspace_create_campaign_from_shortlist(
  p_org_id uuid,
  p_shortlist_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_creator_budget_cents bigint default null,
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_shortlist public.shortlists;
  source_research public.research_runs;
  new_campaign_id uuid;
  selected_count integer;
  product_name text;
  campaign_name text;
begin
  if not exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if p_creator_budget_cents is not null and p_creator_budget_cents < 0 then
    raise exception using errcode = '22023', message = 'Campaign budget cannot be negative.';
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then
    raise exception using errcode = '22023', message = 'Campaign end date must follow its start date.';
  end if;

  select * into source_shortlist
  from public.shortlists
  where org_id = p_org_id and id = p_shortlist_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shortlist not found.';
  end if;
  if source_shortlist.campaign_id is not null then
    return source_shortlist.campaign_id;
  end if;
  if source_shortlist.status <> 'approved' then
    raise exception using errcode = 'P0001', message = 'Approve the shortlist before creating a campaign.';
  end if;
  if source_shortlist.research_run_id is null then
    raise exception using errcode = 'P0001', message = 'This shortlist has no source-backed research session.';
  end if;

  select * into source_research
  from public.research_runs
  where org_id = p_org_id and id = source_shortlist.research_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Source research was not found.';
  end if;

  select count(*) into selected_count
  from public.shortlist_entries
  where org_id = p_org_id
    and shortlist_id = p_shortlist_id
    and decision in ('saved', 'restored');
  if selected_count = 0 then
    raise exception using errcode = 'P0001', message = 'At least one creator must remain on the shortlist.';
  end if;

  product_name := nullif(trim(source_research.search_input ->> 'product'), '');
  if product_name is null then
    raise exception using errcode = 'P0001', message = 'The source research is missing its product.';
  end if;
  campaign_name := coalesce(nullif(trim(p_name), ''), left(product_name || ' creator campaign', 160));
  if char_length(campaign_name) > 160 then
    raise exception using errcode = '22023', message = 'Campaign name is too long.';
  end if;

  insert into public.campaigns (
    org_id,
    created_by,
    owner_id,
    name,
    product,
    status,
    goal,
    audience,
    platform,
    creator_budget_cents,
    brief,
    starts_on,
    ends_on
  ) values (
    p_org_id,
    p_actor_user_id,
    p_actor_user_id,
    campaign_name,
    product_name,
    'sourcing',
    nullif(trim(source_research.search_input ->> 'goal'), ''),
    nullif(trim(source_research.search_input ->> 'audience'), ''),
    nullif(trim(source_research.search_input ->> 'platform'), ''),
    p_creator_budget_cents,
    coalesce(source_research.product_brief, '{}'::jsonb)
      || jsonb_build_object('source_research_run_id', source_research.id),
    p_starts_on,
    p_ends_on
  ) returning id into new_campaign_id;

  update public.shortlists
  set campaign_id = new_campaign_id
  where org_id = p_org_id and id = p_shortlist_id;

  update public.research_runs
  set campaign_id = new_campaign_id
  where org_id = p_org_id and id = source_research.id;

  insert into public.campaign_tasks (org_id, campaign_id, title, owner_id, created_by)
  values
    (p_org_id, new_campaign_id, 'Confirm creator evidence is current', p_actor_user_id, p_actor_user_id),
    (p_org_id, new_campaign_id, 'Prepare and approve outreach drafts', p_actor_user_id, p_actor_user_id),
    (p_org_id, new_campaign_id, 'Record creator replies and next actions', p_actor_user_id, p_actor_user_id);

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
    'campaign.created_from_shortlist',
    'campaign',
    new_campaign_id,
    jsonb_build_object(
      'shortlist_id', p_shortlist_id,
      'research_run_id', source_research.id,
      'selected_creator_count', selected_count
    )
  );

  return new_campaign_id;
end;
$$;

create function public.workspace_set_campaign_status(
  p_org_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_status text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_campaign public.campaigns;
  next_campaign public.campaigns;
  transition_allowed boolean := false;
  unfinished_tasks integer;
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;

  select * into current_campaign
  from public.campaigns
  where org_id = p_org_id and id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if current_campaign.status = p_status then
    return current_campaign;
  end if;

  transition_allowed := case current_campaign.status
    when 'draft' then p_status in ('sourcing', 'cancelled')
    when 'sourcing' then p_status in ('draft', 'outreach', 'cancelled')
    when 'outreach' then p_status in ('sourcing', 'negotiation', 'active', 'cancelled')
    when 'negotiation' then p_status in ('outreach', 'contracted', 'cancelled')
    when 'contracted' then p_status in ('negotiation', 'active', 'cancelled')
    when 'active' then p_status in ('contracted', 'review', 'cancelled')
    when 'review' then p_status in ('active', 'complete', 'cancelled')
    else false
  end;
  if not transition_allowed then
    raise exception using errcode = 'P0001', message = 'That campaign stage transition is not allowed.';
  end if;

  if p_status = 'complete' then
    select count(*) into unfinished_tasks
    from public.campaign_tasks
    where org_id = p_org_id
      and campaign_id = p_campaign_id
      and status not in ('done', 'cancelled');
    if unfinished_tasks > 0 then
      raise exception using errcode = 'P0001', message = 'Complete or cancel every campaign task before closing the campaign.';
    end if;
  end if;

  update public.campaigns
  set status = p_status
  where org_id = p_org_id and id = p_campaign_id
  returning * into next_campaign;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'campaign.status_changed',
    'campaign',
    p_campaign_id,
    jsonb_build_object('from', current_campaign.status, 'to', p_status)
  );
  return next_campaign;
end;
$$;

create function public.workspace_create_campaign_task(
  p_org_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_title text,
  p_due_at timestamptz default null
)
returns public.campaign_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_task public.campaign_tasks;
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if not exists (select 1 from public.campaigns where org_id = p_org_id and id = p_campaign_id) then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 240 then
    raise exception using errcode = '22023', message = 'Enter a task title of 240 characters or fewer.';
  end if;

  insert into public.campaign_tasks (org_id, campaign_id, title, owner_id, due_at, created_by)
  values (p_org_id, p_campaign_id, trim(p_title), p_actor_user_id, p_due_at, p_actor_user_id)
  returning * into next_task;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'campaign.task_created',
    'campaign_task',
    next_task.id,
    jsonb_build_object('campaign_id', p_campaign_id, 'title', next_task.title)
  );
  return next_task;
end;
$$;

create function public.workspace_set_campaign_task_status(
  p_org_id uuid,
  p_campaign_id uuid,
  p_task_id uuid,
  p_actor_user_id uuid,
  p_status text
)
returns public.campaign_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task public.campaign_tasks;
  next_task public.campaign_tasks;
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if p_status not in ('open', 'in_progress', 'blocked', 'done', 'cancelled') then
    raise exception using errcode = '22023', message = 'Choose a valid task status.';
  end if;

  select * into current_task
  from public.campaign_tasks
  where org_id = p_org_id and campaign_id = p_campaign_id and id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Campaign task not found.';
  end if;
  if current_task.status = p_status then
    return current_task;
  end if;

  update public.campaign_tasks
  set status = p_status
  where id = p_task_id
  returning * into next_task;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'campaign.task_status_changed',
    'campaign_task',
    p_task_id,
    jsonb_build_object('campaign_id', p_campaign_id, 'from', current_task.status, 'to', p_status)
  );
  return next_task;
end;
$$;

create function public.workspace_store_outreach_draft(
  p_org_id uuid,
  p_campaign_id uuid,
  p_creator_id uuid,
  p_actor_user_id uuid,
  p_subject text,
  p_body text,
  p_source_references jsonb
)
returns public.outreach_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_draft public.outreach_drafts;
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if not exists (select 1 from public.campaigns where org_id = p_org_id and id = p_campaign_id) then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if not exists (select 1 from public.creator_records where org_id = p_org_id and id = p_creator_id) then
    raise exception using errcode = 'P0002', message = 'Creator not found.';
  end if;
  if nullif(trim(p_body), '') is null or char_length(p_body) > 6000 then
    raise exception using errcode = '22023', message = 'Outreach body must contain 6000 characters or fewer.';
  end if;
  if jsonb_typeof(coalesce(p_source_references, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_source_references) = 0 then
    raise exception using errcode = '22023', message = 'Grounded outreach requires at least one source reference.';
  end if;

  insert into public.outreach_drafts (
    org_id, campaign_id, creator_id, subject, body, source_references, created_by
  ) values (
    p_org_id,
    p_campaign_id,
    p_creator_id,
    nullif(trim(coalesce(p_subject, '')), ''),
    trim(p_body),
    p_source_references,
    p_actor_user_id
  ) returning * into next_draft;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'outreach.draft_created',
    'outreach_draft',
    next_draft.id,
    jsonb_build_object('campaign_id', p_campaign_id, 'creator_id', p_creator_id, 'source_count', jsonb_array_length(p_source_references))
  );
  return next_draft;
end;
$$;

create function public.workspace_transition_outreach_draft(
  p_org_id uuid,
  p_campaign_id uuid,
  p_draft_id uuid,
  p_actor_user_id uuid,
  p_status text
)
returns public.outreach_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  current_draft public.outreach_drafts;
  next_draft public.outreach_drafts;
begin
  select role into actor_role
  from public.memberships
  where org_id = p_org_id and user_id = p_actor_user_id and status = 'active';
  if actor_role is null then
    raise exception using errcode = '42501', message = 'An active workspace membership is required.';
  end if;

  select * into current_draft
  from public.outreach_drafts
  where org_id = p_org_id and campaign_id = p_campaign_id and id = p_draft_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Outreach draft not found.';
  end if;
  if current_draft.approval_status = p_status then
    return current_draft;
  end if;

  if p_status in ('approved', 'rejected') then
    if actor_role not in ('owner', 'admin', 'approver') then
      raise exception using errcode = '42501', message = 'An approver role is required.';
    end if;
    if current_draft.approval_status <> 'review' then
      raise exception using errcode = 'P0001', message = 'Submit the outreach draft for review before an approval decision.';
    end if;
  elsif p_status = 'review' then
    if actor_role not in ('owner', 'admin', 'marketer') then
      raise exception using errcode = '42501', message = 'A workspace manager role is required.';
    end if;
    if current_draft.approval_status not in ('draft', 'rejected') then
      raise exception using errcode = 'P0001', message = 'Only a draft or rejected message can enter review.';
    end if;
  elsif p_status = 'draft' then
    if actor_role not in ('owner', 'admin', 'marketer') or current_draft.approval_status <> 'review' then
      raise exception using errcode = '42501', message = 'Only a workspace manager can withdraw outreach review.';
    end if;
  else
    raise exception using errcode = '22023', message = 'Choose a valid outreach approval status.';
  end if;

  update public.outreach_drafts
  set
    approval_status = p_status,
    approved_by = case when p_status = 'approved' then p_actor_user_id else null end,
    approved_at = case when p_status = 'approved' then now() else null end
  where id = p_draft_id
  returning * into next_draft;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'outreach.approval_status_changed',
    'outreach_draft',
    p_draft_id,
    jsonb_build_object('campaign_id', p_campaign_id, 'from', current_draft.approval_status, 'to', p_status)
  );
  return next_draft;
end;
$$;

create function public.workspace_update_outreach_draft(
  p_org_id uuid,
  p_campaign_id uuid,
  p_draft_id uuid,
  p_actor_user_id uuid,
  p_subject text,
  p_body text
)
returns public.outreach_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_draft public.outreach_drafts;
  next_draft public.outreach_drafts;
begin
  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = any(array['owner', 'admin', 'marketer'])
  ) then
    raise exception using errcode = '42501', message = 'A workspace manager role is required.';
  end if;
  if nullif(trim(p_body), '') is null or char_length(p_body) > 6000 then
    raise exception using errcode = '22023', message = 'Outreach body must contain 6000 characters or fewer.';
  end if;

  select * into current_draft
  from public.outreach_drafts
  where org_id = p_org_id and campaign_id = p_campaign_id and id = p_draft_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Outreach draft not found.';
  end if;
  if current_draft.approval_status not in ('draft', 'rejected') then
    raise exception using errcode = 'P0001', message = 'Withdraw outreach review before editing this draft.';
  end if;

  update public.outreach_drafts
  set
    subject = nullif(trim(coalesce(p_subject, '')), ''),
    body = trim(p_body),
    approval_status = 'draft',
    approved_by = null,
    approved_at = null
  where id = p_draft_id
  returning * into next_draft;

  insert into public.audit_events (org_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_org_id,
    p_actor_user_id,
    'outreach.draft_edited',
    'outreach_draft',
    p_draft_id,
    jsonb_build_object('campaign_id', p_campaign_id)
  );
  return next_draft;
end;
$$;

revoke all on function public.workspace_set_shortlist_entry_decision(uuid, uuid, uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.workspace_transition_shortlist(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_create_campaign_from_shortlist(uuid, uuid, uuid, text, bigint, date, date) from public, anon, authenticated;
revoke all on function public.workspace_set_campaign_status(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_create_campaign_task(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.workspace_set_campaign_task_status(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_store_outreach_draft(uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.workspace_transition_outreach_draft(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_update_outreach_draft(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.workspace_set_shortlist_entry_decision(uuid, uuid, uuid, uuid, text, text[], text) to service_role;
grant execute on function public.workspace_transition_shortlist(uuid, uuid, uuid, text) to service_role;
grant execute on function public.workspace_create_campaign_from_shortlist(uuid, uuid, uuid, text, bigint, date, date) to service_role;
grant execute on function public.workspace_set_campaign_status(uuid, uuid, uuid, text) to service_role;
grant execute on function public.workspace_create_campaign_task(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.workspace_set_campaign_task_status(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.workspace_store_outreach_draft(uuid, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.workspace_transition_outreach_draft(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.workspace_update_outreach_draft(uuid, uuid, uuid, uuid, text, text) to service_role;

comment on function public.workspace_set_shortlist_entry_decision(uuid, uuid, uuid, uuid, text, text[], text)
  is 'Server-only atomic creator decision and audit operation.';
comment on function public.workspace_transition_shortlist(uuid, uuid, uuid, text)
  is 'Server-only role-checked shortlist approval state machine with audit history.';
comment on function public.workspace_create_campaign_from_shortlist(uuid, uuid, uuid, text, bigint, date, date)
  is 'Server-only atomic conversion of an approved, source-backed shortlist into a campaign.';
comment on function public.workspace_set_campaign_status(uuid, uuid, uuid, text)
  is 'Server-only audited campaign stage state machine.';
comment on function public.workspace_create_campaign_task(uuid, uuid, uuid, text, timestamptz)
  is 'Server-only atomic campaign task creation and audit operation.';
comment on function public.workspace_set_campaign_task_status(uuid, uuid, uuid, uuid, text)
  is 'Server-only atomic campaign task status and audit operation.';
comment on function public.workspace_store_outreach_draft(uuid, uuid, uuid, uuid, text, text, jsonb)
  is 'Server-only grounded outreach persistence with source references and audit history.';
comment on function public.workspace_transition_outreach_draft(uuid, uuid, uuid, uuid, text)
  is 'Server-only role-separated outreach review and approval state machine.';
comment on function public.workspace_update_outreach_draft(uuid, uuid, uuid, uuid, text, text)
  is 'Server-only editable outreach draft update with immutable source references and audit history.';
