import { describe, expect, it } from "vitest";
import { GitHubCodeSource } from "@/lib/code/source";
import { GitHubActionsSandbox, GitHubAppAuth } from "@/lib/sandbox/github-actions";

const appId = process.env.GITHUB_APP_ID?.trim();
const installationId = process.env.GITHUB_INSTALLATION_ID?.trim();
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
const target = { owner: "SMTCB", repo: "WCFantasyFootball", ref: "main" };

// Lands ONE harmless text file on the real default branch. Run only on purpose.
describe.skipIf(!appId || !installationId || !privateKey || !process.env.WHATSDOWN_LIVE_MERGE)("Gate 2 merge (live)", () => {
  it("pushes a branch, passes checks, opens a PR and merges it", async () => {
    const creds = { appId: appId!, installationId: installationId!, privateKey: privateKey! };
    const auth = new GitHubAppAuth(creds);
    const sandbox = new GitHubActionsSandbox(target, creds, new GitHubCodeSource(target, () => auth.token()), { auth, timeoutMs: 8 * 60_000 });
    await sandbox.apply([{ path: "whatsdown-merge-check.txt", content: "Written by the WhatsDown Gate 2 merge test. Safe to delete.\n" }]);
    const checks = await sandbox.runChecks();
    console.log(`checks passed=${checks.passed} ${checks.output}`);
    const branch = sandbox.pushedBranch!;
    sandbox.keep();
    const out = await sandbox.merge(branch, "WhatsDown merge test", "Automated Gate 2 merge test. Adds one harmless text file.");
    console.log(`merge=${JSON.stringify(out)}`);
    if (!out.merged) await sandbox.discard(branch);
    expect(checks.passed).toBe(true);
  }, 12 * 60_000);
});
