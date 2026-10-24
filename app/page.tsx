import Link from "next/link";
import { Shell } from "@/components/shell";

/** The front door: reporters and the owner go to different places, so ask rather than guess. */
export default function Home() {
  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-3xl font-semibold">Welcome to WhatsDown</h1>
        <p className="hint mb-6">Who are you today?</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="card">
            <h2 className="mb-1 text-xl font-semibold">Reporter</h2>
            <p className="hint mb-4">Something is broken or could be better. No account needed.</p>
            <Link href="/report" className="btn btn-primary !text-white no-underline">
              Report a problem
            </Link>
          </section>
          <section className="card">
            <h2 className="mb-1 text-xl font-semibold">Admin</h2>
            <p className="hint mb-4">Review tickets and approve plans. Owner sign-in required.</p>
            <Link href="/admin/tickets" className="btn no-underline">
              Open the console
            </Link>
          </section>
        </div>
      </div>
    </Shell>
  );
}
