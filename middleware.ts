import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, ownerAuthorized } from "@/lib/auth/owner";

/** Everything except the report form and WhatsApp webhook needs the owner password. */
export function middleware(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();
  const password = process.env.OWNER_PASSWORD?.trim() ?? "";
  // Without a password the owner pages stay open for local development only.
  if (!password && process.env.NODE_ENV !== "production") return NextResponse.next();
  if (ownerAuthorized(req.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Owner sign-in required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="WhatsDown owner", charset="UTF-8"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
