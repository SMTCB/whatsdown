import type { ChangedFile } from "@/lib/guard/diff-guard";

export interface FileChange {
  path: string;
  /** Full new content of the file. */
  content: string;
}

export interface CheckResult {
  passed: boolean;
  output: string;
}

/**
 * The isolated workspace the Developer and QA agents use. E2B implements this once it exists;
 * MemorySandbox stands in locally. Nothing here can push or merge.
 */
export interface Sandbox {
  /** Writes the files and reports what changed against the original checkout. */
  apply(changes: readonly FileChange[]): Promise<ChangedFile[]>;
  /** Runs the project's test, typecheck and lint commands. */
  runChecks(): Promise<CheckResult>;
  /** Discards all changes. */
  reset(): Promise<void>;
}

export function lineCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  if (text === "") return m;
  for (const line of text.split("\n")) m.set(line, (m.get(line) ?? 0) + 1);
  return m;
}

/** Counts lines in `next` that are not in `prev` (multiset difference). */
export function surplus(next: Map<string, number>, prev: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [line, n] of next) {
    const extra = n - (prev.get(line) ?? 0);
    for (let i = 0; i < extra; i++) out.push(line);
  }
  return out;
}

export class MemorySandbox implements Sandbox {
  private files: Map<string, string>;
  /** Replace to simulate passing or failing checks. */
  checks: () => CheckResult = () => ({ passed: true, output: "all checks passed" });

  constructor(private readonly original: Record<string, string> = {}) {
    this.files = new Map(Object.entries(original));
  }

  async apply(changes: readonly FileChange[]): Promise<ChangedFile[]> {
    const out: ChangedFile[] = [];
    for (const c of changes) {
      const prev = lineCounts(this.original[c.path] ?? "");
      const next = lineCounts(c.content);
      const added = surplus(next, prev);
      const removed = surplus(prev, next);
      this.files.set(c.path, c.content);
      out.push({ path: c.path, added: added.length, removed: removed.length, addedText: added.join("\n") });
    }
    return out;
  }

  async runChecks(): Promise<CheckResult> {
    return this.checks();
  }

  async reset(): Promise<void> {
    this.files = new Map(Object.entries(this.original));
  }

  read(path: string): string | undefined {
    return this.files.get(path);
  }
}
