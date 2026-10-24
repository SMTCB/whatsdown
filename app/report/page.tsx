import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { DEMO_PROJECT_ID, getAttachments, getPipeline, getStore } from "@/lib/db";
import { validateUploads } from "@/lib/attachments/rules";
import { reportInputSchema } from "@/lib/guard/input";
import { sameText } from "@/lib/auth/owner";
import { AttemptLimiter } from "@/lib/auth/throttle";
import { advance } from "@/lib/pipeline/runner";
import { ReportForm, type ReportState } from "./report-form";

/** Agents run after the response is sent, so the reporter is not kept waiting. */
export const maxDuration = 300;

/** The access code is read at request time, so the page must not be prerendered. */
export const dynamic = "force-dynamic";

const accessCode = () => process.env.REPORT_ACCESS_CODE?.trim() ?? "";
const codeLimiter = new AttemptLimiter(10, 10 * 60_000);

const runInBackground = (id: string) => after(() => advance(getPipeline(), id).then(() => undefined));

async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  "use server";
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  // Rejections hand the typed text back so the form can refill itself.
  const fail = (error: string): ReportState => ({ error, title, body });

  const code = accessCode();
  if (code) {
    const h = await headers();
    const who = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (codeLimiter.retryAfter(who) > 0) return fail("Too many wrong access codes. Please try again in a few minutes.");
    if (!sameText(String(formData.get("code") ?? "").trim(), code)) {
      codeLimiter.fail(who);
      return fail("That access code is not right. Ask the maintainer for the current one.");
    }
    codeLimiter.success(who);
  }

  const parsed = reportInputSchema.safeParse({ title, body });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid report");

  const picked = formData.getAll("files").filter((v): v is File => typeof v !== "string");
  const candidates = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const uploads = validateUploads(candidates);
  if (uploads.errors.length > 0) return fail(uploads.errors.join(" "));

  const ticket = await getStore().create({ projectId: DEMO_PROJECT_ID, ...parsed.data, channel: "web" });
  for (const file of uploads.accepted) await getAttachments().add(ticket.id, file);
  runInBackground(ticket.id);
  redirect(`/report/thanks?n=${ticket.number}&t=${ticket.publicToken}`);
}

export default function ReportPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-3xl font-semibold">Report a problem</h1>
      <p className="hint mb-6">Tell us what went wrong. A ticket is created and the agents take it from there.</p>
      <ReportForm action={submitReport} needsCode={accessCode() !== ""} />
    </div>
  );
}
