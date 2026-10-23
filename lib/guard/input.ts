import { z } from "zod";

export const LIMITS = {
  title: { min: 3, max: 120 },
  body: { min: 10, max: 5000 },
} as const;

/** Removes control and zero-width characters that hide text from reviewers, and normalises line endings. */
export function sanitizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, "")
    .trim();
}

const clean = (min: number, max: number, tooShort: string) =>
  z.preprocess((v) => (typeof v === "string" ? sanitizeText(v) : v), z.string().min(min, tooShort).max(max, `Keep it under ${max} characters`));

export const reportInputSchema = z.object({
  title: clean(LIMITS.title.min, LIMITS.title.max, "Give the problem a short title"),
  body: clean(LIMITS.body.min, LIMITS.body.max, "Describe what happened in a sentence or two"),
});

export type ReportInput = z.infer<typeof reportInputSchema>;
