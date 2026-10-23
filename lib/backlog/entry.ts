export interface BacklogEntryInput {
  title: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  prNumber: number;
  ticketNumber: number;
  /** 2 to 4 short bullets, built from the plan and QA summary by the app, not written by a model. */
  bullets: readonly string[];
}

const MARKER = (ticketNumber: number) => `WhatsDown ticket #${ticketNumber}`;

export function buildBacklogEntry(input: BacklogEntryInput): string {
  if (input.bullets.length < 2 || input.bullets.length > 4) {
    throw new Error("A backlog entry needs 2 to 4 bullets");
  }
  const title = input.title.replace(/\s+/g, " ").trim();
  const head = `## 🟡 ${title} (${input.date}) — PR #${input.prNumber}, ${MARKER(input.ticketNumber)}`;
  return [head, ...input.bullets.map((b) => `- ${b.replace(/\s+/g, " ").trim()}`)].join("\n");
}

/** Removes any existing entry for the same ticket, so a rebuild after a conflict is idempotent. */
function removeEntry(lines: string[], ticketNumber: number): string[] {
  const marker = MARKER(ticketNumber);
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes(marker));
  if (start === -1) return lines;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ")) end++;
  return [...lines.slice(0, start), ...lines.slice(end)];
}

/**
 * Inserts the entry above the first `## ` section, i.e. just below the file header.
 * The header, including any "Last Updated" line, is left untouched.
 */
export function insertBacklogEntry(markdown: string, entry: string, ticketNumber: number): string {
  const lines = removeEntry(markdown.replace(/\r\n/g, "\n").split("\n"), ticketNumber);
  const firstSection = lines.findIndex((l) => l.startsWith("## "));
  const block = [...entry.split("\n"), ""];
  if (firstSection === -1) {
    const trimmed = lines.join("\n").replace(/\n+$/, "");
    return `${trimmed}\n\n${block.join("\n")}`;
  }
  return [...lines.slice(0, firstSection), ...block, ...lines.slice(firstSection)].join("\n");
}
