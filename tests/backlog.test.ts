import { describe, expect, it } from "vitest";
import { buildBacklogEntry, insertBacklogEntry } from "@/lib/backlog/entry";

const input = {
  title: "Fix pitch  layout on small screens",
  date: "2026-10-22",
  prNumber: 12,
  ticketNumber: 7,
  bullets: ["Pitch wraps at 360px", "Added a regression test"],
};

const file = `# Backlog

Last Updated: 2026-10-01

## 🟢 Older item (2026-09-30) — PR #3
- done

## 🔴 Open item
- todo
`;

describe("backlog entry", () => {
  it("builds the agreed format", () => {
    expect(buildBacklogEntry(input)).toBe(
      "## 🟡 Fix pitch layout on small screens (2026-10-22) — PR #12, WhatsDown ticket #7\n- Pitch wraps at 360px\n- Added a regression test",
    );
  });

  it("requires 2 to 4 bullets", () => {
    expect(() => buildBacklogEntry({ ...input, bullets: ["one"] })).toThrow();
    expect(() => buildBacklogEntry({ ...input, bullets: ["1", "2", "3", "4", "5"] })).toThrow();
  });

  it("inserts below the header and leaves Last Updated alone", () => {
    const out = insertBacklogEntry(file, buildBacklogEntry(input), 7);
    expect(out).toContain("Last Updated: 2026-10-01");
    expect(out.indexOf("WhatsDown ticket #7")).toBeLessThan(out.indexOf("Older item"));
    expect(out.indexOf("WhatsDown ticket #7")).toBeGreaterThan(out.indexOf("Last Updated"));
  });

  it("is idempotent: a rebuild replaces the entry for the same ticket", () => {
    const once = insertBacklogEntry(file, buildBacklogEntry(input), 7);
    const twice = insertBacklogEntry(once, buildBacklogEntry({ ...input, prNumber: 13 }), 7);
    expect(twice.match(/WhatsDown ticket #7/g)).toHaveLength(1);
    expect(twice).toContain("PR #13");
    expect(twice).toContain("Older item");
  });

  it("appends when the file has no sections", () => {
    const out = insertBacklogEntry("# Backlog\n", buildBacklogEntry(input), 7);
    expect(out.startsWith("# Backlog\n\n## 🟡")).toBe(true);
  });
});
