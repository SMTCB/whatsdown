import { describe, expect, it } from "vitest";
import { unusedFiles } from "@/lib/code/imports";
import { locate } from "@/lib/code/locate";
import { excerptAround, outline, uiStrings } from "@/lib/code/search";
import { GitHubCodeSource, MemoryCodeSource } from "@/lib/code/source";
import { MemoryStore } from "@/lib/db/memory-store";
import { checkDiff, FANTASY_PROTECTED_PATHS } from "@/lib/guard/diff-guard";
import { FakeLlmClient, MemoryUsageLog, reply } from "@/lib/llm/client";
import { createAgentNodes } from "@/lib/pipeline/agent-nodes";
import { MemorySandbox } from "@/lib/sandbox/sandbox";

const base = { ticketId: "t1", spentUsd: 0, budgetUsd: 1.5 };

const rows = Array.from({ length: 120 }, (_, i) => `  // row helper ${i}`).join("\n");
const recapView = `import React from "react";
export function RecapView() {
  return <h2>Matchday scores</h2>;
}
${rows}
function renderScoreRow(r) {
  return <tr>{r.points}</tr>;
}
`;
const repo = {
  "CLAUDE.md": "Fantasy app guide",
  "src/main.jsx": "import { RecapView } from './components/league/RecapView';",
  "src/components/league/RecapView.jsx": recapView,
  "src/components/RecapCard.jsx": "export const RecapCard = () => <div style={{ minHeight: 100 }}>card</div>;",
};
const description =
  '[Read automatically from the attached screenshot "shot.png" (file f1). The reporter did not type this; the reader can make small mistakes.]\nScreen: Recap · gw 2\nTable: Matchday scores | Click row for breakdown';
const ticket = { title: "Different size in recap window", body: `Rows have different heights.\n\n${description}` };

describe("uiStrings", () => {
  it("takes quoted text and fragments of the screenshot description, not generic words", () => {
    const s = uiStrings(`The "Save changes" button is off.\n\n${description}`);
    expect(s).toEqual(["Save changes", "Recap", "Matchday scores", "Click row for breakdown"]);
  });

  it("strips quote marks and a short label lead-in from description fragments", () => {
    const s = uiStrings(
      ['[Read automatically from the attached screenshot "a.jpg" (file f).]', "Screen: Recap", "Controls:", '- Round tabs: "1", "2"', '- Page hint top-right: "Click row for breakdown"'].join("\n"),
    );
    expect(s).toEqual(["Recap", "Click row for breakdown"]);
  });

  it("returns nothing for a report with no screen text", () => {
    expect(uiStrings("Score stuck\nStays at zero after the match")).toEqual([]);
  });
});

describe("excerptAround and outline", () => {
  it("shows the function that is named, not just the start of a long file", () => {
    const part = excerptAround(recapView, ["renderScoreRow"], 600);
    expect(part).toContain("function renderScoreRow");
    expect(part).not.toContain('import React');
    expect(part).toContain("earlier lines not shown");
  });

  it("lists functions with line numbers", () => {
    expect(outline(recapView)).toContain("renderScoreRow (line 125)");
  });

  it("returns a short file whole", () => {
    expect(excerptAround("a\nb", ["b"], 100)).toBe("a\nb");
  });
});

describe("unusedFiles", () => {
  it("flags a file no other file imports, and keeps entry points and imported files", async () => {
    const src = new MemoryCodeSource(repo);
    const dead = await unusedFiles(src, ["src/components/RecapCard.jsx", "src/components/league/RecapView.jsx", "src/main.jsx"]);
    expect([...dead]).toEqual(["src/components/RecapCard.jsx"]);
  });

  it("assumes a file is used when the source cannot search", async () => {
    const dead = await unusedFiles({ tree: async () => [], read: async () => null }, ["src/a.js"]);
    expect(dead.size).toBe(0);
  });
});

describe("locate by on-screen text", () => {
  it("puts the file that holds the screen text first and drops the unused look-alike", async () => {
    // The model picks the look-alike by name, as it did on ticket #58.
    const client = new FakeLlmClient([reply(JSON.stringify({ files: ["src/components/RecapCard.jsx"] }))]);
    const code = await locate({ ...base, client, log: new MemoryUsageLog() }, new MemoryCodeSource(repo), ticket);
    const paths = code.files.map((f) => f.path);
    expect(paths[0]).toBe("src/components/league/RecapView.jsx");
    expect(paths).not.toContain("src/components/RecapCard.jsx");
    expect(code.files[0]?.matched).toContain("Matchday scores");
    expect(code.unused).toContain("src/components/RecapCard.jsx");
    expect(client.requests[0]?.prompt).toContain("text_matches");
  });

  it("reports an unused file the model picked", async () => {
    const client = new FakeLlmClient([reply(JSON.stringify({ files: ["src/components/RecapCard.jsx"] }))]);
    const code = await locate({ ...base, client, log: new MemoryUsageLog() }, new MemoryCodeSource({ ...repo, "src/components/league/RecapView.jsx": "x" }), { title: "t", body: "b" });
    expect(code.files).toEqual([]);
    expect(code.unused).toEqual(["src/components/RecapCard.jsx"]);
  });

  it("notes which strings were searched for and where they were found", async () => {
    const client = new FakeLlmClient([reply(JSON.stringify({ files: [] }))]);
    const code = await locate({ ...base, client, log: new MemoryUsageLog() }, new MemoryCodeSource(repo), ticket);
    expect(code.searched.find((s) => s.text === "Matchday scores")?.paths).toEqual(["src/components/league/RecapView.jsx"]);
  });
});

describe("diagnose and develop with a trace", () => {
  const nodesFor = async (replies: ReturnType<typeof reply>[]) => {
    const store = new MemoryStore();
    const t = await store.create({ projectId: "p", title: ticket.title, body: ticket.body, channel: "web" });
    const client = new FakeLlmClient(replies);
    const nodes = createAgentNodes({
      store,
      client,
      log: new MemoryUsageLog(),
      sandbox: new MemorySandbox(),
      policy: { protectedPaths: [], maxChangedLines: 400 },
      budgetUsd: 1.5,
      code: new MemoryCodeSource(repo),
    });
    return { nodes, t, client };
  };

  it("puts the trace, the files and the ignored dead file into the plan", async () => {
    const { nodes, t } = await nodesFor([
      reply(JSON.stringify({ files: ["src/components/RecapCard.jsx"] })),
      reply(
        JSON.stringify({
          plan: "Give every row the same height.",
          suspectedFiles: ["src/components/RecapCard.jsx", "src/components/league/RecapView.jsx"],
          risk: "low",
          trace: 'searched "Matchday scores", found in RecapView.jsx',
          located: true,
          anchors: ["renderScoreRow"],
        }),
      ),
    ]);
    const r = await nodes.diagnose(t);
    expect(r.files).toEqual(["src/components/league/RecapView.jsx"]);
    expect(r.anchors).toEqual(["renderScoreRow"]);
    expect(r.plan).toContain("How I found it: searched");
    expect(r.plan).toContain("Ignored, not used by the app: src/components/RecapCard.jsx");
  });

  it("proposes no change when the model says it could not locate the problem", async () => {
    const { nodes, t } = await nodesFor([
      reply(JSON.stringify({ files: [] })),
      reply(JSON.stringify({ plan: "The row code is not in the files shown.", suspectedFiles: [], risk: "low", located: false })),
    ]);
    const r = await nodes.diagnose(t);
    expect(r.files).toEqual([]);
    expect(r.plan).toContain("I could not find where this lives");
  });

  it("develop fails clearly, without asking the model, when the plan names no file", async () => {
    const { nodes, t, client } = await nodesFor([]);
    const out = await nodes.develop(t);
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("names no file");
    expect(client.requests).toHaveLength(0);
  });
});

describe("protected paths", () => {
  const policy = { protectedPaths: FANTASY_PROTECTED_PATHS, maxChangedLines: 400 };
  const touch = (path: string) => checkDiff([{ path, added: 1, removed: 0 }], policy).ok;

  it("keeps scoring, sign-in and deploy files for a person", () => {
    for (const p of ["src/lib/f1/scoring.js", "src/context/AuthContext.jsx", "src/hooks/useAuth.js", "tests/unit/scoring-logic.test.js", "scripts/deploy.mjs", "Dockerfile"]) {
      expect(touch(p), p).toBe(false);
    }
  });

  it("still allows ordinary screens", () => {
    expect(touch("src/components/league/RecapView.jsx")).toBe(true);
  });
});

describe("GitHubCodeSource.search", () => {
  it("asks code search for the exact phrase in the repository and returns the paths", async () => {
    let url = "";
    const src = new GitHubCodeSource({ owner: "o", repo: "r", ref: "main" }, "tok", async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({ items: [{ path: "a.jsx" }] }), text: async () => "" };
    });
    expect(await src.search("Matchday scores")).toEqual(["a.jsx"]);
    expect(decodeURIComponent(url)).toContain('q="Matchday scores" repo:o/r');
  });
});
