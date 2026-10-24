import { matchesAny } from "./glob";

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  /** Added lines only, used for the secret scan. */
  addedText?: string;
}

export interface GuardPolicy {
  protectedPaths: readonly string[];
  maxChangedLines: number;
}

export type GuardViolation =
  | { code: "protected_path"; path: string }
  | { code: "too_large"; changed: number; limit: number }
  | { code: "secret"; path: string; rule: string }
  | { code: "empty" };

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
}

/** Files the Developer agent may never touch, whatever the project says. The app itself adds the BACKLOG.md entry. */
export const ALWAYS_BLOCKED = ["BACKLOG.md", ".env", ".env.*", "**/.env", "**/.env.*"];

const SECRET_RULES: { rule: string; re: RegExp }[] = [
  { rule: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { rule: "anthropic_key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: "groq_key", re: /gsk_[A-Za-z0-9]{20,}/ },
  { rule: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { rule: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

export function checkDiff(files: readonly ChangedFile[], policy: GuardPolicy): GuardResult {
  const violations: GuardViolation[] = [];
  if (files.length === 0) violations.push({ code: "empty" });

  const blocked = [...policy.protectedPaths, ...ALWAYS_BLOCKED];
  for (const f of files) {
    if (matchesAny(f.path, blocked)) violations.push({ code: "protected_path", path: f.path });
    if (f.addedText) {
      for (const { rule, re } of SECRET_RULES) {
        if (re.test(f.addedText)) violations.push({ code: "secret", path: f.path, rule });
      }
    }
  }

  const changed = files.reduce((n, f) => n + f.added + f.removed, 0);
  if (changed > policy.maxChangedLines) {
    violations.push({ code: "too_large", changed, limit: policy.maxChangedLines });
  }
  return { ok: violations.length === 0, violations };
}

/** The fantasy repo's rules from its CLAUDE.md and the plan. */
export const FANTASY_PROTECTED_PATHS = [
  "supabase/migrations/**",
  "supabase/functions/**",
  ".github/**",
  "package.json",
  "package-lock.json",
  "ios/**",
  "android/**",
  "middleware.js",
  "vercel.json",
  "capacitor.config.ts",
  "Dockerfile",
  "docker-compose.yml",
  "infra/**",
  "scripts/**",
  "e2e/**",
  "playwright.config.js",
  // Scoring and sign-in: a wrong change here costs real points or locks people out, so a person makes it.
  "src/lib/**/scoring*",
  "tests/unit/*scoring*",
  "src/context/AuthContext.jsx",
  "src/hooks/useAuth.js",
  "src/screens/AuthScreen.jsx",
] as const;
