import { describe, expect, it } from "vitest";
import { diagnose } from "@/lib/agents/diagnose";
import { candidatePaths, groupOf, locate } from "@/lib/code/locate";
import { GitHubCodeSource, MemoryCodeSource } from "@/lib/code/source";
import { MemoryStore } from "@/lib/db/memory-store";
import { FakeLlmClient, MemoryUsageLog, reply } from "@/lib/llm/client";
import { createAgentNodes } from "@/lib/pipeline/agent-nodes";
import { MemorySandbox } from "@/lib/sandbox/sandbox";

const base = { ticketId: "t1", spentUsd: 0, budgetUsd: 1.5 };
const ticket = { title: "Score stuck", body: "Stays at zero after the match" };
const repo = {
  "CLAUDE.md": "Fantasy app guide",
  "src/scores.js": "export const score = () => 0;",
  "src/teams.js": "export const teams = [];",
  "src/main.js": "import { score } from './scores.js'; import { teams } from './teams';",
  "node_modules/x/index.js": "vendored",
  "package-lock.json": "{}",
  "logo.png": "binary",
};

describe("candidatePaths", () => {
  it("drops vendored code, lockfiles and binaries", () => {
    expect(candidatePaths(Object.keys(repo))).toEqual(["CLAUDE.md", "src/scores.js", "src/teams.js", "src/main.js"]);
  });
});

describe("locate", () => {
  const run = async (picked: string[]) => {
    const client = new FakeLlmClient([reply(JSON.stringify({ files: picked }))]);
    const code = await locate({ ...base, client, log: new MemoryUsageLog() }, new MemoryCodeSource(repo), ticket, { type: "bug", area: "scores" });
    return { client, code };
  };

  it("loads the files the model picks, plus the project guide", async () => {
    const { client, code } = await run(["src/scores.js"]);
    expect(code.files).toEqual([{ path: "src/scores.js", content: repo["src/scores.js"] }]);
    expect(code.docs.map((d) => d.path)).toEqual(["CLAUDE.md"]);
    expect(client.requests[0]?.prompt).toContain("src/teams.js");
    expect(client.requests[0]?.prompt).not.toContain("node_modules");
  });

  it("ignores paths that were never offered", async () => {
    const { code } = await run(["node_modules/x/index.js", "../../etc/passwd", "src/missing.js", "src/teams.js"]);
    expect(code.files.map((f) => f.path)).toEqual(["src/teams.js"]);
  });
});

describe("groupOf", () => {
  it("groups by at most two directory levels", () => {
    expect(groupOf("README.md")).toBe(".");
    expect(groupOf("src/a.js")).toBe("src");
    expect(groupOf("src/ui/deep/a.js")).toBe("src/ui");
  });
});

describe("locate on a big repository", () => {
  it("first narrows to directories, then offers only files from them", async () => {
    const files: Record<string, string> = { "src/scores/captain.js": "captain", "src/main.js": "import './scores/captain.js';" };
    for (let i = 0; i < 300; i++) files[`src/other${i % 5}/f${i}.js`] = "x";
    const client = new FakeLlmClient([
      reply(JSON.stringify({ dirs: ["src/scores", "not/a/dir"] })),
      reply(JSON.stringify({ files: ["src/scores/captain.js", "src/other0/f0.js"] })),
    ]);
    const code = await locate({ ...base, client, log: new MemoryUsageLog() }, new MemoryCodeSource(files), ticket);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.prompt).not.toContain("src/other0/f0.js");
    expect(code.files.map((f) => f.path)).toEqual(["src/scores/captain.js"]);
  });
});

describe("diagnose with code", () => {
  it("puts the retrieved files in the prompt", async () => {
    const out = { plan: "Fix score", suspectedFiles: ["src/scores.js"], risk: "low" };
    const client = new FakeLlmClient([reply(JSON.stringify(out))]);
    await diagnose({ ...base, client, log: new MemoryUsageLog() }, ticket, undefined, undefined, {
      docs: [],
      files: [{ path: "src/scores.js", content: "export const score = () => 0;" }],
      searched: [],
      unused: [],
    });
    expect(client.requests[0]?.prompt).toContain('<code path="src/scores.js">');
  });
});

describe("agent nodes with a code source", () => {
  it("diagnose records the located files and develop sees their current content", async () => {
    const store = new MemoryStore();
    const t = await store.create({ projectId: "p", title: ticket.title, body: ticket.body, channel: "web" });
    const client = new FakeLlmClient([
      reply(JSON.stringify({ files: ["src/scores.js"] })),
      reply(JSON.stringify({ plan: "Fix score", suspectedFiles: ["src/scores.js"], risk: "low", evidence: [{ path: "src/scores.js", quote: "export const score = () => 0;" }] })),
    ]);
    const nodes = createAgentNodes({
      store,
      client,
      log: new MemoryUsageLog(),
      sandbox: new MemorySandbox(),
      policy: { protectedPaths: [], maxChangedLines: 400 },
      budgetUsd: 1.5,
      code: new MemoryCodeSource(repo),
    });
    const r = await nodes.diagnose(t);
    expect(r.files).toEqual(["src/scores.js"]);
  });
});

describe("GitHubCodeSource", () => {
  const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => String(data) });

  it("lists blobs only and caches the tree", async () => {
    let calls = 0;
    const src = new GitHubCodeSource({ owner: "o", repo: "r", ref: "main" }, undefined, async () => {
      calls++;
      return json({ tree: [{ path: "a.js", type: "blob" }, { path: "src", type: "tree" }] });
    });
    expect(await src.tree()).toEqual(["a.js"]);
    await src.tree();
    expect(calls).toBe(1);
  });

  it("returns null for a missing file and sends the token only as a header", async () => {
    let seen: { url: string; auth?: string } | undefined;
    const src = new GitHubCodeSource({ owner: "o", repo: "r", ref: "main" }, "tok", async (url, init) => {
      seen = { url, auth: init?.headers?.Authorization };
      return json("", 404);
    });
    expect(await src.read("src/a b.js")).toBeNull();
    expect(seen?.url).toContain("/contents/src/a%20b.js?ref=main");
    expect(seen?.url).not.toContain("tok");
    expect(seen?.auth).toBe("Bearer tok");
  });
});
