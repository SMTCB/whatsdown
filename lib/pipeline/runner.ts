import type { TicketStatus } from "@/lib/domain/status";
import type { Ticket, TicketStore } from "@/lib/db/store";
import { transition } from "@/lib/db/transition";
import type { TriageResult } from "@/lib/agents/triage";
import { findDuplicate } from "@/lib/domain/duplicates";
import type { ScreenResult, Screener } from "@/lib/guard/screen";

/**
 * The agent steps the runner calls. Triage and Communicator are real (see lib/agents);
 * Diagnostics, Developer and QA are injected until their sandbox and keys exist.
 */
export interface PipelineNodes {
  triage(ticket: Ticket): Promise<TriageResult>;
  diagnose(ticket: Ticket): Promise<{ plan: string }>;
  develop(ticket: Ticket): Promise<{ ok: boolean; summary: string }>;
  qa(ticket: Ticket): Promise<{ passed: boolean; summary: string }>;
  notify(ticket: Ticket): Promise<void>;
}

export interface PipelineDeps {
  store: TicketStore;
  nodes: PipelineNodes;
  /** Screens new reports for prompt injection; blocked reports are closed, suspicious ones are flagged. */
  screener?: Screener;
  /** QA failures allowed before the ticket is marked failed. */
  maxQaRetries?: number;
}

/** Statuses where the runner stops and waits for a person or the reporter. */
const STOP: readonly TicketStatus[] = ["needs_info", "duplicate", "awaiting_plan_approval", "awaiting_merge", "closed", "failed"];

const MAX_STEPS = 25;

export async function advance(deps: PipelineDeps, ticketId: string): Promise<Ticket> {
  const { store, nodes } = deps;
  const maxQaRetries = deps.maxQaRetries ?? 2;

  for (let i = 0; i < MAX_STEPS; i++) {
    const ticket = await store.get(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
    if (STOP.includes(ticket.status)) return ticket;

    try {
      switch (ticket.status) {
        case "new": {
          let screen: ScreenResult | undefined;
          if (deps.screener) {
            screen = await deps.screener.screen(`${ticket.title}\n${ticket.body}`);
            if (screen.verdict === "blocked") {
              await transition(store, ticketId, "closed", "system", "report blocked by screening", { screen });
              break;
            }
          }
          const dup = findDuplicate(ticket, await store.list());
          if (dup) {
            await transition(store, ticketId, "duplicate", "agent", "similar to an open ticket", {
              duplicateOf: dup.ticket.id,
              duplicateOfNumber: dup.ticket.number,
              score: Math.round(dup.score * 100) / 100,
            });
            break;
          }
          const r = await nodes.triage(ticket);
          const flagged = screen?.verdict === "suspicious" ? { screen } : {};
          if (r.needsInfo) await transition(store, ticketId, "needs_info", "agent", "triage needs more info", { ...r, ...flagged });
          else await transition(store, ticketId, "triaged", "agent", "triage done", { ...r, ...flagged });
          break;
        }
        case "triaged":
          await transition(store, ticketId, "diagnosing", "agent", "diagnosis started");
          break;
        case "diagnosing": {
          const { plan } = await nodes.diagnose(ticket);
          await transition(store, ticketId, "awaiting_plan_approval", "agent", "plan ready", { plan });
          break;
        }
        case "patching": {
          const r = await nodes.develop(ticket);
          if (r.ok) await transition(store, ticketId, "in_qa", "agent", "patch ready", { summary: r.summary });
          else await transition(store, ticketId, "failed", "agent", "developer could not produce a patch", { summary: r.summary });
          break;
        }
        case "in_qa": {
          const r = await nodes.qa(ticket);
          if (r.passed) {
            await transition(store, ticketId, "awaiting_merge", "agent", "qa passed", { summary: r.summary });
          } else {
            const failures = (await store.events(ticketId)).filter((e) => e.fromStatus === "in_qa" && e.toStatus === "patching").length;
            if (failures >= maxQaRetries) await transition(store, ticketId, "failed", "agent", "qa failed too many times", { summary: r.summary });
            else await transition(store, ticketId, "patching", "agent", "qa failed, retrying", { summary: r.summary });
          }
          break;
        }
        case "merged":
          await nodes.notify(ticket);
          await transition(store, ticketId, "notified", "agent", "reporter notified");
          break;
        case "notified":
          await transition(store, ticketId, "closed", "system", "closed after notification");
          break;
        default:
          return ticket;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return transition(store, ticketId, "failed", "system", "step threw", { error: message });
    }
  }
  throw new Error(`Pipeline did not settle after ${MAX_STEPS} steps for ticket ${ticketId}`);
}

export class WrongGateError extends Error {
  constructor(expected: TicketStatus, actual: TicketStatus) {
    super(`Ticket is ${actual}, expected ${expected}`);
    this.name = "WrongGateError";
  }
}

export type Gate1Decision = "approve" | "revise" | "reject";
export type Gate2Decision = "merge" | "close";

const GATE1_TARGET: Record<Gate1Decision, TicketStatus> = { approve: "patching", revise: "diagnosing", reject: "closed" };
const GATE2_TARGET: Record<Gate2Decision, TicketStatus> = { merge: "merged", close: "closed" };

export async function decideGate1(store: TicketStore, ticketId: string, decision: Gate1Decision, note?: string): Promise<Ticket> {
  const t = await store.get(ticketId);
  if (!t) throw new Error(`Ticket ${ticketId} not found`);
  if (t.status !== "awaiting_plan_approval") throw new WrongGateError("awaiting_plan_approval", t.status);
  return transition(store, ticketId, GATE1_TARGET[decision], "owner", `gate 1: ${decision}`, { gate: 1, decision, note });
}

export async function decideGate2(store: TicketStore, ticketId: string, decision: Gate2Decision, note?: string): Promise<Ticket> {
  const t = await store.get(ticketId);
  if (!t) throw new Error(`Ticket ${ticketId} not found`);
  if (t.status !== "awaiting_merge") throw new WrongGateError("awaiting_merge", t.status);
  return transition(store, ticketId, GATE2_TARGET[decision], "owner", `gate 2: ${decision}`, { gate: 2, decision, note });
}
