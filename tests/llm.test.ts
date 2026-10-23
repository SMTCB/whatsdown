import { describe, expect, it } from "vitest";
import { costUsd } from "@/lib/llm/pricing";
import { BudgetExceededError, assertWithinBudget, budgetState, routeFor } from "@/lib/llm/router";

describe("pricing", () => {
  it("prices Opus 5.5 at $4 in / $20 out per million", () => {
    expect(costUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBe(6);
  });
  it("charges cached input at a discount", () => {
    expect(costUsd("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.4);
  });
  it("treats Groq models as free", () => {
    expect(costUsd("openai/gpt-oss-20b", { inputTokens: 5_000_000, outputTokens: 5_000_000 })).toBe(0);
  });
});

describe("router", () => {
  it("uses the plan's default routing", () => {
    expect(routeFor("triage").primary).toBe("openai/gpt-oss-20b");
    expect(routeFor("diagnose")).toMatchObject({ primary: "claude-opus-5-5", effort: "high" });
  });
  it("lets settings override a task (S6 Sonnet experiment)", () => {
    expect(routeFor("develop", { develop: { primary: "claude-sonnet-5-5" } }).primary).toBe("claude-sonnet-5-5");
  });
  it("rejects unknown models", () => {
    expect(() => routeFor("triage", { triage: { primary: "nope" as never } })).toThrow(/Unknown model/);
  });
});

describe("budget", () => {
  it("warns at 80% and stops at 100%", () => {
    expect(budgetState(1.19, 1.5)).toBe("ok");
    expect(budgetState(1.2, 1.5)).toBe("warn");
    expect(budgetState(1.5, 1.5)).toBe("exceeded");
    expect(() => assertWithinBudget(1.5, 1.5)).toThrow(BudgetExceededError);
  });
});
