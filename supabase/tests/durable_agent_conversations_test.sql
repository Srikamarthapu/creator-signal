BEGIN;
SELECT plan(18);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('a1000000-0000-4000-8000-000000000001', 'memory-owner-a@example.test', '{"full_name":"Memory Owner A","account_type":"business","organization_name":"Memory A"}'::jsonb, '{}'::jsonb),
  ('b1000000-0000-4000-8000-000000000001', 'memory-owner-b@example.test', '{"full_name":"Memory Owner B","account_type":"business","organization_name":"Memory B"}'::jsonb, '{}'::jsonb);

select is(
  (select count(*)::integer from public.profiles where id in (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )),
  2,
  'agent memory test users receive profiles'
);

insert into public.research_runs (id, org_id, created_by, status, search_input)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a1000000-0000-4000-8000-000000000001',
    'complete',
    '{"product":"ergonomic mouse"}'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a1000000-0000-4000-8000-000000000001',
    'complete',
    '{"product":"standing desk"}'::jsonb
  ),
  (
    'b2000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'b1000000-0000-4000-8000-000000000001'),
    'b1000000-0000-4000-8000-000000000001',
    'complete',
    '{"product":"private product"}'::jsonb
  );

insert into public.conversations (id, org_id, research_run_id, title, created_by)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a2000000-0000-4000-8000-000000000002',
    'Workspace gear creator search',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'b3000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'b1000000-0000-4000-8000-000000000001'),
    'b2000000-0000-4000-8000-000000000001',
    'Private creator search',
    'b1000000-0000-4000-8000-000000000001'
  );

insert into public.conversation_research_runs (org_id, conversation_id, research_run_id, linked_by)
values
  (
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a3000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a3000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    (select id from public.organizations where created_by = 'b1000000-0000-4000-8000-000000000001'),
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  );

select is(
  (select count(*)::integer from public.conversation_research_runs where conversation_id = 'a3000000-0000-4000-8000-000000000001'),
  2,
  'one agent conversation retains every research run it launched'
);

insert into public.conversation_messages (id, org_id, conversation_id, author_user_id, role, content)
values
  (
    'a4000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'user',
    'Find workspace creators.'
  ),
  (
    'a4000000-0000-4000-8000-000000000002',
    (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
    'a3000000-0000-4000-8000-000000000001',
    null,
    'assistant',
    'I will search the approved public-source provider.'
  ),
  (
    'b4000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'b1000000-0000-4000-8000-000000000001'),
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'user',
    'Private tenant message.'
  );

update public.conversation_messages
set artifacts = '[{"type":"outreach_draft","version":1,"creator_name":"Workspace Gear","subject":"Workspace collaboration","body":"A source-backed draft.","source_url":"https://example.test/workspace-gear","evidence_id":"E1","status":"draft"},{"type":"creator_comparison","version":1,"title":"Workspace creator comparison","rows":[{"rank":1,"creator_name":"Workspace Gear","evidence_id":"E1","source_url":"https://example.test/workspace-gear","source_title":"Workspace gear review","visible_fit":"Strong","evidence_strength":"Medium","signals":["Visible review format"],"reason":"The public result matches the brief.","unverified":["Rates and availability"]}],"disclaimer":"Saved public evidence only."}]'::jsonb
where id = 'a4000000-0000-4000-8000-000000000002';

select throws_ok(
  $$update public.conversation_messages
    set artifacts = '{}'::jsonb
    where id = 'a4000000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  'conversation message artifacts must be stored as an array'
);

insert into public.agent_runs (id, org_id, conversation_id, requested_by, request_message_id, model, provider, status)
values (
  'a5000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'z-ai/glm-5.2',
  'nvidia',
  'complete'
);

insert into public.agent_tool_calls (id, org_id, agent_run_id, tool_name, output_summary, status)
values (
  'a6000000-0000-4000-8000-000000000001',
  (select id from public.organizations where created_by = 'a1000000-0000-4000-8000-000000000001'),
  'a5000000-0000-4000-8000-000000000001',
  'find_creators',
  '{"provider":"bright_data","creator_count":6}'::jsonb,
  'complete'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*)::integer from public.conversations), 1, 'workspace A sees only its agent conversation');
select is((select count(*)::integer from public.research_runs), 2, 'workspace A sees only its linked research runs');
select is((select count(*)::integer from public.conversation_research_runs), 2, 'workspace A sees only its conversation links');
select is((select count(*)::integer from public.conversation_messages), 2, 'workspace A sees only its conversation messages');
select is(
  (select artifacts -> 0 ->> 'type' from public.conversation_messages where id = 'a4000000-0000-4000-8000-000000000002'),
  'outreach_draft',
  'workspace members can restore a structured outreach draft from agent memory'
);
select is(
  (select artifacts -> 0 ->> 'source_url' from public.conversation_messages where id = 'a4000000-0000-4000-8000-000000000002'),
  'https://example.test/workspace-gear',
  'restored outreach keeps its canonical source URL'
);
select is(
  (select artifacts -> 1 ->> 'type' from public.conversation_messages where id = 'a4000000-0000-4000-8000-000000000002'),
  'creator_comparison',
  'workspace members can restore a structured creator comparison from agent memory'
);
select is((select count(*)::integer from public.agent_runs), 1, 'workspace A sees only its model runs');
select is((select count(*)::integer from public.agent_tool_calls), 1, 'workspace A sees only its tool traces');
select is(
  (select count(*)::integer from public.conversations where id = 'b3000000-0000-4000-8000-000000000001'),
  0,
  'a known conversation ID cannot cross the tenant boundary'
);

select ok(
  not has_table_privilege('authenticated', 'public.conversations', 'insert'),
  'browser clients cannot fabricate agent conversations'
);
select ok(
  not has_table_privilege('authenticated', 'public.conversation_messages', 'insert'),
  'browser clients cannot fabricate agent messages'
);
select ok(
  not has_table_privilege('authenticated', 'public.conversation_messages', 'update')
  and not has_table_privilege('authenticated', 'public.conversation_messages', 'delete'),
  'persisted agent messages are append-only to browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.conversation_research_runs', 'insert'),
  'browser clients cannot attach conversations to arbitrary research runs'
);
select ok(
  not has_table_privilege('authenticated', 'public.agent_runs', 'insert')
  and not has_table_privilege('authenticated', 'public.agent_tool_calls', 'insert'),
  'browser clients cannot fabricate model or tool audit history'
);

SELECT * FROM finish();
ROLLBACK;
