# CreatorSignal

CreatorSignal is a responsive MVP prototype for finding fictional creators whose audiences show product demand signals.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Environment

Copy `.env.example` to `.env.local` and fill server-side keys as needed.

- `BRIGHT_DATA_API_KEY` powers the server-side product research endpoint.
- `OPENAI_API_KEY` enables the OpenAI Agents SDK brief. Without it, the app returns a deterministic local brief.

No secrets are shipped to client JavaScript.

## Prototype Rules

- Creator records are fictional local mock data from `src/data/creators.ts`.
- Creator metrics are prototype values, not real influencer analytics.
- Outreach is copied or saved locally only. No email is sent.
- Campaign plans are local workflow timelines. No calendar booking is created.
- Bright Data and OpenAI Agents are used only for product research context, not creator analytics.

## Demo Path

1. Search `petite linen blazer`.
2. View ranked results.
3. Open Maya R.
4. Review audience signals.
5. Generate outreach and copy or save a local draft.
6. Create a campaign timeline and toggle step status.

