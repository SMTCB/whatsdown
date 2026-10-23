import type { Ticket } from "@/lib/db/store";

/** Same idea as Postgres pg_trgm: lowercase words padded with two spaces before and one after. */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Jaccard similarity of trigram sets, 0 to 1 (pg_trgm's `similarity`). */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.6;

/** A ticket can only duplicate one that is still live; closed and failed ones may be reported again. */
const COMPARABLE: Ticket["status"][] = [
  "new", "needs_info", "triaged", "diagnosing", "awaiting_plan_approval", "patching", "in_qa", "awaiting_merge",
];

export interface DuplicateMatch {
  ticket: Ticket;
  score: number;
}

export function findDuplicate(
  ticket: Pick<Ticket, "id" | "projectId" | "title">,
  others: readonly Ticket[],
  threshold = DUPLICATE_THRESHOLD,
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  for (const o of others) {
    if (o.id === ticket.id || o.projectId !== ticket.projectId || !COMPARABLE.includes(o.status)) continue;
    const score = similarity(ticket.title, o.title);
    if (score >= threshold && (!best || score > best.score)) best = { ticket: o, score };
  }
  return best;
}
