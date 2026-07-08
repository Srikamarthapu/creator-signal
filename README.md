# CreatorSignal

CreatorSignal is a responsive MVP for discovering public, source-backed creator matches from product searches.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Environment

Copy `.env.example` to `.env.local` and fill server-side keys as needed.

- `BRIGHT_DATA_API_KEY` powers server-side product research and real influencer discovery.
- `OPENAI_API_KEY` enables OpenAI Agents SDK extraction and briefs. Without it, the app returns deterministic source extraction.

No secrets are shipped to client JavaScript.

## Data Rules

- `/results` prioritizes real public web results returned by Bright Data and structured by OpenAI Agents when configured.
- Local creator records in `src/data/creators.ts` are fallback placeholders only.
- Source match scores are ranking aids, not verified social-platform analytics.
- Outreach is copied or saved locally only. No email is sent.
- Campaign plans are local workflow timelines. No calendar booking is created.
- No private contact data, private analytics, or campaign performance is inferred.

## Demo Path

1. Search `budget decor`.
2. Review real public creator results.
3. Open the source result.
4. Draft outreach from source-backed evidence.
5. Copy or save a local draft.
