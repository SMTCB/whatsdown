import { describe, expect, it } from "vitest";
import { isPublicPath, ownerAuthorized } from "@/lib/auth/owner";

const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

describe("owner access", () => {
  it("leaves only the report flow and the WhatsApp webhook public", () => {
    for (const p of ["/report", "/report/thanks", "/api/whatsapp"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/tickets", "/tickets/abc", "/dashboard", "/api/attachments/x", "/reports", "/api/whatsapp/x"]) expect(isPublicPath(p)).toBe(false);
  });

  it("accepts the right password with any user name", () => {
    expect(ownerAuthorized(basic("me", "s3cret"), "s3cret")).toBe(true);
    expect(ownerAuthorized(basic("", "s3cret"), "s3cret")).toBe(true);
    expect(ownerAuthorized(basic("me", "pa:ss"), "pa:ss")).toBe(true);
  });

  it("rejects wrong, missing, malformed or unset passwords", () => {
    expect(ownerAuthorized(basic("me", "nope"), "s3cret")).toBe(false);
    expect(ownerAuthorized(null, "s3cret")).toBe(false);
    expect(ownerAuthorized("Bearer s3cret", "s3cret")).toBe(false);
    expect(ownerAuthorized("Basic %%%", "s3cret")).toBe(false);
    expect(ownerAuthorized(basic("me", ""), "")).toBe(false);
  });
});
