import { MemoryAttachmentStore, type AttachmentStore } from "@/lib/attachments/store";
import { MemoryStore } from "./memory-store";
import type { TicketStore } from "./store";

import { demoNodes } from "@/lib/pipeline/demo-nodes";
import { RuleScreener } from "@/lib/guard/screen";
import { MemoryUsageLog } from "@/lib/llm/client";
import type { PipelineDeps } from "@/lib/pipeline/runner";

export function getPipeline(): PipelineDeps {
  return { store: getStore(), nodes: demoNodes, screener: new RuleScreener() };
}

export const DEMO_PROJECT_ID = "forza-fantasy-league";
/** USD allowed per ticket before the agents stop. */
export const TICKET_BUDGET_USD = 1.5;

const globalForStore = globalThis as unknown as { __whatsdownStore?: TicketStore; __whatsdownUsage?: MemoryUsageLog; __whatsdownFiles?: AttachmentStore };

/** Uploaded documents; in memory until Supabase Storage exists. */
export function getAttachments(): AttachmentStore {
  globalForStore.__whatsdownFiles ??= new MemoryAttachmentStore();
  return globalForStore.__whatsdownFiles;
}

/** Shared usage log; the demo nodes make no model calls, so it stays empty until real agents are wired. */
export function getUsageLog(): MemoryUsageLog {
  globalForStore.__whatsdownUsage ??= new MemoryUsageLog();
  return globalForStore.__whatsdownUsage;
}

/** One store per server process (survives hot reload). Swap for the Supabase store once the hosted project exists. */
export function getStore(): TicketStore {
  globalForStore.__whatsdownStore ??= new MemoryStore();
  return globalForStore.__whatsdownStore;
}
