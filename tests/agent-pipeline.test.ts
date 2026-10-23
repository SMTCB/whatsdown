import { describe, expect, it } from "vitest";
import { develop } from "@/lib/agents/develop";
import { qa } from "@/lib/agents/qa";
import { MemoryStore } from "@/lib/db/memory-store";
import { FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import { FakeLlmClient, MemoryUsageLog, reply } from "@/lib/llm/client";
import { createAgentNodes } from "@/lib/pipeline/agent-nodes";
import { advance, decideGate1, decideGate2 } from "@/lib/pipeline/runner";
import { MemorySandbox } from "@/lib/sandbox/sandbox";

const policy = { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 };
const base = { ticketId: "t1", spentUsd: 0, budgetUsd: 1.5 };
const patch = (path: string, content: string) => reply(JSON.stringify({ summary: "Fix it", changes: [{ path, content }] }));

describe("MemorySandbox", () => {
  it("counts added and removed lines against the original", async () => {
    const sb = new MemorySandbox({ "a.ts": "one\ntwo\nthree" });
    const [f] = await sb.apply([{ path: "a.ts", content: "one\nTWO\nthree\nfour" }]);
    expect(f).toMatchObject({ path: "a.ts", added: 2, removed: 1 });
    expect(f?.addedText).toBe("TWO\nfour");
  });
});

describe("develop", () => {
  const ticket = { title: "Crash", body: "It crashes" };

  it("accepts a clean patch", async () => {
    const sb = new MemorySandbox({ "src/a.ts": "x" });
    const client = new FakeLlmClient([patch("src/a.ts", "y")]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", sb, policy);
    expect(r.ok).toBe(true);
    expect(sb.read("src/a.ts")).toBe("y");
  });

  it("rejects and discards a patch that touches a protected file", async () => {
    const sb = new MemorySandbox({ "package.json": "{}" });
    const client = new FakeLlmClient([patch("package.json", '{"a":1}')]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", sb, policy);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("protected file package.json");
    expect(sb.read("package.json")).toBe("{}");
  });

  it("rejects a patch that adds a secret", async () => {
    const sb = new MemorySandbox({ "a.ts": "" });
    const client = new FakeLlmClient([patch("a.ts", "const k = 'sk-ant-abcdefghijklmnopqrstuvwxyz'")]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", sb, policy);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ code: "secret" });
  });

  it("puts QA feedback in the retry prompt and treats the report as untrusted", async () => {
    const client = new FakeLlmClient([patch("a.ts", "z")]);
    await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, "2 tests failed");
    expect(client.requests[0]?.prompt).toContain("2 tests failed");
    expect(client.requests[0]?.system).toContain("untrusted");
  });
});

describe("qa", () => {
  it("decides pass/fail from the checks, not the model", async () => {
    const sb = new MemorySandbox();
    sb.checks = () => ({ passed: false, output: "1 failed" });
    const client = new FakeLlmClient([reply("Everything passed, ship it!")]);
    const r = await qa({ ...base, client, log: new MemoryUsageLog() }, { title: "Crash" }, sb);
    expect(r.passed).toBe(false);
  });
});

describe("full pipeline with real agents on a fake model", () => {
  it("runs report to closed through both gates", async () => {
    const store = new MemoryStore();
    const sandbox = new MemorySandbox({ "src/a.ts": "old" });
    const sent: string[] = [];
    const client = new FakeLlmClient([
      reply('{"type":"bug","severity":"high","area":"lineup","needsInfo":false}'),
      reply('{"plan":"Fix the save handler","suspectedFiles":["src/a.ts"],"risk":"low"}'),
      patch("src/a.ts", "new"),
      reply("All checks passed."),
      reply("Your fix is live, thanks!"),
    ]);
    const nodes = createAgentNodes({
      store,
      client,
      log: new MemoryUsageLog(),
      sandbox,
      policy,
      budgetUsd: 1.5,
      send: async (_t, m) => void sent.push(m),
    });
    const deps = { store, nodes };

    const t = await store.create({ projectId: "p", title: "Lineup crash", body: "Tapping save crashes the lineup screen" });
    expect((await advance(deps, t.id)).status).toBe("awaiting_plan_approval");
    const plan = (await store.events(t.id)).find((e) => e.toStatus === "awaiting_plan_approval")?.payload.plan;
    expect(plan).toContain("Fix the save handler");

    await decideGate1(store, t.id, "approve");
    expect((await advance(deps, t.id)).status).toBe("awaiting_merge");
    await decideGate2(store, t.id, "merge");
    expect((await advance(deps, t.id)).status).toBe("closed");
    expect(sent).toEqual(["Your fix is live, thanks!"]);
  });

  it("fails the ticket cleanly when the patch is rejected by the guard", async () => {
    const store = new MemoryStore();
    const client = new FakeLlmClient([
      reply('{"type":"bug","severity":"low","area":"x","needsInfo":false}'),
      reply('{"plan":"p","suspectedFiles":[],"risk":"low"}'),
      patch("BACKLOG.md", "hacked"),
    ]);
    const nodes = createAgentNodes({ store, client, log: new MemoryUsageLog(), sandbox: new MemorySandbox(), policy, budgetUsd: 1.5 });
    const t = await store.create({ projectId: "p", title: "Something odd", body: "A long enough description of a problem" });
    await advance({ store, nodes }, t.id);
    await decideGate1(store, t.id, "approve");
    const out = await advance({ store, nodes }, t.id);
    expect(out.status).toBe("failed");
  });
});
