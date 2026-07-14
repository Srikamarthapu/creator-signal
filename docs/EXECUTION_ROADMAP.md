# CreatorSignal Execution Roadmap

Status: Sequenced plan, not an implementation commitment
Last updated: July 11, 2026
Companion document: [Production Product Requirements Document](./PRODUCT_VISION_PRD.md)

## 1. Roadmap strategy

The roadmap deliberately separates the useful product from the expensive platform.

1. Prove that businesses pay for evidence-backed activation.
2. Build the secure saved campaign workspace.
3. Make the AI strategist and campaign workflow repeatable.
4. Add creator participation and collaboration operations.
5. Close the outcome and payment loop.
6. Open a marketplace and build mobile only when liquidity and repeated use justify them.

The team should not begin all phases in parallel. Each phase has an exit gate based on behavior and revenue.

## 2. Assumptions

- Initial customer: lean DTC brand or ecommerce growth team.
- Initial networks: TikTok, Instagram, and YouTube public evidence, with no claim of official platform partnership.
- Initial campaign: paid organic content or UGC with clear deliverables and rights.
- Web remains the primary business experience.
- Creator mobile is later and consumes the same API.
- Supabase is the identity, relational data, storage, and queue foundation.
- The existing React and Node application is evolved rather than discarded.
- Bright Data remains one discovery source behind a provider interface, not the entire data strategy.
- AI providers remain replaceable.

## 3. Team shape

A credible early team is:

- founder/product lead responsible for design partners, positioning, and weekly decisions;
- one senior full-stack engineer responsible for architecture and delivery;
- one product engineer or strong designer-engineer responsible for workflow quality;
- part-time product design support;
- fractional legal/privacy/payment counsel before outreach automation and transactions;
- part-time campaign operator during concierge pilots.

With one builder, keep the same sequence but expect longer phases and reduce scope rather than weakening security or trust controls.

## 4. Phase 0 - Paid validation and decisions

Target window: 2 to 3 weeks

### Objective

Prove that a narrow customer segment will pay for the complete shortlist-to-outreach outcome, and identify the first campaign type.

### Work

- recruit 5 to 10 design partners from existing leads;
- charge for each pilot or for a short monthly engagement;
- collect product URL, target buyer, geography, platform, offer, rights, timing, deliverable, and budget;
- produce 20 to 30 candidates with human verification of relevance, activity, contactability, conflicts, and risk;
- record every accepted and rejected candidate and the reason;
- draft approved outreach and track replies manually;
- track negotiation, content delivery, rights, spend, and best available outcome;
- calculate data, AI, and operator cost per activated creator;
- choose DTC or B2B based on paid lead concentration;
- choose a distinctive working name before public launch.

### Deliverables

- one validated ideal customer profile;
- one primary campaign template;
- structured intake and rejection taxonomy;
- first baseline metrics;
- pricing evidence;
- list of manual operator steps that software should remove.

### Exit gate

Advance only when at least three customers pay, at least two indicate repeat intent through payment or scheduled follow-on work, and the service has a credible path to positive contribution margin.

If buyers only value a one-time list, keep the business as a service or stop before building the marketplace.

## 5. Phase 1 - Secure production foundation

Target window: 4 to 6 weeks after Phase 0 gate

### Objective

Turn the local prototype into a secure, durable, multi-tenant application for invited business users.

### Product scope

- Supabase project environments for local, staging, and production;
- sign up, sign in, verification, recovery, session, and sign out;
- Creator, Individual professional, and Business onboarding paths;
- organizations, invitations, memberships, and role permissions;
- durable profiles, searches, briefs, shortlists, campaigns, tasks, and audit events;
- migration from browser-only saved state;
- resume recent campaign work after sign in;
- production error states and data-health status;
- internal support view for failed jobs and customer context;
- basic subscription or manual paid-pilot entitlement.

### Engineering requirements

- RLS and explicit Data API grants for every exposed table;
- server-only service credentials;
- typed API contracts and request validation;
- migration workflow and seed fixtures;
- unit, integration, RLS, and core browser tests;
- structured logs, error reporting, uptime check, backups, and restore test;
- CI checks for build, types, tests, secrets, and dependencies;
- staging deployment with production-like provider configuration.

### Exit gate

- three design-partner organizations can safely use separate workspaces;
- no cross-tenant access in the RLS test matrix;
- users can leave and return without losing work;
- support can diagnose a failed provider request without database editing;
- backup restoration is demonstrated.

## 6. Phase 2 - AI campaign workspace and repeatable activation

Target window: 4 to 6 weeks

### Objective

Make the AI strategist the fastest and clearest way to plan a campaign and activate a source-backed shortlist.

### Product scope

- campaign conversation with structured brief generation;
- product URL and page-context intake;
- missing-information questions and editable assumptions;
- agent tools for discovery, evidence retrieval, comparison, shortlist changes, budget guidance, outreach drafts, and task creation;
- progressive creator results: public evidence first, AI evaluation second;
- saved conversations and campaign-scoped memory;
- creator accept/reject reasons and alternative recommendations;
- human approval for messages and consequential state changes;
- provider usage, latency, cost, and degraded-state UI;
- copied outreach first, connected email only if pilots require it.

### AI quality program

- fixed evidence fixtures across at least five product categories;
- expected relevant and irrelevant creator examples;
- citation validity checks;
- unsupported-claim checks;
- ranking stability and duplicate checks;
- prompt-injection fixtures from public web text;
- model/provider comparison based on activation quality, latency, and cost;
- release block when fallback is mislabeled as AI.

### Exit gate

- median brief-to-credible-shortlist time is materially lower than each pilot customer's current process;
- reviewed shortlist acceptance rate improves over the Phase 0 baseline;
- unsupported claims remain below the team's agreed launch threshold;
- at least three customers launch a second campaign;
- variable AI and data cost fits the planned gross-margin model.

## 7. Phase 3 - Creator portal and collaboration operating system

Target window: 6 to 8 weeks

### Objective

Move from recommendations to reliable, two-sided collaboration without yet opening a broad marketplace.

### Product scope

- creator invitation and direct creator signup;
- profile claim and identity conflict review;
- creator niche, platforms, portfolio, rates, availability, preferences, and exclusions;
- opportunity inbox and response workflow;
- proposals and negotiation history;
- campaign briefs, deliverables, due dates, compensation, revisions, exclusivity, usage rights, and disclosure checklist;
- contract/e-sign integration using reviewed templates;
- content submission, versioning, comments, revisions, and approval;
- rights library and expiry reminders;
- creator activity, response, and delivery reliability signals;
- notifications and responsive creator experience;
- non-transactional earnings and payment status ledger.

### Operations scope

- creator claim review;
- brand and creator report flow;
- cancellation and non-response handling;
- moderation and support case records;
- correction and removal requests;
- private structured ratings with anti-retaliation controls.

### Exit gate

- at least ten paid collaborations complete through the workflow;
- creators can participate without operator database edits;
- brands and creators agree that scope, rights, and payment expectations are clear;
- on-time delivery and approval rates are measured;
- support burden per collaboration is understood and falling.

## 8. Phase 4 - Outcome loop and limited payments

Target window: 6 to 10 weeks

### Objective

Prove the business can measure useful outcomes and safely facilitate creator compensation.

### Outcome work

- Shopify integration first for a DTC path, followed by GA4 as needed;
- unique links and promotional codes;
- click, order, revenue, return, and content-asset outcome events;
- attribution source and confidence;
- campaign review and agent-generated learning summary;
- creator and evidence features linked to outcomes;
- customer controls for data retention and model improvement.

For a B2B path, replace ecommerce work with tracked links, CRM connections, meetings, opportunities, and pipeline.

### Payment work

- legal, tax, merchant-of-record, refund, dispute, and country review;
- Stripe Connect sandbox proof with hosted onboarding;
- connected account status and requirement handling;
- final offer and complete fee disclosure;
- idempotent payment, refund, transfer, payout, and dispute webhooks;
- double-entry or equivalent immutable internal ledger design;
- reconciliation and finance operations dashboard;
- failed payout, refund, dispute, and support workflows;
- limited geography and currency at launch;
- creator earnings and payout views.

### Exit gate

- at least ten transactions reconcile from business payment through creator payout;
- no unexplained ledger differences;
- refund and dispute drills succeed;
- payment time after approval meets the published service level;
- connected outcomes materially improve the next campaign decision;
- legal and provider review approves the production funds flow.

Do not call the payment structure escrow unless the approved legal and provider structure supports that term.

## 9. Phase 5 - Invitation-only marketplace and weekly rankings

Target window: 8 to 12 weeks after transaction readiness

### Objective

Create focused marketplace liquidity in a small number of niches without sacrificing trust or recommendation quality.

### Product scope

- invitation-only brand and creator access;
- opportunity publishing, applications, invitations, and matching;
- supply health by niche, geography, platform, and rate band;
- creator verification and availability freshness;
- weekly Rising, Reliable, Product Fit, Response, and Proven Results lists;
- segmented ranking snapshots and transparent score reasons;
- minimum sample thresholds and cold-start treatment;
- correction and appeal workflow;
- sponsored placement separated from organic ranking;
- marketplace fee disclosure and invoices;
- referral and repeat-collaboration loops.

### Marketplace operating metrics

- active opportunities with at least five qualified creators;
- median time to first qualified response;
- invitation response and application acceptance rates;
- completed collaboration rate;
- repeat match rate;
- creator earnings concentration;
- ranking exposure concentration;
- cancellation, dispute, refund, and fraud rates.

### Exit gate

Expand a niche only when it has repeat demand, enough active supply, acceptable time to match, and healthy completion economics. Do not report one global marketplace size as a substitute for liquidity.

## 10. Phase 6 - Creator-first mobile application

Target window: after creator users show repeated weekly mobile behavior

### Objective

Make the time-sensitive creator workflow excellent on mobile.

### Initial mobile scope

- secure sign in and creator onboarding;
- opportunity inbox and push notifications;
- accept, decline, and propose changes;
- messaging;
- brief and contract status;
- deadline reminders;
- camera/library deliverable upload;
- revision and approval notifications;
- earnings and payout status;
- profile availability and rate updates.

### Explicitly deferred

- full business analytics parity;
- complex campaign configuration;
- admin and operations consoles;
- every web report.

### Exit gate

Mobile reduces creator response time, missed deadlines, and support contacts enough to justify a separate native product surface.

## 11. Cross-phase workstreams

### 11.1 Data provenance and provider strategy

- public-web evidence through Bright Data and alternatives;
- licensed creator data where audience and authenticity breadth is required;
- creator-declared opt-in data;
- official connections for customer-owned campaign metrics;
- first-party collaboration outcomes;
- provider abstraction, caching rules, freshness, and source audit.

### 11.2 Trust, safety, and compliance

- business verification before scaled sending;
- creator claim, correction, and removal;
- outreach consent, caps, suppression, and unsubscribe;
- endorsement disclosure workflow;
- contract and content-rights controls;
- fraud, impersonation, harassment, and dispute reporting;
- privacy, retention, deletion, and access controls;
- region-by-region payment and tax readiness.

### 11.3 Reliability

- durable queues, retries, idempotency, and dead-letter review;
- provider circuit breakers and fallback behavior;
- logs, metrics, traces, alerts, and cost telemetry;
- incident response and customer communication;
- backup and restore drills;
- capacity and rate-limit planning.

### 11.4 Design system

- continue the calm, work-focused macOS-quality interaction standard;
- responsive web components before native mobile components;
- accessible keyboard and screen-reader workflows;
- stable loading, empty, partial, error, and degraded states;
- clear distinction between verified data, public evidence, estimates, and AI inference;
- no decorative metrics or fake precision.

## 12. First 90-day release plan after validation

This is the recommended build sequence once Phase 0 passes.

### Weeks 1 to 2

- architecture decisions and environment setup;
- Supabase Auth, organizations, memberships, and RLS baseline;
- typed domain schema and migrations;
- staging, CI, monitoring, and secret controls.

### Weeks 3 to 4

- saved profiles, search, brief, shortlist, and campaign records;
- localStorage migration path;
- resume workspace and autosave states;
- audit events and support diagnostics.

### Weeks 5 to 6

- agent conversation and structured brief;
- campaign-scoped memory and bounded tools;
- background discovery/evaluation jobs;
- source provenance and freshness UI.

### Weeks 7 to 8

- shortlist compare, rejection reasons, campaign pipeline, owners, and tasks;
- human-approved outreach drafts;
- quality evaluation harness and degraded-provider behavior.

### Weeks 9 to 10

- invitation-only design-partner onboarding;
- billing/entitlement for paid pilots;
- product analytics and operator review queue;
- security and privacy review.

### Weeks 11 to 12

- end-to-end testing and production hardening;
- backup restore and incident drill;
- pilot migration and monitored launch;
- measure activation, recommendation quality, cost, and repeat intent.

The 90-day release does not include open marketplace access, creator payouts, or a mobile app.

## 13. Decision cadence

### Weekly

- review customer interviews and rejected recommendations;
- review activation funnel and provider/AI cost;
- review data-quality and support queue;
- decide one product change and one operational experiment.

### Every two weeks

- score roadmap gate metrics;
- review AI evaluation failures and source validity;
- review security, abuse, and outreach complaints;
- update the risk register.

### Monthly

- assess paid retention and contribution margin;
- decide whether to deepen the current niche or stop expansion;
- review creator supply health once creator onboarding exists;
- revisit build-versus-partner decisions.

## 14. Build-versus-partner decisions

Build internally:

- campaign and creator domain model;
- evidence/provenance layer;
- AI strategist and bounded tools;
- explainable matching and ranking;
- collaboration workflow;
- first-party outcome learning.

Partner initially:

- authentication infrastructure and relational data platform: Supabase;
- public web collection: Bright Data plus alternatives;
- email transport and mailbox connection;
- e-signatures;
- payments, identity, payouts, and tax tooling: Stripe Connect or approved alternative;
- product/analytics connections;
- error monitoring and transactional notifications.

## 15. Definition of production-grade

A feature is not production-grade because the happy path works. It is production-grade when:

- authorization is enforced and tested;
- data persists and can be restored;
- actions are idempotent where retries are possible;
- errors are visible to users and operators;
- external calls have timeouts, retry policies, and cost monitoring;
- consequential actions have audit history;
- accessibility and responsive behavior are verified;
- analytics show whether the feature creates value;
- privacy, retention, and deletion behavior are defined;
- support can resolve failure without unsafe database edits;
- the customer-facing claim exactly matches the data available.

## 16. Immediate next planning actions

No product code should be written until these are agreed:

1. Select DTC or B2B as the initial market.
2. Select one primary campaign type.
3. Recruit and price the first five paid design partners.
4. Choose the initial outcome source.
5. Decide whether email sending is required in the first production release.
6. Approve the identity and organization role model.
7. Approve the first production data model and RLS threat cases.
8. Choose a new working name or begin naming clearance.

Once those decisions are made, convert Phase 1 and Phase 2 into an implementation backlog with epics, user stories, acceptance tests, owners, and estimates.
