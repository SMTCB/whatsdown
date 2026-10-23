import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryCodeSource } from "@/lib/code/source";
import { MemoryStore } from "@/lib/db/memory-store";
import { transition } from "@/lib/db/transition";
import { demoNodes } from "@/lib/pipeline/demo-nodes";
import { MergeBlockedError, resolveGate2, WrongGateError, type PipelineNodes } from "@/lib/pipeline/runner";
import { GitHubActionsSandbox } from "@/lib/sandbox/github-actions";
import type { MergeOutcome } from "@/lib/sandbox/sandbox";

async function ticketAtGate2(store: MemoryStore, withBranch = true) {
  const t = await store.create({ projectId: "p", channel: "web", title: "Fix it", body: "It is broken in the recap screen" });
  for (const to of ["triaged", "diagnosing", "awaiting_plan_approval", "patching", "in_qa"] as const) {
    await transition(store, t.id, to, "agent", to);
  }
  await transition(store, t.id, "awaiting_merge", "agent", "qa passed", { summary: "ok", ...(withBranch ? { branch: "whatsdown/abc" } : {}) });
  return t.id;
}

function nodesWith(outcome: MergeOutcome) {
  const calls: string[] = [];
  const nodes: PipelineNodes = {
    ...demoNodes,
    merge: async (_t, branch) => {
      calls.push(`merge ${branch}`);
      return outcome;
    },
    discard: async (_t, branch) => void calls.push(`discard ${branch}`),
  };
  return { nodes, calls };
}

describe("resolveGate2", () => {
  it("merges the QA branch before marking the ticket merged", async () => {
    const store = new MemoryStore();
    const id = await ticketAtGate2(store);
    const { nodes, calls } = nodesWith({ merged: true, url: "https://github.com/o/r/pull/1" });
    const t = await resolveGate2({ store, nodes }, id, "merge");
    expect(t.status).toBe("merged");
    expect(calls).toEqual(["merge whatsdown/abc"]);
    expect((await store.events(id)).at(-1)?.payload).toMatchObject({ gate: 2, pullRequest: "https://github.com/o/r/pull/1" });
  });

  it("leaves the ticket at Gate 2 when the project refuses the merge", async () => {
    const store = new MemoryStore();
    const id = await ticketAtGate2(store);
    const { nodes } = nodesWith({ merged: false, reason: "protected branch", url: "https://github.com/o/r/pull/2" });
    await expect(resolveGate2({ store, nodes }, id, "merge")).rejects.toBeInstanceOf(MergeBlockedError);
    expect((await store.get(id))?.status).toBe("awaiting_merge");
  });

  it("deletes the branch when the owner closes without merging", async () => {
    const store = new MemoryStore();
    const id = await ticketAtGate2(store);
    const { nodes, calls } = nodesWith({ merged: true, url: "" });
    const t = await resolveGate2({ store, nodes }, id, "close");
    expect(t.status).toBe("closed");
    expect(calls).toEqual(["discard whatsdown/abc"]);
  });

  it("only records the decision in demo mode, and only at Gate 2", async () => {
    const store = new MemoryStore();
    const id = await ticketAtGate2(store, false);
    expect((await resolveGate2({ store, nodes: demoNodes }, id, "merge")).status).toBe("merged");
    await expect(resolveGate2({ store, nodes: demoNodes }, id, "merge")).rejects.toBeInstanceOf(WrongGateError);
  });
});

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function fakeGitHub(responses: Record<string, { status: number; data: unknown }>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: { method?: string; body?: string } = {}) => {
    const path = url.replace("https://api.github.com", "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(responses).find((k) => `${method} ${path}`.startsWith(k));
    const r = key ? responses[key]! : { status: 404, data: {} };
    return { ok: r.status < 300, status: r.status, json: async () => r.data, text: async () => "" };
  };
  return { calls, fetchFn };
}

const token = { status: 201, data: { token: "t", expires_at: new Date(Date.now() + 3_600_000).toISOString() } };

function sandboxOver(gh: ReturnType<typeof fakeGitHub>) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return new GitHubActionsSandbox(
    { owner: "o", repo: "r", ref: "main" },
    { appId: "1", installationId: "2", privateKey },
    new MemoryCodeSource({}),
    { fetchFn: gh.fetchFn },
  );
}

describe("GitHubActionsSandbox.merge", () => {
  it("opens a pull request, squash-merges it and deletes the branch", async () => {
    const gh = fakeGitHub({
      "POST /app/installations": token,
      "POST /repos/o/r/pulls": { status: 201, data: { number: 7, html_url: "https://github.com/o/r/pull/7" } },
      "PUT /repos/o/r/pulls/7/merge": { status: 200, data: { merged: true } },
      "DELETE": { status: 204, data: {} },
    });
    const out = await sandboxOver(gh).merge("whatsdown/abc", "Title", "Body");
    expect(out).toEqual({ merged: true, url: "https://github.com/o/r/pull/7" });
    expect(gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/pulls"))?.body).toMatchObject({ head: "whatsdown/abc", base: "main" });
    expect(gh.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ merge_method: "squash" });
    expect(gh.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/git/refs/heads/whatsdown/abc"))).toBe(true);
  });

  it("reports a refused merge and keeps the branch", async () => {
    const gh = fakeGitHub({
      "POST /app/installations": token,
      "POST /repos/o/r/pulls": { status: 201, data: { number: 8, html_url: "https://github.com/o/r/pull/8" } },
      "PUT /repos/o/r/pulls/8/merge": { status: 405, data: { message: "Required status check is expected" } },
    });
    const out = await sandboxOver(gh).merge("whatsdown/abc", "T", "B");
    expect(out).toMatchObject({ merged: false, url: "https://github.com/o/r/pull/8" });
    expect((out as { reason: string }).reason).toContain("Required status check");
    expect(gh.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("reuses an open pull request for the branch", async () => {
    const gh = fakeGitHub({
      "POST /app/installations": token,
      "POST /repos/o/r/pulls": { status: 422, data: {} },
      "GET /repos/o/r/pulls?head=": { status: 200, data: [{ number: 9, html_url: "https://github.com/o/r/pull/9" }] },
      "PUT /repos/o/r/pulls/9/merge": { status: 200, data: {} },
      "DELETE": { status: 204, data: {} },
    });
    expect((await sandboxOver(gh).merge("whatsdown/abc", "T", "B")).merged).toBe(true);
  });
});
