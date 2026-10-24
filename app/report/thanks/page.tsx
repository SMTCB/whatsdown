import Link from "next/link";

export default async function Thanks({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const number = /^\d{1,9}$/.test(n ?? "") ? n : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-3xl font-semibold">Thank you</h1>
      <p className="card mb-4">Your report{number ? ` (ticket #${number})` : ""} was received. The maintainer reviews every change before it goes live.</p>
      <Link href="/report" className="btn">Send another report</Link>
    </div>
  );
}
