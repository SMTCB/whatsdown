import { describe, expect, it } from "vitest";
import { GitHubCodeSource } from "@/lib/code/source";
import { MemoryStore } from "@/lib/db/memory-store";
import { MemoryUsageLog, type LlmClient } from "@/lib/llm/client";
import { groqFromEnv } from "@/lib/llm/groq";
import { GroqScreener } from "@/lib/guard/groq-screener";
import { advance, decideGate1 } from "@/lib/pipeline/runner";
import { liveNodes } from "@/lib/pipeline/live-nodes";
import { GitHubActionsSandbox, GitHubAppAuth } from "@/lib/sandbox/github-actions";

const client = groqFromEnv();
const appId = process.env.GITHUB_APP_ID?.trim();
const installationId = process.env.GITHUB_INSTALLATION_ID?.trim();
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
const target = { owner: "SMTCB", repo: "WCFantasyFootball", ref: "main" };

describe.skipIf(!client || !appId || !installationId || !privateKey)("Full ticket (live: Groq + fantasy repo + GitHub Actions)", () => {
  it("takes a report to a checked patch and stops before any merge", async () => {
    const creds = { appId: appId!, installationId: installationId!, privateKey: privateKey! };
    const auth = new GitHubAppAuth(creds);
    const code = new GitHubCodeSource(target, () => auth.token());
    const sandbox = new GitHubActionsSandbox(target, creds, code, { timeoutMs: 8 * 60_000, auth });
    const store = new MemoryStore();
    const log = new MemoryUsageLog();
    const spy: LlmClient = {
      complete: async (r) => {
        const o = await client!.complete(r);
        console.log(`[${r.model}] prompt=${r.prompt.length}c reply=${o.text.length}c tokens=${o.usage.outputTokens} tail=${JSON.stringify(o.text.slice(-80))}`);
        return o;
      },
    };
    const nodes = liveNodes({ store, client: spy, log, budgetUsd: 1.5, code, sandbox });
    const deps = { store, nodes, screener: new GroqScreener(client!) };
    const trail: string[] = [];
    try {
      const t = await store.create({
        projectId: "forza-fantasy-league",
        channel: "web",
        title: "Recap screen shows too many decimals",
        body: "On the Recap screen the points are shown like 12.3333333 instead of rounded to one decimal place. It looks messy on my phone.",
      });
      let ticket = await advance(deps, t.id);
      trail.push(ticket.status);
      if (ticket.status === "awaiting_plan_approval") {
        ticket = await decideGate1(store, t.id, "approve");
        ticket = await advance(deps, t.id);
        trail.push(ticket.status);
      }
      const events = await store.events(t.id);
      for (const e of events) trail.push(`${e.fromStatus ?? "-"} -> ${e.toStatus}: ${e.type}`);
      const last = events.at(-1);
      console.log(`final=${ticket.status} branch=${sandbox.pushedBranch ?? "none"} cost=$${log.totalFor(t.id)}\n${trail.join("\n")}\nlast payload: ${JSON.stringify(last?.payload ?? {}).slice(0, 600)}`);
      expect(["awaiting_merge", "failed"]).toContain(ticket.status);
    } finally {
      await sandbox.reset();
    }
  }, 20 * 60_000);
});
