import { z } from "zod";
import { costUsd, type ModelId, type Usage } from "./pricing";
import { assertWithinBudget, routeFor, type Overrides, type Task } from "./router";

export interface LlmRequest {
  model: ModelId;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
}

export interface LlmResponse {
  text: string;
  usage: Usage;
}

/** Provider clients (Groq, Anthropic) implement this once keys exist. */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class RateLimitError extends Error {
  constructor(message = "Rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface UsageRecord {
  ticketId: string;
  task: Task;
  model: ModelId;
  usage: Usage;
  costUsd: number;
}

type MaybeAsync<T> = T | Promise<T>;

/** Where model usage is kept: in memory for tests and local runs, Supabase when configured. */
export interface UsageLog {
  record(r: UsageRecord): MaybeAsync<void>;
  /** Virtual USD spent on one ticket so far. */
  totalFor(ticketId: string): MaybeAsync<number>;
  all(): MaybeAsync<readonly UsageRecord[]>;
}

export class MemoryUsageLog implements UsageLog {
  readonly records: UsageRecord[] = [];
  record(r: UsageRecord): void {
    this.records.push(r);
  }
  totalFor(ticketId: string): number {
    return this.records.filter((r) => r.ticketId === ticketId).reduce((n, r) => n + r.costUsd, 0);
  }
  all(): readonly UsageRecord[] {
    return this.records;
  }
}

export interface TaskContext {
  client: LlmClient;
  log: UsageLog;
  ticketId: string;
  /** Spend so far on this ticket, in USD. */
  spentUsd: number;
  budgetUsd: number;
  overrides?: Overrides;
}

export interface TaskResult {
  text: string;
  model: ModelId;
  costUsd: number;
}

/** Routes the task, enforces the ticket budget, falls back on a rate limit, and logs usage. */
export async function runTask(ctx: TaskContext, task: Task, system: string, prompt: string): Promise<TaskResult> {
  assertWithinBudget(ctx.spentUsd, ctx.budgetUsd);
  const route = routeFor(task, ctx.overrides);
  const candidates = route.fallback ? [route.primary, route.fallback] : [route.primary];

  let lastError: unknown;
  for (const model of candidates) {
    try {
      const res = await ctx.client.complete({ model, system, prompt, effort: route.effort });
      const cost = costUsd(model, res.usage);
      await ctx.log.record({ ticketId: ctx.ticketId, task, model, usage: res.usage, costUsd: cost });
      return { text: res.text, model, costUsd: cost };
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

/** Like runTask, but parses the reply as JSON and validates it. Tolerates a ```json fence. */
export async function runStructured<S extends z.ZodType>(
  ctx: TaskContext,
  task: Task,
  system: string,
  prompt: string,
  schema: S,
): Promise<{ data: z.infer<S>; model: ModelId; costUsd: number }> {
  const res = await runTask(ctx, task, system, prompt);
  const raw = res.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidModelOutputError(`${task}: reply was not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new InvalidModelOutputError(`${task}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  return { data: parsed.data, model: res.model, costUsd: res.costUsd };
}

type Scripted = LlmResponse | Error | ((req: LlmRequest) => LlmResponse | Error);

/** Test double: replies from a queue, in order. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private queue: Scripted[];

  constructor(replies: Scripted[]) {
    this.queue = [...replies];
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (next === undefined) throw new Error("FakeLlmClient: no scripted reply left");
    const out = typeof next === "function" ? next(req) : next;
    if (out instanceof Error) throw out;
    return out;
  }
}

export const reply = (text: string, usage: Partial<Usage> = {}): LlmResponse => ({
  text,
  usage: { inputTokens: 100, outputTokens: 50, ...usage },
});
