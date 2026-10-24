-- Aligns the schema with what the app stores today and adds attachments.
-- Server code uses the service role key, which bypasses RLS; tables stay locked to everyone else.

-- Projects are identified by slug until the project registry exists.
alter table tickets drop constraint tickets_project_id_fkey;
alter table tickets alter column project_id type text using project_id::text;
alter table tickets add column reporter_phone text;

create or replace function create_ticket(
  p_project text, p_title text, p_body text, p_channel ticket_channel, p_phone text
) returns tickets
language plpgsql as $$
declare t tickets;
begin
  insert into tickets (project_id, title, body, channel, reporter_phone)
  values (p_project, p_title, p_body, p_channel, p_phone)
  returning * into t;
  insert into ticket_events (ticket_id, type, from_status, to_status, actor)
  values (t.id, 'created', null, 'new', 'reporter');
  return t;
end $$;

-- Status change and event in one transaction.
create or replace function apply_transition(
  p_id uuid, p_to ticket_status, p_actor event_actor, p_cause text, p_payload jsonb
) returns tickets
language plpgsql as $$
declare t tickets; prev ticket_status;
begin
  select status into prev from tickets where id = p_id for update;
  if not found then raise exception 'Ticket % not found', p_id; end if;
  update tickets set status = p_to, updated_at = now() where id = p_id returning * into t;
  insert into ticket_events (ticket_id, type, from_status, to_status, actor, payload)
  values (p_id, 'status_changed', prev, p_to, p_actor, jsonb_build_object('cause', p_cause) || coalesce(p_payload, '{}'));
  return t;
end $$;

create table attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  name text not null,
  mime text not null,
  size int not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index attachments_ticket_idx on attachments (ticket_id);
alter table attachments enable row level security;

insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;
