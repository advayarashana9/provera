"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, CheckCircle, FileText } from "lucide-react";
import { DashboardMetric, ChatCitation, DashboardSeriesPoint } from "@/lib/api";

// ─── Universal evidence item ────────────────────────────────────────────────
export interface EvidenceItem {
  id: number | string;
  label: string;
  concept: string;
  value: number | null;
  unit: string;
  periodEnd: string | null;
  filedDate?: string | null;
  form?: string | null;
  accessionNumber?: string | null;
  sourceUrl?: string | null;
  usedFor?: string | null;
  isVerified?: boolean;
}

// ─── Converters ─────────────────────────────────────────────────────────────

export function metricsToEvidence(metrics: DashboardMetric[]): EvidenceItem[] {
  return metrics
    .filter((m) => m.value !== null)
    .map((m, idx) => ({
      id: idx + 1,
      label: m.label,
      concept: m.concept,
      value: m.value,
      unit: m.unit || "USD",
      periodEnd: m.period_end,
      filedDate: m.filed_date || null,
      form: null,
      accessionNumber: m.accession_number || null,
      sourceUrl: m.source_url,
      usedFor: `This ${m.label} value is a key performance indicator displayed on the Financial Dashboard.`,
      isVerified: !!m.source_url,
    }));
}

export function chatCitationsToEvidence(
  citations: ChatCitation[],
  comparisons?: { concept: string; label?: string | null }[]
): EvidenceItem[] {
  return citations.map((c) => {
    const usedInComparison = comparisons?.find(
      (comp) =>
        comp.concept.toLowerCase() === c.concept.toLowerCase() ||
        comp.label?.toLowerCase() === (c.label || "").toLowerCase()
    );
    return {
      id: c.id,
      label: c.label || c.concept,
      concept: c.concept,
      value: c.value,
      unit: c.unit,
      periodEnd: c.period_end,
      filedDate: null,
      form: c.form,
      accessionNumber: c.accession_number,
      sourceUrl: c.source_url,
      usedFor: usedInComparison
        ? `This ${c.label || c.concept} value was used to calculate a period-over-period trend comparison.`
        : `This ${c.label || c.concept} value was retrieved as direct evidence for the answer above.`,
      isVerified: true,
    };
  });
}

export function reportCitationsToEvidence(
  citations: Array<{
    id: number;
    concept: string;
    label?: string | null;
    value: number;
    unit: string;
    period_end: string;
    form: string;
    source_url?: string | null;
  }>
): EvidenceItem[] {
  return citations.map((c) => ({
    id: c.id,
    label: c.label || c.concept,
    concept: c.concept,
    value: c.value,
    unit: c.unit,
    periodEnd: c.period_end,
    filedDate: null,
    form: c.form,
    accessionNumber: null,
    sourceUrl: c.source_url || null,
    usedFor: `This ${c.label || c.concept} value was cited as supporting evidence in the generated report.`,
    isVerified: true,
  }));
}

export function seriesPointsToEvidence(
  points: DashboardSeriesPoint[],
  seriesLabel: string
): EvidenceItem[] {
  return points.map((pt, idx) => ({
    id: idx + 1,
    label: seriesLabel,
    concept: seriesLabel,
    value: pt.value,
    unit: "USD",
    periodEnd: pt.period_end,
    filedDate: null,
    form: pt.form,
    accessionNumber: pt.accession_number,
    sourceUrl: pt.source_url,
    usedFor: `This data point contributes to the ${seriesLabel} trend chart (${pt.fiscal_period || ""} ${pt.fiscal_year || ""}).`,
    isVerified: !!pt.source_url,
  }));
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtValue(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "N/A";
  const absVal = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const isUsd = unit.toUpperCase() === "USD";
  const isShares = unit.toUpperCase() === "SHARES";
  const isPct = unit === "%";
  if (isPct) return `${(value * 100).toFixed(2)}%`;
  let numStr = "";
  if (absVal >= 1e12) numStr = `${(absVal / 1e12).toFixed(2)}T`;
  else if (absVal >= 1e9) numStr = `${(absVal / 1e9).toFixed(2)}B`;
  else if (absVal >= 1e6) numStr = `${(absVal / 1e6).toFixed(2)}M`;
  else if (absVal >= 1e3) numStr = `${(absVal / 1e3).toFixed(2)}K`;
  else numStr = absVal.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (isUsd) return `${sign}$${numStr}`;
  if (isShares) return `${sign}${numStr} shares`;
  return `${sign}${numStr} ${unit}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
  } catch { return iso; }
}

// ─── Group by filing ─────────────────────────────────────────────────────────

interface FilingGroup {
  key: string;
  form: string | null;
  filedDate: string | null;
  accessionNumber: string | null;
  items: EvidenceItem[];
}

function groupByFiling(items: EvidenceItem[]): FilingGroup[] {
  const groups = new Map<string, FilingGroup>();
  for (const item of items) {
    const groupKey = item.accessionNumber || item.periodEnd || "unknown";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        form: item.form || null,
        filedDate: item.filedDate || null,
        accessionNumber: item.accessionNumber || null,
        items: [],
      });
    }
    groups.get(groupKey)!.items.push(item);
  }
  return Array.from(groups.values());
}

// ─── Calculation formula map ─────────────────────────────────────────────────

const FORMULA_MAP: Record<string, { uses: string[]; formula: string }> = {
  revenue: {
    uses: ["Revenue (Current Quarter)", "Revenue (Previous Quarter)"],
    formula: "(Current − Previous) / Previous = Revenue Growth",
  },
  "net income": {
    uses: ["Net Income (Current)", "Revenue (Current)"],
    formula: "Net Income / Revenue = Net Margin",
  },
  "gross profit": {
    uses: ["Revenue", "Cost of Revenue"],
    formula: "Revenue − Cost of Revenue = Gross Profit",
  },
  assets: {
    uses: ["Total Assets", "Total Liabilities"],
    formula: "Assets − Liabilities = Stockholders' Equity",
  },
  cash: {
    uses: ["Cash & Equivalents (Current)", "Cash & Equivalents (Prior)"],
    formula: "Current − Prior = Cash Change",
  },
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface SourceEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: EvidenceItem[];
  context?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SourceEvidenceModal({
  isOpen, onClose, title, items, context,
}: SourceEvidenceModalProps) {
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = orig; };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const groups = groupByFiling(items);
  const verifiedCount = items.filter((i) => i.isVerified).length;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Source Evidence: ${title}`}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl border border-zinc-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-zinc-50 rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg border border-blue-100">
              <FileText className="w-4 h-4 text-blue-800" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 tracking-tight font-serif">
                Source Evidence
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {verifiedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
                <CheckCircle className="w-3 h-3 text-emerald-600" />
                <span className="text-[10px] font-bold text-emerald-700">
                  {verifiedCount} SEC XBRL verified
                </span>
              </div>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              aria-label="Close source evidence"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Context banner */}
        {context && (
          <div className="px-6 py-2.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-800 font-medium flex-shrink-0">
            {context}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {items.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-sm">
              No source evidence available for this item.
            </div>
          ) : (
            groups.map((group) => {
              const formulaKey = Object.keys(FORMULA_MAP).find((k) =>
                group.items.some((i) => i.label.toLowerCase().includes(k))
              );
              const formulaInfo = formulaKey ? FORMULA_MAP[formulaKey] : null;

              return (
                <div key={group.key} className="space-y-3">
                  {/* Filing group header */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {group.form && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-zinc-900 text-white uppercase tracking-wider">
                        {group.form}
                      </span>
                    )}
                    {group.filedDate && (
                      <span className="text-xs text-zinc-500">
                        Filed: <span className="font-semibold text-zinc-700">{fmtDate(group.filedDate)}</span>
                      </span>
                    )}
                    {group.accessionNumber && (
                      <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                        {group.accessionNumber}
                      </span>
                    )}
                    {!group.form && !group.filedDate && (
                      <span className="text-xs font-semibold text-zinc-600">
                        Period ending {fmtDate(group.items[0]?.periodEnd)}
                      </span>
                    )}
                  </div>

                  {/* Calculation explanation */}
                  {formulaInfo && (
                    <div className="bg-blue-50/60 border border-blue-100 rounded-lg px-4 py-3 space-y-1.5">
                      <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Calculation</p>
                      <p className="text-xs text-blue-800">
                        <span className="font-semibold">Uses:</span> {formulaInfo.uses.join(", ")}
                      </p>
                      <p className="text-xs font-mono text-blue-900 bg-blue-100/60 rounded px-2 py-1">
                        {formulaInfo.formula}
                      </p>
                    </div>
                  )}

                  {/* Evidence table */}
                  <div className="border border-zinc-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">
                          <th className="px-3 py-2">Metric / Concept</th>
                          <th className="px-3 py-2 text-right">Value</th>
                          <th className="px-3 py-2 text-center w-28">Period End</th>
                          <th className="px-3 py-2 text-center w-20">Status</th>
                          <th className="px-3 py-2 text-center w-20">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 bg-white">
                        {group.items.map((item, iIdx) => (
                          <tr key={iIdx} className="hover:bg-zinc-50/60 transition-colors">
                            <td className="px-3 py-3">
                              <div className="font-semibold text-zinc-900">{item.label}</div>
                              <div className="text-[9px] font-mono text-zinc-400 mt-0.5 break-all">{item.concept}</div>
                              {item.usedFor && (
                                <div className="text-[9px] text-zinc-500 mt-1 italic">{item.usedFor}</div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold text-zinc-950 whitespace-nowrap">
                              {fmtValue(item.value, item.unit)}
                              <div className="text-[9px] text-zinc-400 font-sans font-normal mt-0.5">{item.unit}</div>
                            </td>
                            <td className="px-3 py-3 text-center text-zinc-600 whitespace-nowrap text-[10px]">
                              {fmtDate(item.periodEnd)}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {item.isVerified ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-bold whitespace-nowrap">
                                  <CheckCircle className="w-2.5 h-2.5" />
                                  VERIFIED
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold whitespace-nowrap">
                                  Derived
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {item.sourceUrl ? (
                                <a
                                  href={item.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-800 hover:text-blue-700 font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-700 rounded"
                                  title="Open SEC EDGAR filing"
                                >
                                  <span>SEC</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 rounded-b-2xl flex-shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-zinc-400">
            All VERIFIED facts sourced directly from SEC EDGAR XBRL structured data.
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:text-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
