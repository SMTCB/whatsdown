import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FakeLlmClient,
  InvalidModelOutputError,
  MemoryUsageLog,
  RateLimitError,
  reply,
  runStructured,
  runTask,
  type TaskContext,
} from "@/lib/llm/client";
import { BudgetExceededError } from "@/lib/llm/router";

function ctx(client: FakeLlmClient, over: Partial<TaskContext> = {}): TaskContext & { log: MemoryUsageLog } {
  const log = new MemoryUsageLog();
  return { client, log, ticketId: "t1", spentUsd: 0, budgetUsd: 1.5, ...over } as TaskContext & { log: MemoryUsageLog };
}

describe("runTask", () => {
  it("uses the routed model and logs usage", async () => {
    const client = new FakeLlmClient([reply("ok")]);
    const c = ctx(client);
    const res = await runTask(c, "triage", "sys", "hi");
    expect(res.model).toBe("openai/gpt-oss-20b");
    expect(c.log.records).toHaveLength(1);
    expect(client.requests[0]?.model).toBe("openai/gpt-oss-20b");
  });

  it("falls back to the larger model on a rate limit", async () => {
    const client = new FakeLlmClient([new RateLimitError(), reply("ok", { inputTokens: 1_000_000, outputTokens: 0 })]);
    const res = await runTask(ctx(client), "triage", "sys", "hi");
    expect(res.model).toBe("openai/gpt-oss-120b");
    expect(res.costUsd).toBeCloseTo(0.15);
  });

  it("rethrows when there is no fallback left", async () => {
    const client = new FakeLlmClient([new RateLimitError()]);
    const c = { ...ctx(client), overrides: { triage: { fallback: undefined } } };
    await expect(runTask(c, "triage", "s", "p")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("does not swallow other errors", async () => {
    const client = new FakeLlmClient([new Error("boom")]);
    await expect(runTask(ctx(client), "triage", "s", "p")).rejects.toThrow("boom");
  });

  it("stops before calling the model when the budget is spent", async () => {
    const client = new FakeLlmClient([reply("ok")]);
    await expect(runTask(ctx(client, { spentUsd: 1.5 }), "triage", "s", "p")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(client.requests).toHaveLength(0);
  });
});

describe("runStructured", () => {
  const schema = z.object({ n: z.number() });

  it("parses fenced JSON", async () => {
    const client = new FakeLlmClient([reply('```json\n{"n": 3}\n```')]);
    expect((await runStructured(ctx(client), "triage", "s", "p", schema)).data).toEqual({ n: 3 });
  });

  it("rejects non-JSON and schema mismatches", async () => {
    await expect(runStructured(ctx(new FakeLlmClient([reply("nope"), reply("still no")])), "triage", "s", "p", schema)).rejects.toBeInstanceOf(InvalidModelOutputError);
    await expect(runStructured(ctx(new FakeLlmClient([reply('{"n":"x"}')])), "triage", "s", "p", schema)).rejects.toBeInstanceOf(InvalidModelOutputError);
  });

  it("finds the object inside prose, and asks again once when the reply is cut off", async () => {
    expect((await runStructured(ctx(new FakeLlmClient([reply('Here you go: {"n": 4} done')])), "triage", "s", "p", schema)).data).toEqual({ n: 4 });
    const client = new FakeLlmClient([reply('{"n": 5, "text": "cut of'), reply('{"n": 5}')]);
    expect((await runStructured(ctx(client), "triage", "s", "p", schema)).data).toEqual({ n: 5 });
    expect(client.requests[1]?.prompt).toContain("not valid JSON");
  });
});
