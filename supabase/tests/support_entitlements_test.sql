begin;
select plan(47);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('51111111-1111-4111-8111-111111111111', 'entitlement-owner@example.test', '{"full_name":"Entitlement Owner","account_type":"business","organization_name":"Entitlement Lab"}'::jsonb, '{}'::jsonb),
  ('52222222-2222-4222-8222-222222222222', 'platform-operator@example.test', '{"full_name":"Platform Operator","account_type":"professional"}'::jsonb, '{"platform_role":"operator"}'::jsonb),
  ('53333333-3333-4333-8333-333333333333', 'invited-seat@example.test', '{"full_name":"Invited Seat","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('54444444-4444-4444-8444-444444444444', 'extra-seat@example.test', '{"full_name":"Extra Seat","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', 'unrelated-entitlement@example.test', '{"full_name":"Unrelated User","account_type":"business","organization_name":"Unrelated Lab"}'::jsonb, '{}'::jsonb);

do $$
begin
  perform set_config(
    'test.entitlement_org',
    (select id::text from public.organizations where created_by = '51111111-1111-4111-8111-111111111111'),
    true
  );
end;
$$;

select is(
  (select count(*)::integer from public.organization_entitlements where org_id = current_setting('test.entitlement_org')::uuid),
  1,
  'new organizations receive one default entitlement'
);

select is(
  (select plan from public.organization_entitlements where org_id = current_setting('test.entitlement_org')::uuid),
  'pilot',
  'the default entitlement begins on the pilot plan'
);

select ok(
  not has_table_privilege('authenticated', 'public.provider_jobs', 'select'),
  'provider diagnostics are never exposed directly to authenticated clients'
);

select ok(
  not has_table_privilege('authenticated', 'public.provider_retry_jobs', 'select'),
  'provider retry payloads are never exposed directly to authenticated clients'
);

select ok(
  not has_function_privilege('authenticated', 'public.provider_retry_create(uuid,uuid,uuid,uuid,text,jsonb,integer)', 'execute'),
  'authenticated clients cannot enqueue provider retries directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.platform_update_entitlement(uuid,uuid,text,text,integer,integer,timestamptz)', 'execute'),
  'authenticated clients cannot call the entitlement operator function directly'
);

select throws_ok(
  format(
    $$select public.platform_update_entitlement(%L, %L, 'pilot', 'active', 2, 10, now() + interval '60 days')$$,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid
  ),
  '42501',
  'A platform operator role is required.',
  'a workspace owner cannot grant their own entitlement'
);

select lives_ok(
  format(
    $$select public.platform_update_entitlement(%L, %L, 'pilot', 'active', 2, 10, now() + interval '60 days')$$,
    current_setting('test.entitlement_org')::uuid,
    '52222222-2222-4222-8222-222222222222'::uuid
  ),
  'a platform operator can update a workspace entitlement'
);

select is(
  (select seat_limit from public.organization_entitlements where org_id = current_setting('test.entitlement_org')::uuid),
  2,
  'the operator seat limit is persisted'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.entitlement_org')::uuid and event_type = 'platform.entitlement_updated'),
  1,
  'entitlement changes append an audit event'
);

select lives_ok(
  format(
    $$insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, 'invited-seat@example.test', 'analyst', %L, %L, now() + interval '7 days')$$,
    current_setting('test.entitlement_org')::uuid,
    repeat('e', 64),
    '51111111-1111-4111-8111-111111111111'::uuid
  ),
  'the final available seat can be reserved by an invitation'
);

select throws_ok(
  format(
    $$insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, 'another-seat@example.test', 'analyst', %L, %L, now() + interval '7 days')$$,
    current_setting('test.entitlement_org')::uuid,
    repeat('f', 64),
    '51111111-1111-4111-8111-111111111111'::uuid
  ),
  '23514',
  'This workspace has reached its seat limit.',
  'pending invitations count against the seat limit'
);

select lives_ok(
  $$select public.workspace_accept_invitation(repeat('e', 64), '53333333-3333-4333-8333-333333333333')$$,
  'the reserved invitee can occupy the final seat'
);

select is(
  (select count(*)::integer from public.memberships where org_id = current_setting('test.entitlement_org')::uuid and status = 'active'),
  2,
  'invitation acceptance preserves the seat count'
);

select throws_ok(
  format(
    $$insert into public.memberships (org_id, user_id, role, status) values (%L, %L, 'analyst', 'active')$$,
    current_setting('test.entitlement_org')::uuid,
    '54444444-4444-4444-8444-444444444444'::uuid
  ),
  '23514',
  'This workspace has reached its seat limit.',
  'active memberships cannot bypass the seat limit'
);

select lives_ok(
  format(
    $$insert into public.research_runs (id, org_id, created_by, status, search_input) values (%L, %L, %L, 'partial', '{"product":"Wireless mouse","platform":"YouTube"}'::jsonb)$$,
    '56666666-6666-4666-8666-666666666666'::uuid,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid
  ),
  'a degraded research run can be retained for provider recovery'
);

select lives_ok(
  format(
    $$insert into public.provider_jobs (id, org_id, requested_by, research_run_id, provider, operation, status, latency_ms, source_count, completed_at) values (%L, %L, %L, %L, 'bright_data', 'creator_discovery', 'degraded', 420, 2, now())$$,
    '57777777-7777-4777-8777-777777777777'::uuid,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid,
    '56666666-6666-4666-8666-666666666666'::uuid
  ),
  'the trusted service can record a sanitized provider diagnostic'
);

select is(
  (select status from public.provider_jobs where org_id = current_setting('test.entitlement_org')::uuid),
  'degraded',
  'provider job status is retained for support'
);

select lives_ok(
  format(
    $$select public.provider_retry_create(%L, %L, %L, %L, 'creator_discovery', '{"input":{"product":"Wireless mouse","platform":"YouTube"}}'::jsonb, 3)$$,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid,
    '56666666-6666-4666-8666-666666666666'::uuid,
    '57777777-7777-4777-8777-777777777777'::uuid
  ),
  'a workspace manager can queue a bounded durable provider retry'
);

select is(
  (select status from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'),
  'queued',
  'a new provider retry begins queued'
);

select is(
  (select queue_length::integer from public.provider_retry_metrics()),
  1,
  'the durable queue contains the provider retry message'
);

select lives_ok(
  format(
    $$select public.provider_retry_create(%L, %L, %L, %L, 'creator_discovery', '{"input":{"product":"Wireless mouse"}}'::jsonb, 3)$$,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid,
    '56666666-6666-4666-8666-666666666666'::uuid,
    '57777777-7777-4777-8777-777777777777'::uuid
  ),
  'enqueueing the same active research operation is idempotent'
);

select is(
  (select count(*)::integer from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'),
  1,
  'idempotent enqueueing preserves one active retry record'
);

select lives_ok(
  $$select public.provider_retry_claim((select id from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'), 120)$$,
  'a queue worker can claim the ready provider retry'
);

select is(
  (select status from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'),
  'processing',
  'claiming a provider retry records its processing state'
);

select is(
  (select attempt_count from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'),
  1,
  'claiming increments the bounded attempt counter once'
);

select lives_ok(
  $$select public.provider_retry_complete((select id from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'), '{"creatorCount":3,"sourceCount":3}'::jsonb)$$,
  'a queue worker can complete a recovered provider retry'
);

select is(
  (select status from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'),
  'complete',
  'provider recovery completion is durable'
);

select ok(
  (select public.provider_retry_archive(queue_message_id) from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'creator_discovery'),
  'the processed queue message is archived for an audit trail'
);

select lives_ok(
  format(
    $$select public.provider_retry_create(%L, %L, %L, %L, 'product_research', '{"input":{"product":"Wireless mouse"}}'::jsonb, 3)$$,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid,
    '56666666-6666-4666-8666-666666666666'::uuid,
    '57777777-7777-4777-8777-777777777777'::uuid
  ),
  'a second provider operation can be queued independently'
);

select lives_ok(
  $$select public.provider_retry_claim((select id from public.provider_retry_jobs where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid and operation = 'product_research'), 120)$$,
  'the independent provider retry can be claimed'
);

create temporary table test_provider_retry_message_ids on commit drop as
select id as retry_id, queue_message_id as initial_message_id
from public.provider_retry_jobs
where research_run_id = '56666666-6666-4666-8666-666666666666'::uuid
  and operation = 'product_research';

select lives_ok(
  $$select public.provider_retry_fail((select retry_id from test_provider_retry_message_ids), 'provider_unavailable', 'Temporary outage', true, 0)$$,
  'failing a retry atomically schedules its next queue message'
);

select is(
  (select status from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  'queued',
  'a retryable provider failure returns to queued state'
);

select isnt(
  (select queue_message_id from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  (select initial_message_id from test_provider_retry_message_ids),
  'atomic requeueing records a new durable queue message'
);

select ok(
  (select public.provider_retry_archive(initial_message_id) from test_provider_retry_message_ids),
  'the consumed provider retry message can be archived after atomic requeueing'
);

select lives_ok(
  $$select public.provider_retry_claim((select retry_id from test_provider_retry_message_ids), 120)$$,
  'the atomically requeued provider job can be claimed again'
);

select is(
  (select attempt_count from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  2,
  'the second provider attempt is counted once'
);

update public.provider_retry_jobs
set lease_expires_at = now() - interval '1 second'
where id = (select retry_id from test_provider_retry_message_ids);

select lives_ok(
  $$select public.provider_retry_claim((select retry_id from test_provider_retry_message_ids), 120)$$,
  'an expired worker lease can be reclaimed without losing the job'
);

select is(
  (select attempt_count from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  3,
  'reclaiming an expired lease consumes the next bounded attempt'
);

update public.provider_retry_jobs
set lease_expires_at = now() - interval '1 second'
where id = (select retry_id from test_provider_retry_message_ids);

select lives_ok(
  $$select public.provider_retry_claim((select retry_id from test_provider_retry_message_ids), 120)$$,
  'an expired final lease is closed without leaving a processing job stranded'
);

select is(
  (select status from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  'failed',
  'an expired final worker lease records a terminal failure'
);

select ok(
  (select public.provider_retry_archive(queue_message_id) from public.provider_retry_jobs where id = (select retry_id from test_provider_retry_message_ids)),
  'the terminal retry queue message can be archived'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.entitlement_org')::uuid and event_type = 'provider.retry_queued'),
  2,
  'each provider retry creation appends one audit event without storing request payloads there'
);

select throws_ok(
  format(
    $$select public.provider_retry_create(%L, %L, %L, %L, 'product_research', '{"input":{"product":"Wireless mouse"}}'::jsonb, 3)$$,
    current_setting('test.entitlement_org')::uuid,
    '55555555-5555-4555-8555-555555555555'::uuid,
    '56666666-6666-4666-8666-666666666666'::uuid,
    '57777777-7777-4777-8777-777777777777'::uuid
  ),
  '42501',
  'A workspace manager role is required.',
  'an unrelated user cannot queue a provider retry'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.organization_entitlements),
  1,
  'a workspace owner sees only their own organization entitlement'
);

select throws_ok(
  $$select count(*) from public.provider_jobs$$,
  '42501',
  'permission denied for table provider_jobs',
  'workspace users cannot read internal provider diagnostics'
);

select is(
  (select status from public.organization_entitlements),
  'active',
  'the customer can read their current entitlement status'
);

select * from finish();
rollback;
