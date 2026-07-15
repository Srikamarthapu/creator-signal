# CreatorSignal

CreatorSignal is an evidence-first creator research and campaign workspace. Its GLM 5.2 discovery agent turns a conversation into a bounded live search, Bright Data returns real public creator evidence, and the same agent then evaluates only that active research snapshot. Supabase provides the production identity and persistence foundation.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Environment

Copy `.env.example` to `.env.local` and fill only the integrations you intend to run.

- `BRIGHT_DATA_API_KEY` powers server-side product research and real influencer discovery.
- `NVIDIA_API_KEY` powers GLM 5.2 conversational discovery, source-grounded evaluation, and campaign planning.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` enable browser authentication.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` enable authenticated persistence.
- `APP_ORIGIN` sets the trusted base URL used for workspace invitation links.
- Set `REQUIRE_AUTH=true` in hosted environments to protect paid research endpoints.

Only the Supabase publishable key is shipped to the browser. Provider and Supabase secret keys remain server-side.

## Data Rules

- `/results` contains only real public web results returned through Bright Data discovery.
- No local or generated creator profiles are used as fallback results.
- The discovery agent can ask for missing campaign context and launch a real Bright Data search before any results exist.
- The conversation is the primary discovery surface; the structured search controls remain available as an optional manual path.
- Product-only requests receive one strategic intake question about audience, desired action, and credible creator-content format before discovery.
- A requested TikTok, Instagram, or YouTube channel is enforced in both the live query and returned creator set.
- Source match scores are ranking aids, not verified social-platform analytics.
- The copilot can only retrieve evidence from its server-owned Bright Data research session.
- Agent conversations, model runs, and bounded tool traces are saved before and after discovery, linked to the resulting research, and restored after refresh.
- Saving a creator requires a signed-in workspace and persists the exact server-side source record.
- Shortlists use role-separated review and approval before campaign conversion.
- Campaign stages, tasks, outreach edits, and approval decisions append audit events.
- Outreach is grounded in the selected creator's saved evidence and remains locked from copy until approval. No email is sent automatically.
- Team invitations use single-display links, store only SHA-256 token hashes, require the invited email at acceptance, and expire after seven days.
- Membership changes and account export/deletion requests use audited server workflows; browser clients cannot write those records directly.
- Every workspace receives an operator-controlled pilot entitlement with seat and monthly research limits; customers cannot grant or expand their own access.
- Provider diagnostics retain only status, timing, source counts, model identifiers, and sanitized errors. API keys and raw prompts are excluded.
- Duplicate creator records are collapsed by public source, platform handle, or profile identity before ranking.
- Public source text is treated as untrusted data. Instruction-like text is removed, and unsafe or uncited model answers fall back to deterministic source-only output.
- Visible view counts are never converted into inferred engagement, reach, sales, or conversion claims.
- No private contact data, private analytics, or campaign performance is inferred.

## Quality Checks

```bash
pnpm test:agent-evals
pnpm check
```

The agent evaluation suite uses fixed source fixtures across ergonomic technology, skincare, hydration, meal kits, and pet care. It blocks regressions in ranking stability, duplicate handling, citation validity, unsupported claims, and prompt-injection resistance.

## Database

The production migrations are in `supabase/migrations/`. They create profiles, organizations, memberships, campaigns, research/evidence records, shortlists, agent history, tasks, outreach drafts, append-only audit events, and server-only audited workflow functions with RLS on every exposed table.

```bash
supabase start
supabase db reset
pnpm test:db
```

The database suite currently covers 165 tenant-isolation, role, invitation, account, durable-agent-memory, campaign-brief, approval, task, campaign, outreach, entitlement, seat-limit, and provider-diagnostic assertions. Apply the migrations to a cloud project only after choosing the intended Supabase organization and environment.

Local team invitations are share links and do not send email. Connect reviewed SMTP or an email provider only when the hosted Supabase environment is configured.

When the local Supabase stack is running, `pnpm dev` discovers its local publishable and server keys automatically without writing them to the repository. Hosted credentials must still be supplied through the deployment environment.

Platform users with `app_metadata.platform_role` set to `operator` or `admin` can open `/internal/support` to inspect sanitized provider health and adjust pilot access. Workspace owners and members cannot read that console or call its access-control endpoint.

## Demo Path

1. On the home screen, tell the creator discovery agent what you are promoting and the outcome you need. The agent asks only for missing high-value campaign context.
2. Let the agent launch its `find_creators` tool and wait for the real Bright Data results.
3. Ask the same agent to compare the strongest fits and inspect its cited source records.
4. Open **Brief** to generate, edit, submit, and approve the structured campaign brief.
5. Save a creator to the organization shortlist and submit it for approval.
6. Convert the approved shortlist into a campaign and generate source-grounded outreach.
7. Edit and approve the outreach before copying it for manual use.
8. Open Settings to invite a teammate, assign roles, and review account data controls.
9. As a platform operator, open the support console to review provider health and pilot limits.
