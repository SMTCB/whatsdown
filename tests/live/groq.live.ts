import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryUsageLog, runStructured } from "@/lib/llm/client";
import { groqFromEnv } from "@/lib/llm/groq";

const client = groqFromEnv();

describe.skipIf(!client)("Groq (live)", () => {
  it("answers a plain request and reports usage", async () => {
    const started = Date.now();
    const res = await client!.complete({ model: "openai/gpt-oss-20b", system: "Reply with one word.", prompt: "Say ready.", effort: "low" });
    console.log(`plain: ${res.text.length} chars, ${res.usage.inputTokens} in / ${res.usage.outputTokens} out, ${Date.now() - started} ms`);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("returns JSON that passes our schema through runStructured", async () => {
    const schema = z.object({ category: z.enum(["bug", "question", "feature"]), summary: z.string().min(3) });
    const log = new MemoryUsageLog();
    const out = await runStructured(
      { client: client!, log, ticketId: "live", spentUsd: 0, budgetUsd: 1.5 },
      "triage",
      'Classify the report. Reply with JSON only: {"category":"bug|question|feature","summary":"..."}',
      "Title: Score does not update\nBody: After the final whistle the score stays at zero.",
      schema,
    );
    console.log(`structured: category=${out.data.category}, model=${out.model}, cost=$${out.costUsd}`);
    expect(out.data.category).toBe("bug");
    expect(log.records).toHaveLength(1);
  });
});
