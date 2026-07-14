begin;
select plan(18);

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
    $$insert into public.provider_jobs (org_id, requested_by, provider, operation, status, latency_ms, source_count, completed_at) values (%L, %L, 'bright_data', 'creator_discovery', 'degraded', 420, 2, now())$$,
    current_setting('test.entitlement_org')::uuid,
    '51111111-1111-4111-8111-111111111111'::uuid
  ),
  'the trusted service can record a sanitized provider diagnostic'
);

select is(
  (select status from public.provider_jobs where org_id = current_setting('test.entitlement_org')::uuid),
  'degraded',
  'provider job status is retained for support'
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
