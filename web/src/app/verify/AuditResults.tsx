"use client";

import React, { useState, useEffect } from "react";
import { DocumentAuditResponse } from "@/lib/api";
import ClaimResultCard, { VERDICT_CONFIGS } from "./ClaimResultCard";
import {
  Layers,
  HelpCircle,
  ShieldCheck,
  Check,
  ArrowRight,
  Download,
  RotateCcw,
  Link2,
  X,
} from "lucide-react";

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedCounter({ value, duration = 700 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || value === 0) {
      setTimeout(() => setCount(value), 0);
      return;
    }
    const steps = 32;
    const stepTime = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setCount(Math.min(Math.round((value / steps) * step), value));
      if (step >= steps) clearInterval(timer);
    }, stepTime);
    return () => clearInterval(timer);
  }, [value, duration]);

  return <span className="tabular-nums font-mono">{count}</span>;
}

// ── Completed pipeline (results view) ────────────────────────────────────────
const PIPELINE_STEPS = [
  "Reading report",
  "Extracting claims",
  "Identifying companies",
  "Matching SEC facts",
  "Running deterministic calculations",
  "Generating explanations",
  "Preparing report",
];

function CompletedPipeline() {
  const [revealedIdx, setRevealedIdx] = useState(-1);

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      setRevealedIdx(i);
      i++;
      if (i >= PIPELINE_STEPS.length) clearInterval(timer);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden sm:block bg-white border border-zinc-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100">
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
          Verification Process Pipeline Completed
        </span>
      </div>
      <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
        {PIPELINE_STEPS.map((step, idx) => (
          <React.Fragment key={step}>
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all duration-300 animate-pipeline-step ${
                idx <= revealedIdx
                  ? "bg-emerald-50 border-emerald-250 text-emerald-700"
                  : "bg-zinc-50 border-zinc-200 text-zinc-300"
              }`}
              style={{ animationDelay: `${idx * 110}ms` }}
            >
              {idx <= revealedIdx ? (
                <Check className="w-3 h-3 stroke-[3]" />
              ) : (
                <span className="w-3 h-3 rounded-full border border-zinc-300 inline-block" />
              )}
              {step}
            </div>
            {idx < PIPELINE_STEPS.length - 1 && (
              <ArrowRight className="w-3 h-3 text-zinc-300 flex-shrink-0" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Main AuditResults ─────────────────────────────────────────────────────────
interface AuditResultsProps {
  data: DocumentAuditResponse;
  onReset: () => void;
}

export default function AuditResults({ data, onReset }: AuditResultsProps) {
  const [filter, setFilter] = useState<string>("all");
  const [revealedCount, setRevealedCount] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [citationsCopied, setCitationsCopied] = useState(false);
  const [highlightSection, setHighlightSection] = useState(false);
  const { claims, summary } = data;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setTimeout(() => {
      setPrefersReducedMotion(media.matches);
      if (media.matches) setRevealedCount(claims.length);
    }, 0);

    if (media.matches) return;

    const interval = setInterval(() => {
      setRevealedCount((prev) => {
        if (prev >= claims.length) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 75);

    return () => clearInterval(interval);
  }, [claims.length]);

  // Click card acts as filter, smooth scrolls, and flashes target section
  const handleFilterClick = (verdictKey: string) => {
    setFilter(verdictKey);
    const section = document.getElementById("claims-audit-section");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightSection(true);
      setTimeout(() => setHighlightSection(false), 1200);
    }
  };

  const filteredClaims = claims.filter((c) => {
    if (filter === "all") return true;
    if (filter === "outdated") return c.is_outdated === true;
    return c.verdict === filter;
  });

  // Derived stats
  const totalClaimsCount = claims.length;
  const measurableClaimsCount = claims.filter(
    (c) => c.claim.metric !== null && c.claim.metric !== ""
  ).length;
  const claimsWithEvidenceCount = claims.filter(
    (c) => c.evidence && c.evidence.length > 0
  ).length;
  const savedMins = Math.round((measurableClaimsCount * 60) / 60 * 10) / 10;
  const formattedSavedTime = savedMins >= 1 ? `${savedMins} min` : `${measurableClaimsCount * 60}s`;

  const hasContradicted = summary.contradicted > 0;
  const hasPartiallySupported = summary.partially_supported > 0;
  const hasReviewItems = summary.requires_human_review > 0;
  const isPerfectAudit = !hasContradicted && !hasPartiallySupported && !hasReviewItems && summary.supported > 0;

  // Timestamp
  const auditTime = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const primaryCompany = claims.find((c) => c.claim.company_name)?.claim.company_name ?? null;
  const primaryTicker  = claims.find((c) => c.claim.ticker)?.claim.ticker ?? null;

  // Enriched Citation Copy Formatting
  const allEvidence = claims.flatMap((c) => c.evidence || []);
  const dedupedEvidence = Array.from(
    new Map(allEvidence.map((ev) => [ev.accession_number ?? ev.source_url, ev])).values()
  ).filter((ev) => ev.source_url?.startsWith("http"));

  const hasCitations = dedupedEvidence.length > 0;

  const handleCopyCitations = () => {
    if (!hasCitations) return;
    const lines = dedupedEvidence.map((ev) =>
      [
        ev.concept ? `Concept: ${ev.concept}` : null,
        ev.form ? `Form: ${ev.form}` : null,
        ev.end_date ? `Period End: ${ev.end_date}` : null,
        ev.filed_date ? `Filed: ${ev.filed_date}` : null,
        ev.accession_number ? `Accession: ${ev.accession_number}` : null,
        ev.source_url ? `URL: ${ev.source_url}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
    navigator.clipboard.writeText(lines.join("\n---\n"));
    setCitationsCopied(true);
    setTimeout(() => setCitationsCopied(false), 2500);
  };

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    }
  };

  const getSectionTitle = () => {
    const count = filteredClaims.length;
    if (filter === "all") return `Showing All Claims (${count})`;
    
    const labels: Record<string, string> = {
      supported: "Showing Supported Claims",
      contradicted: "Showing Contradicted Claims",
      partially_supported: "Showing Partially Supported Claims",
      outdated: "Showing Historical Claims",
      opinion: "Showing Opinion Claims",
      forward_looking: "Showing Forward Looking Claims",
      insufficient_evidence: "Showing Insufficient Evidence Claims",
      requires_human_review: "Showing Review Needed Claims",
    };
    return `${labels[filter] || `Showing ${filter} Claims`} (${count})`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-fade-in print-root">

      {/* ── Stepper ── */}
      <div className="flex items-center justify-between max-w-xs pb-4 select-none no-print">
        {[
          { number: 1, label: "Input", done: true },
          { number: 2, label: "Audit", done: true },
          { number: 3, label: "Review", active: true },
        ].map((step, idx) => (
          <React.Fragment key={step.label}>
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                  step.done
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    : step.active
                    ? "bg-blue-800 text-white shadow-sm ring-4 ring-blue-100 animate-pulse"
                    : "bg-zinc-100 text-zinc-400 border border-zinc-200"
                }`}
              >
                {step.done ? <Check className="w-3 h-3 stroke-[3.5]" /> : step.number}
              </div>
              <span
                className={`text-[11px] font-semibold tracking-tight ${
                  step.active ? "text-zinc-900 font-bold" : "text-zinc-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < 2 && <div className="h-px bg-zinc-200 flex-grow mx-3 max-w-[40px]" />}
          </React.Fragment>
        ))}
      </div>

      {/* ── Success banner ── */}
      {isPerfectAudit && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 shadow-xs flex items-center gap-3.5 animate-scale-in">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 flex-shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-emerald-800">No material conflicts found.</h2>
            <p className="text-[11px] text-emerald-700 mt-0.5 font-medium leading-relaxed">
              All parsed numerical claims were cross-referenced and verified against original SEC disclosures.
            </p>
          </div>
        </div>
      )}

      {/* ── Report header ── */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-zinc-100">
          {/* Left: title + metadata */}
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-zinc-950 font-serif tracking-tight">
              Research Audit Report
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400 font-medium">
              <span>Audit completed {auditTime}</span>
              {primaryCompany && (
                <>
                  <span className="text-zinc-200">·</span>
                  <span className="text-zinc-600 font-semibold">
                    {primaryCompany}
                    {primaryTicker ? ` (${primaryTicker})` : ""}
                  </span>
                </>
              )}
              <span className="text-zinc-200">·</span>
              <span>{totalClaimsCount} claims reviewed</span>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 flex-wrap no-print">
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-950 hover:bg-zinc-800 active:translate-y-px active:scale-[0.99] text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Audit</span>
            </button>

            <button
              onClick={handleCopyCitations}
              disabled={!hasCitations}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px active:scale-[0.99] text-zinc-700 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              title={hasCitations ? "Copy all SEC citations to clipboard" : "No citations available"}
            >
              {citationsCopied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span>{citationsCopied ? "Citations copied" : "Copy Citations"}</span>
            </button>

            <button
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 active:translate-y-px active:scale-[0.99] text-zinc-700 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              {linkCopied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
              <span>{linkCopied ? "Link copied" : "Copy Current Link"}</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 active:translate-y-px active:scale-[0.99] text-zinc-700 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              title="Print report to PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary score cards (Interactive filter nodes) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 no-print">
        {/* Total card */}
        <button
          onClick={() => handleFilterClick("all")}
          className={`text-left p-4 rounded-2xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${
            filter === "all"
              ? "ring-2 ring-blue-600/40 bg-zinc-50 border-blue-600 shadow-md scale-[1.01]"
              : "bg-white border-zinc-200 hover:border-zinc-350 hover:-translate-y-0.5 hover:shadow-md"
          }`}
        >
          <div className="flex items-center justify-between text-[9px] text-zinc-400 font-bold uppercase tracking-widest mb-2">
            <span>Total</span>
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-3xl font-bold text-zinc-900 block leading-none">
            <AnimatedCounter value={totalClaimsCount} />
          </span>
          <span className="text-[10px] text-zinc-400 font-medium mt-1 block">Claims</span>
        </button>

        {/* Verdict cards */}
        {Object.entries(summary).map(([key, val]) => {
          if (key === "total") return null;
          const cfg =
            VERDICT_CONFIGS[key] || {
              label: key,
              bg: "bg-white",
              border: "border-zinc-200",
              text: "text-zinc-500",
              icon: HelpCircle,
            };
          const Icon = cfg.icon;
          const isActive = filter === key;

          return (
            <button
              key={key}
              onClick={() => handleFilterClick(key)}
              className={`text-left p-4 rounded-2xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${cfg.bg} ${cfg.border} ${
                isActive
                  ? "ring-2 ring-blue-600/40 shadow-md border-blue-600 bg-zinc-50 scale-[1.01]"
                  : "hover:-translate-y-0.5 hover:shadow-md opacity-90 hover:opacity-100"
              }`}
            >
              <div className={`flex items-center justify-between text-[9px] font-bold uppercase tracking-widest mb-2 ${cfg.text}`}>
                <span>{cfg.label}</span>
                <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
              </div>
              <span className={`text-3xl font-bold block leading-none ${cfg.text}`}>
                <AnimatedCounter value={val} />
              </span>
              <span className={`text-[10px] font-medium mt-1 block opacity-70 ${cfg.text}`}>
                Claims
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Stats sub-panel ── */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-xs overflow-hidden no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
          <div className="px-6 py-5 space-y-1">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block">
              Measurable Claims
            </span>
            <span className="text-2xl font-bold text-zinc-900 block leading-none">
              <AnimatedCounter value={measurableClaimsCount} />
            </span>
            <p className="text-[11px] text-zinc-400 font-medium leading-relaxed">
              Claims with numeric metrics or reported GAAP values.
            </p>
          </div>

          <div className="px-6 py-5 space-y-1">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block">
              Claims With Evidence
            </span>
            <span className="text-2xl font-bold text-zinc-900 block leading-none">
              <AnimatedCounter value={claimsWithEvidenceCount} />
            </span>
            <p className="text-[11px] text-zinc-400 font-medium leading-relaxed">
              Matched to direct facts in SEC XBRL databases.
            </p>
          </div>

          <div className="px-6 py-5 space-y-1">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block">
              Est. Review Time Saved
            </span>
            <span className="text-2xl font-bold text-blue-800 block leading-none tabular-nums">
              {formattedSavedTime}
            </span>
            <p className="text-[11px] text-zinc-400 font-medium leading-relaxed flex items-center gap-1">
              <span>~60s per measurable claim</span>
              <span
                title="Estimated based on 1 minute per manually verified measurable claim."
                className="cursor-help"
              >
                <HelpCircle className="w-3 h-3 text-zinc-300" />
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Completed verification pipeline ── */}
      <div className="no-print">
        <CompletedPipeline />
      </div>

      {/* ── Claims list (Interactive filter with highlight transitions) ── */}
      <div
        id="claims-audit-section"
        className={`space-y-4 text-left p-4 rounded-2xl border transition-all duration-700 ${
          highlightSection
            ? "ring-2 ring-blue-500/50 bg-blue-50/10 border-blue-200"
            : "border-transparent bg-transparent"
        } no-print`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <h2 className="text-sm font-bold text-zinc-850">
            {getSectionTitle()}
          </h2>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear filter</span>
            </button>
          )}
        </div>

        {filteredClaims.length > 0 ? (
          <div className="space-y-3">
            {filteredClaims.map((claim, idx) => {
              if (!prefersReducedMotion && idx >= revealedCount) return null;
              return (
                <div
                  key={idx}
                  className="animate-slide-up"
                  style={
                    prefersReducedMotion ? undefined : { animationDelay: `${(idx % 12) * 55}ms` }
                  }
                >
                  <ClaimResultCard result={claim} index={idx} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-white border border-zinc-200 rounded-2xl">
            <p className="text-zinc-400 font-medium text-sm">
              No claims match the selected filter.
            </p>
          </div>
        )}
      </div>

      {/* ── Disclaimer ── */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 flex gap-3.5 text-xs leading-relaxed text-zinc-500 shadow-xs no-print">
        <ShieldCheck className="w-5 h-5 text-zinc-300 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-zinc-700 block mb-0.5">
            Provera Verification Disclaimer
          </span>
          Provera provides automated evidence review and is not a substitute for professional
          financial, legal, accounting, or investment advice. Deterministic audits compare claims to
          reported SEC filing concepts; qualitative valuations, market trends, and forward-looking
          risks require professional analyst evaluation.
        </div>
      </div>

      {/* ── Print Only PDF Layout (Always prints ALL claims regardless of active filters) ── */}
      <div className="hidden print:block space-y-6 text-left">
        <div className="border-b-2 border-zinc-800 pb-3">
          <h1 className="text-2xl font-bold font-serif text-zinc-950">Provera Analyst Audit Report</h1>
          <div className="grid grid-cols-2 gap-4 text-[11px] text-zinc-500 mt-2">
            <div>
              <span className="font-bold">Subject Company:</span> {primaryCompany || "SEC Registered Entity"}
            </div>
            <div>
              <span className="font-bold">Audit Completed:</span> {auditTime}
            </div>
            <div>
              <span className="font-bold">Filing Sources:</span> SEC EDGAR Database
            </div>
            <div>
              <span className="font-bold">Claims Reviewed:</span> {claims.length} Total
            </div>
          </div>
        </div>

        {/* Verdict summary count table */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Verdict summary</h2>
          <div className="grid grid-cols-4 gap-4 text-xs font-medium text-zinc-700">
            <div>Supported: <span className="font-bold">{summary.supported}</span></div>
            <div>Contradicted: <span className="font-bold">{summary.contradicted}</span></div>
            <div>Partially Supported: <span className="font-bold">{summary.partially_supported}</span></div>
            <div>Historical: <span className="font-bold">{summary.outdated}</span></div>
            <div>Insufficient Evidence: <span className="font-bold">{summary.insufficient_evidence}</span></div>
            <div>Opinion: <span className="font-bold">{summary.opinion}</span></div>
            <div>Forward Looking: <span className="font-bold">{summary.forward_looking}</span></div>
            <div>Requires Review: <span className="font-bold">{summary.requires_human_review}</span></div>
          </div>
        </div>

        {/* Detailed audit list */}
        <div className="space-y-6">
          <h2 className="text-sm font-bold border-b border-zinc-300 pb-1">Verified claims detail</h2>
          {claims.map((claim, idx) => (
            <div key={idx} className="border border-zinc-200 rounded-xl p-4 space-y-3 bg-white page-break-inside-avoid">
              <div className="flex justify-between items-center text-xs font-bold border-b border-zinc-100 pb-1">
                <span>Claim #{idx + 1} — {claim.claim.company_name || ""} ({claim.verdict})</span>
                <span className="font-mono text-zinc-400">{claim.claim.end_period || ""}</span>
              </div>
              <blockquote className="text-xs italic text-zinc-800 border-l-2 border-zinc-300 pl-2">
                &ldquo;{claim.claim.original_text}&rdquo;
              </blockquote>
              <p className="text-xs text-zinc-650">{claim.short_explanation}</p>
              {claim.evidence && claim.evidence.length > 0 && (
                <div className="bg-zinc-50/50 p-2 rounded-lg text-[10px] space-y-1 font-mono">
                  <div className="font-bold text-zinc-500">SEC EVIDENCE DISCLOSURE</div>
                  <div>Concept: {claim.evidence[0].concept}</div>
                  <div>Reported value: {claim.evidence[0].value.toLocaleString()} ({claim.evidence[0].unit})</div>
                  <div>Filing Form: {claim.evidence[0].form} | Filed: {claim.evidence[0].filed_date}</div>
                  <div>Accession Acc: {claim.evidence[0].accession_number}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
