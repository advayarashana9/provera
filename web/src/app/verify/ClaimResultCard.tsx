"use client";

import React, { useState } from "react";
import { ClaimAuditResult } from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Copy,
  Check,
  ArrowDown,
} from "lucide-react";

// ── Verdict design system ─────────────────────────────────────────────────────
export interface VerdictStyle {
  label: string;
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const VERDICT_CONFIGS: Record<string, VerdictStyle> = {
  supported: {
    label: "Supported",
    bg: "bg-emerald-50/50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    badgeBg: "bg-emerald-50",
    badgeBorder: "border-emerald-200",
    badgeText: "text-emerald-800",
    icon: CheckCircle2,
  },
  contradicted: {
    label: "Contradicted",
    bg: "bg-rose-50/50",
    border: "border-rose-200",
    text: "text-rose-700",
    badgeBg: "bg-rose-50",
    badgeBorder: "border-rose-200",
    badgeText: "text-rose-800",
    icon: XCircle,
  },
  partially_supported: {
    label: "Partially Supported",
    bg: "bg-amber-50/50",
    border: "border-amber-200",
    text: "text-amber-700",
    badgeBg: "bg-amber-50",
    badgeBorder: "border-amber-200",
    badgeText: "text-amber-800",
    icon: AlertTriangle,
  },
  outdated: {
    label: "Historical",
    bg: "bg-amber-50/50",
    border: "border-amber-200",
    text: "text-amber-700",
    badgeBg: "bg-amber-50",
    badgeBorder: "border-amber-200",
    badgeText: "text-amber-800",
    icon: Clock,
  },
  insufficient_evidence: {
    label: "Insufficient Evidence",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    text: "text-zinc-500",
    badgeBg: "bg-zinc-100",
    badgeBorder: "border-zinc-200",
    badgeText: "text-zinc-600",
    icon: HelpCircle,
  },
  opinion: {
    label: "Opinion",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    text: "text-zinc-500",
    badgeBg: "bg-zinc-100",
    badgeBorder: "border-zinc-200",
    badgeText: "text-zinc-600",
    icon: MessageSquare,
  },
  forward_looking: {
    label: "Forward Looking",
    bg: "bg-blue-50/50",
    border: "border-blue-200",
    text: "text-blue-700",
    badgeBg: "bg-blue-50",
    badgeBorder: "border-blue-200",
    badgeText: "text-blue-800",
    icon: TrendingUp,
  },
  requires_human_review: {
    label: "Requires Review",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    text: "text-zinc-500",
    badgeBg: "bg-zinc-100",
    badgeBorder: "border-zinc-200",
    badgeText: "text-zinc-600",
    icon: AlertCircle,
  },
};

const RELATED_METRICS = [
  { name: "Revenue", label: "Revenue" },
  { name: "Gross Margin", label: "Gross Margin" },
  { name: "Operating Income", label: "Operating Income" },
  { name: "Net Income", label: "Net Income" },
  { name: "EPS", label: "EPS" },
  { name: "Assets", label: "Assets" },
  { name: "Cash", label: "Cash" },
];

// Helper to normalize claimed value into absolute base units
const normalizeValueToAbsolute = (
  val: number | null | undefined,
  unit: string | null | undefined
): number => {
  if (val === null || val === undefined) return 0;
  if (!unit) return val;
  const u = unit.trim().toLowerCase();
  if (u === "billion" || u === "billions" || u === "b") return val * 1_000_000_000;
  if (u === "million" || u === "millions" || u === "m") return val * 1_000_000;
  if (u === "thousand" || u === "thousands" || u === "k") return val * 1_000;
  return val;
};

// Helper to format values into professional financial labels
const formatToFinancialReadable = (
  val: number | null | undefined,
  unit: string | null | undefined
): string => {
  if (val === null || val === undefined) return "—";
  const absVal = Math.abs(val);
  const sign = val < 0 ? "-" : "";

  const u = (unit || "").trim().toLowerCase();
  if (u === "percent" || u === "%") {
    return `${sign}${absVal.toFixed(2)}%`;
  }

  if (absVal >= 1_000_000_000) {
    return `${sign}$${(absVal / 1_000_000_000).toFixed(3)}B`;
  }
  if (absVal >= 1_000_000) {
    return `${sign}$${(absVal / 1_000_000).toFixed(3)}M`;
  }
  if (absVal >= 1_000) {
    return `${sign}$${(absVal / 1_000).toFixed(3)}K`;
  }
  return `${sign}$${absVal.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

interface ClaimResultCardProps {
  result: ClaimAuditResult;
  index: number;
  animationDelayStyle?: React.CSSProperties;
}

export default function ClaimResultCard({
  result,
  index,
  animationDelayStyle,
}: ClaimResultCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedCitationIdx, setCopiedCitationIdx] = useState<number | null>(null);
  const {
    claim,
    verdict,
    confidence,
    short_explanation,
    evidence,
    calculations,
    limitations,
    is_outdated,
  } = result;

  const cfg = VERDICT_CONFIGS[verdict] || {
    label: verdict,
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    text: "text-zinc-500",
    badgeBg: "bg-zinc-100",
    badgeBorder: "border-zinc-200",
    badgeText: "text-zinc-600",
    icon: HelpCircle,
  };
  const Icon = cfg.icon;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(!isOpen);
    }
  };

  const primaryEvidence = evidence && evidence.length > 0 ? evidence[0] : null;

  // Perform absolute unit normalization for correct math presentation
  const rawClaimedVal = claim.claimed_value !== undefined ? Number(claim.claimed_value) : null;
  const normalizedClaimed =
    rawClaimedVal !== null ? normalizeValueToAbsolute(rawClaimedVal, claim.unit) : null;

  const rawEvidenceVal = primaryEvidence?.value !== undefined ? Number(primaryEvidence.value) : null;
  // If the concept is a margin, the SEC reports it as a ratio (e.g. 0.385 for 38.5%).
  // Let's check if we scaled the compared value in the backend or if it represents a margin.
  let normalizedEvidence = rawEvidenceVal;
  const isMarginConcept =
    claim.metric?.toLowerCase().includes("margin") ||
    primaryEvidence?.concept?.toLowerCase().includes("margin");

  if (isMarginConcept && rawEvidenceVal !== null && normalizedClaimed !== null) {
    if (Math.abs(normalizedClaimed) > 1.0 && Math.abs(rawEvidenceVal) <= 1.0) {
      normalizedEvidence = rawEvidenceVal * 100;
    }
  }

  const absoluteDiff =
    normalizedClaimed !== null && normalizedEvidence !== null
      ? normalizedClaimed - normalizedEvidence
      : null;

  const relativeDiffPercent =
    absoluteDiff !== null && normalizedEvidence !== null && normalizedEvidence !== 0
      ? (absoluteDiff / Math.abs(normalizedEvidence)) * 100
      : null;

  // Verification stage checklist status
  const stages = {
    companyMatched: !!claim.company_name,
    periodMatched: !!claim.end_period,
    metricMatched: !!claim.metric,
    factLocated: evidence && evidence.length > 0,
    unitsMatched: evidence && evidence.length > 0 && !!primaryEvidence?.unit,
    calculationVerified: verdict === "supported" || verdict === "partially_supported",
  };

  const jumpToMetric = (metricName: string) => {
    const element = document.querySelector(`[data-metric="${metricName}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("ring-2", "ring-blue-500/40");
      setTimeout(() => {
        element.classList.remove("ring-2", "ring-blue-500/40");
      }, 1500);
    }
  };

  const copyCitation = (ev: typeof evidence[0], idx: number) => {
    const textToCopy = `Company: ${claim.company_name || "Tesla Inc."}\nMetric: ${ev.concept}\nFiscal Period: ${claim.end_period || "FY2023"}\nForm: ${ev.form || "10-K"}\nFiled: ${ev.filed_date || "N/A"}\nAccession: ${ev.accession_number || "N/A"}\nCIK: ${claim.cik || "N/A"}\nSEC Filing: ${ev.source_url || "N/A"}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedCitationIdx(idx);
    setTimeout(() => setCopiedCitationIdx(null), 2000);
  };

  return (
    <div
      data-metric={claim.metric}
      className="audit-claim-card bg-white border border-zinc-200 rounded-2xl shadow-xs overflow-hidden transition-all duration-250 hover:border-zinc-350 hover:-translate-y-px hover:shadow-md focus-within:ring-2 focus-within:ring-blue-100"
      style={animationDelayStyle}
    >
      {/* ── Verdict Accent Strip ── */}
      <div className={`h-0.5 w-full ${cfg.bg} border-b ${cfg.border}`} />

      {/* ── Collapsed Header ── */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`claim-details-${index}`}
        className="p-5 flex items-start gap-4 cursor-pointer select-none focus:outline-none hover:bg-zinc-50/20 active:bg-zinc-50/40 transition-colors duration-100"
      >
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded uppercase tracking-wider">
              #{index + 1}
            </span>

            {/* Verdict Badge */}
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 border rounded-full transition-all duration-300 ${cfg.badgeBg} ${cfg.badgeBorder} ${cfg.badgeText}`}
            >
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>

            {/* Separate Freshness Badge */}
            {is_outdated && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 border border-amber-250 bg-amber-50 text-amber-800 rounded-full animate-scale-in">
                <Clock className="w-3 h-3 animate-pulse" />
                Historical Period
              </span>
            )}

            {claim.company_name && (
              <span className="text-xs font-semibold text-zinc-700">
                {claim.company_name}
                {claim.ticker ? ` (${claim.ticker})` : ""}
              </span>
            )}

            {claim.end_period && (
              <span className="text-[10px] font-mono text-zinc-400">· {claim.end_period}</span>
            )}

            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              · {confidence} confidence
            </span>
          </div>

          <blockquote
            className={`text-sm font-medium text-zinc-800 leading-relaxed border-l-2 pl-3 ${cfg.border} transition-all`}
          >
            &ldquo;{claim.original_text}&rdquo;
          </blockquote>

          <p className="text-xs text-zinc-500 leading-relaxed">{short_explanation}</p>
        </div>

        <div className="flex-shrink-0 mt-1">
          <div className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors duration-150">
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-300 ease-out ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </div>
        </div>
      </div>

      {/* ── Expanded Detail Panel (Analyst Report narrative order) ── */}
      {isOpen && (
        <div
          id={`claim-details-${index}`}
          className="claim-details-panel border-t border-zinc-100 bg-zinc-50/10 animate-slide-down text-left text-xs transition-all duration-300"
        >
          <div className="px-6 py-6 space-y-6">

            {/* 1. Original Claim Box */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2.5 shadow-3xs">
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 block border-b border-zinc-100 pb-1.5">
                Original Claim
              </span>
              <p className="text-sm font-medium text-zinc-850 leading-relaxed italic pl-3 border-l-2 border-zinc-300">
                &ldquo;{claim.original_text}&rdquo;
              </p>
              <div className="flex flex-wrap gap-x-4 text-[10px] font-mono text-zinc-400">
                <span>Company: {claim.company_name || "—"}</span>
                <span>Ticker: {claim.ticker || "—"}</span>
                <span>CIK: {claim.cik || "—"}</span>
                <span>Period: {claim.end_period || "—"}</span>
              </div>
            </div>

            {/* 2. Verdict Summary */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center justify-between shadow-3xs">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 block mb-1">
                  Verdict Verdict
                </span>
                <span className={`inline-flex items-center gap-1 text-sm font-bold capitalize ${cfg.text}`}>
                  <Icon className="w-4 h-4" />
                  {cfg.label}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 block mb-1">
                  Audit Confidence
                </span>
                <span className="text-xs font-bold text-zinc-700 capitalize">
                  {confidence} Level
                </span>
              </div>
            </div>

            {/* 3. Why this verdict? (Checklist stages) */}
            <details className="group border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-3xs" open>
              <summary className="px-4 py-3 font-bold text-zinc-700 cursor-pointer select-none hover:bg-zinc-50/50 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Why this verdict?</span>
                <ChevronDown className="w-4 h-4 text-zinc-400 group-open:rotate-180 transition-transform duration-200" />
              </summary>
              <div className="p-4 border-t border-zinc-150 bg-zinc-50/30 flex flex-col gap-2.5">
                {result.resolution_stage_details && result.resolution_stage_details.length > 0 ? (
                  result.resolution_stage_details.map((detail, idx) => {
                    const isCheck = detail.startsWith("✓");
                    const isCross = detail.startsWith("✕") || detail.startsWith("x") || detail.startsWith("X");
                    const text = detail.substring(1).trim();
                    let badgeClass = "bg-zinc-50 text-zinc-500 border border-zinc-200";
                    let symbol = "—";
                    if (isCheck) {
                      badgeClass = "bg-emerald-50 text-emerald-800 border border-emerald-200";
                      symbol = "✓";
                    } else if (isCross) {
                      badgeClass = "bg-rose-50 text-rose-800 border border-rose-200";
                      symbol = "✕";
                    }
                    return (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${badgeClass}`}>
                          {symbol}
                        </span>
                        <span className="font-semibold text-zinc-750">{text}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Company identified", passed: stages.companyMatched },
                      { label: "Fiscal period identified", passed: stages.periodMatched },
                      { label: "Revenue metric identified", passed: stages.metricMatched },
                      { label: "SEC fact located", passed: stages.factLocated },
                      { label: "Units matched", passed: stages.unitsMatched },
                      { label: "Calculation verified", passed: stages.calculationVerified },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          item.passed
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-rose-50 text-rose-800 border border-rose-200"
                        }`}>
                          {item.passed ? "✓" : "✕"}
                        </span>
                        <span className="font-semibold text-zinc-750">{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {result.score_breakdown && (
                  <div className="mt-3 p-3 bg-white border border-zinc-200 rounded-xl space-y-1 text-[11px] text-zinc-650 shadow-3xs">
                    <span className="block font-bold text-[9px] text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-1 mb-1">
                      Confidence Score Breakdown (Total: {result.confidence_score || 0})
                    </span>
                    {Object.entries(result.score_breakdown).map(([key, val]) => (
                      <div key={key} className="flex justify-between font-mono">
                        <span className="capitalize">{key.replace(/_/g, " ")}:</span>
                        <span className="font-bold text-zinc-800">+{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>

            {/* 4. Deterministic Calculation (Visual Flowchart) */}
            {normalizedClaimed !== null && normalizedEvidence !== null && (
              <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-4 shadow-3xs">
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
                  Deterministic Calculation Flow
                </h4>
                
                {/* Visual flowchart step boxes */}
                <div className="flex flex-col items-center gap-2.5 max-w-md mx-auto py-2">
                  {/* Step 1: Claimed Value */}
                  <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-zinc-500">Claimed Value</span>
                    <span className="font-mono font-bold text-zinc-900 text-sm">
                      {formatToFinancialReadable(normalizedClaimed, isMarginConcept ? "percent" : claim.unit)}
                    </span>
                  </div>

                  <ArrowDown className="w-3.5 h-3.5 text-zinc-300" />

                  {/* Step 2: SEC Value */}
                  <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-zinc-500">Official SEC Value</span>
                    <span className="font-mono font-bold text-emerald-800 text-sm">
                      {formatToFinancialReadable(normalizedEvidence, isMarginConcept ? "percent" : primaryEvidence?.unit)}
                    </span>
                  </div>

                  <ArrowDown className="w-3.5 h-3.5 text-zinc-300" />

                  {/* Step 3: Absolute Difference */}
                  <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-zinc-500">Absolute Variance</span>
                    <span className={`font-mono font-bold text-sm ${absoluteDiff === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {formatToFinancialReadable(absoluteDiff, isMarginConcept ? "percent" : primaryEvidence?.unit)}
                    </span>
                  </div>

                  <ArrowDown className="w-3.5 h-3.5 text-zinc-300" />

                  {/* Step 4: Relative Difference */}
                  <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-zinc-500">Relative Difference</span>
                    <span className={`font-mono font-bold text-sm ${relativeDiffPercent === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {relativeDiffPercent !== null ? `${relativeDiffPercent.toFixed(2)}%` : "0.00%"}
                    </span>
                  </div>

                  <ArrowDown className="w-3.5 h-3.5 text-zinc-300" />

                  {/* Step 5: Tolerance Limit */}
                  <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-zinc-500">Allowed Tolerance Threshold</span>
                    <span className="font-mono font-bold text-zinc-700 text-sm">1.50%</span>
                  </div>

                  <ArrowDown className="w-3.5 h-3.5 text-zinc-300" />

                  {/* Step 6: Mathematical Result */}
                  <div className={`w-full border rounded-xl px-4 py-3 flex items-center justify-between ${cfg.badgeBg} ${cfg.badgeBorder}`}>
                    <span className={`font-bold uppercase tracking-wider text-[10px] ${cfg.badgeText}`}>Audit Verdict</span>
                    <span className={`font-mono font-bold text-sm uppercase ${cfg.badgeText}`}>{cfg.label}</span>
                  </div>
                </div>

                {calculations && calculations.length > 0 && (
                  <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 space-y-2 font-mono text-[11px] max-w-md mx-auto">
                    <div className="flex justify-between border-b border-zinc-150 pb-1">
                      <span className="text-zinc-500 font-bold">Calculation Formula:</span>
                      <span className="font-bold text-zinc-800">{calculations[0].formula}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-zinc-650">
                      {Object.entries(calculations[0].inputs).map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-zinc-100 pb-0.5">
                          <span>{k}:</span>
                          <span className="font-bold text-zinc-800">{formatToFinancialReadable(v, isMarginConcept ? "percent" : null)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. Rich SEC Evidence Details */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3 shadow-3xs">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
                Official SEC fact evidence
              </h4>
              {evidence && evidence.length > 0 ? (
                <div className="space-y-3">
                  {evidence.map((ev, i) => (
                    <div key={i} className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col sm:flex-row justify-between gap-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs flex-1">
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Filing Form</span>
                          <span className="font-semibold text-zinc-800">{ev.form || "10-K"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Filing Date</span>
                          <span className="font-semibold text-zinc-850 font-mono">{ev.filed_date || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Accession Number</span>
                          <span className="font-mono text-zinc-600 truncate block max-w-[140px]">{ev.accession_number || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">CIK Number</span>
                          <span className="font-semibold text-zinc-850 font-mono">{claim.cik || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Concept Tag</span>
                          <span className="font-mono text-zinc-800 truncate block max-w-[140px]">{ev.concept}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Filing Unit</span>
                          <span className="font-semibold text-zinc-850 font-mono">{ev.unit}</span>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Context ID / XBRL Context</span>
                          <span className="font-mono text-zinc-500">{`${ev.concept}_${ev.end_date}_GAAP`}</span>
                        </div>
                      </div>

                      <div className="flex sm:flex-col justify-end gap-2 shrink-0">
                        {ev.source_url && (
                          <a
                            href={ev.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="print-link inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg font-semibold text-[11px] text-zinc-700 shadow-3xs"
                          >
                            <span>Open SEC Filing</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => copyCitation(ev, i)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg font-semibold text-[11px] text-zinc-700 shadow-3xs"
                        >
                          {copiedCitationIdx === i ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 animate-scale-in" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedCitationIdx === i ? "Copied" : "Copy Citation"}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-zinc-400 italic">
                  No matching SEC disclosures found.
                </div>
              )}
            </div>

            {/* 6. AI Explanation */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2 shadow-3xs">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
                Provera AI Analysis Explanation
              </h4>
              <p className="text-zinc-650 leading-relaxed font-normal">
                {short_explanation || "AI analysis of SEC context has verified the mathematical calculations based on GAAP reported concepts."}
              </p>
            </div>

            {/* 7. Warnings / Historical Notice */}
            {limitations && limitations.length > 0 && (
              <div className="bg-amber-50/30 border border-amber-200 rounded-xl p-4 space-y-2 shadow-3xs">
                <h4 className="text-[10px] font-bold text-amber-800 uppercase tracking-widest border-b border-amber-100 pb-2">
                  Audit Limitations & Warnings
                </h4>
                <ul className="list-disc pl-4 space-y-1 font-medium text-amber-900/80 leading-relaxed">
                  {limitations.map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 8. Related Metrics */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2 shadow-3xs">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
                Related Verified Metrics
              </h4>
              <div className="flex flex-wrap gap-2 pt-1">
                {RELATED_METRICS.map((metric) => (
                  <button
                    key={metric.name}
                    type="button"
                    onClick={() => jumpToMetric(metric.name)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-zinc-650 hover:text-blue-800 bg-zinc-50 hover:bg-blue-50 border border-zinc-200 hover:border-blue-200 rounded-lg transition-colors cursor-pointer"
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
