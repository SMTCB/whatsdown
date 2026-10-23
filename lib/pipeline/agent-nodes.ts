import { communicate } from "@/lib/agents/communicator";
import { develop } from "@/lib/agents/develop";
import { diagnose } from "@/lib/agents/diagnose";
import { qa } from "@/lib/agents/qa";
import { triage, type TriageResult } from "@/lib/agents/triage";
import type { Ticket, TicketStore } from "@/lib/db/store";
import type { GuardPolicy } from "@/lib/guard/diff-guard";
import type { LlmClient, MemoryUsageLog, TaskContext } from "@/lib/llm/client";
import type { Overrides } from "@/lib/llm/router";
import type { Sandbox } from "@/lib/sandbox/sandbox";
import type { PipelineNodes } from "./runner";

export interface AgentNodeDeps {
  store: TicketStore;
  client: LlmClient;
  log: MemoryUsageLog;
  sandbox: Sandbox;
  policy: GuardPolicy;
  budgetUsd: number;
  overrides?: Overrides;
  /** Delivers a message to the reporter (web page, WhatsApp). Defaults to doing nothing. */
  send?: (ticket: Ticket, message: string) => Promise<void>;
}

/** Wires the real agents into the pipeline's node slots. */
export function createAgentNodes(deps: AgentNodeDeps): PipelineNodes {
  const ctxFor = (ticket: Ticket): TaskContext => ({
    client: deps.client,
    log: deps.log,
    ticketId: ticket.id,
    spentUsd: deps.log.totalFor(ticket.id),
    budgetUsd: deps.budgetUsd,
    overrides: deps.overrides,
  });

  const latest = async <T>(ticket: Ticket, pick: (e: Awaited<ReturnType<TicketStore["events"]>>[number]) => T | undefined) => {
    const events = await deps.store.events(ticket.id);
    for (const e of [...events].reverse()) {
      const v = pick(e);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  return {
    triage: (ticket) => triage(ctxFor(ticket), ticket),

    async diagnose(ticket) {
      const triaged = await latest(ticket, (e) => (e.toStatus === "triaged" ? (e.payload as Partial<TriageResult>) : undefined));
      const note = await latest(ticket, (e) =>
        e.payload.gate === 1 && e.payload.decision === "revise" && typeof e.payload.note === "string" ? e.payload.note : undefined,
      );
      const t = triaged?.type && triaged.severity && triaged.area ? { type: triaged.type, severity: triaged.severity, area: triaged.area } : undefined;
      const r = await diagnose(ctxFor(ticket), ticket, t, note);
      return { plan: `${r.plan}\n\nLikely files: ${r.suspectedFiles.join(", ") || "unknown"}\nRisk: ${r.risk}` };
    },

    async develop(ticket) {
      const plan = (await latest(ticket, (e) => (typeof e.payload.plan === "string" ? e.payload.plan : undefined))) ?? "";
      const feedback = await latest(ticket, (e) =>
        e.fromStatus === "in_qa" && e.toStatus === "patching" && typeof e.payload.summary === "string" ? e.payload.summary : undefined,
      );
      const r = await develop(ctxFor(ticket), ticket, plan, deps.sandbox, deps.policy, feedback);
      return { ok: r.ok, summary: r.summary };
    },

    async qa(ticket) {
      const r = await qa(ctxFor(ticket), ticket, deps.sandbox);
      return { passed: r.passed, summary: r.summary };
    },

    async notify(ticket) {
      if (!deps.send) return;
      const message = await communicate(ctxFor(ticket), ticket, "merged");
      await deps.send(ticket, message);
    },
  };
}
