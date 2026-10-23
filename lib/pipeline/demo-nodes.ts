import type { PipelineNodes } from "./runner";

/**
 * Deterministic stand-ins used by the local UI until real keys and the sandbox exist.
 * They make no model calls and produce placeholder output.
 */
export const demoNodes: PipelineNodes = {
  async triage(ticket) {
    const vague = ticket.body.trim().length < 25;
    return {
      type: "bug",
      severity: "medium",
      area: "unknown",
      needsInfo: vague,
      question: vague ? "Could you describe what you expected to happen and what happened instead?" : undefined,
    };
  },
  async diagnose(ticket) {
    return { plan: `Demo plan for "${ticket.title}": locate the affected component, apply the smallest fix, add a regression test.` };
  },
  async develop() {
    return { ok: true, summary: "Demo patch (no code changed)." };
  },
  async qa() {
    return { passed: true, summary: "Demo QA: all checks green." };
  },
  async notify() {},
};
