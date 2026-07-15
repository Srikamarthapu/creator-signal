begin;
select plan(29);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('61111111-1111-4111-8111-111111111111', 'brief-owner@example.test', '{"full_name":"Brief Owner","account_type":"business","organization_name":"Brief Lab"}'::jsonb, '{}'::jsonb),
  ('62222222-2222-4222-8222-222222222222', 'brief-marketer@example.test', '{"full_name":"Brief Marketer","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('63333333-3333-4333-8333-333333333333', 'brief-approver@example.test', '{"full_name":"Brief Approver","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('64444444-4444-4444-8444-444444444444', 'brief-analyst@example.test', '{"full_name":"Brief Analyst","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('65555555-5555-4555-8555-555555555555', 'brief-outsider@example.test', '{"full_name":"Brief Outsider","account_type":"business","organization_name":"Other Brief Lab"}'::jsonb, '{}'::jsonb);

do $$
declare
  workspace_id uuid;
begin
  select id into workspace_id
  from public.organizations
  where created_by = '61111111-1111-4111-8111-111111111111';
  perform set_config('test.brief_org', workspace_id::text, true);

  insert into public.memberships (org_id, user_id, role)
  values
    (workspace_id, '62222222-2222-4222-8222-222222222222', 'marketer'),
    (workspace_id, '63333333-3333-4333-8333-333333333333', 'approver'),
    (workspace_id, '64444444-4444-4444-8444-444444444444', 'analyst');

  insert into public.research_runs (id, org_id, created_by, status, search_input)
  values (
    '66666666-6666-4666-8666-666666666666',
    workspace_id,
    '61111111-1111-4111-8111-111111111111',
    'complete',
    '{"product":"ergonomic mouse","goal":"Sales","platform":"YouTube","audience":"Millennial","budget":"$1k to $5k"}'::jsonb
  );
end;
$$;

select ok(
  not has_table_privilege('authenticated', 'public.campaign_briefs', 'insert'),
  'authenticated clients cannot write campaign briefs directly'
);

select ok(
  has_table_privilege('authenticated', 'public.campaign_briefs', 'select'),
  'authenticated workspace members may read campaign briefs through RLS'
);

select ok(
  not has_function_privilege('authenticated', 'public.workspace_save_campaign_brief(uuid,uuid,uuid,jsonb,jsonb,text,text)', 'execute'),
  'authenticated clients cannot call campaign brief persistence directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.workspace_transition_campaign_brief(uuid,uuid,uuid,text)', 'execute'),
  'authenticated clients cannot bypass campaign brief approval transitions'
);

select lives_ok(
  format(
    $$select public.workspace_save_campaign_brief(
      %L,
      '66666666-6666-4666-8666-666666666666',
      '62222222-2222-4222-8222-222222222222',
      %L::jsonb,
      %L::jsonb,
      'nvidia',
      'z-ai/glm-5.2'
    )$$,
    current_setting('test.brief_org')::uuid,
    '{"campaignName":"Ergonomic mouse launch","objective":"Drive qualified product consideration","audience":"Millennial desk workers","platforms":["YouTube"],"geography":"United States","budget":{"label":"$1k to $5k","creatorSpend":"Not yet confirmed"},"timing":{"launchDate":"Not yet confirmed","campaignWindow":"Not yet confirmed"},"deliverables":["One product demonstration"],"creatorCriteria":"Source-backed creators with desk setup relevance","keyMessage":"Comfortable control for daily desk work","successMeasures":["Qualified product interest"],"assumptions":["Final usage rights require approval"]}',
    '[{"id":"E1","title":"Public creator source","url":"https://example.com/source","excerpt":"Ergonomic mouse setup review"}]'
  ),
  'a marketer can save a source-referenced draft campaign brief'
);

select is(
  (select status from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'draft',
  'a generated campaign brief begins in draft'
);

select is(
  (select version from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  1,
  'the first campaign brief is version one'
);

select is(
  (select provider from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'nvidia',
  'the model provider is persisted with the brief'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.brief_org')::uuid and event_type = 'campaign_brief.generated'),
  1,
  'campaign brief generation appends an audit event'
);

select throws_ok(
  format(
    $$select public.workspace_save_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '63333333-3333-4333-8333-333333333333', '{}'::jsonb, '[]'::jsonb, 'user', null)$$,
    current_setting('test.brief_org')::uuid
  ),
  '42501',
  'A workspace manager role is required to prepare a campaign brief.',
  'an approver cannot generate or revise a campaign brief'
);

select throws_ok(
  format(
    $$select public.workspace_save_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '62222222-2222-4222-8222-222222222222', '{"campaignName":"Incomplete"}'::jsonb, '[]'::jsonb, 'user', null)$$,
    current_setting('test.brief_org')::uuid
  ),
  '22023',
  'Complete the campaign name, objective, audience, and key message.',
  'incomplete structured campaign brief content is rejected'
);

select lives_ok(
  format(
    $$select public.workspace_save_campaign_brief(
      %L,
      '66666666-6666-4666-8666-666666666666',
      '61111111-1111-4111-8111-111111111111',
      %L::jsonb,
      %L::jsonb,
      'user',
      null
    )$$,
    current_setting('test.brief_org')::uuid,
    '{"campaignName":"Ergonomic mouse launch","objective":"Drive qualified product consideration and purchases","audience":"Millennial desk workers","platforms":["YouTube"],"geography":"United States","budget":{"label":"$1k to $5k","creatorSpend":"Not yet confirmed"},"timing":{"launchDate":"Not yet confirmed","campaignWindow":"Not yet confirmed"},"deliverables":["One product demonstration","One usage-focused short"],"creatorCriteria":"Source-backed creators with desk setup relevance","keyMessage":"Comfortable control for daily desk work","successMeasures":["Qualified product interest","Product page visits"],"assumptions":["Final usage rights require approval"]}',
    '[{"id":"E1","title":"Public creator source","url":"https://example.com/source","excerpt":"Ergonomic mouse setup review"}]'
  ),
  'a manager can revise the brief before review'
);

select is(
  (select version from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  2,
  'campaign brief revisions increment the version'
);

select is(
  (select provider from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'user',
  'a human edit is distinguished from generated content'
);

select lives_ok(
  format(
    $$select public.workspace_transition_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '62222222-2222-4222-8222-222222222222', 'review')$$,
    current_setting('test.brief_org')::uuid
  ),
  'a marketer can submit a draft campaign brief for review'
);

select is(
  (select status from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'review',
  'the campaign brief enters review'
);

select throws_ok(
  format(
    $$select public.workspace_transition_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '62222222-2222-4222-8222-222222222222', 'approved')$$,
    current_setting('test.brief_org')::uuid
  ),
  '42501',
  'An approver must review the campaign brief before approval.',
  'the marketer who prepared the brief cannot approve it'
);

select throws_ok(
  format(
    $$select public.workspace_transition_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '64444444-4444-4444-8444-444444444444', 'approved')$$,
    current_setting('test.brief_org')::uuid
  ),
  '42501',
  'An approver must review the campaign brief before approval.',
  'an analyst cannot approve a campaign brief'
);

select lives_ok(
  format(
    $$select public.workspace_transition_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '63333333-3333-4333-8333-333333333333', 'approved')$$,
    current_setting('test.brief_org')::uuid
  ),
  'an approver can approve a campaign brief in review'
);

select is(
  (select status from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'approved',
  'the approved status is persisted'
);

select is(
  (select approved_by from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  '63333333-3333-4333-8333-333333333333'::uuid,
  'the approving user is recorded'
);

select ok(
  (select approved_at is not null from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'campaign brief approval records its timestamp'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.brief_org')::uuid and event_type like 'campaign_brief.%'),
  4,
  'generation, revision, review, and approval all append audit events'
);

select lives_ok(
  format(
    $$select public.workspace_transition_campaign_brief(%L, '66666666-6666-4666-8666-666666666666', '61111111-1111-4111-8111-111111111111', 'draft')$$,
    current_setting('test.brief_org')::uuid
  ),
  'a manager can explicitly reopen an approved brief'
);

select is(
  (select status from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'draft',
  'reopening returns the campaign brief to draft'
);

select ok(
  (select approved_at is null and approved_by is null from public.campaign_briefs where org_id = current_setting('test.brief_org')::uuid),
  'reopening clears the current approval marker'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"61111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.campaign_briefs),
  1,
  'a workspace owner can read the organization campaign brief'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"65555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.campaign_briefs),
  0,
  'campaign brief RLS prevents cross-organization reads'
);

select throws_ok(
  $$update public.campaign_briefs set status = 'approved'$$,
  '42501',
  'permission denied for table campaign_briefs',
  'authenticated clients cannot bypass the audited approval workflow'
);

select * from finish();
rollback;
