import { MODELS } from "./pricing";
import { RateLimitError, type LlmClient, type LlmRequest, type LlmResponse } from "./client";

/** Longest Retry-After (seconds) worth waiting for. */
const MAX_RETRY_WAIT_S = 30;
const MAX_COMPLETION_TOKENS = 3_500;
const MAX_VISION_TOKENS = 1_200;
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "status" | "json" | "text"> & { headers?: Pick<Headers, "get"> }>;

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

/** Plain text, or text plus pictures as data URLs (OpenAI-compatible vision format). */
function userContent(req: LlmRequest) {
  if (!req.images?.length) return req.prompt;
  return [
    { type: "text", text: req.prompt },
    ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${Buffer.from(i.bytes).toString("base64")}` } })),
  ];
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
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (!apiKey) throw new Error("GROQ_API_KEY is empty");
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (MODELS[req.model].provider !== "groq") throw new Error(`GroqClient cannot serve ${req.model}`);
    const body: Record<string, unknown> = {
      model: req.model,
      // Prompt Guard rejects a system message; an empty system string means "none".
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: userContent(req) }],
    };
    if (req.images?.length) body.max_completion_tokens = MAX_VISION_TOKENS;
    if (req.model.startsWith("openai/gpt-oss")) {
      if (req.effort) body.reasoning_effort = req.effort;
      // Reasoning tokens count against this cap; Groq also counts it toward the per-minute limit.
      body.max_completion_tokens = MAX_COMPLETION_TOKENS;
    }

    const send = () =>
      this.fetchFn(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    let res = await send();
    // Free-tier limits reset within a minute: wait out a short Retry-After once before falling back.
    const wait = res.status === 429 ? Number(res.headers?.get("retry-after")) : NaN;
    if (wait > 0 && wait <= MAX_RETRY_WAIT_S) {
      await this.sleep(wait * 1000);
      res = await send();
    }
    if (res.status === 429) throw new RateLimitError("Groq rate limit");
    let detail = "";
    if (!res.ok) {
      // Groq's error text names the problem (token limit, bad request); it never contains our key.
      detail = await res.text().then((t) => (JSON.parse(t) as { error?: { message?: string } }).error?.message ?? "", () => "");
      // gpt-oss sometimes answers with a tool call although none are offered; the next sample is normally fine.
      if (res.status === 400 && detail.includes("model called a tool")) {
        res = await send();
        if (res.status === 429) throw new RateLimitError("Groq rate limit");
        detail = res.ok ? "" : await res.text().then((t) => (JSON.parse(t) as { error?: { message?: string } }).error?.message ?? "", () => "");
      }
    }
    if (!res.ok) {
      throw new LlmProviderError(`Groq request failed with status ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, res.status);
    }

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
