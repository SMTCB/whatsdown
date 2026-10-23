import { redirect } from "next/navigation";
import { DEMO_PROJECT_ID, getAttachments, getPipeline, getStore } from "@/lib/db";
import { ACCEPT, ATTACH_LIMITS, validateUploads } from "@/lib/attachments/rules";
import { LIMITS, reportInputSchema } from "@/lib/guard/input";
import { advance } from "@/lib/pipeline/runner";

function fail(message: string): never {
  redirect(`/report?error=${encodeURIComponent(message)}`);
}

async function submitReport(formData: FormData) {
  "use server";
  const parsed = reportInputSchema.safeParse({ title: formData.get("title"), body: formData.get("body") });
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Invalid report");

  const picked = formData.getAll("files").filter((v): v is File => typeof v !== "string");
  const candidates = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const uploads = validateUploads(candidates);
  if (uploads.errors.length > 0) fail(uploads.errors.join(" "));

  const ticket = await getStore().create({ projectId: DEMO_PROJECT_ID, ...parsed.data, channel: "web" });
  for (const file of uploads.accepted) await getAttachments().add(ticket.id, file);
  await advance(getPipeline(), ticket.id);
  redirect(`/tickets/${ticket.id}`);
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const maxMb = ATTACH_LIMITS.maxBytes / 1024 / 1024;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-3xl font-semibold">Report a problem</h1>
      <p className="hint mb-6">Tell us what went wrong. A ticket is created and the agents take it from there.</p>
      {error && (
        <p id="form-error" role="alert" className="alert-bad mb-4">
          {error}
        </p>
      )}
      <form action={submitReport} className="card flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="label">
            Title
          </label>
          <input id="title" name="title" required maxLength={LIMITS.title.max} className="field" aria-describedby="title-hint" />
          <p id="title-hint" className="hint">
            A short summary, for example “Score does not update after a match”.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="body" className="label">
            What happened?
          </label>
          <textarea id="body" name="body" required rows={6} maxLength={LIMITS.body.max} className="field" aria-describedby="body-hint" />
          <p id="body-hint" className="hint">
            What you did, what you expected and what you saw instead.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="files" className="label">
            Documents <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept={ACCEPT}
            aria-describedby="files-hint"
            className="field cursor-pointer border-dashed bg-[var(--bg)] p-3 file:mr-4 file:min-h-10 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-4 file:font-semibold file:text-white"
          />
          <p id="files-hint" className="hint">
            Screenshots, PDFs, Word documents or text logs. Up to {ATTACH_LIMITS.maxFiles} files, {maxMb} MB each. Files are stored with the ticket and are never read by the agents.
          </p>
        </div>
        <button type="submit" className="btn btn-primary self-start">
          Send report
        </button>
      </form>
    </div>
  );
}
