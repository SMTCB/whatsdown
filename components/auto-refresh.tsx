"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every few seconds while an agent is still working on the ticket. */
export function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return <p className="hint" role="status">Working on it… this page updates by itself.</p>;
}
