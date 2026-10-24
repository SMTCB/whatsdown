/** Paths anyone may open: the report form, its thank-you page, and the signed WhatsApp webhook. */
const PUBLIC = [/^\/report(\/|$)/, /^\/api\/whatsapp$/];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when the Authorization header is HTTP Basic with the owner password (any user name). */
export function ownerAuthorized(header: string | null, password: string): boolean {
  if (!password || !header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    return sameText(decoded.slice(decoded.indexOf(":") + 1), password);
  } catch {
    return false;
  }
}
