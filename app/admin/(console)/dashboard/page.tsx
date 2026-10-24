import Link from "next/link";
import { TICKET_BUDGET_USD, getStore, getUsageLog } from "@/lib/db";
import { summarize } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;
const BUDGET_STYLE = { ok: "text-[var(--muted)]", warn: "text-[var(--warn)] font-semibold", exceeded: "text-[var(--bad)] font-semibold" } as const;

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card">
      <div className="font-[family-name:var(--font-heading)] text-3xl font-semibold">{value}</div>
      <div className="font-semibold">{label}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const store = getStore();
  const tickets = await store.list();
  const events = new Map(await Promise.all(tickets.map(async (t) => [t.id, await store.events(t.id)] as const)));
  const stats = summarize(tickets, events, getUsageLog().records, TICKET_BUDGET_USD);

  return (
    <div>
      <h1 className="mb-6 text-3xl font-semibold">Dashboard</h1>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Waiting on you" value={stats.waitingOnOwner} hint="plan or merge decisions" />
        <Stat label="Waiting on reporter" value={stats.waitingOnReporter} hint="needs more information" />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="Done" value={stats.done} hint={`${stats.failed} failed`} />
      </div>

      <p className="mb-3">
        Total AI spend: <strong>{usd(stats.totalSpendUsd)}</strong>{" "}
        <span className="hint">(budget {usd(TICKET_BUDGET_USD)} per ticket; demo mode makes no model calls)</span>
      </p>

      {stats.rows.length === 0 ? (
        <div className="card text-center">
          <p className="hint mb-3">No tickets yet. Activity shows up here once a problem is reported.</p>
          <Link href="/report" className="btn btn-primary !text-white no-underline">
            Report a problem
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[34rem] text-left">
            <caption className="sr-only">Tickets with status, spend and QA retries</caption>
            <thead className="border-b border-[var(--line)] bg-[var(--subtle)] text-sm text-[var(--muted)]">
              <tr>
                <th scope="col" className="px-3 py-2">Ticket</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Spend</th>
                <th scope="col" className="px-3 py-2">QA retries</th>
                <th scope="col" className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {stats.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/tickets/${r.id}`}>#{r.number}</Link> {r.title}
                  </td>
                  <td className="px-3 py-2">{r.status.replaceAll("_", " ")}</td>
                  <td className={`px-3 py-2 ${BUDGET_STYLE[r.budget]}`}>
                    {usd(r.costUsd)}
                    {r.budget !== "ok" && ` (${r.budget})`}
                  </td>
                  <td className="px-3 py-2">{r.qaRetries}</td>
                  <td className="px-3 py-2">{r.flaggedByScreening ? "flagged by screening" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
