"use client";

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("FilingLens profile retrieval failed:", error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg tracking-tight text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 rounded">
            FilingLens
          </Link>
        </div>
      </header>

      {/* Error Message Layout */}
      <main className="flex-1 flex flex-col justify-center items-center max-w-md mx-auto w-full px-6 py-12 space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 font-serif">
            Profile Ingestion Failed
          </h1>
          <p className="text-sm text-zinc-500 font-normal leading-5">
            An error occurred while loading this company&apos;s facts from the SEC EDGAR API. Connection limits, rate limiting, or an invalid CIK parameter may cause this.
          </p>
          <div className="bg-red-50 text-red-800 text-xs px-3 py-2 rounded font-mono border border-red-100 max-w-full overflow-x-auto text-left">
            {error.message || "Unknown Ingestion Error"}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <button
            onClick={() => reset()}
            className="px-4 py-2 border border-zinc-300 hover:border-zinc-400 bg-white hover:bg-zinc-50 rounded text-sm font-semibold text-zinc-900 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 cursor-pointer"
          >
            Retry Loading
          </button>
          <Link
            href="/"
            className="px-4 py-2 bg-zinc-950 hover:bg-zinc-800 rounded text-sm font-semibold text-white transition-colors shadow-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          >
            Return Home
          </Link>
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-6 mt-auto">
        <div className="mx-auto max-w-7xl px-6 text-center text-xs text-zinc-400 font-normal">
          Source data: U.S. SEC EDGAR.
        </div>
      </footer>
    </div>
  );
}
