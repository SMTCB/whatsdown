import { locate } from "@/lib/code/locate";
import type { CodeSource } from "@/lib/code/source";
import { communicate } from "@/lib/agents/communicator";
import { develop } from "@/lib/agents/develop";
import { diagnose } from "@/lib/agents/diagnose";
import { qa } from "@/lib/agents/qa";
import { triage, type TriageResult } from "@/lib/agents/triage";
import type { Ticket, TicketStore } from "@/lib/db/store";
import type { GuardPolicy } from "@/lib/guard/diff-guard";
import type { LlmClient, MemoryUsageLog, TaskContext } from "@/lib/llm/client";
import type { Overrides } from "@/lib/llm/router";
import type { Publisher, Sandbox } from "@/lib/sandbox/sandbox";
import type { PipelineNodes } from "./runner";

export interface AgentNodeDeps {
  store: TicketStore;
  client: LlmClient;
  log: MemoryUsageLog;
  sandbox: Sandbox;
  policy: GuardPolicy;
  budgetUsd: number;
  overrides?: Overrides;
  /** The target repository, read-only. Without it Diagnose and Developer work from the report alone. */
  code?: CodeSource;
  /** Lands approved branches on the project; without it the pipeline cannot merge. */
  publisher?: Publisher;
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

  /** The files the plan names (if they exist in the repo), else whatever retrieval found. */
  const filesToPatch = async (suspected: readonly string[], located: string[]) => {
    const named: string[] = [];
    for (const path of suspected.slice(0, 3)) {
      if (deps.code && (await deps.code.read(path)) !== null) named.push(path);
    }
    return named.length > 0 ? named : located;
  };

  return {
    triage: (ticket) => triage(ctxFor(ticket), ticket),

    async diagnose(ticket) {
      const triaged = await latest(ticket, (e) => (e.toStatus === "triaged" ? (e.payload as Partial<TriageResult>) : undefined));
      const note = await latest(ticket, (e) =>
        e.payload.gate === 1 && e.payload.decision === "revise" && typeof e.payload.note === "string" ? e.payload.note : undefined,
      );
      const t = triaged?.type && triaged.severity && triaged.area ? { type: triaged.type, severity: triaged.severity, area: triaged.area } : undefined;
      const code = deps.code ? await locate(ctxFor(ticket), deps.code, ticket, t) : undefined;
      const r = await diagnose(ctxFor(ticket), ticket, t, note, code);
      return {
        plan: `${r.plan}\n\nLikely files: ${r.suspectedFiles.join(", ") || "unknown"}\nRisk: ${r.risk}`,
        files: await filesToPatch(r.suspectedFiles, code?.files.map((f) => f.path) ?? []),
      };
    },

    async develop(ticket) {
      const plan = (await latest(ticket, (e) => (typeof e.payload.plan === "string" ? e.payload.plan : undefined))) ?? "";
      const feedback = await latest(ticket, (e) =>
        e.fromStatus === "in_qa" && e.toStatus === "patching" && typeof e.payload.summary === "string" ? e.payload.summary : undefined,
      );
      const paths = (await latest(ticket, (e) => (Array.isArray(e.payload.files) ? (e.payload.files as string[]) : undefined))) ?? [];
      const original = [];
      for (const path of paths) {
        const content = deps.code ? await deps.code.read(path) : null;
        if (content !== null) original.push({ path, content });
      }
      const r = await develop(ctxFor(ticket), ticket, plan, deps.sandbox, deps.policy, feedback, original);
      return { ok: r.ok, summary: r.summary };
    },

    async qa(ticket) {
      const r = await qa(ctxFor(ticket), ticket, deps.sandbox);
      // Passing branches are handed to the owner (Gate 2); keep them out of the next ticket's reset.
      const branch = r.passed ? deps.sandbox.pushedBranch : undefined;
      if (branch) deps.sandbox.keep?.();
      return { passed: r.passed, summary: r.summary, ...(branch ? { branch } : {}) };
    },

    async merge(ticket, branch) {
      if (!deps.publisher) return { merged: false, reason: "No merge access is configured." };
      const plan = (await latest(ticket, (e) => (typeof e.payload.plan === "string" ? e.payload.plan : undefined))) ?? "";
      const body = `Proposed by WhatsDown for ticket #${ticket.number} and approved by the owner.

${plan}`.slice(0, 4000);
      return deps.publisher.merge(branch, `WhatsDown #${ticket.number}: ${ticket.title}`.slice(0, 120), body);
    },

    async discard(_ticket, branch) {
      await deps.publisher?.discard(branch);
    },

    async notify(ticket) {
      if (!deps.send) return;
      const message = await communicate(ctxFor(ticket), ticket, "merged");
      await deps.send(ticket, message);
    },
  };
}
