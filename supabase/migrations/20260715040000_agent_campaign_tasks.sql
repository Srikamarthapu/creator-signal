alter table public.agent_action_confirmations
  drop constraint agent_action_confirmations_action_type_check;

alter table public.agent_action_confirmations
  add constraint agent_action_confirmations_action_type_check
  check (action_type in ('save_creator', 'create_campaign_task'));

alter table public.campaign_tasks
  add column agent_action_id uuid;

alter table public.campaign_tasks
  add constraint campaign_tasks_agent_action_fk
  foreign key (org_id, agent_action_id)
  references public.agent_action_confirmations(org_id, id)
  on delete set null (agent_action_id);

create unique index campaign_tasks_agent_action_idx
  on public.campaign_tasks(agent_action_id)
  where agent_action_id is not null;

create function public.workspace_create_campaign_task_from_agent(
  p_org_id uuid,
  p_campaign_id uuid,
  p_agent_action_id uuid,
  p_actor_user_id uuid
)
returns public.campaign_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_action public.agent_action_confirmations;
  current_campaign public.campaigns;
  existing_task public.campaign_tasks;
  next_task public.campaign_tasks;
  task_title text;
  task_due_at timestamptz;
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

  select * into current_action
  from public.agent_action_confirmations
  where org_id = p_org_id and id = p_agent_action_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Agent action not found.';
  end if;
  if current_action.action_type <> 'create_campaign_task'
    or current_action.status <> 'processing'
    or current_action.confirmed_by is distinct from p_actor_user_id
    or current_action.action_payload ->> 'requires_confirmation' <> 'true'
  then
    raise exception using errcode = 'P0001', message = 'Confirm this campaign task action before creating it.';
  end if;
  if current_action.action_payload ->> 'campaign_id' is distinct from p_campaign_id::text then
    raise exception using errcode = 'P0001', message = 'The campaign task target no longer matches its proposal.';
  end if;

  select * into existing_task
  from public.campaign_tasks
  where agent_action_id = p_agent_action_id;
  if found then
    return existing_task;
  end if;

  select * into current_campaign
  from public.campaigns
  where org_id = p_org_id and id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if current_campaign.status in ('complete', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'Tasks cannot be added to a closed campaign.';
  end if;
  if not exists (
    select 1 from public.research_runs
    where org_id = p_org_id
      and id = current_action.research_run_id
      and campaign_id = p_campaign_id
  ) then
    raise exception using errcode = 'P0001', message = 'The campaign is no longer linked to this research.';
  end if;

  task_title := nullif(trim(current_action.action_payload ->> 'task_title'), '');
  if task_title is null or char_length(task_title) > 240 then
    raise exception using errcode = '22023', message = 'The proposed campaign task title is invalid.';
  end if;
  begin
    task_due_at := nullif(current_action.action_payload ->> 'due_at', '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception using errcode = '22023', message = 'The proposed campaign task due date is invalid.';
  end;

  insert into public.campaign_tasks (
    org_id,
    campaign_id,
    title,
    owner_id,
    due_at,
    created_by,
    agent_action_id
  ) values (
    p_org_id,
    p_campaign_id,
    task_title,
    p_actor_user_id,
    task_due_at,
    p_actor_user_id,
    p_agent_action_id
  ) returning * into next_task;

  insert into public.audit_events (
    org_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload,
    request_id
  ) values (
    p_org_id,
    p_actor_user_id,
    'campaign.task_created',
    'campaign_task',
    next_task.id,
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'title', next_task.title,
      'agent_action_id', p_agent_action_id,
      'conversation_id', current_action.conversation_id,
      'research_run_id', current_action.research_run_id
    ),
    p_agent_action_id
  );

  return next_task;
end;
$$;

revoke all on function public.workspace_create_campaign_task_from_agent(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.workspace_create_campaign_task_from_agent(uuid, uuid, uuid, uuid)
  to service_role;

comment on column public.campaign_tasks.agent_action_id
  is 'The confirmed server-owned agent proposal that idempotently created this task.';

comment on function public.workspace_create_campaign_task_from_agent(uuid, uuid, uuid, uuid)
  is 'Creates one audited campaign task from a confirmed canonical agent action without accepting browser-supplied task content.';
