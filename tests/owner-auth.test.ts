import { describe, expect, it } from "vitest";
import { SESSION_DAYS, createSession, isPublicPath, verifySession } from "@/lib/auth/owner";
import { AttemptLimiter } from "@/lib/auth/throttle";

describe("public paths", () => {
  it("leaves only the report flow, status links, sign-in and the WhatsApp webhook public", () => {
    for (const p of ["/report", "/report/thanks", "/t/abc123", "/admin/login", "/api/whatsapp"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/admin", "/admin/tickets", "/admin/tickets/abc", "/admin/login/x", "/api/attachments/x", "/reports", "/t", "/t/a/b", "/api/whatsapp/x"]) expect(isPublicPath(p)).toBe(false);
  });
});

describe("owner session", () => {
  const now = Date.UTC(2026, 0, 1);
  const day = 86_400_000;

  it("accepts a fresh cookie signed with the password", async () => {
    expect(await verifySession(await createSession("s3cret", now), "s3cret", now + 1000)).toBe(true);
  });

  it("expires after the session length", async () => {
    const token = await createSession("s3cret", now);
    expect(await verifySession(token, "s3cret", now + SESSION_DAYS * day - 1000)).toBe(true);
    expect(await verifySession(token, "s3cret", now + SESSION_DAYS * day + 1)).toBe(false);
  });

  it("rejects other passwords, tampering and junk", async () => {
    const token = await createSession("s3cret", now);
    expect(await verifySession(token, "other", now)).toBe(false);
    const [exp, sig] = token.split(".");
    expect(await verifySession(`${Number(exp) + day}.${sig}`, "s3cret", now)).toBe(false);
    for (const bad of [undefined, "", "abc", ".abc", "123.", "x.y"]) expect(await verifySession(bad, "s3cret", now)).toBe(false);
    expect(await verifySession(token, "", now)).toBe(false);
  });
});

describe("AttemptLimiter", () => {
  it("locks a key after too many failures, then releases it", () => {
    const l = new AttemptLimiter(3, 60_000);
    for (let i = 0; i < 2; i++) l.fail("ip", 0);
    expect(l.retryAfter("ip", 0)).toBe(0);
    l.fail("ip", 0);
    expect(l.retryAfter("ip", 1000)).toBe(59);
    expect(l.retryAfter("other", 1000)).toBe(0);
    expect(l.retryAfter("ip", 60_001)).toBe(0);
  });

  it("forgets failures after a success", () => {
    const l = new AttemptLimiter(2, 60_000);
    l.fail("ip", 0);
    l.success("ip");
    l.fail("ip", 0);
    expect(l.retryAfter("ip", 0)).toBe(0);
  });
});
