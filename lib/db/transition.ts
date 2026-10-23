import { canTransition, type TicketStatus } from "@/lib/domain/status";
import type { Actor, Ticket, TicketStore } from "./store";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TicketStatus,
    public readonly to: TicketStatus,
  ) {
    super(`Ticket cannot move from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

/** The only way a ticket's status changes. Checks the rule, then writes status + event together. */
export async function transition(
  store: TicketStore,
  ticketId: string,
  to: TicketStatus,
  actor: Actor,
  cause: string,
  payload?: Record<string, unknown>,
): Promise<Ticket> {
  const ticket = await store.get(ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  if (!canTransition(ticket.status, to)) throw new InvalidTransitionError(ticket.status, to);
  return store.applyTransition(ticketId, to, actor, cause, payload);
}
