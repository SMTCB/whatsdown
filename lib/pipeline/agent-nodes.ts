import { unusedFiles } from "@/lib/code/imports";
import { checkQuotes, type Quote } from "@/lib/code/evidence";
import { locate, LOCATE_LIMITS } from "@/lib/code/locate";
import type { CodeSource } from "@/lib/code/source";
import { communicate } from "@/lib/agents/communicator";
import { describeScreenshot, MAX_IMAGE_BYTES } from "@/lib/agents/describe-image";
import type { AttachmentStore } from "@/lib/attachments/store";
import { develop } from "@/lib/agents/develop";
import { diagnose } from "@/lib/agents/diagnose";
import { qa } from "@/lib/agents/qa";
import { triage, type TriageResult } from "@/lib/agents/triage";
import type { Ticket, TicketStore } from "@/lib/db/store";
import type { GuardPolicy } from "@/lib/guard/diff-guard";
import type { LlmClient, TaskContext, UsageLog } from "@/lib/llm/client";
import type { Overrides } from "@/lib/llm/router";
import type { Publisher, Sandbox } from "@/lib/sandbox/sandbox";
import type { PipelineNodes } from "./runner";

export interface AgentNodeDeps {
  store: TicketStore;
  client: LlmClient;
  log: UsageLog;
  sandbox: Sandbox;
  policy: GuardPolicy;
  budgetUsd: number;
  overrides?: Overrides;
  /** The target repository, read-only. Without it Diagnose and Developer work from the report alone. */
  code?: CodeSource;
  /** Lands approved branches on the project; without it the pipeline cannot merge. */
  publisher?: Publisher;
  /** Uploaded files; with it, attached screenshots are read at intake. */
  attachments?: AttachmentStore;
  /** Delivers a message to the reporter (web page, WhatsApp). Defaults to doing nothing. */
  send?: (ticket: Ticket, message: string) => Promise<void>;
}

/** Second-attempt excerpt sizes: still inside Groq free-tier request limits. */
const WIDE_LIMITS = { matchedFileChars: LOCATE_LIMITS.matchedFileChars + 3_000, totalChars: LOCATE_LIMITS.totalChars + 3_000 };

/** Wires the real agents into the pipeline's node slots. */
export function createAgentNodes(deps: AgentNodeDeps): PipelineNodes {
  const ctxFor = async (ticket: Ticket): Promise<TaskContext> => ({
    client: deps.client,
    log: deps.log,
    ticketId: ticket.id,
    spentUsd: await deps.log.totalFor(ticket.id),
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
    // A file nothing imports cannot change what the reporter sees.
    const dead = deps.code ? await unusedFiles(deps.code, named) : new Set<string>();
    const live = named.filter((p) => !dead.has(p));
    return { files: live.length > 0 ? live : located, dead: [...dead] };
  };

  return {
    triage: async (ticket) => triage(await ctxFor(ticket), ticket),

    async readImages(ticket) {
      if (!deps.attachments) return undefined;
      const parts: string[] = [];
      for (const meta of await deps.attachments.list(ticket.id)) {
        // Already described on an earlier pass (the reporter replied and the ticket restarted).
        if (!meta.mime.startsWith("image/") || meta.size > MAX_IMAGE_BYTES || ticket.body.includes(meta.id)) continue;
        const file = await deps.attachments.get(meta.id);
        if (!file) continue;
        parts.push(await describeScreenshot(await ctxFor(ticket), { id: meta.id, name: meta.name, mime: meta.mime, bytes: file.bytes }));
      }
      return parts.length > 0 ? parts.join("\n\n") : undefined;
    },

    async diagnose(ticket) {
      const triaged = await latest(ticket, (e) => (e.toStatus === "triaged" ? (e.payload as Partial<TriageResult>) : undefined));
      const note = await latest(ticket, (e) =>
        e.payload.gate === 1 && e.payload.decision === "revise" && typeof e.payload.note === "string" ? e.payload.note : undefined,
      );
      const t = triaged?.type && triaged.severity && triaged.area ? { type: triaged.type, severity: triaged.severity, area: triaged.area } : undefined;
      const code = deps.code ? await locate(await ctxFor(ticket), deps.code, ticket, t) : undefined;
      let r = await diagnose(await ctxFor(ticket), ticket, t, note, code);
      let shown = code;
      if (deps.code && !r.located && code?.files.some((f) => f.matched?.length)) {
        // The model said the code is not in the excerpt: show it a wider one before giving up.
        shown = await locate(await ctxFor(ticket), deps.code, ticket, t, WIDE_LIMITS);
        r = await diagnose(await ctxFor(ticket), ticket, t, note, shown, "Your last answer said the code was not shown. More of each matched file is shown now, including the functions it calls. Look again.");
      }
      // A diagnosis has to show the code it rests on. Quotes that are not in the file mean the model guessed.
      let proof = { verified: [] as Quote[], rejected: [] as Quote[] };
      if (deps.code && r.located) {
        const read = (p: string) => deps.code!.read(p);
        proof = await checkQuotes(read, r.evidence);
        if (proof.verified.length === 0) {
          const hint = `Your last answer gave no evidence that could be found in the files. Quote 1 to 4 exact lines of the code shown that cause the problem, copied character for character.`;
          r = await diagnose(await ctxFor(ticket), ticket, t, note, shown, hint);
          if (r.located) proof = await checkQuotes(read, r.evidence);
        }
      }
      if (!r.located) {
        // Say so rather than edit a file that merely looks related.
        const looked = r.trace ? `\n\nWhat I looked for: ${r.trace}` : "";
        return {
          plan: `I could not find where this lives, so I am not proposing a change.\n\n${r.plan}${looked}\n\nRevise this plan with a hint (the screen, the exact words shown), or close the ticket.`,
          files: [],
        };
      }
      const picked = await filesToPatch(r.suspectedFiles, code?.files.map((f) => f.path) ?? []);
      const ignored = [...new Set([...(code?.unused ?? []), ...picked.dead])];
      // The screen text was found in some files, yet the plan changes none of them: the plan may be about something else.
      const hitFiles = (shown?.files ?? []).filter((f) => f.matched?.length).map((f) => f.path);
      const offScreen = hitFiles.length > 0 && !picked.files.some((p) => hitFiles.includes(p));
      const evidence = proof.verified.map((q) => `${q.path}:\n${q.quote.trim()}`).join("\n\n");
      const parts = [
        deps.code && proof.verified.length === 0
          ? "Not verified: I could not back this diagnosis with a line of code that exists in the file. Treat the cause below as a guess and check it before approving."
          : "",
        offScreen ? `Check: the text on your screen was found in ${hitFiles.join(", ")}, but this plan changes other files. Make sure it is the right place.` : "",
        r.plan,
        r.trace ? `How I found it: ${r.trace}` : "",
        evidence ? `Code this is based on (checked against the file):\n${evidence}` : "",
        `Files to change: ${picked.files.join(", ") || "unknown"}`,
        ignored.length ? `Ignored, not used by the app: ${ignored.join(", ")}` : "",
        `Risk: ${r.risk}`,
      ];
      return { plan: parts.filter(Boolean).join("\n\n"), files: picked.files, ...(r.anchors.length ? { anchors: r.anchors } : {}) };
    },

    async develop(ticket) {
      const plan = (await latest(ticket, (e) => (typeof e.payload.plan === "string" ? e.payload.plan : undefined))) ?? "";
      const feedback = await latest(ticket, (e) =>
        e.fromStatus === "in_qa" && e.toStatus === "patching" && typeof e.payload.summary === "string" ? e.payload.summary : undefined,
      );
      const paths = (await latest(ticket, (e) => (Array.isArray(e.payload.files) ? (e.payload.files as string[]) : undefined))) ?? [];
      const anchors = (await latest(ticket, (e) => (Array.isArray(e.payload.anchors) ? (e.payload.anchors as string[]) : undefined))) ?? [];
      if (deps.code && paths.length === 0) return { ok: false, summary: "The approved plan names no file to change, so there is nothing to patch." };
      const original = [];
      for (const path of paths) {
        const content = deps.code ? await deps.code.read(path) : null;
        if (content !== null) original.push({ path, content });
      }
      const r = await develop(await ctxFor(ticket), ticket, plan, deps.sandbox, deps.policy, feedback, original, anchors);
      return { ok: r.ok, summary: r.summary };
    },

    async qa(ticket) {
      const r = await qa(await ctxFor(ticket), ticket, deps.sandbox);
      // Passing branches are handed to the owner (Gate 2); keep them out of the next ticket's reset.
      const branch = r.passed ? deps.sandbox.pushedBranch : undefined;
      if (branch) deps.sandbox.keep?.();
      return { passed: r.passed, summary: r.summary, ...(branch ? { branch } : {}), ...(r.report ? { checks: r.report } : {}) };
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
      const message = await communicate(await ctxFor(ticket), ticket, "merged");
      await deps.send(ticket, message);
    },
  };
}
