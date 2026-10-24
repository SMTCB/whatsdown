import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getPipeline, getStore } from "@/lib/db";
import { AttemptLimiter } from "@/lib/auth/throttle";
import { transition } from "@/lib/db/transition";
import { PUBLIC_STEPS, publicStatus } from "@/lib/domain/public-status";
import { AutoRefresh } from "@/components/auto-refresh";
import { advance } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";
/** A reply re-runs triage (and diagnosis) after the response is sent. */
export const maxDuration = 300;

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN = /^[a-f0-9]{32,128}$/;
const limiter = new AttemptLimiter(20, 10 * 60_000);

async function reply(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) notFound();
  const text = String(formData.get("reply") ?? "").trim().slice(0, 2000);
  if (limiter.retryAfter(token) > 0) redirect(`/t/${token}?e=wait`);
  limiter.fail(token);
  const store = getStore();
  const ticket = await store.getByToken(token);
  if (!ticket) notFound();
  if (!text) redirect(`/t/${token}?e=empty`);
  if (ticket.status === "needs_info") {
    await store.appendDetails(ticket.id, text);
    await transition(store, ticket.id, "new", "reporter", "reporter replied", { reply: text });
    after(() => advance(getPipeline(), ticket.id).then(() => undefined));
  }
  revalidatePath(`/t/${token}`);
  redirect(`/t/${token}?sent=1`);
}

const h2 = "mb-2 font-[family-name:var(--font-heading)] text-lg font-semibold";

export default async function StatusPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string; sent?: string }> }) {
  const { token } = await params;
  const { e, sent } = await searchParams;
  if (!TOKEN.test(token)) notFound();
  const store = getStore();
  const ticket = await store.getByToken(token);
  if (!ticket) notFound();
  const events = await store.events(ticket.id);
  const s = publicStatus(ticket.status, events.some((ev) => ev.toStatus === "merged"));
  const question = [...events].reverse().find((ev) => ev.toStatus === "needs_info")?.payload.question as string | undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <p className="hint">Ticket #{ticket.number}</p>
        <h1 className="mb-2 text-3xl font-semibold">{ticket.title}</h1>
        <p className="mb-3">
          Status: <span className="badge">{s.label}</span>
        </p>
        <p>{s.message}</p>
      </div>

      {!s.done && ticket.status !== "needs_info" && <AutoRefresh />}

      <ol aria-label="Progress" className="grid grid-cols-4 gap-2 text-center text-[0.8125rem]">
        {PUBLIC_STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i + 1 === s.step ? "step" : undefined}
            className={`rounded-md border px-1 py-2 ${i + 1 <= s.step ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-[var(--line)] text-[var(--muted)]"}`}
          >
            {name}
          </li>
        ))}
      </ol>

      {sent && (
        <p role="status" className="card">
          Thank you. Your answer was sent and we are looking at it again.
        </p>
      )}
      {e === "empty" && (
        <p role="alert" className="alert-bad">
          Please write an answer first.
        </p>
      )}
      {e === "wait" && (
        <p role="alert" className="alert-bad">
          Too many answers in a short time. Please try again in a few minutes.
        </p>
      )}

      {ticket.status === "needs_info" && (
        <section className="card border-2 border-[var(--accent)]">
          <h2 className={h2}>We need more information</h2>
          <p className="mb-3">{question ?? "Could you describe what you expected to happen and what happened instead?"}</p>
          <form action={reply} className="flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <label htmlFor="reply" className="label">
              Your answer
            </label>
            <textarea id="reply" name="reply" rows={4} required maxLength={2000} className="field" />
            <button type="submit" className="btn btn-primary self-start">
              Send answer
            </button>
          </form>
        </section>
      )}

      <section>
        <h2 className={h2}>Your report</h2>
        <p className="card whitespace-pre-wrap">{ticket.body}</p>
      </section>
      <p className="hint">Keep this link private. Anyone who has it can see this report.</p>
    </div>
  );
}
