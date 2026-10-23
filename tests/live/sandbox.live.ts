import { describe, expect, it } from "vitest";
import { GitHubCodeSource } from "@/lib/code/source";
import { GitHubActionsSandbox } from "@/lib/sandbox/github-actions";

const appId = process.env.GITHUB_APP_ID?.trim();
const installationId = process.env.GITHUB_INSTALLATION_ID?.trim();
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
const target = { owner: "SMTCB", repo: "WCFantasyFootball", ref: "main" };

describe.skipIf(!appId || !installationId || !privateKey)("GitHub Actions sandbox (live, fantasy repo)", () => {
  it("pushes a throwaway branch, waits for the checks and cleans up", async () => {
    const sandbox = new GitHubActionsSandbox(
      target,
      { appId: appId!, installationId: installationId!, privateKey: privateKey! },
      new GitHubCodeSource(target),
      { timeoutMs: 8 * 60_000 },
    );
    try {
      // A new, harmless text file: nothing in the app imports it.
      await sandbox.apply([{ path: "whatsdown-live-check.txt", content: "WhatsDown sandbox check. Safe to delete.\n" }]);
      const result = await sandbox.runChecks();
      console.log(`branch=${sandbox.pushedBranch} passed=${result.passed}\n${result.output}`);
      expect(sandbox.pushedBranch).toMatch(/^whatsdown\//);
      expect(result.output.length).toBeGreaterThan(0);
    } finally {
      await sandbox.reset();
    }
  }, 10 * 60_000);
});
