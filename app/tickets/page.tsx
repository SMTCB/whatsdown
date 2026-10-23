import Link from "next/link";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const tickets = (await getStore().list()).sort((a, b) => b.number - a.number);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-semibold">Tickets</h1>
      {tickets.length === 0 ? (
        <div className="card text-center">
          <p className="hint mb-3">No tickets yet.</p>
          <Link href="/report" className="btn btn-primary !text-white no-underline">
            Report a problem
          </Link>
        </div>
      ) : (
        <ul className="card divide-y divide-[var(--line)] !p-0">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/tickets/${t.id}`} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 !text-[var(--ink)] no-underline hover:bg-[var(--subtle)]">
                <span>
                  <span className="mr-2 text-[var(--muted)]">#{t.number}</span>
                  {t.title}
                </span>
                <span className="badge shrink-0">{t.status.replaceAll("_", " ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
