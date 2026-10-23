import { describe, expect, it } from "vitest";
import { TICKET_STATUSES, allowedNext, canTransition } from "@/lib/domain/status";
import { MemoryStore } from "@/lib/db/memory-store";
import { InvalidTransitionError, transition } from "@/lib/db/transition";

describe("status rules", () => {
  it("allows the happy path end to end", () => {
    const path = ["new", "triaged", "diagnosing", "awaiting_plan_approval", "patching", "in_qa", "awaiting_merge", "merged", "notified", "closed"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it("sends QA failures back to patching and revisions back to diagnosing", () => {
    expect(canTransition("in_qa", "patching")).toBe(true);
    expect(canTransition("awaiting_plan_approval", "diagnosing")).toBe(true);
  });

  it("never skips a gate", () => {
    expect(canTransition("diagnosing", "patching")).toBe(false);
    expect(canTransition("in_qa", "merged")).toBe(false);
    expect(canTransition("awaiting_plan_approval", "in_qa")).toBe(false);
  });

  it("treats duplicate as final", () => {
    expect(allowedNext("duplicate")).toEqual([]);
  });

  it("lets every other status fail, except failed itself", () => {
    for (const s of TICKET_STATUSES) {
      if (s === "duplicate" || s === "failed") expect(canTransition(s, "failed")).toBe(false);
      else expect(canTransition(s, "failed")).toBe(true);
    }
  });
});

describe("transition()", () => {
  it("writes the new status and an event together", async () => {
    const store = new MemoryStore();
    const t = await store.create({ projectId: "p1", title: "Bug", body: "It broke" });
    const updated = await transition(store, t.id, "triaged", "agent", "triage done");
    expect(updated.status).toBe("triaged");
    const events = await store.events(t.id);
    expect(events.at(-1)).toMatchObject({ type: "status_changed", fromStatus: "new", toStatus: "triaged", actor: "agent" });
  });

  it("rejects an illegal move and leaves the ticket unchanged", async () => {
    const store = new MemoryStore();
    const t = await store.create({ projectId: "p1", title: "Bug", body: "It broke" });
    await expect(transition(store, t.id, "merged", "owner", "oops")).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await store.get(t.id))?.status).toBe("new");
    expect(await store.events(t.id)).toHaveLength(1);
  });
});
