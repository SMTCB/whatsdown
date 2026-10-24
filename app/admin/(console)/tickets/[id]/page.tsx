import Link from "next/link";
import { after } from "next/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TICKET_BUDGET_USD, getAttachments, getPipeline, getStore, getUsageLog } from "@/lib/db";
import { formatSize } from "@/lib/attachments/rules";
import type { CheckReport } from "@/lib/sandbox/sandbox";
import { advance, decideGate1, MergeBlockedError, resolveGate2, type Gate1Decision, type Gate2Decision } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";
/** Approving a plan starts the Developer, the GitHub checks and QA after the response is sent. */
export const maxDuration = 300;

/** Statuses where an agent is working, so the page keeps itself fresh. */
const RUNNING = ["new", "triaged", "diagnosing", "patching", "in_qa", "merged", "notified"];

const GATE1: Gate1Decision[] = ["approve", "revise", "reject"];
const GATE2: Gate2Decision[] = ["merge", "close", "revise"];

async function gate1(decision: Gate1Decision, formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  if (!GATE1.includes(decision)) throw new Error("Invalid decision");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  await decideGate1(getStore(), id, decision, note);
  after(() => advance(getPipeline(), id).then(() => undefined));
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}

async function gate2(decision: Gate2Decision, formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  if (!GATE2.includes(decision)) throw new Error("Invalid decision");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (decision === "revise" && !note) redirect(`/admin/tickets/${id}?blocked=${encodeURIComponent("Say what to change before sending it back.")}`);
  const pipeline = getPipeline();
  try {
    await resolveGate2(pipeline, id, decision, note);
  } catch (err) {
    if (!(err instanceof MergeBlockedError)) throw err;
    redirect(`/admin/tickets/${id}?blocked=${encodeURIComponent(err.reason)}${err.url ? `&pr=${encodeURIComponent(err.url)}` : ""}`);
  }
  after(() => advance(pipeline, id).then(() => undefined));
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
}

const OUTCOME: Record<string, string> = { success: "Passed", failure: "Failed", skipped: "Skipped", cancelled: "Cancelled", unfinished: "Did not finish" };
const outcome = (c: string) => OUTCOME[c] ?? c;

const h2 = "mb-2 font-[family-name:var(--font-heading)] text-lg font-semibold";

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blocked?: string; pr?: string }> }) {
  const { id } = await params;
  const { blocked, pr } = await searchParams;
  const store = getStore();
  const ticket = await store.get(id);
  if (!ticket) notFound();
  const events = await store.events(id);
  const files = await getAttachments().list(id);
  const cost = await getUsageLog().totalFor(id);

  const latest = (key: string) => [...events].reverse().find((e) => typeof e.payload[key] === "string")?.payload[key] as string | undefined;
  const plan = latest("plan");
  const qa = [...events].reverse().find((e) => e.fromStatus === "in_qa")?.payload.summary as string | undefined;
  const question = [...events].reverse().find((e) => e.toStatus === "needs_info")?.payload.question as string | undefined;
  const checks = [...events].reverse().find((e) => e.fromStatus === "in_qa" && e.payload.checks)?.payload.checks as CheckReport | undefined;
  const error = latest("error");
  const dupId = latest("duplicateOf");
  const dupOf = dupId ? await store.get(dupId) : null;

  return (
    <div className="flex flex-col gap-5">
      {RUNNING.includes(ticket.status) && <AutoRefresh />}
      <div>
        <p className="hint">Ticket #{ticket.number}</p>
        <h1 className="mb-2 text-3xl font-semibold">{ticket.title}</h1>
        <p className="mb-3">
          Status: <span className="badge">{ticket.status.replaceAll("_", " ")}</span>{" "}
          <span className="hint">
            Virtual cost ${cost < 0.01 && cost > 0 ? cost.toFixed(4) : cost.toFixed(2)} of ${TICKET_BUDGET_USD.toFixed(2)}
          </span>
        </p>
        <p className="card whitespace-pre-wrap">{ticket.body}</p>
      </div>

      {files.length > 0 && (
        <section className="card">
          <h2 className={h2}>Attached documents</h2>
          <ul className="divide-y divide-[var(--line)]">
            {files.map((f) => (
              <li key={f.id} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <a href={`/api/attachments/${f.id}`} download>
                  {f.name}
                </a>
                <span className="hint shrink-0">{formatSize(f.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {question && ticket.status === "needs_info" && (
        <section className="card">
          <h2 className={h2}>We need more information</h2>
          <p>{question}</p>
        </section>
      )}

      {ticket.status === "closed" && events.some((e) => e.toStatus === "closed" && e.payload.screen) && (
        <p className="alert-bad">
          This report was closed automatically because it looked like an attempt to manipulate the system. If that is a mistake, rewrite it
          and submit it again.
        </p>
      )}

      {ticket.status === "duplicate" && dupOf && (
        <p className="card">
          This looks like a duplicate of <Link href={`/admin/tickets/${dupOf.id}`}>ticket #{dupOf.number}</Link>, which is already being handled.
        </p>
      )}

      {error && ticket.status === "failed" && (
        <p role="alert" className="alert-bad">
          Something went wrong: {error}
        </p>
      )}

      {plan && (
        <section className="card">
          <h2 className={h2}>Plan</h2>
          <p className="whitespace-pre-wrap">{plan}</p>
        </section>
      )}

      {qa && (
        <section className="card">
          <h2 className={h2}>QA</h2>
          <p>{qa}</p>
          {checks && checks.jobs.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold">Detailed test results</summary>
              <div className="mt-2 flex flex-col gap-3">
                {checks.jobs.map((j) => (
                  <div key={j.name}>
                    <p className="font-semibold">
                      {j.name}: <span className="badge">{outcome(j.conclusion)}</span>
                    </p>
                    <ul className="mt-1 text-[0.9375rem]">
                      {j.steps.map((s, i) => (
                        <li key={`${i}-${s.name}`} className="py-0.5">
                          {s.log ? (
                            <details open={s.conclusion === "failure"}>
                              <summary className="flex cursor-pointer justify-between gap-4">
                                <span>{s.name}</span>
                                <span className={s.conclusion === "failure" ? "font-semibold" : "text-[var(--muted)]"}>{outcome(s.conclusion)}</span>
                              </summary>
                              <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-[var(--line)] p-3 text-[0.8125rem] whitespace-pre-wrap">{s.log}</pre>
                            </details>
                          ) : (
                            <div className="flex justify-between gap-4">
                              <span>{s.name}</span>
                              <span className={s.conclusion === "failure" ? "font-semibold" : "text-[var(--muted)]"}>{outcome(s.conclusion)}</span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {ticket.status === "awaiting_plan_approval" && (
        <section className="card border-[var(--accent)] border-2">
          <h2 className={h2}>Gate 1: approve the plan?</h2>
          <p className="hint mb-3">Approve to let the Developer start, ask for a revision, or reject the plan.</p>
          <form className="flex flex-col gap-3">
            <input type="hidden" name="id" value={ticket.id} />
            <label htmlFor="note" className="label">
              Note <span className="font-normal text-[var(--muted)]">(optional; for a revision, say what to change)</span>
            </label>
            <textarea id="note" name="note" rows={2} className="field" />
            <div className="flex flex-wrap gap-2">
              <button formAction={gate1.bind(null, "approve")} className="btn btn-primary">Approve</button>
              <button formAction={gate1.bind(null, "revise")} className="btn">Revise</button>
              <button formAction={gate1.bind(null, "reject")} className="btn btn-danger">Reject</button>
            </div>
          </form>
        </section>
      )}

      {ticket.status === "awaiting_merge" && (
        <section className="card border-[var(--accent)] border-2">
          <h2 className={h2}>Gate 2: merge?</h2>
          <p className="hint mb-3">QA passed. Merging applies the change to the project. If the change is not right, send it back with a note and the Developer tries again.</p>
          {blocked && (
            <p role="alert" className="mb-3 text-[0.9375rem]">
              The merge did not go through: {blocked.slice(0, 300)}
              {pr && pr.startsWith("https://github.com/") && (
                <>
                  {" "}
                  <a className="underline" href={pr}>Open the pull request</a>
                </>
              )}
            </p>
          )}
          <form className="flex flex-col gap-3">
            <input type="hidden" name="id" value={ticket.id} />
            <label htmlFor="note2" className="label">
              Note <span className="font-normal text-[var(--muted)]">(needed to send back: say what to change)</span>
            </label>
            <textarea id="note2" name="note" rows={2} className="field" />
            <div className="flex flex-wrap gap-2">
              <button formAction={gate2.bind(null, "merge")} className="btn btn-primary">Merge</button>
              <button formAction={gate2.bind(null, "revise")} className="btn">Send back</button>
              <button formAction={gate2.bind(null, "close")} className="btn">Close without merging</button>
            </div>
          </form>
        </section>
      )}

      <p className="hint">Every merge needs your approval at Gate 2; nothing reaches the project without it.</p>

      <section>
        <h2 className={h2}>History</h2>
        <ol className="space-y-1 text-[0.9375rem]">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-[var(--muted)]">{new Date(e.createdAt).toLocaleString()}</span> · {e.actor} ·{" "}
              {e.type === "status_changed" ? `${e.fromStatus} → ${e.toStatus}` : e.type}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
