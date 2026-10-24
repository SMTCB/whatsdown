export interface Quote {
  path: string;
  quote: string;
}

/** Quotes shorter than this prove nothing ("div", "return"). */
const MIN_QUOTE = 12;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Splits the plan's quotes into those that really appear in the named file and those that do not.
 * Whitespace differences are ignored; a missing file or a one-word quote counts as not found.
 */
export async function checkQuotes(read: (path: string) => Promise<string | null>, quotes: readonly Quote[]): Promise<{ verified: Quote[]; rejected: Quote[] }> {
  const verified: Quote[] = [];
  const rejected: Quote[] = [];
  const cache = new Map<string, string | null>();
  for (const q of quotes) {
    if (!cache.has(q.path)) {
      try {
        cache.set(q.path, await read(q.path));
      } catch {
        cache.set(q.path, null);
      }
    }
    const content = cache.get(q.path);
    const want = squash(q.quote);
    (content != null && want.length >= MIN_QUOTE && squash(content).includes(want) ? verified : rejected).push(q);
  }
  return { verified, rejected };
}
