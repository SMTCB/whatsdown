# ADR-001: Storage behind a port, in-memory first

Status: accepted

## Context
The hosted Supabase project, repo and other platforms do not exist yet, but the UI, state machine, diff guard and LLM router can be built and tested now.

## Decision
All ticket access goes through the `TicketStore` interface. `MemoryStore` implements it for local development and tests. A Supabase implementation will be added later against the same contract, using `supabase/migrations/0001_core_schema.sql`.

## Consequences
- Local work needs no accounts; data resets on restart.
- Atomic "status plus event" is part of the port (`applyTransition`); the Supabase version must do it in one transaction.
- A contract test shared by both stores should be added when the second implementation lands.
