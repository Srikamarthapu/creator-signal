BEGIN;
SELECT plan(16);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'owner-a@example.test', '{"full_name":"Avery Owner","account_type":"business","organization_name":"Acme Labs"}'::jsonb, '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@example.test', '{"full_name":"Blair Owner","account_type":"business","organization_name":"Beta Goods"}'::jsonb, '{}'::jsonb);

do $$
begin
  perform set_config(
    'test.organization_b',
    (select id::text from public.organizations where created_by = '22222222-2222-4222-8222-222222222222'),
    true
  );
end;
$$;

select is(
  (select count(*)::integer from public.profiles where id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2,
  'signup creates one profile per test user'
);
select is(
  (select count(*)::integer from public.organizations where created_by in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2,
  'signup creates one workspace per test user'
);
select is(
  (select count(*)::integer from public.memberships where role = 'owner' and user_id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2,
  'new test workspaces receive an owner membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select is((select auth.uid()), '11111111-1111-4111-8111-111111111111'::uuid, 'test request is scoped to user A');
select is((select count(*)::integer from public.organizations), 1, 'user A sees only their organization');
select is((select name from public.organizations), 'Acme Labs', 'user A cannot read the other organization');
select is((select count(*)::integer from public.profiles), 1, 'user A sees only workspace colleagues');

select lives_ok(
  $$insert into public.campaigns (id, org_id, created_by, name, product)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select id from public.organizations where created_by = '11111111-1111-4111-8111-111111111111'),
      '11111111-1111-4111-8111-111111111111',
      'Launch campaign',
      'Wireless mouse'
    )$$,
  'an owner can create a campaign in their organization'
);

select throws_ok(
  $$insert into public.campaigns (org_id, created_by, name, product)
    values (
      current_setting('test.organization_b')::uuid,
      '11111111-1111-4111-8111-111111111111',
      'Cross-tenant write',
      'Should fail'
    )$$,
  '42501',
  'new row violates row-level security policy for table "campaigns"',
  'a known organization identifier still cannot cross the tenant boundary'
);

select ok(
  not has_table_privilege('authenticated', 'public.account_requests', 'insert'),
  'account requests must use the audited server workflow'
);

reset role;
select throws_ok(
  $$delete from public.memberships
    where user_id = '11111111-1111-4111-8111-111111111111' and role = 'owner'$$,
  'P0001',
  'An organization must keep at least one active owner.',
  'the final active owner cannot remove themselves'
);

insert into public.memberships (org_id, user_id, role)
values (
  (select id from public.organizations where created_by = '11111111-1111-4111-8111-111111111111'),
  '22222222-2222-4222-8222-222222222222',
  'analyst'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

select is((select count(*)::integer from public.organizations), 2, 'a user can read every organization where they are an active member');
select is((select count(*)::integer from public.campaigns where product = 'Wireless mouse'), 1, 'an analyst can read campaigns in their workspace');

select throws_ok(
  $$insert into public.campaigns (org_id, created_by, name, product)
    values (
      (select id from public.organizations where created_by = '11111111-1111-4111-8111-111111111111'),
      '22222222-2222-4222-8222-222222222222',
      'Analyst write',
      'Should fail'
    )$$,
  '42501',
  'new row violates row-level security policy for table "campaigns"',
  'an analyst cannot create campaigns'
);

select throws_ok(
  $$insert into public.account_requests (user_id, request_type)
    values ('11111111-1111-4111-8111-111111111111', 'deletion')$$,
  '42501',
  'permission denied for table account_requests',
  'a client cannot submit an account request for another person'
);

select is(
  (select count(*)::integer from public.audit_events),
  0,
  'clients can read scoped audit history but cannot fabricate events through granted writes'
);

SELECT * FROM finish();
ROLLBACK;
