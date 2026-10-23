import { FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import type { CodeSource } from "@/lib/code/source";
import type { TicketStore } from "@/lib/db/store";
import type { LlmClient, MemoryUsageLog } from "@/lib/llm/client";
import { MemorySandbox } from "@/lib/sandbox/sandbox";
import { createAgentNodes } from "./agent-nodes";
import { demoNodes } from "./demo-nodes";
import type { PipelineNodes } from "./runner";

export interface LiveDeps {
  store: TicketStore;
  client: LlmClient;
  log: MemoryUsageLog;
  budgetUsd: number;
  code: CodeSource;
}

/**
 * Demo nodes with the agents that work without a sandbox swapped in: Triage, and Diagnostics
 * reading the real repository. Developer and QA stay placeholders until a sandbox exists.
 */
export function liveNodes(deps: LiveDeps): PipelineNodes {
  const real = createAgentNodes({
    ...deps,
    sandbox: new MemorySandbox(),
    policy: { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 },
  });
  return { ...demoNodes, triage: real.triage, diagnose: real.diagnose };
}
