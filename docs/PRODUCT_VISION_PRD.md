# CreatorSignal Production Product Requirements Document

Status: Product direction for validation and future implementation
Last updated: July 11, 2026
Planning horizon: Web product first, creator-focused mobile app later

## 1. Executive decision

CreatorSignal should become an evidence-first operating system and trusted marketplace for creator partnerships.

It should not compete as another giant influencer directory. The product should help a business move through the entire decision and execution chain:

> product need -> campaign brief -> evidence-backed creator shortlist -> approved outreach -> collaboration -> deliverables -> payment -> measurable outcome -> better future match

The initial commercial wedge is narrower:

> Turn a product brief into a source-backed shortlist of active, reachable micro-creators and approved outreach in one working session.

The marketplace, creator payouts, public rankings, and mobile app are part of the long-term platform, but they should only launch after the brand workflow produces repeat paid demand.

## 2. Vision

Build the trusted work network for creator partnerships: a place where businesses can confidently choose and activate creators, creators can find fair work and get paid predictably, and both sides build portable proof of reliability and results.

CreatorSignal wins when it makes four things legible:

1. Why a creator fits a specific product and audience.
2. Whether that creator is active, reachable, available, and reliable.
3. What collaboration, offer, and creative format are likely to work.
4. What happened after the match and what should be learned from it.

## 3. Product mental model

The platform is four connected systems, not one search screen.

### 3.1 Intelligence system

Understands the business, product, target customer, campaign constraints, creator evidence, and historical outcomes. It produces explainable recommendations and never presents an inference as a verified fact.

### 3.2 Campaign operating system

Turns recommendations into saved shortlists, outreach, proposals, briefs, contracts, deliverables, approvals, rights, tasks, and outcome reporting.

### 3.3 Trust network

Combines public evidence, creator-declared information, connected platform data, customer feedback, response behavior, delivery reliability, and dispute history. It distinguishes discovered creators from opt-in, verified, available, and previously successful creators.

### 3.4 Financial and outcome system

Supports transparent offers, milestone status, platform-facilitated payments, creator earnings, fees, refunds, and attribution. It turns completed work into better future matching.

### 3.5 Compounding loop

Every campaign should strengthen the next one:

1. A business accepts or rejects recommendations and records why.
2. Creators reply, negotiate, accept, decline, or do not respond.
3. Deliverables are submitted, revised, approved, and published.
4. Clicks, orders, leads, content quality, and reliability are recorded.
5. Matching learns which evidence predicted a useful outcome for that business and campaign type.

The durable asset is this first-party outcome graph, not the number of profiles indexed.

## 4. Target users and account model

### 4.1 Business user

A founder, growth marketer, ecommerce manager, or brand team running approximately 5 to 50 creator collaborations per campaign and lacking enterprise software, a large creator roster, or a dedicated influencer operations team.

Primary jobs:

- translate a launch goal into a creator campaign;
- find a small number of relevant, reachable creators;
- understand why each creator is recommended;
- manage outreach, negotiation, deliverables, rights, and spend;
- prove what worked.

### 4.2 Independent professional

A freelance marketer, consultant, or agency operator managing work independently or across several client workspaces.

Primary jobs:

- maintain separate client data and permissions;
- repeat campaign workflows efficiently;
- collaborate with clients on approval;
- report outcomes without combining tenant data.

### 4.3 Creator

An opt-in content creator who wants relevant opportunities, clear briefs, fair terms, less administrative friction, dependable payment, and a trustworthy record of completed work.

Primary jobs:

- present niche, platforms, portfolio, rates, availability, and preferences;
- review and respond to opportunities;
- negotiate scope, rights, timing, and compensation;
- submit content and manage revisions;
- track earnings and payout status;
- build a reputation based on real delivery, not follower count alone.

### 4.4 Platform operator

Internal support, trust and safety, campaign operations, finance operations, and data-quality users.

### 4.5 Identity design decision

There will be one authentication system and three onboarding paths: Creator, Individual professional, and Business.

Account type is not a permanent exclusive role. A person can own a creator profile and also belong to one or more business workspaces. Authorization comes from organization memberships and platform-managed role data, not from editable user profile metadata.

Initial organization roles:

- Owner: billing, integrations, members, and all campaign data.
- Admin: members, integrations, and all campaign workflows except ownership transfer.
- Marketer: create and manage campaigns, creators, and outreach.
- Approver: review shortlists, messages, terms, and deliverables.
- Analyst: read-only access to campaigns and reports.

Creator access is scoped to the creator's own profile and collaborations to which they are a party.

## 5. Problem statement

Businesses struggle to answer five connected questions:

1. Who is genuinely relevant to this product and audience?
2. What evidence supports the recommendation?
3. Can the creator be reached, and will they reliably deliver?
4. What offer and campaign structure should the business use?
5. Did the collaboration create a useful business outcome?

Today these answers are fragmented across search tools, spreadsheets, inboxes, social platforms, contracts, payment tools, and analytics. Search products often optimize for profile volume. Marketplaces often optimize for listings and transactions. CreatorSignal should optimize for activated, successful collaborations with traceable evidence.

## 6. Product principles

1. Evidence before confidence. Every recommendation links to the facts that support it.
2. Honest data labels. Fields are marked as observed, connected/verified, creator-declared, vendor-estimated, AI-inferred, or campaign outcome.
3. Human approval at consequential moments. AI may recommend and draft; people approve outreach, contracts, payments, and external actions.
4. Outcome over vanity. Optimize for replies, accepted collaborations, reliable delivery, usable content, and business results rather than follower count alone.
5. Creator dignity. Clear scope, rights, compensation, timelines, and payment status are product requirements.
6. Narrow first, expand with proof. Start with one buyer segment and campaign type before broadening platforms and industries.
7. Fast first value. Source-backed candidates appear quickly; deeper AI analysis loads progressively and never blocks basic discovery.
8. No hidden automation. The product clearly shows what the agent did, what data it used, and what still requires review.

## 7. Positioning

### 7.1 Category

AI campaign strategist and creator collaboration platform for lean growth teams.

### 7.2 Product promise

Turn a product brief into a verified creator shortlist and approved outreach in one session, then learn which evidence actually predicted a reply and result.

### 7.3 Initial ideal customer profile

Small and lower-mid-market DTC brands launching consumer products through TikTok, Instagram, and YouTube micro-creators.

The B2B creator GTM path is a valid alternative, but it should be selected only if paid design partners are primarily B2B SaaS companies. The first release should not support DTC and B2B equally.

## 8. Product scope by horizon

### 8.1 Production foundation

- authentication and onboarding;
- organizations, memberships, roles, and tenant isolation;
- durable saved searches, briefs, shortlists, creator records, and campaigns;
- evidence-first discovery using real public sources and approved data providers;
- AI campaign strategist with campaign-scoped memory;
- human-approved outreach drafts;
- campaign pipeline, tasks, and audit history;
- internal review and support tools;
- billing for the business subscription or pilot service.

### 8.2 Collaboration network

- creator onboarding and opt-in profiles;
- invitation, application, proposal, negotiation, and messaging;
- briefs, contracts, deliverables, revisions, approvals, and rights tracking;
- availability, response, delivery, and customer feedback signals;
- creator notifications and earnings ledger;
- customer-connected outcome data.

### 8.3 Transaction marketplace

- platform-facilitated payments and payouts;
- identity and payout onboarding through a regulated payment provider;
- milestone and payment status;
- refunds, disputes, cancellations, and operations tooling;
- transparent platform and processing fees;
- invitation-only marketplace supply and demand;
- weekly rankings segmented by niche, market, platform, and campaign goal.

### 8.4 Mobile

The first mobile application should be creator-first: opportunities, messages, deliverable uploads, approvals, deadlines, and earnings. Business campaign planning can remain web-first until mobile demand is demonstrated.

## 9. Core user journeys

### 9.1 Business onboarding

1. User signs up with email, passwordless sign-in, or supported social login.
2. User chooses Business or Individual professional.
3. Business user creates or joins an organization.
4. User provides company, product, market, team role, and campaign goals.
5. User may connect a product catalog, website, analytics, or email later; connection is not mandatory for first value.
6. User lands in a saved workspace with a clear first campaign action.

### 9.2 AI-assisted campaign planning

1. User starts a conversation with the campaign strategist.
2. Agent asks only the missing high-value questions: product, customer, geography, objective, platform, deliverable, offer, rights, timing, and budget.
3. Agent creates a structured campaign brief and shows assumptions.
4. User edits or approves the brief.
5. Agent proposes a search plan and begins discovery.
6. Fast source results appear first; deeper fit evaluation streams in afterward.
7. Agent explains tradeoffs and asks for feedback on recommendations.

### 9.3 Shortlist and outreach

1. User reviews creator cards with evidence, freshness, availability state, and confidence.
2. User saves, rejects, compares, or requests alternatives.
3. Rejection reasons become structured learning signals.
4. User approves a shortlist.
5. Agent drafts grounded, editable outreach tied to visible creator evidence.
6. User approves sending through a connected mailbox or copies the draft during early releases.
7. The platform records message, approval, send, reply, and suppression events.

### 9.4 Creator onboarding and collaboration

1. Creator signs up directly or accepts an invitation.
2. Creator claims or creates a profile and links public social identities.
3. Creator declares niche, availability, rate guidance, locations, formats, and restrictions.
4. Creator reviews opportunity, scope, rights, timing, and compensation.
5. Creator declines, expresses interest, or proposes changes.
6. Both parties approve final terms and deliverables.
7. Creator submits work, receives revision requests, and obtains approval.
8. Payment becomes available according to the agreed milestone and platform rules.

### 9.5 Outcome review

1. Platform captures available connected metrics and declared campaign outcomes.
2. Business reviews qualitative content value and quantitative outcomes.
3. Both parties may leave structured, private operational feedback.
4. Agent explains what worked, what did not, and how the next campaign should change.

## 10. Functional requirements

Priority meanings: P0 is required for the first production release, P1 for the collaboration release, and P2 for the transaction marketplace.

### 10.1 Authentication, identity, and workspaces

- P0: sign up, sign in, email verification, password recovery, session management, and sign out;
- P0: Creator, Individual professional, and Business onboarding paths;
- P0: organizations, invitations, memberships, and role-based permissions;
- P0: users may belong to multiple organizations;
- P0: all customer-owned data is tenant isolated;
- P0: account export and deletion request workflow;
- P1: creator profile claiming and identity conflict review;
- P1: optional social account verification through approved connections;
- P2: payment-provider identity and payout onboarding.

### 10.2 Saved workspace

- P0: persist searches, briefs, conversations, recommendations, shortlists, filters, and campaigns;
- P0: show recent work and resume the exact campaign context;
- P0: support autosave with visible saved, saving, and failed states;
- P0: immutable audit events for approvals and external actions;
- P1: notifications and activity feed;
- P1: attachments and content assets with tenant-scoped access.

### 10.3 AI campaign strategist

- P0: conversational intake that produces a structured campaign brief;
- P0: retrieve organization and campaign context only when authorized;
- P0: search creators, retrieve evidence, compare candidates, estimate budget bands, draft outreach, and create campaign tasks through bounded tools;
- P0: cite source evidence and label unsupported assumptions;
- P0: require explicit user confirmation before sending messages, modifying final terms, inviting creators, or changing campaign state;
- P0: preserve full tool-call and approval audit history;
- P0: support a model-provider gateway and structured fallbacks;
- P0: run repeatable quality evaluations against fixed creator-evidence fixtures;
- P1: summarize negotiations and propose next actions;
- P1: learn from accepted, rejected, reply, and delivery outcomes within the authorized organization;
- P2: proactive alerts and recommendations, with user-controlled notification settings.

The agent must never autonomously send funds, sign contracts, publish content, or represent uncertain data as verified.

### 10.4 Creator discovery and evidence

- P0: accept product URL or text brief, audience, geography, platform, budget, goal, timing, and deliverable;
- P0: return real creator candidates with public source links and freshness timestamps;
- P0: separate fast source discovery from slower AI evaluation;
- P0: show fit explanation, evidence strength, campaign risk, source type, and confidence;
- P0: filter and sort without rerunning search when data is already loaded;
- P0: deduplicate creator identities across sources;
- P0: store every external observation with provider, source URL, collection time, verification class, and expiry policy;
- P0: provide a clear no-result state instead of local or fabricated creators;
- P1: add opt-in availability, rate guidance, response history, and delivery reliability;
- P1: add approved first-party or licensed audience/authenticity data;
- P2: support marketplace applications and invitation-only opportunities.

### 10.5 Shortlist and campaign CRM

- P0: save, reject, restore, compare, tag, note, and assign creators;
- P0: capture structured accept/reject reasons;
- P0: campaign states: Draft, Sourcing, Outreach, Negotiation, Contracted, Active, Review, Complete, Cancelled;
- P0: configurable tasks, owners, due dates, reminders, and status;
- P0: campaign budget with creator spend separated from software and service fees;
- P1: collaboration states: Invited, Interested, Negotiating, Accepted, Contract Pending, Active, Submitted, Revisions, Approved, Paid, Complete, Declined, Cancelled, Disputed;
- P1: bulk actions must remain reviewable and reversible where possible.

### 10.6 Outreach and communication

- P0: grounded, editable outreach drafts with source references;
- P0: copy draft during the first release;
- P0: approval state and audit event for every final message;
- P1: Gmail and Outlook connection, sending, reply sync, shared inbox, and thread status;
- P1: send caps, suppression list, unsubscribe handling, and bounce monitoring;
- P1: templates by campaign type without synthetic personal familiarity;
- P2: in-platform business-to-creator messaging for opt-in marketplace users.

### 10.7 Briefs, proposals, contracts, deliverables, and rights

- P1: structured campaign brief and creator-specific scope;
- P1: proposal with deliverable, date, compensation, revisions, exclusivity, usage channels, paid-media rights, territory, and duration;
- P1: contract generation through reviewed templates and e-sign provider integration;
- P1: deliverable upload, version history, comments, revisions, and approval;
- P1: rights grants with start, end, territory, channel, and reminder state;
- P1: content library with access scoped to the owning organization and collaboration parties;
- P1: required disclosure checklist appropriate to the campaign.

### 10.8 Payments and creator earnings

- P1: non-transactional earnings ledger and payment status may be recorded before money movement is enabled;
- P2: creator onboarding through Stripe Connect or another approved marketplace payout provider;
- P2: platform records offer, gross amount, fees, net creator amount, currency, payment status, payout status, refunds, and disputes;
- P2: business sees the complete fee breakdown before approval;
- P2: creator sees expected and available earnings and payout history;
- P2: payment and payout webhooks are idempotent and auditable;
- P2: support tooling handles failed onboarding, failed payouts, refunds, and disputes;
- P2: no product language may call the flow escrow unless legal and provider review confirms that structure.

Stripe Connect is the leading implementation candidate, but the final funds flow and merchant-of-record responsibilities require legal, tax, risk, and provider review. Stripe documents that marketplace platforms can be responsible for fees, refunds, disputes, and negative balances depending on the charge model.

### 10.9 Outcomes and attribution

- P1: campaign-level qualitative outcome review;
- P1: track response, positive response, acceptance, delivery, revision, approval, and completion rates;
- P1: record customer-connected clicks, codes, orders, revenue, returns, leads, meetings, or pipeline as applicable;
- P1: preserve source and attribution method for each outcome;
- P1: show confidence and attribution limitations;
- P2: use historical outcomes as ranking features only after data quality and bias review;
- P2: permit customers to exclude sensitive outcomes from model improvement.

### 10.10 Top creators this week

This is a segmented discovery product, not a universal popularity contest.

- P2: weekly lists by niche, platform, geography, creator size, campaign format, and buyer goal;
- P2: separate Rising, Most Reliable, Strongest Product Fit, Best Response, and Proven Results views;
- P2: require recent activity or availability and minimum evidence quality;
- P2: show why each creator is ranked and when the snapshot was calculated;
- P2: prevent paid placement from altering organic rank; sponsored placement must be visually separate;
- P2: apply minimum sample thresholds so a single campaign does not create a misleading rank;
- P2: provide creator correction and appeal workflow;
- P2: monitor exposure concentration and unfair cold-start effects.

Illustrative score inputs, subject to validation:

- 30% campaign-specific product and audience fit;
- 20% evidence quality and freshness;
- 15% response and availability reliability;
- 15% delivery and approval reliability;
- 15% connected or customer-confirmed outcomes;
- 5% business satisfaction and dispute-adjusted trust.

Follower count is an eligibility/filter input, not the dominant rank factor.

## 11. Data model

Core domains:

- Identity: profiles, organizations, memberships, invitations, roles.
- Creator network: creator_profiles, social_identities, creator_preferences, availability, portfolios.
- Evidence: creator_observations, evidence_sources, provider_syncs, verification_events.
- Intelligence: conversations, messages, agent_runs, tool_calls, recommendations, evaluation_versions.
- Campaigns: campaigns, campaign_briefs, requirements, shortlists, shortlist_entries, tasks.
- Relationships: contacts, outreach_threads, messages, suppressions, invitations, applications.
- Collaboration: proposals, collaborations, contracts, deliverables, revisions, approvals, rights_grants.
- Money: billing_customers, subscriptions, connected_accounts, payment_records, payouts, refunds, disputes, ledger_entries.
- Outcomes: tracking_links, promo_codes, outcome_events, attribution_models, campaign_reviews.
- Platform: integrations, notifications, audit_events, moderation_cases, support_cases, background_jobs.

Every tenant-owned record should include an organization identifier where applicable. Every externally derived fact should include source, provider, observed time, verification class, confidence, and freshness/expiry state.

## 12. Technical architecture direction

### 12.1 Keep and evolve the current stack

The existing React, TypeScript, Vite, and Node/Express application is a valid starting point. Production work should modularize it rather than rewrite it solely for framework fashion.

Recommended shape:

- Web client: React and TypeScript, responsive and accessible.
- API layer: typed Node/TypeScript service that owns secrets, agent tools, provider calls, billing actions, and authorization checks.
- Data platform: Supabase Auth, Postgres, Row Level Security, Storage, Realtime where useful, and Queues for durable background work.
- Workers: discovery, AI evaluation, email sync, webhook processing, ranking snapshots, and outcome ingestion.
- Provider adapters: Bright Data, future licensed creator data, social/ecommerce connections, email, analytics, e-sign, and payments.
- Observability: structured logs, traces, metrics, alerting, provider cost, and AI quality telemetry.
- Mobile: consume the same authenticated API and domain contracts rather than connecting directly to privileged services.

### 12.2 Supabase requirements

- enable RLS on every exposed table;
- use explicit grants because new tables may not be automatically exposed to the Data API;
- store organization roles in membership/app-managed authorization data, never editable user metadata;
- keep service-role and secret keys on trusted servers only;
- scope Storage objects by organization, creator, and collaboration;
- use durable queues for provider work that requires retry, visibility timeout, and auditability;
- test RLS for owner, member, creator-party, unrelated authenticated user, anonymous user, and service process;
- run database and security advisors before migration release;
- pin client versions and keep TypeScript at a currently supported version.

Relevant current references:

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase changelog](https://supabase.com/changelog)

### 12.3 AI architecture

- provider-neutral model gateway with per-task model selection;
- structured outputs validated against schemas;
- retrieval limited by organization and campaign authorization;
- tool permission policy enforced on the server;
- append-only agent run, source, prompt version, tool call, approval, latency, and cost records;
- fast deterministic/source path when AI is delayed or unavailable;
- offline evaluation set for relevance, hallucination, unsafe outreach, ranking consistency, and source citation;
- prompt injection controls for public source text;
- no secret, payment, or cross-tenant data in model prompts unless strictly required and authorized.

## 13. Security, privacy, and trust requirements

- tenant isolation is enforced in the database and API, not only in UI routes;
- sensitive provider tokens are encrypted and rotated;
- least-privilege access for users, workers, and support staff;
- admin access and impersonation require reason, time limit, and audit event;
- rate limiting, abuse prevention, bot protection, and invitation controls;
- dependency scanning, secret scanning, backups, restore drills, and incident response;
- data export, correction, retention, deletion, and consent workflows;
- documented rights to collect, cache, and display creator data;
- creator claim, correction, and removal workflow;
- legal review for commercial email, endorsements/disclosures, contracts, rights, privacy, marketplace payments, tax, refunds, and disputes;
- prohibit inferred sensitive traits and private audience claims;
- do not treat public availability as consent to automated outreach.

## 14. Revenue model

Revenue should expand with delivered value.

### 14.1 Validation revenue

Charge a fixed paid pilot or monthly software-assisted service fee. Creator spend is separate and transparent. This tests willingness to pay before substantial marketplace investment.

### 14.2 SaaS revenue

Business subscription based on active campaigns, seats, creator evaluations, or workflow volume. Avoid opaque credits and surprise limits. A free creator account supports marketplace liquidity.

### 14.3 Transaction revenue

After payments are proven, test a clearly disclosed marketplace fee on platform-facilitated creator payments. An initial hypothesis range of 8% to 12% should be validated against support, payment, fraud, dispute, and payout costs rather than copied from competitors.

### 14.4 Optional expansion revenue

- managed sourcing or campaign operations;
- advanced outcome reporting and integrations;
- agencies and multi-client workspaces;
- paid rights extension and content amplification workflows;
- enterprise controls only after repeat mid-market demand.

No creator paywall should block basic participation, opportunity response, deliverable submission, or earnings access.

## 15. Success metrics

### 15.1 North-star metric

Successful activated collaborations per active paying organization per month.

A successful activated collaboration means the creator accepted, the agreed deliverable was approved, payment obligations were completed or recorded, and the organization captured at least one outcome signal.

### 15.2 Activation metrics

- time from signup to approved campaign brief;
- time from brief to first credible shortlist;
- time from brief to first approved outreach;
- percentage of new organizations that save at least three creators;
- percentage that launch one campaign within seven days.

### 15.3 Match and marketplace metrics

- customer shortlist acceptance rate;
- verified contact and creator response rate;
- positive response and proposal acceptance rate;
- creator availability accuracy;
- recommendation rejection reasons;
- creator supply by niche, market, and platform.

### 15.4 Collaboration metrics

- on-time delivery rate;
- average revision cycles;
- approval rate;
- cancellation and dispute rate;
- payment time after approval;
- repeat brand-creator collaborations.

### 15.5 Business and unit metrics

- paid pilot conversion and repeat purchase;
- monthly retention and expansion;
- contribution margin per activated creator;
- data, AI, support, and payment cost per collaboration;
- creator and business acquisition cost;
- revenue concentration and marketplace take-rate realization.

### 15.6 AI quality metrics

- product relevance precision on reviewed candidates;
- citation/source validity;
- unsupported-claim rate;
- human acceptance of briefs, recommendations, and drafts;
- latency to first result and complete evaluation;
- model/provider cost per activated collaboration.

## 16. First production release acceptance criteria

The first production release is ready for invited design partners when:

1. A user can sign up, create or join a business workspace, and sign back in safely.
2. Organization data is isolated by tested RLS policies.
3. A user can talk to the agent and approve a structured campaign brief.
4. Real source-backed creator discovery returns no fabricated fallback profiles.
5. Results persist, filters work locally, and every external fact shows source and freshness.
6. A user can save and compare creators and record accept/reject reasons.
7. A user can create a campaign, assign owners, and manage status and tasks.
8. The agent can draft evidence-grounded outreach, but sending requires explicit approval.
9. Agent runs, sources, tool actions, and approvals are auditable.
10. Provider failures produce honest degraded states and retryable background jobs.
11. Product analytics, error monitoring, backups, and a restore test are in place.
12. At least three paid design-partner organizations complete the core workflow without operator database edits.

Creator transactions, open marketplace access, and mobile are not required for this release.

## 17. Non-goals until stage gates are met

- largest creator database claims;
- an open global marketplace;
- automatic bulk cold outreach or social DMs;
- autonomous contracts, content publishing, or money movement;
- unsupported private audience analytics;
- every social network and every customer segment;
- enterprise SSO and complex global brand hierarchies;
- native mobile parity with the business web app;
- universal creator rankings without sufficient recent data.

## 18. Key risks and mitigations

### Poor creator relevance

Mitigation: narrow category templates, source evidence, human review queue, structured rejection reasons, and provider diversification.

### Marketplace cold start

Mitigation: begin with customer-owned rosters and outbound discovery, invite creators only for real paid opportunities, and launch supply by niche rather than globally.

### Stale or misleading data

Mitigation: provenance, freshness policies, creator claims, connected data, correction workflows, and no fabricated fallback.

### AI latency, cost, and hallucination

Mitigation: progressive loading, deterministic fallbacks, structured outputs, source citations, caching, model routing, budget controls, and continuous evaluation.

### Outreach abuse

Mitigation: human approval, send caps, suppression, verified business identity, complaint monitoring, and graduated access.

### Payment, tax, and dispute burden

Mitigation: defer transaction launch, partner with a marketplace payment provider, limit initial regions, use hosted onboarding, and operate an audited support workflow.

### Trust and ranking bias

Mitigation: segmented rankings, minimum sample sizes, transparent score reasons, no pay-to-rank, appeals, and exposure fairness monitoring.

### Building too much before demand

Mitigation: every roadmap phase has a paid usage gate. The platform does not advance because a feature is attractive; it advances because the prior workflow repeats.

## 19. Open product decisions

These decisions should be resolved through design-partner evidence before major implementation:

1. Initial segment: DTC consumer brands or B2B creator GTM.
2. Initial campaign type: gifting, paid organic content, UGC, affiliate, or a narrow combination.
3. Primary outcome system: Shopify orders, GA4 events, or CRM pipeline.
4. Initial communication mode: copied drafts or connected email.
5. Initial creator data mix: public web only, licensed provider, or opt-in network.
6. Payment timing: brand pays creator directly first, or limited Stripe Connect pilot.
7. Marketplace launch geography and currencies.
8. Working brand name after domain and trademark clearance.

## 20. Source documents and external references

- Original CreatorSignal prototype PRD, 24 pages, provided by the founder.
- [Competitive research and recommended next steps](../COMPETITIVE_RESEARCH_2026.md)
- [Stripe Connect overview](https://docs.stripe.com/connect)
- [Stripe marketplace guide](https://docs.stripe.com/connect/marketplace)
- [Stripe Connect charge types](https://docs.stripe.com/connect/charges)
- [FTC disclosures for social media influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
