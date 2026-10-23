import { FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import type { CodeSource } from "@/lib/code/source";
import type { TicketStore } from "@/lib/db/store";
import type { LlmClient, MemoryUsageLog } from "@/lib/llm/client";
import { MemorySandbox, type Sandbox } from "@/lib/sandbox/sandbox";
import { createAgentNodes } from "./agent-nodes";
import { demoNodes } from "./demo-nodes";
import type { PipelineNodes } from "./runner";

export interface LiveDeps {
  store: TicketStore;
  client: LlmClient;
  log: MemoryUsageLog;
  budgetUsd: number;
  code: CodeSource;
  /** A real cloud sandbox. Without one, Developer and QA stay placeholders. */
  sandbox?: Sandbox;
}

/**
 * Demo nodes with the real agents swapped in: Triage, and Diagnostics reading the real repository.
 * Developer and QA join once a cloud sandbox is supplied.
 */
export function liveNodes(deps: LiveDeps): PipelineNodes {
  const real = createAgentNodes({
    ...deps,
    sandbox: deps.sandbox ?? new MemorySandbox(),
    policy: { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 },
  });
  const nodes = { ...demoNodes, triage: real.triage, diagnose: real.diagnose };
  return deps.sandbox ? { ...nodes, develop: real.develop, qa: real.qa } : nodes;
}
