import { describe, expect, it } from "vitest";
import { RateLimitError } from "@/lib/llm/client";
import { GroqClient, LlmProviderError, groqFromEnv } from "@/lib/llm/groq";

const ok = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const SECRET = "gsk_test_secret_value";

describe("GroqClient", () => {
  it("maps a chat reply to text and usage, splitting cached tokens", async () => {
    let seen: { headers: Record<string, string>; body: string } | undefined;
    const client = new GroqClient(SECRET, async (_url, init) => {
      seen = init;
      return ok({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } })();
    });
    const res = await client.complete({ model: "openai/gpt-oss-20b", system: "s", prompt: "p", effort: "low" });
    expect(res).toEqual({ text: "hi", usage: { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40 } });
    expect(seen?.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(seen!.body)).toMatchObject({ model: "openai/gpt-oss-20b", reasoning_effort: "low" });
  });

  it("turns a 429 into RateLimitError so the router can fall back", async () => {
    const client = new GroqClient(SECRET, ok({}, 429));
    await expect(client.complete({ model: "openai/gpt-oss-20b", system: "s", prompt: "p" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("resends once when gpt-oss answers with a tool call nobody asked for", async () => {
    const replies = [
      ok({ error: { message: "Tool choice is none, but model called a tool" } }, 400),
      ok({ choices: [{ message: { content: "fine" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    ];
    let calls = 0;
    const client = new GroqClient(SECRET, async () => replies[calls++]!());
    expect((await client.complete({ model: "openai/gpt-oss-120b", system: "s", prompt: "p" })).text).toBe("fine");
    expect(calls).toBe(2);
  });

  it("raises the temperature on the resend, since temperature 0 would repeat the same answer", async () => {
    const temps: unknown[] = [];
    const replies = [ok({ error: { message: "Tool choice is none, but model called a tool" } }, 400), ok({ choices: [{ message: { content: "fine" } }] })];
    let calls = 0;
    const client = new GroqClient(SECRET, async (_url, init) => {
      temps.push(JSON.parse(String((init as { body: string }).body)).temperature);
      return replies[calls++]!();
    });
    await client.complete({ model: "openai/gpt-oss-120b", system: "s", prompt: "p" });
    expect(temps).toEqual([0, 0.4]);
  });

  it("gives up if the answers stay bad requests", async () => {
    let calls = 0;
    const client = new GroqClient(SECRET, async () => {
      calls++;
      return ok({ error: { message: "Tool choice is none, but model called a tool" } }, 400)();
    });
    await expect(client.complete({ model: "openai/gpt-oss-120b", system: "s", prompt: "p" })).rejects.toBeInstanceOf(LlmProviderError);
    expect(calls).toBe(3);
  });

  it("never puts the key in an error message", async () => {
    const client = new GroqClient(SECRET, ok({ error: SECRET }, 401));
    const err = await client.complete({ model: "openai/gpt-oss-20b", system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(String(err.message)).not.toContain(SECRET);
    expect(err.status).toBe(401);
  });

  it("rejects non-Groq models and empty keys", async () => {
    const client = new GroqClient(SECRET, ok({}));
    await expect(client.complete({ model: "claude-haiku-5-5", system: "s", prompt: "p" })).rejects.toThrow(/cannot serve/);
    expect(() => new GroqClient("")).toThrow();
  });

  it("groqFromEnv returns null without a key", () => {
    expect(groqFromEnv({})).toBeNull();
    expect(groqFromEnv({ GROQ_API_KEY: "  " })).toBeNull();
    expect(groqFromEnv({ GROQ_API_KEY: SECRET })).toBeInstanceOf(GroqClient);
  });
});
