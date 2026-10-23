import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/dashboard/stats";
import { MemoryStore } from "@/lib/db/memory-store";
import type { UsageRecord } from "@/lib/llm/client";

const rec = (ticketId: string, costUsd: number): UsageRecord => ({
  ticketId,
  task: "triage",
  model: "openai/gpt-oss-20b",
  usage: { inputTokens: 1, outputTokens: 1 },
  costUsd,
});

describe("summarize", () => {
  it("groups tickets, sums spend and flags budget, retries and screening", async () => {
    const store = new MemoryStore();
    const a = await store.create({ projectId: "p", title: "A", body: "x" });
    const b = await store.create({ projectId: "p", title: "B", body: "x" });
    const c = await store.create({ projectId: "p", title: "C", body: "x" });
    await store.applyTransition(a.id, "triaged", "agent", "t", { screen: { verdict: "suspicious" } });
    await store.applyTransition(a.id, "diagnosing", "agent", "t");
    await store.applyTransition(a.id, "awaiting_plan_approval", "agent", "t");
    await store.applyTransition(b.id, "patching", "agent", "t");
    await store.applyTransition(b.id, "in_qa", "agent", "t");
    await store.applyTransition(b.id, "patching", "agent", "qa failed");
    await store.applyTransition(c.id, "failed", "system", "t");

    const tickets = await store.list();
    const events = new Map(await Promise.all(tickets.map(async (t) => [t.id, await store.events(t.id)] as const)));
    const s = summarize(tickets, events, [rec(a.id, 0.5), rec(a.id, 0.8), rec(b.id, 0.1)], 1.5);

    expect(s).toMatchObject({ total: 3, waitingOnOwner: 1, inProgress: 1, failed: 1, done: 0 });
    expect(s.totalSpendUsd).toBeCloseTo(1.4);
    const rowA = s.rows.find((r) => r.id === a.id)!;
    expect(rowA).toMatchObject({ budget: "warn", flaggedByScreening: true });
    expect(s.rows.find((r) => r.id === b.id)).toMatchObject({ qaRetries: 1, budget: "ok" });
    expect(s.rows.map((r) => r.number)).toEqual([3, 2, 1]);
  });
});
