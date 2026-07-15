begin;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  'e1000000-0000-4000-8000-000000000001',
  'agent-task-owner@example.test',
  '{"full_name":"Agent Task Owner","account_type":"business","organization_name":"Agent Tasks"}'::jsonb,
  '{}'::jsonb
);

select is(
  (select count(*)::integer from public.profiles where id = 'e1000000-0000-4000-8000-000000000001'),
  1,
  'the agent task owner receives a workspace profile'
);

insert into public.campaigns (
  id, org_id, created_by, owner_id, name, product, status
)
values (
  'e2000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Quiet desk launch',
  'Ergonomic mouse',
  'sourcing'
);

insert into public.research_runs (
  id, org_id, campaign_id, created_by, status, search_input
)
values (
  'e3000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'complete',
  '{"product":"ergonomic mouse"}'::jsonb
);

insert into public.conversations (
  id, org_id, research_run_id, campaign_id, title, created_by
)
values (
  'e4000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Mouse creator campaign',
  'e1000000-0000-4000-8000-000000000001'
);

insert into public.conversation_messages (id, org_id, conversation_id, role, content)
values (
  'e5000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
  'e4000000-0000-4000-8000-000000000001',
  'assistant',
  'I prepared a campaign task for confirmation.'
);

insert into public.agent_action_confirmations (
  id, org_id, conversation_id, assistant_message_id, research_run_id,
  requested_by, action_type, status, action_payload, confirmed_by, confirmed_at
)
values
  (
    'e6000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e4000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'create_campaign_task',
    'processing',
    '{"campaign_id":"e2000000-0000-4000-8000-000000000001","campaign_name":"Quiet desk launch","task_title":"Contact Desk Tech about usage rights","due_at":null,"requires_confirmation":true}'::jsonb,
    'e1000000-0000-4000-8000-000000000001',
    now()
  ),
  (
    'e6000000-0000-4000-8000-000000000002',
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e4000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'create_campaign_task',
    'pending',
    '{"campaign_id":"e2000000-0000-4000-8000-000000000001","campaign_name":"Quiet desk launch","task_title":"Unconfirmed task","due_at":null,"requires_confirmation":true}'::jsonb,
    null,
    null
  ),
  (
    'e6000000-0000-4000-8000-000000000003',
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e4000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'create_campaign_task',
    'processing',
    '{"campaign_id":"e2000000-0000-4000-8000-000000000099","campaign_name":"Wrong campaign","task_title":"Misdirected task","due_at":null,"requires_confirmation":true}'::jsonb,
    'e1000000-0000-4000-8000-000000000001',
    now()
  );

select lives_ok(
  format(
    $$select public.workspace_create_campaign_task_from_agent(%L, %L, %L, %L)$$,
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e6000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid
  ),
  'a confirmed canonical proposal creates a campaign task'
);

select is(
  (select count(*)::integer from public.campaign_tasks where agent_action_id = 'e6000000-0000-4000-8000-000000000001'),
  1,
  'one campaign task is created for the proposal'
);
select is(
  (select title from public.campaign_tasks where agent_action_id = 'e6000000-0000-4000-8000-000000000001'),
  'Contact Desk Tech about usage rights',
  'the task title comes from the server-owned action payload'
);
select is(
  (select campaign_id from public.campaign_tasks where agent_action_id = 'e6000000-0000-4000-8000-000000000001'),
  'e2000000-0000-4000-8000-000000000001'::uuid,
  'the task remains scoped to the research-linked campaign'
);
select is(
  (select agent_action_id from public.campaign_tasks where agent_action_id = 'e6000000-0000-4000-8000-000000000001'),
  'e6000000-0000-4000-8000-000000000001'::uuid,
  'the task records the action that created it'
);
select is(
  (select count(*)::integer from public.audit_events where request_id = 'e6000000-0000-4000-8000-000000000001'),
  1,
  'the confirmed task creation appends one audit event'
);
select is(
  (select payload ->> 'research_run_id' from public.audit_events where request_id = 'e6000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  'the audit event retains the source research identifier'
);

select lives_ok(
  format(
    $$select public.workspace_create_campaign_task_from_agent(%L, %L, %L, %L)$$,
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e6000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid
  ),
  'replaying the same confirmed action is safe'
);
select is(
  (select count(*)::integer from public.campaign_tasks where agent_action_id = 'e6000000-0000-4000-8000-000000000001'),
  1,
  'replaying the action does not duplicate the task'
);

select throws_ok(
  format(
    $$select public.workspace_create_campaign_task_from_agent(%L, %L, %L, %L)$$,
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e6000000-0000-4000-8000-000000000002'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid
  ),
  'P0001',
  'Confirm this campaign task action before creating it.',
  'an unconfirmed proposal cannot create a task'
);

select throws_ok(
  format(
    $$select public.workspace_create_campaign_task_from_agent(%L, %L, %L, %L)$$,
    (select id from public.organizations where created_by = 'e1000000-0000-4000-8000-000000000001'),
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e6000000-0000-4000-8000-000000000003'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid
  ),
  'P0001',
  'The campaign task target no longer matches its proposal.',
  'a mismatched campaign target is rejected'
);

select ok(
  not has_function_privilege('authenticated', 'public.workspace_create_campaign_task_from_agent(uuid,uuid,uuid,uuid)', 'execute'),
  'browser clients cannot call the privileged task workflow directly'
);

select * from finish();
rollback;
