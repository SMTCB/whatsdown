import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const heading = Lexend({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "WhatsDown",
  description: "Agentic maintenance platform",
};

const navLink = "inline-flex min-h-11 items-center rounded-md px-3 text-[0.9375rem] font-semibold text-[var(--muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-[var(--line)] bg-[var(--card)]">
          <nav aria-label="Main" className="mx-auto flex max-w-4xl flex-wrap items-center gap-1 px-4 py-2">
            <Link href="/tickets" className="mr-3 inline-flex min-h-11 items-center font-[family-name:var(--font-heading)] text-lg font-bold !text-[var(--accent)] no-underline">
              WhatsDown
            </Link>
            <Link href="/tickets" className={navLink}>
              Tickets
            </Link>
            <Link href="/dashboard" className={navLink}>
              Dashboard
            </Link>
            <Link href="/report" className="btn btn-primary ml-auto !text-white no-underline">
              Report a problem
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-4xl px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
