export type Provider = "groq" | "anthropic";

export interface ModelInfo {
  provider: Provider;
  model: string;
  /** USD per million tokens */
  inputPerM: number;
  outputPerM: number;
  /** Fraction of the input price charged for cached input tokens. Assumption: verify against real usage. */
  cacheReadFactor: number;
}

// Prices are placeholders to be checked against the provider price pages before real use.
// Groq models run on the free tier, so nothing is billed. The prices below are Groq's list prices, used as a
// virtual cost so each ticket still shows what it would cost on a paid plan. Check them against the Groq price page.
export const MODELS = {
  "claude-opus-5-5": { provider: "anthropic", model: "claude-opus-5-5", inputPerM: 4, outputPerM: 20, cacheReadFactor: 0.1 },
  "claude-sonnet-5-5": { provider: "anthropic", model: "claude-sonnet-5-5", inputPerM: 2, outputPerM: 10, cacheReadFactor: 0.1 },
  "claude-haiku-5-5": { provider: "anthropic", model: "claude-haiku-5-5", inputPerM: 0.1, outputPerM: 0.5, cacheReadFactor: 0.1 },
  "openai/gpt-oss-20b": { provider: "groq", model: "openai/gpt-oss-20b", inputPerM: 0.075, outputPerM: 0.3, cacheReadFactor: 1 },
  "openai/gpt-oss-120b": { provider: "groq", model: "openai/gpt-oss-120b", inputPerM: 0.15, outputPerM: 0.6, cacheReadFactor: 1 },
  "qwen/qwen3.8-27b": { provider: "groq", model: "qwen/qwen3.8-27b", inputPerM: 0.29, outputPerM: 0.59, cacheReadFactor: 1 },
  "meta-llama/llama-prompt-guard-2-86m": { provider: "groq", model: "meta-llama/llama-prompt-guard-2-86m", inputPerM: 0, outputPerM: 0, cacheReadFactor: 1 },
  "whisper-large-v3-turbo": { provider: "groq", model: "whisper-large-v3-turbo", inputPerM: 0, outputPerM: 0, cacheReadFactor: 1 },
} as const satisfies Record<string, ModelInfo>;

export type ModelId = keyof typeof MODELS;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

/** Cost in USD. `inputTokens` is the non-cached input; cached tokens are billed at a discount. */
export function costUsd(model: ModelId, usage: Usage): number {
  const m: ModelInfo = MODELS[model];
  const cached = usage.cacheReadTokens ?? 0;
  const cost =
    (usage.inputTokens * m.inputPerM +
      cached * m.inputPerM * m.cacheReadFactor +
      usage.outputTokens * m.outputPerM) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
