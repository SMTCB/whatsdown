# ADR-002: Diff guard, and BACKLOG.md written by the app

Status: accepted

## Decision
- Agent diffs are checked by `checkDiff`: protected paths (migrations, functions, CI, package files, native projects, config), env files, a 400 changed-line cap, a secret scan, and no empty diffs.
- BACKLOG.md is always blocked in Developer diffs. Every agent PR gets a second, app-written commit with a template-built entry (`## 🟡 <title> (<date>) — PR #<n>, WhatsDown ticket #<t>` plus 2 to 4 bullets). The model never writes it. It can be turned off per project with `projects.backlog_entry`.

## Consequences
The agent cannot alter the backlog or the rules that constrain it; the backlog entry is deterministic and rebuilt on conflict.
