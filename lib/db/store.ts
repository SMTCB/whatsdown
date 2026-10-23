import type { TicketStatus } from "@/lib/domain/status";

export type Actor = "agent" | "owner" | "system" | "reporter";

export interface Ticket {
  id: string;
  number: number;
  projectId: string;
  title: string;
  body: string;
  channel: "web" | "whatsapp";
  /** E.164 number for WhatsApp reporters, used to send updates back. */
  reporterPhone: string | null;
  status: TicketStatus;
  costUsd: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEvent {
  id: number;
  ticketId: string;
  type: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  actor: Actor;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface NewTicket {
  projectId: string;
  title: string;
  body: string;
  channel?: "web" | "whatsapp";
  reporterPhone?: string;
}

/**
 * Storage port. Sprint 0 uses MemoryStore; the Supabase implementation arrives with
 * the hosted project and must satisfy the same contract (see tests/store.contract).
 */
export interface TicketStore {
  create(input: NewTicket): Promise<Ticket>;
  get(id: string): Promise<Ticket | null>;
  list(filter?: { status?: TicketStatus }): Promise<Ticket[]>;
  events(ticketId: string): Promise<TicketEvent[]>;
  /** Atomically update status and append the matching event. */
  applyTransition(
    id: string,
    to: TicketStatus,
    actor: Actor,
    cause: string,
    payload?: Record<string, unknown>,
  ): Promise<Ticket>;
}
