import type { LlmClient } from "@/lib/llm/client";
import { RuleScreener, type ScreenResult, type Screener, type Verdict } from "./screen";

const SUSPICIOUS_AT = 0.4;
const BLOCKED_AT = 0.8;

/**
 * Prompt Guard 2 on Groq returns the probability that the text is a prompt attack.
 * The local rules always run too; the riskier of the two wins. If the model call fails,
 * the rules alone decide, so an outage never lets a report through unscreened by rules.
 */
export class GroqScreener implements Screener {
  constructor(
    private readonly client: LlmClient,
    private readonly rules: Screener = new RuleScreener(),
  ) {}

  async screen(text: string): Promise<ScreenResult> {
    const local = await this.rules.screen(text);
    let model: number | null = null;
    try {
      const res = await this.client.complete({ model: "meta-llama/llama-prompt-guard-2-86m", system: "", prompt: text });
      const n = Number.parseFloat(res.text);
      if (Number.isFinite(n) && n >= 0 && n <= 1) model = n;
    } catch {
      // fall through to the rules
    }
    if (model === null) return { ...local, reasons: [...local.reasons, "model_unavailable"] };

    const score = Math.max(local.score, Math.round(model * 100) / 100);
    const verdict: Verdict = score >= BLOCKED_AT ? "blocked" : score >= SUSPICIOUS_AT ? "suspicious" : "safe";
    const reasons = model >= SUSPICIOUS_AT ? [...local.reasons, "prompt_guard"] : local.reasons;
    return { verdict, score, reasons };
  }
}
