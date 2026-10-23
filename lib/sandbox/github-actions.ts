import { createSign } from "node:crypto";
import type { CodeSource, RepoRef } from "@/lib/code/source";
import type { ChangedFile } from "@/lib/guard/diff-guard";
import { lineCounts, surplus, type CheckResult, type FileChange, type MergeOutcome, type Publisher, type Sandbox } from "./sandbox";

type Init = { method?: string; headers?: Record<string, string>; body?: string };
type FetchLike = (url: string, init?: Init) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

export interface GitHubAppCredentials {
  appId: string;
  installationId: string;
  /** PEM private key; "\n" escapes are accepted so it fits on one .env line. */
  privateKey: string;
}

export interface ActionsOptions {
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to wait for the workflow run before reporting a timeout. */
  timeoutMs?: number;
  pollMs?: number;
  /** Share one token cache with other readers (e.g. the code source). */
  auth?: GitHubAppAuth;
}

const API = "https://api.github.com";
const BRANCH_PREFIX = "whatsdown/";

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Short-lived JWT that proves we are the GitHub App (valid 10 minutes). */
export function appJwt(creds: Pick<GitHubAppCredentials, "appId" | "privateKey">, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 600, iss: creds.appId }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(creds.privateKey.replace(/\\n/g, "\n"));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Exchanges the app key for short-lived installation tokens and caches them. */
export class GitHubAppAuth {
  private cached?: { value: string; expires: number };

  constructor(
    private readonly creds: GitHubAppCredentials,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  async token(): Promise<string> {
    if (this.cached && this.cached.expires > this.now() + 60_000) return this.cached.value;
    const res = await this.fetchFn(`${API}/app/installations/${this.creds.installationId}/access_tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${appJwt(this.creds, this.now())}`, Accept: "application/vnd.github+json", "User-Agent": "whatsdown" },
    });
    if (!res.ok) throw new Error(`GitHub App sign-in failed with status ${res.status}`);
    const data = (await res.json()) as { token: string; expires_at: string };
    this.cached = { value: data.token, expires: Date.parse(data.expires_at) };
    return data.token;
  }
}

interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/**
 * Cloud sandbox: the patch is pushed to a throwaway `whatsdown/*` branch of the target repo and
 * GitHub Actions runs the project's own checks there. It can never write to the base branch;
 * merging stays a separate, owner-approved step. The target repo needs a workflow that runs on
 * pushes to `whatsdown/**` (see docs/target-repo-workflow.yml).
 */
export class GitHubActionsSandbox implements Sandbox, Publisher {
  private staged = new Map<string, string>();
  private branch?: string;
  private readonly auth: GitHubAppAuth;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly target: RepoRef,
    private readonly creds: GitHubAppCredentials,
    private readonly source: CodeSource,
    opts: ActionsOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? (fetch as unknown as FetchLike);
    this.now = opts.now ?? Date.now;
    this.auth = opts.auth ?? new GitHubAppAuth(creds, this.fetchFn, this.now);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    this.pollMs = opts.pollMs ?? 10_000;
  }

  /** Name of the branch holding the last pushed patch, if any. */
  get pushedBranch(): string | undefined {
    return this.branch;
  }

  async apply(changes: readonly FileChange[]): Promise<ChangedFile[]> {
    const out: ChangedFile[] = [];
    for (const c of changes) {
      const prev = lineCounts((await this.source.read(c.path)) ?? "");
      const next = lineCounts(c.content);
      const added = surplus(next, prev);
      const removed = surplus(prev, next);
      this.staged.set(c.path, c.content);
      out.push({ path: c.path, added: added.length, removed: removed.length, addedText: added.join("\n") });
    }
    return out;
  }

  async runChecks(): Promise<CheckResult> {
    if (this.staged.size === 0) return { passed: false, output: "No changes to check." };
    const sha = await this.push();
    const run = await this.waitForRun(sha);
    if (!run) {
      const minutes = Math.round(this.timeoutMs / 60_000);
      return { passed: false, output: `No workflow run finished within ${minutes} minutes. Does the target repo have a workflow for ${BRANCH_PREFIX}** pushes?` };
    }
    return this.describe(run);
  }

  async reset(): Promise<void> {
    this.staged.clear();
    if (!this.branch) return;
    const branch = this.branch;
    this.branch = undefined;
    await this.call("DELETE", `/git/refs/heads/${branch}`, undefined, [404, 422]);
  }

  keep(): void {
    this.staged.clear();
    this.branch = undefined;
  }

  async merge(branch: string, title: string, body: string): Promise<MergeOutcome> {
    const opened = await this.raw("POST", "/pulls", { title, head: branch, base: this.target.ref, body });
    let pr = opened.data as { number?: number; html_url?: string };
    if (opened.status === 422) {
      // A pull request for this branch may already be open (e.g. an earlier blocked merge).
      const found = (await this.raw("GET", `/pulls?head=${encodeURIComponent(`${this.target.owner}:${branch}`)}&state=open`)).data;
      pr = (Array.isArray(found) ? found[0] : undefined) ?? {};
    } else if (opened.status >= 300) {
      return { merged: false, reason: `GitHub would not open a pull request (status ${opened.status}).` };
    }
    if (!pr.number) return { merged: false, reason: "GitHub would not open a pull request for this branch." };
    const url = pr.html_url ?? "";
    const done = await this.raw("PUT", `/pulls/${pr.number}/merge`, { merge_method: "squash", commit_title: title });
    if (done.status >= 300) {
      const why = (done.data as { message?: string }).message ?? `status ${done.status}`;
      return { merged: false, reason: `GitHub refused the merge: ${why.slice(0, 200)}`, url };
    }
    await this.discard(branch);
    return { merged: true, url };
  }

  async discard(branch: string): Promise<void> {
    await this.call("DELETE", `/git/refs/heads/${branch}`, undefined, [404, 422]);
  }

  /** Like call(), but returns the status and body instead of throwing on errors. */
  private async raw(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const res = await this.fetchFn(`${API}/repos/${this.target.owner}/${this.target.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.auth.token()}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "whatsdown",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  private async call(method: string, path: string, body?: unknown, tolerated: number[] = []): Promise<unknown> {
    const res = await this.fetchFn(`${API}/repos/${this.target.owner}/${this.target.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.auth.token()}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "whatsdown",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && !tolerated.includes(res.status)) throw new Error(`GitHub ${method} ${path.split("?")[0]} failed with status ${res.status}`);
    return res.ok && res.status !== 204 ? res.json() : undefined;
  }

  /** Commits the staged files on a new branch cut from the base ref and returns the commit sha. */
  private async push(): Promise<string> {
    const base = (await this.call("GET", `/git/ref/heads/${this.target.ref}`)) as { object: { sha: string } };
    const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (const [path, content] of this.staged) {
      const blob = (await this.call("POST", "/git/blobs", { content, encoding: "utf-8" })) as { sha: string };
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = (await this.call("POST", "/git/trees", { base_tree: base.object.sha, tree })) as { sha: string };
    const commit = (await this.call("POST", "/git/commits", {
      message: "WhatsDown: proposed fix",
      tree: newTree.sha,
      parents: [base.object.sha],
    })) as { sha: string };
    this.branch = `${BRANCH_PREFIX}${this.now().toString(36)}`;
    await this.call("POST", "/git/refs", { ref: `refs/heads/${this.branch}`, sha: commit.sha });
    return commit.sha;
  }

  private async waitForRun(sha: string): Promise<Run | undefined> {
    const deadline = this.now() + this.timeoutMs;
    while (this.now() < deadline) {
      await this.sleep(this.pollMs);
      const list = (await this.call("GET", `/actions/runs?branch=${encodeURIComponent(this.branch ?? "")}&head_sha=${sha}`)) as {
        workflow_runs: Run[];
      };
      const runs = list.workflow_runs;
      if (runs.length > 0 && runs.every((r) => r.status === "completed")) {
        return runs.find((r) => r.conclusion !== "success") ?? runs[0];
      }
    }
    return undefined;
  }

  private async describe(run: Run): Promise<CheckResult> {
    if (run.conclusion === "success") return { passed: true, output: `All checks passed on branch ${this.branch}. ${run.html_url}` };
    const jobs = (await this.call("GET", `/actions/runs/${run.id}/jobs`)) as {
      jobs: { name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[];
    };
    const failures = jobs.jobs
      .filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped")
      .map((j) => `${j.name}: failed at "${j.steps?.find((s) => s.conclusion === "failure")?.name ?? "unknown step"}"`);
    return { passed: false, output: `Checks ${run.conclusion ?? "did not finish"}. ${failures.join("; ")} ${run.html_url}`.trim() };
  }
}
