import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { findDuplicate, similarity } from "@/lib/domain/duplicates";
import { advance, type PipelineNodes } from "@/lib/pipeline/runner";

describe("similarity", () => {
  it("is 1 for identical text and ignores case and punctuation", () => {
    expect(similarity("Pitch overlaps bench", "pitch, overlaps BENCH!")).toBe(1);
  });
  it("is high for near matches and low for unrelated titles", () => {
    expect(similarity("Pitch overlaps the bench on phone", "Pitch overlaps bench on phones")).toBeGreaterThan(0.6);
    expect(similarity("Pitch overlaps bench", "Login button missing")).toBeLessThan(0.2);
  });
  it("is 0 for empty text", () => {
    expect(similarity("", "abc")).toBe(0);
  });
});

describe("findDuplicate", () => {
  it("matches the best live ticket in the same project only", async () => {
    const s = new MemoryStore();
    const a = await s.create({ projectId: "p1", title: "Pitch overlaps bench on phone", body: "x" });
    await s.create({ projectId: "p2", title: "Pitch overlaps bench on phone", body: "x" });
    const mine = await s.create({ projectId: "p1", title: "Pitch overlaps bench on phones", body: "y" });
    const hit = findDuplicate(mine, await s.list());
    expect(hit?.ticket.id).toBe(a.id);
  });

  it("ignores closed tickets", async () => {
    const s = new MemoryStore();
    const old = await s.create({ projectId: "p1", title: "Pitch overlaps bench", body: "x" });
    const { transition } = await import("@/lib/db/transition");
    await transition(s, old.id, "closed", "owner", "done");
    const mine = await s.create({ projectId: "p1", title: "Pitch overlaps bench", body: "y" });
    expect(findDuplicate(mine, await s.list())).toBeNull();
  });
});

describe("pipeline duplicate step", () => {
  it("marks a repeat report as duplicate without calling triage", async () => {
    let triaged = 0;
    const nodes: PipelineNodes = {
      triage: async () => {
        triaged++;
        return { type: "bug", severity: "low", area: "x", needsInfo: false };
      },
      diagnose: async () => ({ plan: "p" }),
      develop: async () => ({ ok: true, summary: "" }),
      qa: async () => ({ passed: true, summary: "" }),
      notify: async () => {},
    };
    const store = new MemoryStore();
    const first = await store.create({ projectId: "p", title: "Pitch overlaps bench", body: "long enough body" });
    await advance({ store, nodes }, first.id);
    const second = await store.create({ projectId: "p", title: "Pitch overlaps bench", body: "another body here" });
    const out = await advance({ store, nodes }, second.id);
    expect(out.status).toBe("duplicate");
    expect(triaged).toBe(1);
    expect((await store.events(second.id)).at(-1)?.payload).toMatchObject({ duplicateOf: first.id, duplicateOfNumber: first.number });
  });
});
