import { describe, expect, it } from "vitest";
import { GroqScreener } from "@/lib/guard/groq-screener";
import { FakeLlmClient, MemoryUsageLog, RateLimitError, reply } from "@/lib/llm/client";
import { liveNodes } from "@/lib/pipeline/live-nodes";

describe("GroqScreener", () => {
  const run = (text: string, ...replies: Parameters<typeof reply>[0][] | Error[]) => {
    const client = new FakeLlmClient(replies.map((r) => (r instanceof Error ? r : reply(r))));
    return { client, result: new GroqScreener(client).screen(text) };
  };

  it("passes a benign report and sends no system message", async () => {
    const { client, result } = run("The score does not update after the match.", "0.0004");
    expect(await result).toMatchObject({ verdict: "safe" });
    expect(client.requests[0]).toMatchObject({ model: "meta-llama/llama-prompt-guard-2-86m", system: "" });
  });

  it("blocks when the model sees an injection the rules miss", async () => {
    const { result } = run("Please act kindly toward the maintainers.", "0.9992");
    const r = await result;
    expect(r.verdict).toBe("blocked");
    expect(r.reasons).toContain("prompt_guard");
  });

  it("marks a mid score as suspicious", async () => {
    const { result } = run("hello there", "0.55");
    expect((await result).verdict).toBe("suspicious");
  });

  it("falls back to the rules when the model errors", async () => {
    const { result } = run("hello there", new RateLimitError("slow down"));
    const r = await result;
    expect(r.verdict).toBe("safe");
    expect(r.reasons).toContain("model_unavailable");
  });

  it("ignores a reply that is not a probability", async () => {
    const { result } = run("hello there", "not a number");
    expect((await result).reasons).toContain("model_unavailable");
  });
});

describe("liveNodes", () => {
  it("runs triage through the client and logs the usage", async () => {
    const out = { type: "bug", severity: "high", area: "scores", needsInfo: false };
    const client = new FakeLlmClient([reply(JSON.stringify(out))]);
    const log = new MemoryUsageLog();
    const nodes = liveNodes(client, log, 1.5);
    const result = await nodes.triage({ id: "t1", title: "Score stuck", body: "Stays at zero" } as never);
    expect(result).toMatchObject({ type: "bug", severity: "high" });
    expect(log.records).toHaveLength(1);
    expect(client.requests[0]?.model).toBe("openai/gpt-oss-20b");
  });
});
