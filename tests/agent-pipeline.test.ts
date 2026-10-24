import { describe, expect, it } from "vitest";
import { applyEdits, develop } from "@/lib/agents/develop";
import { qa } from "@/lib/agents/qa";
import { MemoryStore } from "@/lib/db/memory-store";
import { FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import { FakeLlmClient, MemoryUsageLog, reply } from "@/lib/llm/client";
import { createAgentNodes } from "@/lib/pipeline/agent-nodes";
import { advance, decideGate1, decideGate2 } from "@/lib/pipeline/runner";
import { MemorySandbox } from "@/lib/sandbox/sandbox";

const policy = { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 };
const base = { ticketId: "t1", spentUsd: 0, budgetUsd: 1.5 };
const approved = () => reply(JSON.stringify({ ok: true, problems: [] }));
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
    const client = new FakeLlmClient([patch("src/a.ts", "y"), approved()]);
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
    const client = new FakeLlmClient([patch("a.ts", "z"), approved()]);
    await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, "2 tests failed");
    expect(client.requests[0]?.prompt).toContain("2 tests failed");
    expect(client.requests[0]?.system).toContain("untrusted");
  });
});

describe("develop with edits", () => {
  const ticket = { title: "Crash", body: "It crashes" };
  const files = [{ path: "src/a.ts", content: "const a = 1;\nconst b = 2;\n" }];
  const edit = (find: string, replace: string) => reply(JSON.stringify({ summary: "Fix", edits: [{ path: "src/a.ts", find, replace }] }));

  it("applies a snippet edit to the full original file", async () => {
    const sb = new MemorySandbox({ "src/a.ts": files[0]!.content });
    const client = new FakeLlmClient([edit("const b = 2;", "const b = 3;"), approved()]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", sb, policy, undefined, files);
    expect(r.ok).toBe(true);
    expect(sb.read("src/a.ts")).toBe("const a = 1;\nconst b = 3;\n");
    expect(r.changes).toEqual([{ path: "src/a.ts", before: "const b = 2;", after: "const b = 3;" }]);
  });

  it("fails clearly when the snippet is missing or ambiguous", async () => {
    const run = async (find: string, content = files[0]!.content) => {
      const client = new FakeLlmClient([edit(find, "x"), edit(find, "x")]);
      return develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, undefined, [{ path: "src/a.ts", content }]);
    };
    expect((await run("nope")).summary).toContain("snippet not found");
    expect((await run("const", "const a;\nconst b;")).summary).toContain("more than once");
  });

  it("retries once with the error, and tolerates indentation drift", async () => {
    const client = new FakeLlmClient([edit("nope", "x"), edit("const a = 1;", "const a = 9;"), approved()]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, undefined, [{ path: "src/a.ts", content: files[0]!.content }]);
    expect(r.ok).toBe(true);
    expect(client.requests).toHaveLength(3);
    const src = "if (x) {\n    run();\n}\n";
    const loose = applyEdits(new Map([["f", src]]), [{ path: "f", find: "run();", replace: "stop();" }]);
    expect("files" in loose && loose.files.get("f")).toContain("stop();");
    const drift = applyEdits(new Map([["f", src]]), [{ path: "f", find: "if (x) {\nrun();\n}", replace: "z" }]);
    expect("files" in drift && drift.files.get("f")).toBe("z\n");
  });

  it("keeps the diff to the changed line when the model re-emits a block without its indentation", () => {
    const src = "      <div>\r\n        <b>{a}</b>\r\n        <i>-{x}-</i>\r\n      </div>\r\nrest\r\n";
    const out = applyEdits(new Map([["f", src]]), [{ path: "f", find: "<div>\n  <b>{a}</b>\n  <i>-{x}-</i>\n</div>", replace: "<div>\n  <b>{a}</b>\n  <i>-{y}-</i>\n</div>" }]);
    expect("files" in out && out.files.get("f")).toBe("      <div>\r\n        <b>{a}</b>\r\n        <i>-{y}-</i>\r\n      </div>\r\nrest\r\n");
  });

  it("applyEdits chains edits on the same file and rejects unknown paths", () => {
    const orig = new Map([["f", "abc"]]);
    const ok = applyEdits(orig, [{ path: "f", find: "a", replace: "1" }, { path: "f", find: "c", replace: "3" }]);
    expect("files" in ok && ok.files.get("f")).toBe("1b3");
    expect(applyEdits(orig, [{ path: "g", find: "a", replace: "b" }])).toHaveProperty("error");
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

describe("develop patch review", () => {
  const ticket = { title: "Crash", body: "It crashes" };
  const edit = (replace: string) => reply(JSON.stringify({ summary: "Fix", edits: [{ path: "src/a.ts", find: "const a = 1;", replace }] }));
  const files = [{ path: "src/a.ts", content: "const a = 1;\n" }];

  it("sends the reviewer's problems back to the Developer once and keeps the better patch", async () => {
    const bad = reply(JSON.stringify({ ok: false, problems: ["WORKS: the empty div has zero height"] }));
    const client = new FakeLlmClient([edit("const a = '';"), bad, edit("const a = ' ';"), approved()]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, undefined, files);
    expect(r.ok).toBe(true);
    expect(r.summary).not.toContain("Reviewer concerns");
    expect(client.requests.at(-2)?.prompt).toContain("WORKS: the empty div has zero height");
  });

  it("passes unresolved concerns on in the summary instead of looping", async () => {
    const bad = reply(JSON.stringify({ ok: false, problems: ["KEEPS: the Live label is gone"] }));
    const client = new FakeLlmClient([edit("a"), bad, edit("b"), bad]);
    const r = await develop({ ...base, client, log: new MemoryUsageLog() }, ticket, "plan", new MemorySandbox(), policy, undefined, files);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("Reviewer concerns: KEEPS: the Live label is gone");
  });
});
