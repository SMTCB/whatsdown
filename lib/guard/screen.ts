export type Verdict = "safe" | "suspicious" | "blocked";

export interface ScreenResult {
  verdict: Verdict;
  /** 0 to 1, higher is riskier. */
  score: number;
  reasons: string[];
}

/** The real implementation will call Prompt Guard 2 on Groq; this rule-based one runs locally. */
export interface Screener {
  screen(text: string): Promise<ScreenResult>;
}

interface Rule {
  id: string;
  re: RegExp;
  weight: number;
}

const RULES: Rule[] = [
  { id: "ignore_instructions", re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?)\b/i, weight: 0.7 },
  { id: "reveal_prompt", re: /\b(reveal|show|print|repeat|leak)\b[^.\n]{0,30}\b(system|hidden|secret|initial)\b[^.\n]{0,15}\b(prompt|instructions?|message)\b/i, weight: 0.6 },
  { id: "role_override", re: /\b(you are now|act as|pretend (to be|you are)|from now on you)\b/i, weight: 0.4 },
  { id: "fake_role_marker", re: /(^|\n)\s*(system|assistant|developer)\s*:/i, weight: 0.4 },
  { id: "chat_template_tokens", re: /<\|[a-z_]+\|>|\[\/?INST\]|<<SYS>>/i, weight: 0.7 },
  { id: "secrets_request", re: /\b(api[_ -]?key|secret|token|password|credentials?)\b[^.\n]{0,30}\b(send|print|show|reveal|include|output)\b|\b(send|print|show|reveal|include|output)\b[^.\n]{0,30}\b(api[_ -]?key|secrets?|tokens?|passwords?|credentials?)\b/i, weight: 0.5 },
  { id: "approval_bypass", re: /\b(skip|bypass|disable|without)\b[^.\n]{0,25}\b(review|approval|approve|guard|checks?|tests?|ci)\b/i, weight: 0.5 },
  { id: "destructive_shell", re: /\brm\s+-rf\b|\bdrop\s+(table|database)\b|\bcurl\b[^\n|]*\|\s*(ba)?sh\b/i, weight: 0.6 },
  { id: "protected_files", re: /\b(edit|modify|change|delete|push)\b[^.\n]{0,40}(\.github|migrations?|\.env|package\.json)\b/i, weight: 0.4 },
];

const SUSPICIOUS_AT = 0.4;
const BLOCKED_AT = 0.8;

export class RuleScreener implements Screener {
  async screen(text: string): Promise<ScreenResult> {
    const hits = RULES.filter((r) => r.re.test(text));
    // Independent signals compound: 1 - product of (1 - weight).
    const score = 1 - hits.reduce((p, r) => p * (1 - r.weight), 1);
    const rounded = Math.round(score * 100) / 100;
    const verdict: Verdict = rounded >= BLOCKED_AT ? "blocked" : rounded >= SUSPICIOUS_AT ? "suspicious" : "safe";
    return { verdict, score: rounded, reasons: hits.map((h) => h.id) };
  }
}
