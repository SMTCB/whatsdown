# WhatsDown

Agentic maintenance platform (hobby/learning project). Reporters send problems by web form or WhatsApp; five agents (Triage, Diagnostics, Developer, QA, Communicator) work the ticket, with two human gates: Gate 1 approves the plan, Gate 2 is the merge. First target app: the Forza Fantasy League.

The full plan, board, documentation register and specs are in [`plan/`](plan/index.html).

## Status

Local-only build. No Supabase project, GitHub repo, Vercel, E2B, GitHub App or API keys exist yet, so everything external sits behind an interface with a local stand-in.

Built and tested:
- Ticket status rules and `transition()` (`lib/domain`, `lib/db`)
- `TicketStore` port, in-memory store, and a reusable contract suite (`tests/store.contract.ts`)
- Diff guard, glob matcher and secret scan (`lib/guard`); BACKLOG.md entry builder (`lib/backlog`)
- LLM router, pricing, budget checks, client layer with fallback and usage log (`lib/llm`)
- Agents: Triage, Diagnostics, Developer, QA, Communicator (`lib/agents`), tested on a fake model
- Pipeline runner with both gates, QA retries and failure handling (`lib/pipeline`); `createAgentNodes` wires the real agents in
- Sandbox interface with an in-memory stand-in (`lib/sandbox`)
- Duplicate detection, input limits, injection screening (`lib/domain`, `lib/guard`)
- WhatsApp adapter: signature check, webhook parsing, handler and `/api/whatsapp` route (`lib/channels`)
- Pages: report form, tickets, ticket detail with gates, dashboard (`app/`)
- Core SQL schema in `supabase/migrations/0001_core_schema.sql` (written, not applied)

The pages currently run on placeholder agents (`lib/pipeline/demo-nodes.ts`) so no model calls happen.

## What to plug in once you have accounts

| When you have | Do this |
|---|---|
| Supabase project | Apply the migration; write `SupabaseStore` and run `runStoreContract` against it; swap it in `lib/db/index.ts` |
| Anthropic and Groq keys | Write the two `LlmClient` implementations; write a Prompt Guard `Screener`; use `createAgentNodes` instead of `demoNodes` in `getPipeline()` |
| E2B account | Implement `Sandbox` (`apply`, `runChecks`, `reset`) |
| GitHub App | Open the PR from the approved patch (include the BACKLOG.md entry from `lib/backlog`); wire Gate 2 merge |
| WhatsApp Cloud API | Set the `WHATSAPP_*` variables in `.env.example`; write a Graph API `WhatsAppSender`; add a whisper step for voice notes |
| Auth | Protect the admin pages before any deployment |

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test
npm run typecheck
npm run lint
```

Data is in memory and resets when the server restarts.
