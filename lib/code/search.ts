import type { CodeSource } from "./source";

/** Words that appear in nearly every screen and say nothing about where a problem lives. */
const COMMON = new Set(["the", "and", "for", "with", "this", "that", "screen", "button", "table", "page", "click", "tap"]);

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

/**
 * Text a person can see on the screen, taken from the report: anything in quotes, plus short fragments of the
 * screenshot description (headings, labels, column names). Quoted text comes first because the reporter chose it.
 */
export function uiStrings(text: string, max = 8): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    // Drop quote marks and a short "Label:" lead-in ("Page hint top-right: ...") so only the words on screen remain.
    const s = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/^[-*•\s]+|[:.\s]+$/g, "").replace(/^[A-Za-z][A-Za-z -]{1,30}:\s+(?=\S)/, "");
    if (s.length < 4 || s.length > 50 || letters(s) < 3 || s.split(" ").length > 6) return;
    if (COMMON.has(s.toLowerCase()) || out.some((o) => o.toLowerCase() === s.toLowerCase())) return;
    out.push(s);
  };
  const [typed = "", described] = text.split("[Read automatically from the attached screenshot");
  for (const m of typed.matchAll(/["“”«]([^"“”»\n]{3,50})["“”»]/g)) add(m[1]!);
  if (described) {
    // The first line is the reader's own header (file name and a caveat), not screen text.
    for (const line of described.split("\n").slice(1)) {
      const body = line.replace(/^\s*(Screen|Controls|Table|Highlighted)\s*:/i, "");
      for (const part of body.split(/[·|,;•]|\s[-–—]\s/)) add(part);
    }
  }
  return out.slice(0, max);
}

export interface SearchHit {
  path: string;
  /** The on-screen strings found in this file. */
  matched: string[];
  score: number;
}

/**
 * Finds the files that contain the on-screen strings. A string found in many files is weak evidence, so each match
 * counts 1 divided by the number of files that share it. Returns nothing when the source cannot search.
 */
export async function findByText(source: CodeSource, strings: readonly string[], eligible: (path: string) => boolean): Promise<SearchHit[]> {
  if (!source.search) return [];
  const byPath = new Map<string, SearchHit>();
  for (const s of strings) {
    let paths: string[];
    try {
      paths = (await source.search(s)).filter(eligible);
    } catch {
      continue; // search is a bonus: a rate limit must never stop the ticket
    }
    for (const path of paths) {
      const hit = byPath.get(path) ?? { path, matched: [], score: 0 };
      hit.matched.push(s);
      hit.score += 1 / paths.length;
      byPath.set(path, hit);
    }
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score);
}

/** A window of the file around the first place any needle appears, cut on line boundaries. Whole file if it fits. */
export function excerptAround(content: string, needles: readonly string[], max: number): string {
  if (content.length <= max) return content;
  const lower = content.toLowerCase();
  let at = -1;
  for (const n of needles) {
    // A function name points at where it is defined, not at the first place it is called.
    const def = /^[A-Za-z_$][\w$]*$/.test(n) ? new RegExp(`(?:function\\s+|(?:const|let)\\s+)${n.replace(/\$/g, "\\$")}\\b`).exec(content) : null;
    const i = def ? def.index : lower.indexOf(n.toLowerCase());
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return content.slice(0, max);
  let start = Math.max(0, at - Math.floor(max / 3));
  let end = Math.min(content.length, start + max);
  start = Math.max(0, end - max);
  const nl = content.indexOf("\n", start);
  if (start > 0 && nl !== -1 && nl < at) start = nl + 1;
  const back = content.lastIndexOf("\n", end);
  if (end < content.length && back > at) end = back;
  return `${start > 0 ? "[... earlier lines not shown ...]\n" : ""}${content.slice(start, end)}${end < content.length ? "\n[... later lines not shown ...]" : ""}`;
}

/** Names and line numbers of the functions and components in a file, so the model can point at one it cannot see in full. */
export function outline(content: string, maxItems = 40): string {
  const items: string[] = [];
  const lines = content.split("\n");
  const re = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;
  for (let i = 0; i < lines.length && items.length < maxItems; i++) {
    const m = re.exec(lines[i]!);
    const name = m?.[1] ?? m?.[2];
    if (name) items.push(`${name} (line ${i + 1})`);
  }
  return items.join(", ");
}

/**
 * Like `excerptAround`, but when the window around the screen text only calls a function that is defined further away
 * (a table that maps rows through `renderRow`), the start of that definition is shown too: the cause often lives there.
 */
export function excerptWithCallees(content: string, needles: readonly string[], max: number): string {
  if (content.length <= max) return content;
  const main = excerptAround(content, needles, Math.floor(max * 0.3));
  let left = max - main.length;
  let out = main;
  const seen = new Set<string>();
  // The rows are often rendered a little below the heading, so look for calls in the lines that follow the match too.
  const lower = content.toLowerCase();
  let scanned = main;
  for (const n of needles) {
    for (let i = lower.indexOf(n.toLowerCase()), k = 0; i !== -1 && k < 3; i = lower.indexOf(n.toLowerCase(), i + 1), k++) scanned += `\n${content.slice(i, i + 3000)}`;
  }
  for (const m of scanned.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]!;
    if (seen.has(name) || left < 600) continue;
    seen.add(name);
    const def = new RegExp(`^[ \\t]*(?:async\\s+)?function\\s+${name.replace(/\$/g, "\\$")}\\b`, "m").exec(content);
    if (!def || main.includes(`function ${name}`)) continue;
    let block = content.slice(def.index, def.index + left);
    const cut = block.lastIndexOf("\n");
    if (def.index + left < content.length && cut > 0) block = block.slice(0, cut);
    out += `\n[... function ${name}, defined elsewhere in the file ...]\n${block}`;
    left -= block.length + 60;
  }
  return out;
}
