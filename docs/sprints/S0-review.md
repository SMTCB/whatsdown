# Sprint 0 review (local-only)

## Delivered
- Next.js 15 / TypeScript strict / Tailwind 4 / Vitest scaffold; typecheck, lint, test and build scripts
- Ticket status rules and `transition()` with event log
- `TicketStore` port and in-memory store
- Diff guard, glob matcher, secret scan
- LLM router (task to model, fallback), pricing, budget states
- Report form, ticket list and ticket detail with manual status moves
- Core schema SQL (not applied)
- README, CLAUDE.md, ADR-001 and ADR-002

## Not done: needs you
| Item | Unblocks |
|---|---|
| Supabase project (free plan allows 2) | persistence, auth, Gate approvals by login |
| GitHub repo for WhatsDown, Vercel | CI, hosting |
| E2B account, GitHub App | sandbox, PRs on the fantasy repo |
| Groq key (check free limits in the console) | triage, screening, voice |
| Anthropic key | Diagnostics and Developer |
| WhatsApp Cloud API | WhatsApp channel |

## Notes
- Prices in `lib/llm/pricing.ts` are placeholders; check them against provider pages.
- `npm audit` reports a high-severity `braces` advisory reached only through the dev-only lint chain (eslint-config-next, fast-glob, micromatch). The forced fix downgrades to eslint-config-next 14, so it was left alone.
- No auth yet: the admin pages are open. Do not deploy this build.
