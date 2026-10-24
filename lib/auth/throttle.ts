interface Entry {
  fails: number;
  until: number;
}

/**
 * Best-effort limiter for failed attempts per key (kept in process memory, so on serverless it
 * slows guessing rather than stopping it outright; the owner password should be long anyway).
 */
export class AttemptLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFails = 5,
    private readonly lockMs = 15 * 60_000,
  ) {}

  /** Seconds the caller must wait, or 0 when allowed. */
  retryAfter(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e || e.until <= now) return 0;
    return Math.ceil((e.until - now) / 1000);
  }

  fail(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    const fresh = !e || (e.until !== 0 && e.until <= now);
    const fails = fresh ? 1 : e.fails + 1;
    this.entries.set(key, { fails, until: fails >= this.maxFails ? now + this.lockMs : 0 });
    if (this.entries.size > 5000) this.entries.clear();
  }

  success(key: string): void {
    this.entries.delete(key);
  }
}
