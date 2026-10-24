import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/db";
import { sameText } from "@/lib/auth/owner";
import { recoverStalled } from "@/lib/pipeline/recover";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called on a schedule (GitHub Actions, Vercel cron). Runs again any ticket whose pipeline run died. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) return new NextResponse("CRON_SECRET is not set", { status: 503 });
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!sameText(given, secret)) return new NextResponse("Unauthorized", { status: 401 });
  const outcomes = await recoverStalled(getPipeline());
  return NextResponse.json({ checked: new Date().toISOString(), outcomes });
}
