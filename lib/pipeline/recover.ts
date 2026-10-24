import type { TicketStatus } from "@/lib/domain/status";
import { transition } from "@/lib/db/transition";
import { advance, type PipelineDeps } from "./runner";

/** Statuses the pipeline moves through by itself; a ticket resting here for long means a run died. */
export const WORKING: readonly TicketStatus[] = ["new", "triaged", "diagnosing", "patching", "in_qa", "merged", "notified"];

export const STALL_MS = 10 * 60_000;
export const MAX_RETRIES = 3;

export interface RecoveryOutcome {
  ticketId: string;
  number: number;
  action: "retried" | "failed";
  status: TicketStatus;
}

export interface RecoveryOptions {
  now?: number;
  staleMs?: number;
  maxRetries?: number;
}

/**
 * Finds tickets stuck in a working status and runs them again. Each pass counts as a retry; once a ticket has
 * used up its retries it is marked failed instead, so a ticket that keeps dying does not loop forever.
 */
export async function recoverStalled(deps: PipelineDeps, opts: RecoveryOptions = {}): Promise<RecoveryOutcome[]> {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? STALL_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const out: RecoveryOutcome[] = [];

  const stalled = (await deps.store.list()).filter((t) => WORKING.includes(t.status) && now - Date.parse(t.updatedAt) > staleMs);
  for (const t of stalled) {
    if (t.retryCount >= maxRetries) {
      const failed = await transition(deps.store, t.id, "failed", "system", `stalled in "${t.status}" and gave up after ${maxRetries} retries`, {
        error: `Stalled in "${t.status}" and did not recover after ${maxRetries} retries`,
      });
      out.push({ ticketId: t.id, number: t.number, action: "failed", status: failed.status });
      continue;
    }
    await deps.store.recordRetry(t.id, `stalled in "${t.status}" for over ${Math.round(staleMs / 60_000)} minutes, running it again`);
    const after = await advance(deps, t.id);
    out.push({ ticketId: t.id, number: t.number, action: "retried", status: after.status });
  }
  return out;
}
