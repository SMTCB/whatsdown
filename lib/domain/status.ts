import { z } from "zod";

export const TICKET_STATUSES = [
  "new",
  "needs_info",
  "duplicate",
  "triaged",
  "diagnosing",
  "awaiting_plan_approval",
  "patching",
  "in_qa",
  "awaiting_merge",
  "merged",
  "notified",
  "closed",
  "failed",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const ticketStatusSchema = z.enum(TICKET_STATUSES);

/** Statuses a ticket can wait in for a human (owner or reporter). */
export const WAITING_STATUSES: readonly TicketStatus[] = [
  "needs_info",
  "awaiting_plan_approval",
  "awaiting_merge",
];

const FINAL: TicketStatus[] = ["duplicate"];

/** Allowed moves, from the functional spec lifecycle. Any non-final status may also go to `failed`. */
const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  new: ["needs_info", "duplicate", "triaged", "closed"],
  needs_info: ["new", "closed"],
  duplicate: [],
  triaged: ["diagnosing", "closed"],
  diagnosing: ["awaiting_plan_approval"],
  awaiting_plan_approval: ["diagnosing", "patching", "closed"],
  patching: ["in_qa"],
  in_qa: ["patching", "awaiting_merge"],
  awaiting_merge: ["merged", "patching", "closed"],
  merged: ["notified"],
  notified: ["closed"],
  closed: ["new"], // owner can reopen
  failed: ["triaged", "diagnosing", "patching", "closed"], // owner retries from last good step
};

export function allowedNext(from: TicketStatus): TicketStatus[] {
  const next = ALLOWED[from];
  if (FINAL.includes(from) || from === "failed") return next;
  return [...next, "failed"];
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return allowedNext(from).includes(to);
}
