-- WhatsDown core schema. Written locally; NOT applied to any database yet.
-- Apply with `supabase db push` once the hosted project exists (see docs/adr/ADR-001).

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create type ticket_status as enum (
  'new', 'needs_info', 'duplicate', 'triaged', 'diagnosing',
  'awaiting_plan_approval', 'patching', 'in_qa', 'awaiting_merge',
  'merged', 'notified', 'closed', 'failed'
);
create type ticket_channel as enum ('web', 'whatsapp');
create type event_actor as enum ('agent', 'owner', 'system', 'reporter');
create type artifact_kind as enum ('intake', 'triage', 'diagnosis', 'patch', 'qa');
create type approval_decision as enum ('approve', 'revise', 'reject', 'merged', 'closed');

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_owner text not null,
  repo_name text not null,
  default_branch text not null default 'main',
  installation_id bigint,
  context_files text[] not null default '{}',
  protected_paths text[] not null default '{}',
  max_diff_lines int not null default 400,
  required_checks text[] not null default '{}',
  budget_usd numeric(6,2) not null default 1.50,
  backlog_entry boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (repo_owner, repo_name)
);

create table reporters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null,
  phone_e164 text unique,
  allowlisted boolean not null default false,
  opted_out boolean not null default false,
  locale text not null default 'en',
  created_at timestamptz not null default now()
);

create sequence ticket_number_seq;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('ticket_number_seq'),
  project_id uuid not null references projects (id),
  reporter_id uuid references reporters (id),
  channel ticket_channel not null default 'web',
  title text not null,
  body text not null,
  status ticket_status not null default 'new',
  type text,
  severity text,
  area text,
  duplicate_of uuid references tickets (id),
  pr_number int,
  branch text,
  cost_usd numeric(8,4) not null default 0,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_status_idx on tickets (status);
create index tickets_title_trgm on tickets using gin (title gin_trgm_ops);

create table ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets (id) on delete cascade,
  type text not null,
  from_status ticket_status,
  to_status ticket_status,
  actor event_actor not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on ticket_events (ticket_id, created_at);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  kind artifact_kind not null,
  version int not null default 1,
  content jsonb not null default '{}',
  markdown text,
  prompt_version text,
  trace_url text,
  created_at timestamptz not null default now(),
  unique (ticket_id, kind, version)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  gate smallint not null check (gate in (1, 2)),
  decision approval_decision not null,
  note text,
  decided_by uuid references auth.users (id),
  decided_at timestamptz not null default now()
);

create table llm_usage (
  id bigint generated always as identity primary key,
  ticket_id uuid references tickets (id) on delete set null,
  node text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd numeric(8,4) not null default 0,
  latency_ms int,
  created_at timestamptz not null default now()
);

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text unique,
  reporter_id uuid references reporters (id),
  ticket_id uuid references tickets (id),
  direction text not null check (direction in ('in', 'out')),
  type text not null check (type in ('text', 'image', 'audio', 'template')),
  body text,
  media_path text,
  status text,
  created_at timestamptz not null default now()
);

-- Row level security: owner-only by default. The service role (server code) bypasses RLS.
-- A reporter can read only their own tickets and events.
alter table projects enable row level security;
alter table reporters enable row level security;
alter table tickets enable row level security;
alter table ticket_events enable row level security;
alter table artifacts enable row level security;
alter table approvals enable row level security;
alter table llm_usage enable row level security;
alter table whatsapp_messages enable row level security;

create policy reporter_reads_own_ticket on tickets for select
  using (reporter_id in (select id from reporters where user_id = auth.uid()));
create policy reporter_reads_own_profile on reporters for select
  using (user_id = auth.uid());
create policy reporter_reads_own_events on ticket_events for select
  using (ticket_id in (
    select t.id from tickets t join reporters r on r.id = t.reporter_id where r.user_id = auth.uid()
  ));
