# Local build review: after Sprint 0

## Delivered since Sprint 0
- BACKLOG.md entry builder (app-written, idempotent per ticket)
- LLM client layer: fallback on rate limit, usage log, structured output with schema validation
- Agents: Triage, Diagnostics, Developer (patch goes through the diff guard before anyone sees it), QA (pass/fail from checks, never from the model), Communicator
- Pipeline runner, both gates, QA retries (max 2), failure on a node error; gate buttons on the ticket page
- Duplicate detection (trigram similarity on titles, same project, live tickets)
- Input limits and sanitising; rule-based injection screening (blocked reports close, suspicious ones are flagged)
- Store contract suite; `reporterPhone` added to tickets
- WhatsApp adapter: HMAC signature check, handshake, parsing, allowlist, redelivery protection, `/api/whatsapp`
- Dashboard: waiting counts, spend and budget state per ticket, QA retries, screening flags
- Light-mode design system (`design-system/whatsdown/MASTER.md`): navy/slate palette, Lexend + Source Sans 3, 44px targets, visible focus, labelled fields
- Document upload on the report form: up to 3 files, 5 MB each; PDF, PNG, JPEG, .docx, text. Type is checked from file content, not the name. Stored behind an `AttachmentStore` port (memory for now), downloaded as attachments only, never read by the agents

## Verified
- Unit tests, typecheck, lint, production build
- In the browser: report, both gates, duplicate detection, screening, dashboard

## Not verified
- Nothing has run against a real model, database, sandbox, GitHub or WhatsApp. Prompts are untested against real model output.
- The WhatsApp route has not received a real Meta payload; the payload shape follows Meta's documented format and may need small fixes.

## Decisions for you
- Rule-based screening is a stand-in. Prompt Guard 2 replaces it once a Groq key exists.
- The WhatsApp allowlist is an env variable for now; the schema has `reporters.allowlisted` for the real thing.
- Voice notes are declined politely until a transcription step exists.
