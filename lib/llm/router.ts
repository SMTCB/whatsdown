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

export const DEFAULT_ROUTES: Record<Task, Route> = {
  screen: { primary: "meta-llama/llama-prompt-guard-2-86m" },
  transcribe: { primary: "whisper-large-v3-turbo" },
  triage: { primary: "openai/gpt-oss-20b", fallback: "claude-haiku-5-5" },
  diagnose: { primary: "claude-opus-5-5", effort: "high" },
  develop: { primary: "claude-opus-5-5", effort: "high" },
  qa_summary: { primary: "openai/gpt-oss-20b", fallback: "claude-haiku-5-5" },
  communicate: { primary: "openai/gpt-oss-120b", fallback: "claude-haiku-5-5" },
};

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
