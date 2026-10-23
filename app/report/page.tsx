import { redirect } from "next/navigation";
import { DEMO_PROJECT_ID, getAttachments, getPipeline, getStore } from "@/lib/db";
import { validateUploads } from "@/lib/attachments/rules";
import { reportInputSchema } from "@/lib/guard/input";
import { advance } from "@/lib/pipeline/runner";
import { ReportForm, type ReportState } from "./report-form";

async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  "use server";
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  // Rejections hand the typed text back so the form can refill itself.
  const fail = (error: string): ReportState => ({ error, title, body });

  const parsed = reportInputSchema.safeParse({ title, body });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid report");

  const picked = formData.getAll("files").filter((v): v is File => typeof v !== "string");
  const candidates = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const uploads = validateUploads(candidates);
  if (uploads.errors.length > 0) return fail(uploads.errors.join(" "));

  const ticket = await getStore().create({ projectId: DEMO_PROJECT_ID, ...parsed.data, channel: "web" });
  for (const file of uploads.accepted) await getAttachments().add(ticket.id, file);
  await advance(getPipeline(), ticket.id);
  redirect(`/tickets/${ticket.id}`);
}

export default function ReportPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-3xl font-semibold">Report a problem</h1>
      <p className="hint mb-6">Tell us what went wrong. A ticket is created and the agents take it from there.</p>
      <ReportForm action={submitReport} />
    </div>
  );
}
