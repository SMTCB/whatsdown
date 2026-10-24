"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, createSession, sameText } from "@/lib/auth/owner";
import { AttemptLimiter } from "@/lib/auth/throttle";

export interface LoginState {
  error?: string;
}

const limiter = new AttemptLimiter();

/** Only same-site paths under /admin; anything else falls back to the ticket list. */
function safeNext(next: string): string {
  return /^\/admin(\/[\w\-./]*)?$/.test(next) && !next.startsWith("/admin/login") ? next : "/admin/tickets";
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = process.env.OWNER_PASSWORD?.trim() ?? "";
  if (!password) return { error: "Sign-in is not configured: set OWNER_PASSWORD." };
  const h = await headers();
  const who = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = limiter.retryAfter(who);
  if (wait > 0) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` };
  if (!sameText(String(formData.get("password") ?? ""), password)) {
    limiter.fail(who);
    return { error: "That password is not right." };
  }
  limiter.success(who);
  (await cookies()).set(SESSION_COOKIE, await createSession(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}
