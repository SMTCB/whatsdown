import Link from "next/link";

export default async function Thanks({ searchParams }: { searchParams: Promise<{ n?: string; t?: string }> }) {
  const { n, t } = await searchParams;
  const number = /^\d{1,9}$/.test(n ?? "") ? n : undefined;
  const token = /^[a-f0-9]{32,128}$/.test(t ?? "") ? t : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-3xl font-semibold">Thank you</h1>
      <p className="card mb-4">Your report{number ? ` (ticket #${number})` : ""} was received. The maintainer reviews every change before it goes live.</p>
      {token && (
        <div className="card mb-4">
          <h2 className="mb-1 font-[family-name:var(--font-heading)] text-lg font-semibold">Follow your report</h2>
          <p className="hint mb-3">This private link shows progress and lets you answer questions about your report. Save it: it is the only way back, and anyone with the link can see the report.</p>
          <Link href={`/t/${token}`} className="btn btn-primary !text-white no-underline">
            Open my status page
          </Link>
        </div>
      )}
      <Link href="/report" className="btn">Send another report</Link>
    </div>
  );
}
