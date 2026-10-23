import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { WrongGateError, advance, decideGate1, decideGate2, type PipelineNodes } from "@/lib/pipeline/runner";

const triaged = { type: "bug", severity: "low", area: "x", needsInfo: false } as const;

function nodes(over: Partial<PipelineNodes> = {}): PipelineNodes {
  return {
    triage: async () => triaged,
    diagnose: async () => ({ plan: "Fix the thing" }),
    develop: async () => ({ ok: true, summary: "patched" }),
    qa: async () => ({ passed: true, summary: "green" }),
    notify: async () => {},
    ...over,
  };
}

async function setup(over: Partial<PipelineNodes> = {}) {
  const store = new MemoryStore();
  const t = await store.create({ projectId: "p", title: "Bug", body: "It broke badly" });
  return { store, id: t.id, deps: { store, nodes: nodes(over) } };
}

describe("pipeline", () => {
  it("runs to Gate 1 and stops", async () => {
    const { deps, id } = await setup();
    expect((await advance(deps, id)).status).toBe("awaiting_plan_approval");
  });

  it("goes through both gates to closed", async () => {
    const notify = vi.fn(async () => {});
    const { deps, store, id } = await setup({ notify });
    await advance(deps, id);
    await decideGate1(store, id, "approve");
    expect((await advance(deps, id)).status).toBe("awaiting_merge");
    await decideGate2(store, id, "merge");
    expect((await advance(deps, id)).status).toBe("closed");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("stops at needs_info", async () => {
    const { deps, id } = await setup({ triage: async () => ({ ...triaged, needsInfo: true, question: "?" }) });
    expect((await advance(deps, id)).status).toBe("needs_info");
  });

  it("revise sends the ticket back through diagnosis", async () => {
    const diagnose = vi.fn(async () => ({ plan: "p" }));
    const { deps, store, id } = await setup({ diagnose });
    await advance(deps, id);
    await decideGate1(store, id, "revise", "try another way");
    expect((await advance(deps, id)).status).toBe("awaiting_plan_approval");
    expect(diagnose).toHaveBeenCalledTimes(2);
  });

  it("retries QA failures, then fails", async () => {
    const develop = vi.fn(async () => ({ ok: true, summary: "p" }));
    const { deps, store, id } = await setup({ develop, qa: async () => ({ passed: false, summary: "red" }) });
    await advance(deps, id);
    await decideGate1(store, id, "approve");
    expect((await advance(deps, id)).status).toBe("failed");
    expect(develop).toHaveBeenCalledTimes(3);
  });

  it("marks the ticket failed when a node throws", async () => {
    const { deps, store, id } = await setup({ diagnose: async () => { throw new Error("model down"); } });
    expect((await advance(deps, id)).status).toBe("failed");
    expect((await store.events(id)).at(-1)?.payload).toMatchObject({ error: "model down" });
  });

  it("refuses gate decisions at the wrong time", async () => {
    const { store, id } = await setup();
    await expect(decideGate1(store, id, "approve")).rejects.toBeInstanceOf(WrongGateError);
    await expect(decideGate2(store, id, "merge")).rejects.toBeInstanceOf(WrongGateError);
  });

  it("reject at Gate 1 closes the ticket", async () => {
    const { deps, store, id } = await setup();
    await advance(deps, id);
    expect((await decideGate1(store, id, "reject")).status).toBe("closed");
  });
});
