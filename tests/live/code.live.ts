import { describe, expect, it } from "vitest";
import { diagnose } from "@/lib/agents/diagnose";
import { locate } from "@/lib/code/locate";
import { GitHubCodeSource } from "@/lib/code/source";
import { MemoryUsageLog } from "@/lib/llm/client";
import { groqFromEnv } from "@/lib/llm/groq";

const client = groqFromEnv();

describe.skipIf(!client)("Code retrieval (live, public fantasy repo)", () => {
  it("finds files for a report and drafts a plan from them", async () => {
    const source = new GitHubCodeSource({ owner: "SMTCB", repo: "WCFantasyFootball", ref: "main" }, process.env.GITHUB_READ_TOKEN || undefined);
    const ctx = { client: client!, log: new MemoryUsageLog(), ticketId: "live", spentUsd: 0, budgetUsd: 1.5 };
    const ticket = { title: "Captain points are not doubled", body: "I picked a captain in my squad but after the match day my points total only counted him once." };
    const code = await locate(ctx, source, ticket, { type: "bug", area: "scoring" });
    console.log(`located: ${code.files.map((f) => f.path).join(", ") || "(none)"}`);
    expect(code.files.length).toBeGreaterThan(0);
    const plan = await diagnose(ctx, ticket, { type: "bug", severity: "medium", area: "scoring" }, undefined, code);
    console.log(`plan files: ${plan.suspectedFiles.join(", ")} | risk=${plan.risk} | plan chars=${plan.plan.length}`);
    expect(plan.plan.length).toBeGreaterThan(20);
  });
});
