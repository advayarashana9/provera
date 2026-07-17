"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auditReport, DocumentAuditResponse } from "@/lib/api";
import VerificationInput from "./VerificationInput";
import AuditLoading from "./AuditLoading";
import AuditResults from "./AuditResults";
import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isApiReady, setIsApiReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiResponse, setApiResponse] = useState<DocumentAuditResponse | null>(null);
  const [activeResponse, setActiveResponse] = useState<DocumentAuditResponse | null>(null);

  const handleVerify = useCallback(async (reportText: string) => {
    setIsLoading(true);
    setIsApiReady(false);
    setError(null);
    setApiResponse(null);
    setActiveResponse(null);
    try {
      const data = await auditReport(reportText);
      setApiResponse(data);
      setIsApiReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run audit. Please try again.");
      setIsLoading(false);
    }
  }, []);

  const handleLoadingComplete = () => {
    setActiveResponse(apiResponse);
    setIsLoading(false);
  };

  useEffect(() => {
    const textParam = searchParams.get("text");
    if (textParam) {
      setTimeout(() => {
        setText(textParam);
        handleVerify(textParam);
      }, 0);
    }
  }, [searchParams, handleVerify]);

  const handleReset = () => {
    setApiResponse(null);
    setActiveResponse(null);
    setError(null);
    setText("");
    router.push("/verify");
  };

  return (
    <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-7">
      {/* Back link */}
      <div className="no-print">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Provera</span>
        </Link>
      </div>

      {isLoading ? (
        <AuditLoading
          reportTitle={text ? (text.slice(0, 50) + (text.length > 50 ? "…" : "")) : undefined}
          isApiReady={isApiReady}
          onComplete={handleLoadingComplete}
        />
      ) : activeResponse ? (
        <AuditResults data={activeResponse} onReset={handleReset} />
      ) : (
        <div className="space-y-7 max-w-3xl mx-auto">
          {/* Empty state header */}
          <div className="text-center space-y-4 py-2">
            <div className="mx-auto w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-800 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold font-serif text-zinc-950 tracking-tight">
                Verify financial research before publishing.
              </h1>
              <p className="max-w-lg mx-auto text-xs text-zinc-500 leading-relaxed font-normal">
                Paste a research report or investment memo below. Provera extracts individual
                financial claims and checks each one against official SEC EDGAR disclosures.
              </p>
            </div>

            {/* Supported content types */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest select-none">
                Supports:
              </span>
              {[
                "Investment Memos",
                "Equity Research",
                "Earnings Summaries",
                "AI-Generated Financial Text",
              ].map((chip) => (
                <span
                  key={chip}
                  className="px-2.5 py-1 text-[10px] font-semibold text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-lg select-none"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          <VerificationInput
            initialText={text}
            onVerify={handleVerify}
            isLoading={isLoading}
          />
        </div>
      )}
    </main>
  );
}

const Logo = () => (
  <div className="flex items-center gap-2 select-none">
    {/* Provera P-mark: geometric letterform on deep navy */}
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1e3a5f"/>
      <rect x="10" y="8" width="3" height="16" rx="1.5" fill="white"/>
      <rect x="10" y="8" width="10" height="3" rx="1.5" fill="white"/>
      <rect x="10" y="15" width="9" height="2.5" rx="1.25" fill="white"/>
      <rect x="17" y="8" width="3" height="9.5" rx="1.5" fill="white"/>
      <circle cx="22.5" cy="22.5" r="2.5" fill="#3b82f6"/>
      <path d="M21.3 22.5 L22.2 23.4 L23.8 21.6" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <span className="font-semibold text-zinc-900 text-sm tracking-tight font-sans">Provera</span>
  </div>
);

export default function VerifyPage() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900 scroll-smooth">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-zinc-200 shadow-xs no-print">
        <div className="mx-auto max-w-5xl px-6 py-3.5 flex items-center justify-between">
          <Link
            href="/"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 rounded-lg"
          >
            <Logo />
          </Link>
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest select-none">
            Claim Audit Workspace
          </span>
        </div>
      </header>

      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center py-20 text-zinc-500 font-semibold text-sm">
            Loading…
          </div>
        }
      >
        <VerifyContent />
      </Suspense>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-6 mt-auto no-print">
        <div className="mx-auto max-w-5xl px-6 text-center text-[11px] text-zinc-400 font-medium">
          © {new Date().getFullYear()} Provera. All rights reserved. SEC EDGAR and XBRL
          disclosures verified in real-time.
        </div>
      </footer>
    </div>
  );
}
