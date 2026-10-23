import { triage } from "@/lib/agents/triage";
import type { LlmClient, MemoryUsageLog } from "@/lib/llm/client";
import { demoNodes } from "./demo-nodes";
import type { PipelineNodes } from "./runner";

/**
 * Demo nodes with the agents that have been verified against a real model swapped in.
 * Triage only for now; the rest stay placeholders until the sandbox and Anthropic key exist.
 */
export function liveNodes(client: LlmClient, log: MemoryUsageLog, budgetUsd: number): PipelineNodes {
  return {
    ...demoNodes,
    triage: (ticket) =>
      triage(
        {
          client,
          log,
          ticketId: ticket.id,
          spentUsd: log.totalFor(ticket.id),
          budgetUsd,
        },
        ticket,
      ),
  };
}
