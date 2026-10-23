import { MODELS, type ModelId } from "./pricing";

export type Task =
  | "screen"
  | "transcribe"
  | "triage"
  | "diagnose"
  | "develop"
  | "qa_summary"
  | "communicate";

export interface Route {
  primary: ModelId;
  /** Used when the primary hits a rate limit (Groq 429). */
  fallback?: ModelId;
  effort?: "low" | "medium" | "high";
}

/**
 * Groq only, cheapest model that can do each job. Effort is the other dial: the same
 * model reasons more on diagnose/develop than on triage. Models were listed from the
 * Groq key's /models endpoint; not yet compared on real tickets.
 */
export const GROQ_ROUTES: Record<Task, Route> = {
  screen: { primary: "meta-llama/llama-prompt-guard-2-86m" },
  transcribe: { primary: "whisper-large-v3-turbo" },
  triage: { primary: "openai/gpt-oss-20b", fallback: "openai/gpt-oss-120b", effort: "low" },
  qa_summary: { primary: "openai/gpt-oss-20b", fallback: "openai/gpt-oss-120b", effort: "low" },
  communicate: { primary: "openai/gpt-oss-20b", fallback: "openai/gpt-oss-120b", effort: "medium" },
  diagnose: { primary: "openai/gpt-oss-120b", fallback: "qwen/qwen3.8-27b", effort: "high" },
  develop: { primary: "openai/gpt-oss-120b", fallback: "qwen/qwen3.8-27b", effort: "high" },
};

/** Upgrade preset for once an Anthropic key exists: Claude for the two hard tasks. */
export const CLAUDE_ROUTES: Partial<Record<Task, Route>> = {
  diagnose: { primary: "claude-opus-5-5", fallback: "openai/gpt-oss-120b", effort: "high" },
  develop: { primary: "claude-opus-5-5", fallback: "openai/gpt-oss-120b", effort: "high" },
};

export const DEFAULT_ROUTES = GROQ_ROUTES;

export type Overrides = Partial<Record<Task, Partial<Route>>>;

export function routeFor(task: Task, overrides: Overrides = {}): Route {
  const route = { ...DEFAULT_ROUTES[task], ...overrides[task] };
  if (!(route.primary in MODELS)) throw new Error(`Unknown model "${route.primary}" for task "${task}"`);
  return route;
}

export type BudgetState = "ok" | "warn" | "exceeded";

/** 80% of the ticket budget warns the owner; 100% stops the node. */
export function budgetState(spentUsd: number, budgetUsd: number): BudgetState {
  if (spentUsd >= budgetUsd) return "exceeded";
  if (spentUsd >= budgetUsd * 0.8 - 1e-9) return "warn";
  return "ok";
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly budgetUsd: number,
  ) {
    super(`Ticket budget exceeded: $${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export function assertWithinBudget(spentUsd: number, budgetUsd: number): void {
  if (budgetState(spentUsd, budgetUsd) === "exceeded") throw new BudgetExceededError(spentUsd, budgetUsd);
}
