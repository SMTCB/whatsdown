-- Private status link for reporters: a long random secret per ticket, looked up server-side only.
alter table tickets add column public_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index tickets_public_token_idx on tickets (public_token);

-- Reporter follow-up text joins the ticket body so the agents see it on the next triage.
create or replace function append_ticket_details(p_id uuid, p_text text) returns tickets
language plpgsql as $$
declare t tickets;
begin
  update tickets set body = body || E'\n\nFollow-up from the reporter:\n' || p_text, updated_at = now()
  where id = p_id returning * into t;
  if not found then raise exception 'Ticket % not found', p_id; end if;
  return t;
end $$;
