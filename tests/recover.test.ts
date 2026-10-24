import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { transition } from "@/lib/db/transition";
import { demoNodes } from "@/lib/pipeline/demo-nodes";
import { FAILED_COOLDOWN_MS, MAX_RETRIES, STALL_MS, recoverStalled } from "@/lib/pipeline/recover";
import type { PipelineDeps } from "@/lib/pipeline/runner";

const input = { projectId: "p", title: "Pitch view crashes on load", body: "Opening the pitch view shows a blank page on every device." };

async function setup() {
  const store = new MemoryStore();
  const deps: PipelineDeps = { store, nodes: demoNodes };
  const ticket = await store.create(input);
  await transition(store, ticket.id, "triaged", "agent", "triage done");
  return { store, deps, id: ticket.id };
}

const later = (ms: number) => Date.now() + ms;

describe("recoverStalled", () => {
  it("leaves a recently updated ticket alone", async () => {
    const { deps, store, id } = await setup();
    expect(await recoverStalled(deps, { now: later(STALL_MS - 60_000) })).toEqual([]);
    expect((await store.get(id))?.status).toBe("triaged");
    expect((await store.get(id))?.retryCount).toBe(0);
  });

  it("runs a stalled ticket again and counts the retry", async () => {
    const { deps, store, id } = await setup();
    const out = await recoverStalled(deps, { now: later(STALL_MS + 60_000) });
    expect(out).toEqual([expect.objectContaining({ ticketId: id, action: "retried", status: "awaiting_plan_approval" })]);
    const t = await store.get(id);
    expect(t?.retryCount).toBe(1);
    expect((await store.events(id)).some((e) => e.type === "retry")).toBe(true);
  });

  it("ignores tickets waiting for a person", async () => {
    const { deps, store, id } = await setup();
    await transition(store, id, "diagnosing", "agent", "x");
    await transition(store, id, "awaiting_plan_approval", "agent", "plan ready", { plan: "p" });
    expect(await recoverStalled(deps, { now: later(STALL_MS * 10) })).toEqual([]);
  });

  it("retries a ticket that failed in a step, but not one over budget or out of retries", async () => {
    const { deps, store, id } = await setup();
    await transition(store, id, "diagnosing", "agent", "x");
    await transition(store, id, "failed", "system", "step threw", { error: "Groq request failed with status 400" });
    expect(await recoverStalled(deps, { now: later(60_000) })).toEqual([]); // still cooling down
    const out = await recoverStalled(deps, { now: later(FAILED_COOLDOWN_MS + 60_000) });
    expect(out).toEqual([expect.objectContaining({ ticketId: id, action: "retried", status: "awaiting_plan_approval" })]);

    const b = await store.create(input);
    await transition(store, b.id, "triaged", "agent", "x");
    await transition(store, b.id, "diagnosing", "agent", "x");
    await transition(store, b.id, "failed", "system", "step threw", { error: "Ticket budget exceeded: $1.60 of $1.50" });
    expect(await recoverStalled(deps, { now: later(FAILED_COOLDOWN_MS + 60_000) })).toEqual([]);
    expect((await store.get(b.id))?.status).toBe("failed");
  });

  it("marks the ticket failed once the retries are used up", async () => {
    const { deps, store, id } = await setup();
    for (let i = 0; i < MAX_RETRIES; i++) await store.recordRetry(id, "earlier");
    const out = await recoverStalled(deps, { now: later(STALL_MS + 60_000) });
    expect(out).toEqual([expect.objectContaining({ ticketId: id, action: "failed", status: "failed" })]);
    expect((await store.get(id))?.status).toBe("failed");
  });
});
