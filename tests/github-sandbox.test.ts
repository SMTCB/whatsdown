import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryCodeSource } from "@/lib/code/source";
import { appJwt, GitHubActionsSandbox } from "@/lib/sandbox/github-actions";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const creds = { appId: "123", installationId: "9", privateKey };
const target = { owner: "o", repo: "r", ref: "main" };

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth?: string;
}

function fakeGitHub(runs: { status: string; conclusion: string | null }[][], jobs: unknown = { jobs: [] }) {
  const calls: Call[] = [];
  let poll = 0;
  const fetchFn = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const path = url.replace("https://api.github.com", "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => data, text: async () => "" });
    if (path.endsWith("/access_tokens")) return ok({ token: "inst-token", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
    if (path.includes("/git/ref/heads/main")) return ok({ object: { sha: "base" } });
    if (path.endsWith("/git/blobs")) return ok({ sha: "blob1" }, 201);
    if (path.endsWith("/git/trees")) return ok({ sha: "tree1" }, 201);
    if (path.endsWith("/git/commits")) return ok({ sha: "commit1" }, 201);
    if (path.endsWith("/git/refs")) return ok({}, 201);
    if (method === "DELETE") return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    if (path.includes("/actions/runs?")) {
      const step = runs[Math.min(poll++, runs.length - 1)] ?? [];
      return ok({ workflow_runs: step.map((r, i) => ({ id: i + 1, html_url: "https://run", ...r })) });
    }
    if (path.endsWith("/jobs")) return ok(jobs);
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  return { calls, fetchFn };
}

const make = (gh: ReturnType<typeof fakeGitHub>, timeoutMs = 60_000) => {
  let t = 1_000_000;
  return new GitHubActionsSandbox(target, creds, new MemoryCodeSource({ "a.js": "one\ntwo" }), {
    fetchFn: gh.fetchFn,
    sleep: async (ms) => void (t += ms),
    now: () => t,
    timeoutMs,
    pollMs: 10_000,
  });
};

describe("appJwt", () => {
  it("is an RS256 token signed with the app key", () => {
    const jwt = appJwt(creds, 1_700_000_000_000);
    const [head, body, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(body, "base64url").toString()).iss).toBe("123");
    expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("accepts a key written on one line with \\n escapes", () => {
    expect(() => appJwt({ ...creds, privateKey: privateKey.trim().replace(/\n/g, "\\n") }, 0)).not.toThrow();
  });
});

describe("GitHubActionsSandbox", () => {
  it("reports changed lines against the repository's current file", async () => {
    const sb = make(fakeGitHub([]));
    const out = await sb.apply([{ path: "a.js", content: "one\nthree" }]);
    expect(out).toEqual([{ path: "a.js", added: 1, removed: 1, addedText: "three" }]);
  });

  it("pushes a whatsdown/* branch, waits for the run and reports success", async () => {
    const gh = fakeGitHub([[], [{ status: "in_progress", conclusion: null }], [{ status: "completed", conclusion: "success" }]]);
    const sb = make(gh);
    await sb.apply([{ path: "a.js", content: "x" }]);
    const res = await sb.runChecks();
    expect(res.passed).toBe(true);
    const ref = gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/git/refs"));
    expect((ref?.body as { ref: string }).ref).toMatch(/^refs\/heads\/whatsdown\//);
    expect(gh.calls.some((c) => c.path.includes("heads/main") && c.method !== "GET")).toBe(false);
    expect(gh.calls.find((c) => c.path.endsWith("/git/blobs"))?.auth).toBe("Bearer inst-token");
  });

  it("names the failing step when checks fail", async () => {
    const gh = fakeGitHub([[{ status: "completed", conclusion: "failure" }]], {
      jobs: [{ name: "checks", conclusion: "failure", steps: [{ name: "npm test", conclusion: "failure" }] }],
    });
    const sb = make(gh);
    await sb.apply([{ path: "a.js", content: "x" }]);
    const res = await sb.runChecks();
    expect(res.passed).toBe(false);
    expect(res.output).toContain('failed at "npm test"');
  });

  it("fails clearly when no workflow ever runs", async () => {
    const sb = make(fakeGitHub([[]]), 30_000);
    await sb.apply([{ path: "a.js", content: "x" }]);
    const res = await sb.runChecks();
    expect(res.passed).toBe(false);
    expect(res.output).toContain("workflow");
  });

  it("deletes its branch on reset and refuses to check with nothing staged", async () => {
    const gh = fakeGitHub([[{ status: "completed", conclusion: "success" }]]);
    const sb = make(gh);
    expect((await sb.runChecks()).passed).toBe(false);
    await sb.apply([{ path: "a.js", content: "x" }]);
    await sb.runChecks();
    await sb.reset();
    expect(gh.calls.some((c) => c.method === "DELETE" && c.path.includes("/git/refs/heads/whatsdown/"))).toBe(true);
    expect(sb.pushedBranch).toBeUndefined();
  });
});
