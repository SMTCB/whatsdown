import { beforeEach, describe, expect, it } from "vitest";
import type { TicketStore } from "@/lib/db/store";

/**
 * Behaviour every TicketStore must have. MemoryStore runs it today (tests/memory-store.test.ts);
 * the Supabase store must pass the same suite when it exists.
 * `make` must return a fresh, empty store.
 */
export function runStoreContract(name: string, make: () => TicketStore | Promise<TicketStore>) {
  describe(`TicketStore contract: ${name}`, () => {
    let store: TicketStore;
    beforeEach(async () => {
      store = await make();
    });

    const input = { projectId: "p1", title: "Pitch bug", body: "Players overlap on phone" };

    it("creates a new web ticket with defaults", async () => {
      const t = await store.create(input);
      expect(t).toMatchObject({ ...input, status: "new", channel: "web", costUsd: 0, retryCount: 0 });
      expect(t.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(t.createdAt))).toBe(false);
    });

    it("keeps the channel when given", async () => {
      expect((await store.create({ ...input, channel: "whatsapp" })).channel).toBe("whatsapp");
    });

    it("stores the reporter's phone, or null", async () => {
      expect((await store.create({ ...input, channel: "whatsapp", reporterPhone: "+351900000000" })).reporterPhone).toBe("+351900000000");
      expect((await store.create(input)).reporterPhone).toBeNull();
    });

    it("gives unique, increasing ticket numbers", async () => {
      const a = await store.create(input);
      const b = await store.create(input);
      expect(b.number).toBeGreaterThan(a.number);
      expect(b.id).not.toBe(a.id);
    });

    it("gives each ticket a long private token that finds only that ticket", async () => {
      const a = await store.create(input);
      const b = await store.create(input);
      expect(a.publicToken.length).toBeGreaterThanOrEqual(32);
      expect(a.publicToken).not.toBe(b.publicToken);
      expect((await store.getByToken(a.publicToken))?.id).toBe(a.id);
      expect(await store.getByToken("nope")).toBeNull();
      expect(await store.getByToken("")).toBeNull();
    });

    it("appends reporter details to the ticket text", async () => {
      const t = await store.create(input);
      const out = await store.appendDetails(t.id, "It happens on Safari");
      expect(out.body).toContain(input.body);
      expect(out.body).toContain("It happens on Safari");
      expect((await store.get(t.id))?.body).toBe(out.body);
      await expect(store.appendDetails("00000000-0000-4000-8000-000000000000", "x")).rejects.toThrow();
    });

    it("counts retries, refreshes updatedAt and logs a retry event", async () => {
      const t = await store.create(input);
      const out = await store.recordRetry(t.id, "stalled");
      expect(out.retryCount).toBe(1);
      expect(out.status).toBe("new");
      expect((await store.recordRetry(t.id, "stalled")).retryCount).toBe(2);
      const ev = (await store.events(t.id)).filter((e) => e.type === "retry");
      expect(ev).toHaveLength(2);
      expect(ev[1]).toMatchObject({ actor: "system", fromStatus: "new", toStatus: "new" });
      await expect(store.recordRetry("00000000-0000-4000-8000-000000000000", "x")).rejects.toThrow();
    });

    it("records a created event", async () => {
      const t = await store.create(input);
      const ev = await store.events(t.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ ticketId: t.id, type: "created", fromStatus: null, toStatus: "new" });
    });

    it("get returns the ticket, or null when unknown", async () => {
      const t = await store.create(input);
      expect(await store.get(t.id)).toMatchObject({ id: t.id, title: input.title });
      expect(await store.get("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("lists newest first and filters by status", async () => {
      const a = await store.create(input);
      const b = await store.create(input);
      await store.applyTransition(a.id, "triaged", "agent", "test");
      expect((await store.list()).map((t) => t.id)).toEqual([b.id, a.id]);
      expect((await store.list({ status: "triaged" })).map((t) => t.id)).toEqual([a.id]);
      expect(await store.list({ status: "closed" })).toEqual([]);
    });

    it("applyTransition updates status and appends one matching event", async () => {
      const t = await store.create(input);
      const out = await store.applyTransition(t.id, "triaged", "agent", "triage done", { severity: "low" });
      expect(out.status).toBe("triaged");
      expect((await store.get(t.id))?.status).toBe("triaged");
      const ev = await store.events(t.id);
      expect(ev).toHaveLength(2);
      expect(ev[1]).toMatchObject({ type: "status_changed", fromStatus: "new", toStatus: "triaged", actor: "agent" });
      expect(ev[1]?.payload).toMatchObject({ cause: "triage done", severity: "low" });
    });

    it("orders events oldest first with increasing ids", async () => {
      const t = await store.create(input);
      await store.applyTransition(t.id, "triaged", "agent", "a");
      await store.applyTransition(t.id, "diagnosing", "agent", "b");
      const ids = (await store.events(t.id)).map((e) => e.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    });

    it("keeps events separate per ticket", async () => {
      const a = await store.create(input);
      const b = await store.create(input);
      await store.applyTransition(a.id, "triaged", "agent", "x");
      expect(await store.events(b.id)).toHaveLength(1);
    });

    it("rejects a transition on an unknown ticket", async () => {
      await expect(store.applyTransition("00000000-0000-4000-8000-000000000000", "triaged", "agent", "x")).rejects.toThrow();
    });

    it("returns copies, so callers cannot mutate stored state", async () => {
      const t = await store.create(input);
      t.status = "closed";
      t.title = "changed";
      const again = await store.get(t.id);
      expect(again).toMatchObject({ status: "new", title: input.title });
    });
  });
}
