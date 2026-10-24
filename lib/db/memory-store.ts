import { randomBytes, randomUUID } from "node:crypto";
import type { Actor, NewTicket, Ticket, TicketEvent, TicketStore } from "./store";
import type { TicketStatus } from "@/lib/domain/status";

export class MemoryStore implements TicketStore {
  private tickets = new Map<string, Ticket>();
  private eventLog: TicketEvent[] = [];
  private nextNumber = 1;
  private nextEventId = 1;

  async create(input: NewTicket): Promise<Ticket> {
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: randomUUID(),
      number: this.nextNumber++,
      publicToken: randomBytes(24).toString("hex"),
      projectId: input.projectId,
      title: input.title,
      body: input.body,
      channel: input.channel ?? "web",
      reporterPhone: input.reporterPhone ?? null,
      status: "new",
      costUsd: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(ticket.id, ticket);
    this.pushEvent(ticket.id, "created", null, "new", "reporter", {});
    return { ...ticket };
  }

  async get(id: string) {
    const t = this.tickets.get(id);
    return t ? { ...t } : null;
  }

  async getByToken(token: string) {
    const t = token ? [...this.tickets.values()].find((x) => x.publicToken === token) : undefined;
    return t ? { ...t } : null;
  }

  async appendDetails(id: string, text: string) {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`Ticket ${id} not found`);
    t.body = `${t.body}

Follow-up from the reporter:
${text}`;
    t.updatedAt = new Date().toISOString();
    return { ...t };
  }

  async recordRetry(id: string, cause: string) {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`Ticket ${id} not found`);
    t.retryCount += 1;
    t.updatedAt = new Date().toISOString();
    this.pushEvent(id, "retry", t.status, t.status, "system", { cause, attempt: t.retryCount });
    return { ...t };
  }

  async list(filter?: { status?: TicketStatus }) {
    return [...this.tickets.values()]
      .filter((t) => !filter?.status || t.status === filter.status)
      .sort((a, b) => b.number - a.number)
      .map((t) => ({ ...t }));
  }

  async events(ticketId: string) {
    return this.eventLog.filter((e) => e.ticketId === ticketId).map((e) => ({ ...e }));
  }

  async applyTransition(
    id: string,
    to: TicketStatus,
    actor: Actor,
    cause: string,
    payload: Record<string, unknown> = {},
  ) {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`Ticket ${id} not found`);
    const from = t.status;
    t.status = to;
    t.updatedAt = new Date().toISOString();
    this.pushEvent(id, "status_changed", from, to, actor, { cause, ...payload });
    return { ...t };
  }

  private pushEvent(
    ticketId: string,
    type: string,
    from: TicketStatus | null,
    to: TicketStatus | null,
    actor: Actor,
    payload: Record<string, unknown>,
  ) {
    this.eventLog.push({
      id: this.nextEventId++,
      ticketId,
      type,
      fromStatus: from,
      toStatus: to,
      actor,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
}
