-- Virtual cost per call is tiny on cheap models; keep six decimals so it does not round to zero.
alter table llm_usage alter column cost_usd type numeric(12,6);
create index if not exists llm_usage_ticket_idx on llm_usage (ticket_id);

-- A stalled ticket is retried by a scheduled job; each retry bumps the counter and leaves an audit event.
create or replace function record_retry(p_id uuid, p_cause text) returns tickets
language plpgsql as $$
declare t tickets;
begin
  update tickets set retry_count = retry_count + 1, updated_at = now() where id = p_id returning * into t;
  if not found then raise exception 'Ticket % not found', p_id; end if;
  insert into ticket_events (ticket_id, type, from_status, to_status, actor, payload)
  values (p_id, 'retry', t.status, t.status, 'system', jsonb_build_object('cause', p_cause, 'attempt', t.retry_count));
  return t;
end $$;
