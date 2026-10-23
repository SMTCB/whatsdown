import type { Ticket, TicketEvent } from "@/lib/db/store";
import type { UsageRecord } from "@/lib/llm/client";
import { budgetState, type BudgetState } from "@/lib/llm/router";
import type { TicketStatus } from "@/lib/domain/status";

export interface TicketRow {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
  costUsd: number;
  budget: BudgetState;
  qaRetries: number;
  flaggedByScreening: boolean;
}

export interface DashboardStats {
  total: number;
  /** Tickets waiting on the owner at a gate. */
  waitingOnOwner: number;
  /** Tickets waiting on the reporter. */
  waitingOnReporter: number;
  inProgress: number;
  done: number;
  failed: number;
  totalSpendUsd: number;
  byStatus: Partial<Record<TicketStatus, number>>;
  rows: TicketRow[];
}

const OWNER: TicketStatus[] = ["awaiting_plan_approval", "awaiting_merge"];
const DONE: TicketStatus[] = ["closed", "duplicate", "merged", "notified"];

export function summarize(
  tickets: readonly Ticket[],
  eventsByTicket: ReadonlyMap<string, readonly TicketEvent[]>,
  usage: readonly UsageRecord[],
  budgetUsd: number,
): DashboardStats {
  const spend = new Map<string, number>();
  for (const u of usage) spend.set(u.ticketId, (spend.get(u.ticketId) ?? 0) + u.costUsd);

  const byStatus: Partial<Record<TicketStatus, number>> = {};
  const rows: TicketRow[] = [];
  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const events = eventsByTicket.get(t.id) ?? [];
    const cost = spend.get(t.id) ?? 0;
    rows.push({
      id: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      costUsd: cost,
      budget: budgetState(cost, budgetUsd),
      qaRetries: events.filter((e) => e.fromStatus === "in_qa" && e.toStatus === "patching").length,
      flaggedByScreening: events.some((e) => e.payload.screen !== undefined),
    });
  }
  rows.sort((a, b) => b.number - a.number);

  const count = (pred: (s: TicketStatus) => boolean) => tickets.filter((t) => pred(t.status)).length;
  return {
    total: tickets.length,
    waitingOnOwner: count((s) => OWNER.includes(s)),
    waitingOnReporter: count((s) => s === "needs_info"),
    inProgress: count((s) => !OWNER.includes(s) && !DONE.includes(s) && s !== "needs_info" && s !== "failed"),
    done: count((s) => DONE.includes(s)),
    failed: count((s) => s === "failed"),
    totalSpendUsd: [...spend.values()].reduce((n, v) => n + v, 0),
    byStatus,
    rows,
  };
}
