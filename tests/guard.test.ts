import { describe, expect, it } from "vitest";
import { checkDiff, FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import { matchesAny } from "@/lib/guard/glob";

const policy = { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 };

describe("glob", () => {
  it("matches deep paths with **", () => {
    expect(matchesAny("supabase/migrations/301_x.sql", ["supabase/migrations/**"])).toBe(true);
    expect(matchesAny("src/a/b/c.jsx", ["src/**/*.jsx"])).toBe(true);
  });
  it("does not match across folders with *", () => {
    expect(matchesAny("src/a/b.js", ["src/*.js"])).toBe(false);
  });
  it("normalises Windows separators and leading ./", () => {
    expect(matchesAny(".\\.github\\workflows\\ci.yml", [".github/**"])).toBe(true);
  });
});

describe("diff guard", () => {
  it("passes a small change to app code", () => {
    expect(checkDiff([{ path: "src/components/Pitch.jsx", added: 5, removed: 2 }], policy).ok).toBe(true);
  });
  it("blocks protected paths", () => {
    const r = checkDiff(
      [
        { path: "supabase/migrations/301_fix.sql", added: 3, removed: 0 },
        { path: "package.json", added: 1, removed: 1 },
      ],
      policy,
    );
    expect(r.violations.filter((v) => v.code === "protected_path")).toHaveLength(2);
  });
  it("blocks BACKLOG.md in agent diffs", () => {
    expect(checkDiff([{ path: "BACKLOG.md", added: 5, removed: 0 }], policy).ok).toBe(false);
  });
  it("blocks env files at any depth", () => {
    expect(checkDiff([{ path: "apps/web/.env.local", added: 1, removed: 0 }], policy).ok).toBe(false);
  });
  it("enforces the size cap", () => {
    const r = checkDiff([{ path: "src/a.js", added: 300, removed: 101 }], policy);
    expect(r.violations).toContainEqual({ code: "too_large", changed: 401, limit: 400 });
  });
  it("catches secrets in added lines", () => {
    const addedText = "const k = " + "sk-ant-" + "abcdefghijklmnopqrstuvwxyz";
    const r = checkDiff([{ path: "src/a.js", added: 1, removed: 0, addedText }], policy);
    expect(r.violations).toContainEqual({ code: "secret", path: "src/a.js", rule: "anthropic_key" });
  });
  it("rejects an empty diff", () => {
    expect(checkDiff([], policy).violations).toEqual([{ code: "empty" }]);
  });
});
