import Link from "next/link";
import { signOut } from "@/app/admin/actions";

const navLink = "inline-flex min-h-11 items-center rounded-md px-3 text-[0.9375rem] font-semibold text-[var(--muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]";
const brand = "mr-3 inline-flex min-h-11 items-center font-[family-name:var(--font-heading)] text-lg font-bold !text-[var(--accent)] no-underline";

/** Page frame. `admin` adds the owner navigation and Sign out; reporters only see the brand and the report link. */
export function Shell({ admin, children }: { admin?: boolean; children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-[var(--line)] bg-[var(--card)]">
        <nav aria-label="Main" className="mx-auto flex max-w-4xl flex-wrap items-center gap-1 px-4 py-2">
          {admin ? (
            <>
              <Link href="/admin/tickets" className={brand}>
                WhatsDown
              </Link>
              <Link href="/admin/tickets" className={navLink}>
                Tickets
              </Link>
              <Link href="/admin/dashboard" className={navLink}>
                Dashboard
              </Link>
              <form action={signOut} className="ml-auto">
                <button type="submit" className="btn">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/report" className={brand}>
                WhatsDown
              </Link>
              <Link href="/report" className="btn btn-primary ml-auto !text-white no-underline">
                Report a problem
              </Link>
            </>
          )}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-8">
        {children}
      </main>
    </>
  );
}
