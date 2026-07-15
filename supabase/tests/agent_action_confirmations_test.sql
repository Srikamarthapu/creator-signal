begin;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('c1000000-0000-4000-8000-000000000001', 'action-owner-a@example.test', '{"full_name":"Action Owner A","account_type":"business","organization_name":"Action A"}'::jsonb, '{}'::jsonb),
  ('d1000000-0000-4000-8000-000000000001', 'action-owner-b@example.test', '{"full_name":"Action Owner B","account_type":"business","organization_name":"Action B"}'::jsonb, '{}'::jsonb);

select is(
  (select count(*)::integer from public.profiles where id in (
    'c1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001'
  )),
  2,
  'agent action test users receive profiles'
);

insert into public.research_runs (id, org_id, created_by, status, search_input)
values
  (
    'c2000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'c1000000-0000-4000-8000-000000000001'),
    'c1000000-0000-4000-8000-000000000001',
    'complete',
    '{"product":"ergonomic mouse"}'::jsonb
  ),
  (
    'd2000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'd1000000-0000-4000-8000-000000000001'),
    'd1000000-0000-4000-8000-000000000001',
    'complete',
    '{"product":"private product"}'::jsonb
  );

insert into public.conversations (id, org_id, research_run_id, title, created_by)
values
  (
    'c3000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'c1000000-0000-4000-8000-000000000001'),
    'c2000000-0000-4000-8000-000000000001',
    'Mouse creator search',
    'c1000000-0000-4000-8000-000000000001'
  ),
  (
    'd3000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'd1000000-0000-4000-8000-000000000001'),
    'd2000000-0000-4000-8000-000000000001',
    'Private creator search',
    'd1000000-0000-4000-8000-000000000001'
  );

insert into public.conversation_messages (id, org_id, conversation_id, role, content)
values
  (
    'c4000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'c1000000-0000-4000-8000-000000000001'),
    'c3000000-0000-4000-8000-000000000001',
    'assistant',
    'I prepared a source-backed shortlist.'
  ),
  (
    'd4000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'd1000000-0000-4000-8000-000000000001'),
    'd3000000-0000-4000-8000-000000000001',
    'assistant',
    'Private workspace proposal.'
  );

insert into public.agent_action_confirmations (
  id, org_id, conversation_id, assistant_message_id, research_run_id,
  requested_by, action_type, action_payload
)
values
  (
    'c7000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'c1000000-0000-4000-8000-000000000001'),
    'c3000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'save_creator',
    '{"creator_name":"Desk Tech","source_url":"https://www.youtube.com/watch?v=source-a","evidence_id":"E1","label":"Save Desk Tech","requires_confirmation":true}'::jsonb
  ),
  (
    'd7000000-0000-4000-8000-000000000001',
    (select id from public.organizations where created_by = 'd1000000-0000-4000-8000-000000000001'),
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'save_creator',
    '{"creator_name":"Private Creator","source_url":"https://example.test/private","evidence_id":"E1","label":"Save Private Creator","requires_confirmation":true}'::jsonb
  );

select is((select count(*)::integer from public.agent_action_confirmations where id in (
  'c7000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000001'
)), 2, 'source-backed proposals are stored independently');
select is((select status from public.agent_action_confirmations where id = 'c7000000-0000-4000-8000-000000000001'), 'pending', 'new proposals await confirmation');

select throws_ok(
  $$insert into public.agent_action_confirmations (
      id, org_id, conversation_id, assistant_message_id, research_run_id, requested_by, action_type, action_payload
    ) values (
      'c7000000-0000-4000-8000-000000000002',
      (select id from public.organizations where created_by = 'c1000000-0000-4000-8000-000000000001'),
      'c3000000-0000-4000-8000-000000000001',
      'c4000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001',
      'save_creator',
      '[]'::jsonb
    )$$,
  '23514',
  null,
  'action payloads must be structured objects'
);

select throws_ok(
  $$update public.agent_action_confirmations
    set confirmed_by = 'c1000000-0000-4000-8000-000000000001', confirmed_at = now()
    where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'pending actions cannot look user-confirmed'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*)::integer from public.agent_action_confirmations), 1, 'workspace A sees only its own action proposals');
select is(
  (select count(*)::integer from public.agent_action_confirmations where id = 'd7000000-0000-4000-8000-000000000001'),
  0,
  'a known action ID cannot cross the tenant boundary'
);
select is(
  (select action_payload ->> 'source_url' from public.agent_action_confirmations where id = 'c7000000-0000-4000-8000-000000000001'),
  'https://www.youtube.com/watch?v=source-a',
  'workspace members can inspect the canonical source behind a proposal'
);
select ok(
  not has_table_privilege('authenticated', 'public.agent_action_confirmations', 'insert'),
  'browser clients cannot fabricate agent actions'
);
select ok(
  not has_table_privilege('authenticated', 'public.agent_action_confirmations', 'update')
  and not has_table_privilege('authenticated', 'public.agent_action_confirmations', 'delete'),
  'browser clients cannot confirm or erase actions outside the server workflow'
);

reset role;
select lives_ok(
  $$do $body$
    begin
      update public.agent_action_confirmations
      set status = 'processing',
          confirmed_by = 'c1000000-0000-4000-8000-000000000001',
          confirmed_at = now()
      where id = 'c7000000-0000-4000-8000-000000000001';

      update public.agent_action_confirmations
      set status = 'complete',
          result_payload = '{"shortlist_id":"c8000000-0000-4000-8000-000000000001","entry_id":"c9000000-0000-4000-8000-000000000001"}'::jsonb
      where id = 'c7000000-0000-4000-8000-000000000001';
    end
  $body$;$$,
  'the server workflow can process and complete a confirmed action'
);
select is(
  (select status from public.agent_action_confirmations where id = 'c7000000-0000-4000-8000-000000000001'),
  'complete',
  'completed action state is durable'
);
select is(
  (select result_payload ->> 'shortlist_id' from public.agent_action_confirmations where id = 'c7000000-0000-4000-8000-000000000001'),
  'c8000000-0000-4000-8000-000000000001',
  'completed actions retain their workspace result identifiers'
);

select * from finish();
rollback;
