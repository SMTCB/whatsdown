# WhatsDown

TypeScript strict, Next.js 15 App Router, Tailwind 4, Zod, Vitest. Node 24.

## Rules
- Status changes go through `transition()` in `lib/db/transition.ts`, never by writing `status` directly.
- Pages and agents talk to storage through the `TicketStore` port (`lib/db/store.ts`). MemoryStore is the only implementation until Supabase exists.
- Developer-agent diffs must pass `checkDiff` (`lib/guard`). BACKLOG.md is blocked there; only the app's own backlog commit may touch it.
- Model choice goes through `routeFor` (`lib/llm/router.ts`); costs through `costUsd`; the per-ticket budget is enforced with `assertWithinBudget`.
- Migrations in `supabase/migrations` are written but not applied until a hosted project exists.
- Never commit secrets; `.env.example` lists variable names only.

## Commands
`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
