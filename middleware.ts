import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isPublicPath, verifySession } from "@/lib/auth/owner";

/** Everything except the report form, reporter status links and the WhatsApp webhook and the secret-protected cron endpoint needs the owner session. */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const password = process.env.OWNER_PASSWORD?.trim() ?? "";
  // Without a password the owner pages stay open for local development only.
  if (!password && process.env.NODE_ENV !== "production") return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, password)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return new NextResponse("Owner sign-in required", { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
