/** Paths anyone may open: the report form, reporter status links, the sign-in page and the signed WhatsApp webhook. */
const PUBLIC = [/^\/report(\/|$)/, /^\/t\/[^/]+$/, /^\/admin\/login$/, /^\/api\/whatsapp$/, /^\/api\/cron\/retry-stalled$/];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

/** Constant-time string compare (edge-safe, no node:crypto). */
export function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const SESSION_COOKIE = "wd_admin";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function mac(password: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`whatsdown-session:${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie value `<expiry ms>.<hmac>`; changing the owner password signs everyone out. */
export async function createSession(password: string, now = Date.now()): Promise<string> {
  const expires = String(now + SESSION_DAYS * 86_400_000);
  return `${expires}.${await mac(password, expires)}`;
}

export async function verifySession(token: string | undefined, password: string, now = Date.now()): Promise<boolean> {
  if (!token || !password) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expires = token.slice(0, dot);
  if (!/^\d{10,16}$/.test(expires) || Number(expires) <= now) return false;
  return sameText(token.slice(dot + 1), await mac(password, expires));
}
