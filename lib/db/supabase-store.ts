import type { SupabaseClient } from "@supabase/supabase-js";
import type { TicketStatus } from "@/lib/domain/status";
import type { Actor, NewTicket, Ticket, TicketEvent, TicketStore } from "./store";

interface TicketRow {
  id: string;
  number: number;
  public_token: string;
  project_id: string;
  title: string;
  body: string;
  channel: "web" | "whatsapp";
  reporter_phone: string | null;
  status: TicketStatus;
  cost_usd: number | string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  ticket_id: string;
  type: string;
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  actor: Actor;
  payload: Record<string, unknown>;
  created_at: string;
}

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  number: r.number,
  publicToken: r.public_token,
  projectId: r.project_id,
  title: r.title,
  body: r.body,
  channel: r.channel,
  reporterPhone: r.reporter_phone,
  status: r.status,
  costUsd: Number(r.cost_usd),
  retryCount: r.retry_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toEvent = (r: EventRow): TicketEvent => ({
  id: r.id,
  ticketId: r.ticket_id,
  type: r.type,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  actor: r.actor,
  payload: r.payload,
  createdAt: r.created_at,
});

function check<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

/** TicketStore on Supabase Postgres (migrations 0001 + 0002). Server-side only: needs the service role client. */
export class SupabaseStore implements TicketStore {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: NewTicket): Promise<Ticket> {
    const row = check<TicketRow>(
      await this.db.rpc("create_ticket", {
        p_project: input.projectId,
        p_title: input.title,
        p_body: input.body,
        p_channel: input.channel ?? "web",
        p_phone: input.reporterPhone ?? null,
      }),
    );
    return toTicket(row!);
  }

  async get(id: string): Promise<Ticket | null> {
    const row = check<TicketRow>(await this.db.from("tickets").select("*").eq("id", id).maybeSingle());
    return row ? toTicket(row) : null;
  }

  async getByToken(token: string): Promise<Ticket | null> {
    if (!token) return null;
    const row = check<TicketRow>(await this.db.from("tickets").select("*").eq("public_token", token).maybeSingle());
    return row ? toTicket(row) : null;
  }

  async appendDetails(id: string, text: string): Promise<Ticket> {
    const row = check<TicketRow>(await this.db.rpc("append_ticket_details", { p_id: id, p_text: text }));
    return toTicket(row!);
  }

  async recordRetry(id: string, cause: string): Promise<Ticket> {
    const row = check<TicketRow>(await this.db.rpc("record_retry", { p_id: id, p_cause: cause }));
    return toTicket(row!);
  }

  async list(filter?: { status?: TicketStatus }): Promise<Ticket[]> {
    let q = this.db.from("tickets").select("*").order("number", { ascending: false });
    if (filter?.status) q = q.eq("status", filter.status);
    return (check<TicketRow[]>(await q) ?? []).map(toTicket);
  }

  async events(ticketId: string): Promise<TicketEvent[]> {
    const rows = check<EventRow[]>(await this.db.from("ticket_events").select("*").eq("ticket_id", ticketId).order("id"));
    return (rows ?? []).map(toEvent);
  }

  async applyTransition(id: string, to: TicketStatus, actor: Actor, cause: string, payload: Record<string, unknown> = {}): Promise<Ticket> {
    const row = check<TicketRow>(await this.db.rpc("apply_transition", { p_id: id, p_to: to, p_actor: actor, p_cause: cause, p_payload: payload }));
    return toTicket(row!);
  }
}
