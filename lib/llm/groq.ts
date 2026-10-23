import { MODELS } from "./pricing";
import { RateLimitError, type LlmClient, type LlmRequest, type LlmResponse } from "./client";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

interface ChatReply {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** Groq chat completions (OpenAI-compatible). The key is only ever sent in the Authorization header and never put in an error. */
export class GroqClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 30_000,
  ) {
    if (!apiKey) throw new Error("GROQ_API_KEY is empty");
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (MODELS[req.model].provider !== "groq") throw new Error(`GroqClient cannot serve ${req.model}`);
    const body: Record<string, unknown> = {
      model: req.model,
      // Prompt Guard rejects a system message; an empty system string means "none".
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }],
    };
    if (req.model.startsWith("openai/gpt-oss") && req.effort) body.reasoning_effort = req.effort;

    const res = await this.fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429) throw new RateLimitError("Groq rate limit");
    if (!res.ok) throw new LlmProviderError(`Groq request failed with status ${res.status}`, res.status);

    const data = (await res.json()) as ChatReply;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new LlmProviderError("Groq reply had no text");
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text,
      usage: {
        inputTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
        outputTokens: data.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
      },
    };
  }
}

/** Reads GROQ_API_KEY from the environment; returns null when it is not set. */
export function groqFromEnv(env: Record<string, string | undefined> = process.env): GroqClient | null {
  const key = env.GROQ_API_KEY?.trim();
  return key ? new GroqClient(key) : null;
}
