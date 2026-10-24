import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseAttachmentStore } from "@/lib/attachments/supabase-store";
import { SupabaseStore } from "@/lib/db/supabase-store";
import { SupabaseUsageLog } from "@/lib/llm/supabase-usage";
import { runStoreContract } from "../store.contract";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : undefined;

// The contract assumes an empty store, so it only runs when every ticket belongs to the contract's own project "p1".
async function onlyContractTickets() {
  const { count } = await db!.from("tickets").select("id", { count: "exact", head: true }).neq("project_id", "p1");
  return (count ?? 0) === 0;
}

describe.skipIf(!db)("Supabase (live)", () => {
  runStoreContract("SupabaseStore", async () => {
    if (!(await onlyContractTickets())) throw new Error("The database holds real tickets; refusing to run the contract against it.");
    await db!.from("tickets").delete().eq("project_id", "p1");
    return new SupabaseStore(db!);
  });

  it("stores, lists and returns an attachment", async () => {
    const t = await new SupabaseStore(db!).create({ projectId: "p1", title: "Attach", body: "Has a file" });
    const store = new SupabaseAttachmentStore(db!);
    const bytes = new TextEncoder().encode("error log line");
    const a = await store.add(t.id, { name: "log.txt", kind: "text", mime: "text/plain", bytes });
    expect((await store.list(t.id)).map((x) => x.id)).toEqual([a.id]);
    const got = await store.get(a.id);
    expect(got?.name).toBe("log.txt");
    expect(new TextDecoder().decode(got!.bytes)).toBe("error log line");
    expect(await store.get("00000000-0000-4000-8000-000000000000")).toBeNull();
    await db!.from("tickets").delete().eq("id", t.id);
  });

  it("records usage and totals it per ticket", async () => {
    const t = await new SupabaseStore(db!).create({ projectId: "p1", title: "Usage", body: "Costs something" });
    const log = new SupabaseUsageLog(db!);
    await log.record({ ticketId: t.id, task: "triage", model: "openai/gpt-oss-20b", usage: { inputTokens: 1000, outputTokens: 200 }, costUsd: 0.000135 });
    await log.record({ ticketId: t.id, task: "diagnose", model: "openai/gpt-oss-120b", usage: { inputTokens: 5000, outputTokens: 800 }, costUsd: 0.00123 });
    expect(await log.totalFor(t.id)).toBeCloseTo(0.001365, 6);
    expect((await log.all()).filter((r) => r.ticketId === t.id)).toHaveLength(2);
    await db!.from("tickets").delete().eq("id", t.id);
    expect(await log.totalFor(t.id)).toBe(0);
  });
});
