import { MemoryAttachmentStore, type AttachmentStore } from "@/lib/attachments/store";
import { MemoryStore } from "./memory-store";
import { SupabaseAttachmentStore } from "@/lib/attachments/supabase-store";
import { SupabaseStore } from "./supabase-store";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TicketStore } from "./store";

import { demoNodes } from "@/lib/pipeline/demo-nodes";
import { GroqScreener } from "@/lib/guard/groq-screener";
import { RuleScreener } from "@/lib/guard/screen";
import { MemoryUsageLog } from "@/lib/llm/client";
import { groqFromEnv } from "@/lib/llm/groq";
import { GitHubCodeSource } from "@/lib/code/source";
import { GitHubActionsSandbox, GitHubAppAuth } from "@/lib/sandbox/github-actions";
import { liveNodes } from "@/lib/pipeline/live-nodes";
import type { PipelineDeps } from "@/lib/pipeline/runner";

/** Uses Groq for screening and triage when GROQ_API_KEY is set; otherwise the local stand-ins. */
export function getPipeline(): PipelineDeps {
  const groq = groqFromEnv();
  if (!groq) return { store: getStore(), nodes: demoNodes, screener: new RuleScreener() };
  return { store: getStore(), nodes: liveNodes({ store: getStore(), client: groq, log: getUsageLog(), budgetUsd: TICKET_BUDGET_USD, code: getCodeSource(), sandbox: getSandbox(), publisher: getSandbox() }), screener: new GroqScreener(groq) };
}

/** Target repository for the demo project; becomes a project-registry row once Supabase exists. */
export const DEMO_REPO = { owner: "SMTCB", repo: "WCFantasyFootball", ref: "main" };

/** One reader per process so the repository file list stays cached between requests. */
function getCodeSource() {
  globalForStore.__whatsdownCode ??= new GitHubCodeSource(DEMO_REPO, process.env.GITHUB_READ_TOKEN?.trim() || undefined);
  return globalForStore.__whatsdownCode;
}

/** Cloud sandbox on GitHub Actions; only when the GitHub App is configured. One per process. */
function getSandbox() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const installationId = process.env.GITHUB_INSTALLATION_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !installationId || !privateKey) return undefined;
  globalForStore.__whatsdownSandbox ??= new GitHubActionsSandbox(DEMO_REPO, { appId, installationId, privateKey }, getCodeSource());
  return globalForStore.__whatsdownSandbox;
}

export const DEMO_PROJECT_ID = "forza-fantasy-league";
/** USD allowed per ticket before the agents stop. */
export const TICKET_BUDGET_USD = 1.5;

const globalForStore = globalThis as unknown as { __whatsdownStore?: TicketStore; __whatsdownUsage?: MemoryUsageLog; __whatsdownFiles?: AttachmentStore; __whatsdownCode?: GitHubCodeSource; __whatsdownSandbox?: GitHubActionsSandbox; __whatsdownAuth?: GitHubAppAuth; __whatsdownDb?: SupabaseClient | null };

/** Supabase client with the service role key (server only); undefined when not configured. */
export function getDb(): SupabaseClient | undefined {
  if (globalForStore.__whatsdownDb === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    globalForStore.__whatsdownDb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  }
  return globalForStore.__whatsdownDb ?? undefined;
}

/** Uploaded documents: Supabase Storage when configured, else in memory. */
export function getAttachments(): AttachmentStore {
  const db = getDb();
  globalForStore.__whatsdownFiles ??= db ? new SupabaseAttachmentStore(db) : new MemoryAttachmentStore();
  return globalForStore.__whatsdownFiles;
}

/** Shared usage log; the demo nodes make no model calls, so it stays empty until real agents are wired. */
export function getUsageLog(): MemoryUsageLog {
  globalForStore.__whatsdownUsage ??= new MemoryUsageLog();
  return globalForStore.__whatsdownUsage;
}

/** One store per server process (survives hot reload): Supabase when configured, else in memory. */
export function getStore(): TicketStore {
  const db = getDb();
  globalForStore.__whatsdownStore ??= db ? new SupabaseStore(db) : new MemoryStore();
  return globalForStore.__whatsdownStore;
}
