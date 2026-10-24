/** Read-only view of a target repository. Nothing here can write, push or merge. */
export interface CodeSource {
  /** Every file path in the repository at the pinned ref. */
  tree(): Promise<string[]>;
  /** File text, or null if the path does not exist. */
  read(path: string): Promise<string | null>;
  /** Paths of files whose text contains the phrase (case-insensitive). Absent when the source cannot search. */
  search?(phrase: string): Promise<string[]>;
}

export class MemoryCodeSource implements CodeSource {
  constructor(private readonly files: Record<string, string>) {}
  async tree() {
    return Object.keys(this.files);
  }
  async read(path: string) {
    return this.files[path] ?? null;
  }
  async search(phrase: string) {
    const needle = phrase.toLowerCase();
    return Object.entries(this.files)
      .filter(([, text]) => text.toLowerCase().includes(needle))
      .map(([path]) => path);
  }
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string;
}

const TREE_TTL_MS = 10 * 60_000;

/**
 * Reads a GitHub repository over HTTPS. Public repos need no token; a token (read-only) only
 * raises the API rate limit and allows private repos.
 */
export class GitHubCodeSource implements CodeSource {
  private cached?: { at: number; paths: string[] };

  constructor(
    private readonly target: RepoRef,
    private readonly token?: string | (() => Promise<string>),
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  private async headers(accept: string): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: accept, "User-Agent": "whatsdown" };
    if (this.token) h.Authorization = `Bearer ${typeof this.token === "function" ? await this.token() : this.token}`;
    return h;
  }

  async tree(): Promise<string[]> {
    if (this.cached && this.now() - this.cached.at < TREE_TTL_MS) return this.cached.paths;
    const { owner, repo, ref } = this.target;
    const res = await this.fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
      headers: await this.headers("application/vnd.github+json"),
    });
    if (!res.ok) throw new Error(`GitHub tree request failed with status ${res.status}`);
    const data = (await res.json()) as { tree?: { path: string; type: string }[]; truncated?: boolean };
    const paths = (data.tree ?? []).filter((n) => n.type === "blob").map((n) => n.path);
    this.cached = { at: this.now(), paths };
    return paths;
  }

  async read(path: string): Promise<string | null> {
    const { owner, repo, ref } = this.target;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
    const res = await this.fetchFn(url, { headers: await this.headers("application/vnd.github.raw+json") });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub file request failed with status ${res.status}`);
    return res.text();
  }

  /** GitHub code search on the default branch. Rate limited (10 a minute), so callers use it sparingly. */
  async search(phrase: string): Promise<string[]> {
    const { owner, repo } = this.target;
    const q = `"${phrase.replace(/["\\]/g, " ")}" repo:${owner}/${repo}`;
    const res = await this.fetchFn(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=10`, {
      headers: await this.headers("application/vnd.github+json"),
    });
    if (!res.ok) throw new Error(`GitHub search failed with status ${res.status}`);
    const data = (await res.json()) as { items?: { path: string }[] };
    return (data.items ?? []).map((i) => i.path);
  }
}
