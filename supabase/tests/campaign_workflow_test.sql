begin;
select plan(32);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('31111111-1111-4111-8111-111111111111', 'workflow-owner@example.test', '{"full_name":"Workflow Owner","account_type":"business","organization_name":"Workflow Lab"}'::jsonb, '{}'::jsonb),
  ('32222222-2222-4222-8222-222222222222', 'workflow-marketer@example.test', '{"full_name":"Workflow Marketer","account_type":"professional"}'::jsonb, '{}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'workflow-approver@example.test', '{"full_name":"Workflow Approver","account_type":"professional"}'::jsonb, '{}'::jsonb);

do $$
declare
  workspace_id uuid;
begin
  select id into workspace_id
  from public.organizations
  where created_by = '31111111-1111-4111-8111-111111111111';

  perform set_config('test.workflow_org', workspace_id::text, true);

  insert into public.memberships (org_id, user_id, role)
  values
    (workspace_id, '32222222-2222-4222-8222-222222222222', 'marketer'),
    (workspace_id, '33333333-3333-4333-8333-333333333333', 'approver');

  insert into public.research_runs (
    id, org_id, created_by, status, search_input, product_brief, source_count, creator_count, completed_at
  ) values (
    '34444444-4444-4444-8444-444444444444',
    workspace_id,
    '31111111-1111-4111-8111-111111111111',
    'complete',
    '{"product":"Wireless mouse","goal":"Sales","audience":"Millennial","platform":"Instagram","budget":"$1k to $5k"}'::jsonb,
    '{"summary":"Saved product brief","demandSignals":[],"searchAngles":[],"outreachCues":[],"caution":"Verify terms"}'::jsonb,
    4,
    2,
    now()
  );

  insert into public.creator_records (
    id, org_id, display_name, handle, platform, profile_url, niche, identity_key
  ) values
    ('35555555-5555-4555-8555-555555555551', workspace_id, 'Creator One', 'creatorone', 'Instagram', 'https://instagram.com/creatorone', 'Desk setups', 'workflow-creator-one'),
    ('35555555-5555-4555-8555-555555555552', workspace_id, 'Creator Two', 'creatortwo', 'TikTok', 'https://tiktok.com/@creatortwo', 'Tech reviews', 'workflow-creator-two');

  insert into public.evidence_sources (
    id, org_id, research_run_id, creator_id, provider, source_url, source_type, title, excerpt, confidence
  ) values
    ('36666666-6666-4666-8666-666666666661', workspace_id, '34444444-4444-4444-8444-444444444444', '35555555-5555-4555-8555-555555555551', 'bright_data', 'https://instagram.com/p/workflow-one', 'post', 'Creator One mouse setup', 'A public mouse setup post.', 'high'),
    ('36666666-6666-4666-8666-666666666662', workspace_id, '34444444-4444-4444-8444-444444444444', '35555555-5555-4555-8555-555555555552', 'bright_data', 'https://tiktok.com/@creatortwo/video/1', 'post', 'Creator Two mouse review', 'A public mouse review.', 'medium');

  insert into public.creator_recommendations (
    id, org_id, research_run_id, creator_id, primary_evidence_id, rank, source_score, confidence, match_reason, strengths
  ) values
    ('37777777-7777-4777-8777-777777777771', workspace_id, '34444444-4444-4444-8444-444444444444', '35555555-5555-4555-8555-555555555551', '36666666-6666-4666-8666-666666666661', 1, 91, 'high', 'Direct desk setup evidence.', '["Product shown in context"]'::jsonb),
    ('37777777-7777-4777-8777-777777777772', workspace_id, '34444444-4444-4444-8444-444444444444', '35555555-5555-4555-8555-555555555552', '36666666-6666-4666-8666-666666666662', 2, 84, 'medium', 'Relevant review evidence.', '["Review format"]'::jsonb);

  insert into public.shortlists (
    id, org_id, research_run_id, name, created_by
  ) values (
    '38888888-8888-4888-8888-888888888888',
    workspace_id,
    '34444444-4444-4444-8444-444444444444',
    'Wireless mouse shortlist',
    '31111111-1111-4111-8111-111111111111'
  );

  insert into public.shortlist_entries (
    id, org_id, shortlist_id, creator_id, recommendation_id, position, created_by
  ) values
    ('39999999-9999-4999-8999-999999999991', workspace_id, '38888888-8888-4888-8888-888888888888', '35555555-5555-4555-8555-555555555551', '37777777-7777-4777-8777-777777777771', 1, '31111111-1111-4111-8111-111111111111'),
    ('39999999-9999-4999-8999-999999999992', workspace_id, '38888888-8888-4888-8888-888888888888', '35555555-5555-4555-8555-555555555552', '37777777-7777-4777-8777-777777777772', 2, '31111111-1111-4111-8111-111111111111');
end;
$$;

select ok(
  not has_function_privilege('authenticated', 'public.workspace_transition_shortlist(uuid,uuid,uuid,text)', 'execute'),
  'authenticated clients cannot call the privileged transition function directly'
);

select lives_ok(
  format(
    $$select public.workspace_set_shortlist_entry_decision(%L, %L, %L, %L, 'rejected', array['Weak evidence'], 'Needs stronger proof')$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '39999999-9999-4999-8999-999999999992'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can reject a creator with structured evidence feedback'
);

select is(
  (select decision from public.shortlist_entries where id = '39999999-9999-4999-8999-999999999992'),
  'rejected',
  'the creator decision is persisted'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.workflow_org')::uuid and event_type = 'shortlist.creator_decision_changed'),
  1,
  'creator decisions append an audit event'
);

select throws_ok(
  format(
    $$select public.workspace_set_shortlist_entry_decision(%L, %L, %L, %L, 'restored', '{}', null)$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '39999999-9999-4999-8999-999999999992'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  ),
  '42501',
  'A workspace manager role is required.',
  'an approver cannot alter creator decisions'
);

select lives_ok(
  format(
    $$select public.workspace_transition_shortlist(%L, %L, %L, 'review')$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can submit a shortlist for review'
);

select throws_ok(
  format(
    $$select public.workspace_transition_shortlist(%L, %L, %L, 'approved')$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  '42501',
  'An approver role is required.',
  'a marketer cannot approve their own shortlist'
);

select lives_ok(
  format(
    $$select public.workspace_transition_shortlist(%L, %L, %L, 'approved')$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  ),
  'an approver can approve a reviewed shortlist'
);

select is(
  (select approved_by from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'approval identity is recorded'
);

select throws_ok(
  format(
    $$select public.workspace_set_shortlist_entry_decision(%L, %L, %L, %L, 'rejected', array['Budget mismatch'], null)$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '39999999-9999-4999-8999-999999999991'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'P0001',
  'Reopen the shortlist before changing creator decisions.',
  'approved creator decisions are immutable until review is reopened'
);

select lives_ok(
  format(
    $$select public.workspace_create_campaign_from_shortlist(%L, %L, %L, 'Fall mouse launch', 500000, '2026-08-01', '2026-08-31')$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can convert an approved shortlist into a campaign'
);

select is(
  (select count(*)::integer from public.campaigns where name = 'Fall mouse launch'),
  1,
  'campaign conversion creates one campaign'
);

select is(
  (select count(*)::integer from public.campaign_tasks where campaign_id = (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888')),
  3,
  'campaign conversion creates the three initial operating tasks'
);

select is(
  (select campaign_id from public.research_runs where id = '34444444-4444-4444-8444-444444444444'),
  (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
  'the campaign remains linked to its source research and shortlist'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.workflow_org')::uuid and event_type = 'campaign.created_from_shortlist'),
  1,
  'campaign conversion appends one audit event'
);

select lives_ok(
  format(
    $$select public.workspace_create_campaign_from_shortlist(%L, %L, %L, 'Duplicate attempt', 900000, null, null)$$,
    current_setting('test.workflow_org')::uuid,
    '38888888-8888-4888-8888-888888888888'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'campaign conversion is idempotent after the first success'
);

select ok(
  not has_function_privilege('authenticated', 'public.workspace_set_campaign_status(uuid,uuid,uuid,text)', 'execute'),
  'authenticated clients cannot call the privileged campaign state machine directly'
);

select lives_ok(
  format(
    $$select public.workspace_create_campaign_task(%L, %L, %L, 'Confirm usage rights', '2026-08-10T17:00:00Z')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can create an audited campaign task'
);

select is(
  (select count(*)::integer from public.campaign_tasks where campaign_id = (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888')),
  4,
  'the new task is added to the campaign task list'
);

select lives_ok(
  format(
    $$select public.workspace_set_campaign_task_status(%L, %L, %L, %L, 'done')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    (select id from public.campaign_tasks where title = 'Confirm usage rights'),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can complete a campaign task'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.workflow_org')::uuid and event_type in ('campaign.task_created', 'campaign.task_status_changed')),
  2,
  'task creation and completion both append audit events'
);

select lives_ok(
  format(
    $$select public.workspace_set_campaign_status(%L, %L, %L, 'outreach')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can advance sourcing to outreach'
);

select throws_ok(
  format(
    $$select public.workspace_set_campaign_status(%L, %L, %L, 'contracted')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'P0001',
  'That campaign stage transition is not allowed.',
  'campaign stages cannot skip the negotiation state'
);

select lives_ok(
  format(
    $$select public.workspace_store_outreach_draft(%L, %L, %L, %L, 'Desk setup collaboration', 'A source-grounded draft.', '[{"title":"Creator One mouse setup","url":"https://instagram.com/p/workflow-one"}]'::jsonb)$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    '35555555-5555-4555-8555-555555555551'::uuid,
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can save a grounded outreach draft'
);

select is(
  (select jsonb_array_length(source_references) from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
  1,
  'the outreach draft retains its exact source reference'
);

select lives_ok(
  format(
    $$select public.workspace_update_outreach_draft(%L, %L, %L, %L, 'Updated collaboration', 'An edited source-grounded draft.')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    (select id from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can edit a draft before review'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.workflow_org')::uuid and event_type = 'outreach.draft_edited'),
  1,
  'draft editing appends an audit event without changing source references'
);

select lives_ok(
  format(
    $$select public.workspace_transition_outreach_draft(%L, %L, %L, %L, 'review')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    (select id from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  'a marketer can submit grounded outreach for review'
);

select throws_ok(
  format(
    $$select public.workspace_transition_outreach_draft(%L, %L, %L, %L, 'approved')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    (select id from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
    '32222222-2222-4222-8222-222222222222'::uuid
  ),
  '42501',
  'An approver role is required.',
  'a marketer cannot approve their own outreach draft'
);

select lives_ok(
  format(
    $$select public.workspace_transition_outreach_draft(%L, %L, %L, %L, 'approved')$$,
    current_setting('test.workflow_org')::uuid,
    (select campaign_id from public.shortlists where id = '38888888-8888-4888-8888-888888888888'),
    (select id from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
    '33333333-3333-4333-8333-333333333333'::uuid
  ),
  'an approver can approve reviewed outreach'
);

select is(
  (select approved_by from public.outreach_drafts where org_id = current_setting('test.workflow_org')::uuid limit 1),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'outreach approval identity is recorded'
);

select is(
  (select count(*)::integer from public.audit_events where org_id = current_setting('test.workflow_org')::uuid and event_type = 'outreach.approval_status_changed'),
  2,
  'outreach review and approval both append audit events'
);

select * from finish();
rollback;
