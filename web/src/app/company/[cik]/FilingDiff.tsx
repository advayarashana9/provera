"use client";

import React, { useState, useEffect, useRef } from "react";
import { FilingSummary, compareFilings, FilingDiffResponse, getRecentFilings } from "@/lib/api";
import { formatPercent, formatDate } from "@/lib/format";

/** Canonical normalizer: strips dashes and whitespace. Used for comparison only — display uses original. */
function normAcc(acc: string): string {
  return acc.replace(/-/g, "").trim();
}

/** True only when the string has exactly 18 digits (no dashes) or 20-char dashed format. */
function isValidAccession(acc: string): boolean {
  const stripped = normAcc(acc);
  return /^\d{18}$/.test(stripped);
}

interface FilingDiffProps {
  cik: number;
  // filings prop is no longer used; component fetches its own validated list.
  // Kept for API compatibility with the page so no other file needs changing.
  filings?: FilingSummary[];
}

interface DiffState {
  compareOptions: FilingSummary[];
  isFetchingFilings: boolean;
  olderAccession: string;
  newerAccession: string;
  isLoading: boolean;
  error: string | null;
  diffResult: FilingDiffResponse | null;
  expandedSection: string | null;
  showAllMetrics: boolean;
}

type DiffAction =
  | { type: "RESET_FOR_CIK" }
  | { type: "SET_FILINGS"; options: FilingSummary[]; defaultNewer: string; defaultOlder: string }
  | { type: "FETCH_DONE" }
  | { type: "SET_OLDER"; acc: string }
  | { type: "SET_NEWER"; acc: string }
  | { type: "COMPARE_START" }
  | { type: "COMPARE_SUCCESS"; result: FilingDiffResponse }
  | { type: "COMPARE_ERROR"; error: string; badAcc?: string }
  | { type: "TOGGLE_SECTION"; section: string | null }
  | { type: "TOGGLE_METRICS" }
  | { type: "REMOVE_OPTION"; normBadAcc: string };

const initialState: DiffState = {
  compareOptions: [],
  isFetchingFilings: true,
  olderAccession: "",
  newerAccession: "",
  isLoading: false,
  error: null,
  diffResult: null,
  expandedSection: null,
  showAllMetrics: false,
};

function diffReducer(state: DiffState, action: DiffAction): DiffState {
  switch (action.type) {
    case "RESET_FOR_CIK":
      return { ...initialState };
    case "SET_FILINGS":
      return {
        ...state,
        compareOptions: action.options,
        newerAccession: action.defaultNewer,
        olderAccession: action.defaultOlder,
      };
    case "FETCH_DONE":
      return { ...state, isFetchingFilings: false };
    case "SET_OLDER":
      return { ...state, olderAccession: action.acc };
    case "SET_NEWER":
      return { ...state, newerAccession: action.acc };
    case "COMPARE_START":
      return { ...state, isLoading: true, error: null, diffResult: null, expandedSection: null, showAllMetrics: false };
    case "COMPARE_SUCCESS":
      return { ...state, isLoading: false, diffResult: action.result };
    case "COMPARE_ERROR": {
      const next = { ...state, isLoading: false, error: action.error };
      if (action.badAcc) {
        const norm = action.badAcc;
        next.compareOptions = next.compareOptions.filter(
          (f) => normAcc(f.accession_number) !== norm
        );
        if (normAcc(next.olderAccession) === norm) next.olderAccession = "";
        if (normAcc(next.newerAccession) === norm) next.newerAccession = "";
      }
      return next;
    }
    case "TOGGLE_SECTION":
      return { ...state, expandedSection: action.section };
    case "TOGGLE_METRICS":
      return { ...state, showAllMetrics: !state.showAllMetrics };
    case "REMOVE_OPTION":
      return {
        ...state,
        compareOptions: state.compareOptions.filter(
          (f) => normAcc(f.accession_number) !== action.normBadAcc
        ),
        olderAccession: normAcc(state.olderAccession) === action.normBadAcc ? "" : state.olderAccession,
        newerAccession: normAcc(state.newerAccession) === action.normBadAcc ? "" : state.newerAccession,
      };
    default:
      return state;
  }
}

export default function FilingDiff({ cik }: FilingDiffProps) {
  const [state, dispatch] = React.useReducer(diffReducer, initialState);
  const {
    compareOptions, isFetchingFilings,
    olderAccession, newerAccession,
    isLoading, error, diffResult, expandedSection, showAllMetrics,
  } = state;

  const [diffSeconds, setDiffSeconds] = useState(0);
  useEffect(() => {
    if (!isLoading) {
      setDiffSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setDiffSeconds((s: number) => s + 0.5);
    }, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  const getDiffLabel = () => {
    if (diffSeconds < 1.0) return "Fetching filings...";
    if (diffSeconds < 2.5) return "Comparing financial facts...";
    return "Comparing narrative sections...";
  };

  // Track current CIK so that in-flight fetches from a previous CIK are ignored.
  const currentCikRef = useRef(cik);

  useEffect(() => {
    currentCikRef.current = cik;
    dispatch({ type: "RESET_FOR_CIK" });
    let cancelled = false;

    async function fetchFilings() {
      try {
        // Fetch 10-K and 10-Q filings with limit=50 — same filter the backend validates against.
        const result = await getRecentFilings(cik, "10-K,10-Q", 50);
        if (cancelled || currentCikRef.current !== cik) return;

        // Deduplicate by normalized accession number and exclude malformed ones.
        const seen = new Set<string>();
        const valid: FilingSummary[] = [];
        for (const f of result.filings) {
          const norm = normAcc(f.accession_number);
          if (!isValidAccession(f.accession_number)) continue;
          if (seen.has(norm)) continue;
          seen.add(norm);
          valid.push(f);
        }

        // Auto-select a compatible default pair (same form type, two distinct filings).
        const defaultNewer = valid[0]?.accession_number ?? "";
        const defaultOlderFiling = valid.find(
          (f, idx) => idx > 0 && f.form.toUpperCase() === (valid[0]?.form ?? "").toUpperCase()
        );
        dispatch({
          type: "SET_FILINGS",
          options: valid,
          defaultNewer,
          defaultOlder: defaultOlderFiling?.accession_number ?? "",
        });
      } catch {
        if (cancelled || currentCikRef.current !== cik) return;
        // Non-fatal: leave compareOptions empty, show empty state.
      } finally {
        if (!cancelled && currentCikRef.current === cik) {
          dispatch({ type: "FETCH_DONE" });
        }
      }
    }

    fetchFilings();
    return () => { cancelled = true; };
  }, [cik]);

  const selectedOlder = compareOptions.find((f) => normAcc(f.accession_number) === normAcc(olderAccession));
  const selectedNewer = compareOptions.find((f) => normAcc(f.accession_number) === normAcc(newerAccession));

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!olderAccession || !newerAccession || isLoading) return;

    if (normAcc(olderAccession) === normAcc(newerAccession)) {
      dispatch({ type: "COMPARE_ERROR", error: "Cannot compare a filing with itself. Please select two different filings." });
      return;
    }

    dispatch({ type: "COMPARE_START" });

    try {
      const response = await compareFilings(cik, olderAccession, newerAccession);
      dispatch({ type: "COMPARE_SUCCESS", result: response });
    } catch (err: unknown) {
      console.error("Comparison error:", err);
      const raw = err instanceof Error ? err.message : "";

      // Detect backend ownership rejection and show a user-friendly message.
      // Also remove the invalid accession from the dropdown via the reducer.
      if (raw.includes("invalid or does not belong")) {
        const badAcc = raw.match(/Accession number ([\w-]+)/)?.[1] ?? "";
        dispatch({
          type: "COMPARE_ERROR",
          error: "The selected filing is no longer available for this company. Please choose another filing.",
          badAcc: badAcc ? normAcc(badAcc) : undefined,
        });
      } else {
        dispatch({ type: "COMPARE_ERROR", error: raw || "Failed to retrieve comparison." });
      }
    }
  };

  const formatCompact = (value: number, unit: string): string => {
    const isUsd = unit.toUpperCase() === "USD";
    const absVal = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    let numStr = "";
    if (absVal >= 1e12) {
      numStr = `${(absVal / 1e12).toFixed(1)}T`;
    } else if (absVal >= 1e9) {
      numStr = `${(absVal / 1e9).toFixed(1)}B`;
    } else if (absVal >= 1e6) {
      numStr = `${(absVal / 1e6).toFixed(1)}M`;
    } else if (absVal >= 1e3) {
      numStr = `${(absVal / 1e3).toFixed(1)}K`;
    } else {
      numStr = absVal.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    return isUsd ? `${sign}$${numStr}` : `${sign}${numStr} ${unit}`;
  };

  // Safe basic markdown rendering for the summary
  const renderMarkdown = (text: string) => {
    const paragraphs = text.split("\n\n");
    return paragraphs.map((para, idx) => {
      const inlineRegex = /(\*\*.*?\*\*)/g;
      const parts = para.split(inlineRegex);
      return (
        <p key={idx} className="mb-3 text-zinc-800 text-sm leading-relaxed last:mb-0 select-text font-normal font-sans">
          {parts.map((part, pIdx) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return <strong key={pIdx} className="font-bold text-zinc-950">{part.slice(2, -2)}</strong>;
            }
            return part;
          })}
        </p>
      );
    });
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 font-serif">Compare Filings</h2>
      </div>

      <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm space-y-6 font-sans">
        {/* Loading skeleton while fetching filing list */}
        {isFetchingFilings && (
          <div className="space-y-3 py-2">
            <div className="h-3 shimmer-bg rounded w-1/4"></div>
            <div className="h-9 shimmer-bg rounded"></div>
            <div className="h-9 shimmer-bg rounded"></div>
          </div>
        )}

        {/* No valid filings */}
        {!isFetchingFilings && compareOptions.length === 0 && (
          <div className="text-center py-10 border border-dashed border-zinc-200 bg-zinc-50/20 rounded">
            <p className="text-zinc-500 text-sm font-medium">
              No 10-K or 10-Q filings available for this company.
            </p>
          </div>
        )}

        {/* Dropdowns controls */}
        {!isFetchingFilings && compareOptions.length > 0 && (
        <form onSubmit={handleCompare} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Base Filing (Older Period)
            </label>
            <select
              value={olderAccession}
              onChange={(e) => dispatch({ type: "SET_OLDER", acc: e.target.value })}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 bg-white shadow-xs transition-all"
            >
              <option value="">Select older filing...</option>
              {compareOptions.map((f) => {
                const isFormIncompatible = selectedNewer && f.form.toUpperCase() !== selectedNewer.form.toUpperCase();
                return (
                  <option
                    key={f.accession_number}
                    value={f.accession_number}
                    disabled={normAcc(f.accession_number) === normAcc(newerAccession) || !!isFormIncompatible}
                  >
                    {f.form} ({formatDate(f.report_date)}) — {f.accession_number}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Compare Filing (Newer Period)
            </label>
            <select
              value={newerAccession}
              onChange={(e) => dispatch({ type: "SET_NEWER", acc: e.target.value })}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 bg-white shadow-xs transition-all"
            >
              <option value="">Select newer filing...</option>
              {compareOptions.map((f) => {
                const isFormIncompatible = selectedOlder && f.form.toUpperCase() !== selectedOlder.form.toUpperCase();
                return (
                  <option
                    key={f.accession_number}
                    value={f.accession_number}
                    disabled={normAcc(f.accession_number) === normAcc(olderAccession) || !!isFormIncompatible}
                  >
                    {f.form} ({formatDate(f.report_date)}) — {f.accession_number}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="md:col-span-1">
            <button
              type="submit"
              disabled={isLoading || !olderAccession || !newerAccession || normAcc(olderAccession) === normAcc(newerAccession)}
              className="w-full px-4 py-2 bg-blue-800 hover:bg-blue-700 disabled:bg-zinc-100 text-white disabled:text-zinc-400 font-semibold rounded-lg text-sm transition-all active:scale-[0.98] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              {isLoading ? getDiffLabel() : "Compare"}
            </button>
          </div>
        </form>
        )}

        {/* Error panel */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-750 text-xs rounded-xl p-4 shadow-sm space-y-3 flex flex-col animate-fadeIn">
            <div className="font-bold flex items-center gap-1 text-red-900 text-xs uppercase tracking-wider">⚠️ validation failed</div>
            <p className="font-semibold text-red-700 mt-1 leading-normal">{error}</p>
            <button
              onClick={handleCompare}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-900 text-white rounded-lg text-[10px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-700 w-fit cursor-pointer active:scale-[0.98] shadow-xs"
            >
              Retry Comparison
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-6 py-6 animate-pulse">
            {/* Spinner + Loading comparison... */}
            <div className="flex flex-col items-center justify-center py-6 space-y-3">
              <svg className="animate-spin h-6 w-6 text-blue-800" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div className="text-center space-y-1">
                <h4 className="text-xs font-bold text-zinc-900 font-serif">Loading comparison…</h4>
                <p className="text-[10px] text-zinc-500 font-sans">Calculating text similarities and metric differentials…</p>
              </div>
            </div>

            {/* Changed metrics list skeleton */}
            <div className="space-y-3">
              <div className="h-4 w-1/4 shimmer-bg rounded"></div>
              <div className="border border-zinc-200 rounded-lg bg-white divide-y divide-zinc-100 overflow-hidden">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-3.5 flex items-center justify-between">
                    <div className="space-y-1 w-1/3">
                      <div className="h-4 w-2/3 shimmer-bg rounded"></div>
                      <div className="h-3 w-1/2 shimmer-bg rounded"></div>
                    </div>
                    <div className="h-4 w-16 shimmer-bg rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!diffResult && !isLoading && !error && (
          <div className="text-center py-10 border border-dashed border-zinc-250 bg-zinc-50/20 rounded">
            <p className="text-zinc-500 text-sm font-medium">
              Select two filings above and click Compare to analyze changes.
            </p>
          </div>
        )}

        {/* Comparison Result Panel */}
        {diffResult && !isLoading && (
          <div className="space-y-6">
            {/* Summary details card */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-zinc-150 bg-zinc-50/50 rounded gap-4">
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Comparing Filing Documents
                </p>
                <div className="text-sm font-medium text-zinc-800 mt-1 flex flex-wrap gap-2 items-center">
                  <span className="font-bold text-zinc-900">{diffResult.older_filing.form} ({formatDate(diffResult.older_filing.report_date)})</span>
                  <span className="text-zinc-400">&rarr;</span>
                  <span className="font-bold text-zinc-900">{diffResult.newer_filing.form} ({formatDate(diffResult.newer_filing.report_date)})</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <a
                  href={diffResult.older_filing.sec_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 bg-white border border-zinc-200 rounded hover:bg-zinc-50 transition-colors text-zinc-600"
                >
                  Open Older Filing
                </a>
                <a
                  href={diffResult.newer_filing.sec_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 bg-white border border-zinc-200 rounded hover:bg-zinc-50 transition-colors text-zinc-600"
                >
                  Open Newer Filing
                </a>
              </div>
            </div>

            {/* Compact Headline Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-zinc-200 rounded p-4 text-center">
                <div className="text-xl font-bold text-zinc-950">
                  {diffResult.metric_changes.length}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">
                  Changed Metrics
                </div>
              </div>
              <div className="bg-white border border-zinc-200 rounded p-4 text-center">
                <div className="text-xl font-bold text-zinc-950">
                  {diffResult.section_changes.filter(s => s.change_type !== "unchanged").length}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">
                  Changed Sections
                </div>
              </div>
              <div className="bg-white border border-zinc-200 rounded p-4 text-center">
                <div className="text-xl font-bold text-zinc-950 truncate" title={diffResult.largest_financial_change !== null && diffResult.largest_financial_change !== undefined ? formatCompact(diffResult.largest_financial_change, "USD") : "N/A"}>
                  {diffResult.largest_financial_change !== null && diffResult.largest_financial_change !== undefined 
                    ? formatCompact(diffResult.largest_financial_change, "USD") 
                    : "N/A"}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">
                  Largest Abs Change
                </div>
              </div>
              <div className="bg-white border border-zinc-200 rounded p-4 text-center">
                <div className="text-xl font-bold text-zinc-950">
                  {diffResult.similarity_percentage.toFixed(1)}%
                </div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">
                  Text Similarity
                </div>
                <div className="text-[8px] text-zinc-400 mt-0.5 leading-none">
                  Does not imply quality or risk
                </div>
              </div>
            </div>

            {/* Key Takeaways Card */}
            {diffResult.key_takeaways && diffResult.key_takeaways.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Key Takeaways
                </h3>
                <div className="bg-zinc-50/50 border border-zinc-200 rounded p-5 shadow-sm">
                  <ul className="space-y-2.5 list-none pl-0 m-0">
                    {diffResult.key_takeaways.slice(0, 5).map((takeaway, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-zinc-800 text-sm leading-relaxed">
                        <span className="text-indigo-500 font-bold select-none mt-0.5">&bull;</span>
                        <span className="select-text font-medium">{takeaway}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Generated summary section */}
            {diffResult.generated_summary && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  AI Comparison Summary
                </h3>
                <div className="bg-zinc-50 border border-zinc-150 rounded p-4">
                  {renderMarkdown(diffResult.generated_summary)}
                </div>
              </div>
            )}

            {/* Metric changes table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Financial Metric Changes
              </h3>
              {(() => {
                const sortedMetrics = [...diffResult.metric_changes].sort((a, b) => {
                  const aPct = a.percentage_change !== null && a.percentage_change !== undefined ? Math.abs(a.percentage_change) : 0;
                  const bPct = b.percentage_change !== null && b.percentage_change !== undefined ? Math.abs(b.percentage_change) : 0;
                  if (bPct !== aPct) {
                    return bPct - aPct;
                  }
                  return Math.abs(b.absolute_change) - Math.abs(a.absolute_change);
                });

                const displayedMetrics = showAllMetrics ? sortedMetrics : sortedMetrics.slice(0, 10);

                if (sortedMetrics.length === 0) {
                  return <p className="text-xs text-zinc-500 font-medium font-sans">No matching financial metric changes detected.</p>;
                }

                return (
                  <div className="border border-zinc-200 rounded overflow-hidden w-full bg-white">
                    <div className="overflow-x-auto w-full">
                      <table className="min-w-full divide-y divide-zinc-200 text-[11px] text-left text-zinc-600 font-sans table-auto">
                        <thead className="bg-zinc-50 font-bold text-zinc-700">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold">Concept Label / ID</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Older Value</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Newer Value</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Change</th>
                            <th className="px-4 py-2.5 text-right font-semibold">Percent</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-250 bg-white">
                          {displayedMetrics.map((m, mIdx) => {
                            const isNeg = m.absolute_change < 0;
                            return (
                              <tr key={mIdx} className="interactive-row hover:bg-zinc-50/50">
                                <td className="px-4 py-2.5 break-words min-w-[140px] whitespace-normal">
                                  <span 
                                    className="font-medium text-zinc-900 select-text cursor-help"
                                    title={m.concept}
                                  >
                                    {m.label || m.concept}
                                  </span>
                                  <div 
                                    className="text-[9px] text-zinc-400 font-mono mt-0.5 break-all whitespace-normal select-text"
                                    title={m.concept}
                                  >
                                    {m.concept}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-zinc-800 whitespace-nowrap">
                                  {formatCompact(m.older_value, m.unit)}
                                  <div className="text-[9px] text-zinc-400 font-sans mt-0.5">{formatDate(m.older_period_end)}</div>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-zinc-800 whitespace-nowrap">
                                  {formatCompact(m.newer_value, m.unit)}
                                  <div className="text-[9px] text-zinc-400 font-sans mt-0.5">{formatDate(m.newer_period_end)}</div>
                                </td>
                                <td className={`px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap ${isNeg ? 'text-red-600' : 'text-green-700'}`}>
                                  {m.absolute_change > 0 ? "+" : ""}{formatCompact(m.absolute_change, m.unit)}
                                </td>
                                <td className={`px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap ${isNeg ? 'text-red-600' : 'text-green-700'}`}>
                                  {m.percentage_change !== null && m.percentage_change !== undefined
                                    ? `${m.percentage_change > 0 ? "+" : ""}${formatPercent(m.percentage_change)}`
                                    : "N/M"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {sortedMetrics.length > 10 && (
                      <div className="flex justify-center p-3 border-t border-zinc-200 bg-zinc-50/30">
                        <button
                          type="button"
                          onClick={() => dispatch({ type: "TOGGLE_METRICS" })}
                          className="px-4 py-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded text-xs font-semibold text-zinc-700 hover:text-zinc-900 transition-colors shadow-sm focus:outline-none"
                        >
                          {showAllMetrics ? "Show less" : `Show all metrics (${sortedMetrics.length} total)`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Changed filing sections */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Changed Filing Sections
              </h3>
              <div className="border border-zinc-200 rounded divide-y divide-zinc-200">
                {diffResult.section_changes.map((sec, sIdx) => {
                  const isExpanded = expandedSection === sec.section;
                  const getBadgeClass = (type: string) => {
                    switch (type.toLowerCase()) {
                      case "added":
                        return "bg-green-50 text-green-700 border-green-200";
                      case "removed":
                        return "bg-red-50 text-red-700 border-red-200";
                      case "modified":
                        return "bg-amber-50 text-amber-700 border-amber-200";
                      default:
                        return "bg-zinc-100 text-zinc-500 border-zinc-200";
                    }
                  };

                  return (
                    <div key={sIdx} className="bg-white">
                      {/* Section Header */}
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "TOGGLE_SECTION", section: isExpanded ? null : sec.section })}
                        className="w-full flex items-center justify-between p-4 hover:bg-zinc-50/50 text-left focus:outline-none transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-zinc-800">{sec.section}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getBadgeClass(sec.change_type)}`}>
                            {sec.change_type}
                          </span>
                        </div>
                        <span className="text-zinc-400 text-xs font-bold">
                          {isExpanded ? "Collapse" : "Expand"}
                        </span>
                      </button>

                      {/* Expanded Section Panel */}
                      {isExpanded && (
                        <div className="p-4 bg-zinc-50/30 border-t border-zinc-100 space-y-4 animate-fadeIn">
                          <div>
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                              Change Details
                            </p>
                            <p className="text-xs text-zinc-700 font-medium mt-1 leading-relaxed">
                              {sec.summary}
                            </p>
                          </div>

                          {/* Excerpts panel */}
                          {sec.change_type !== "unchanged" && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {/* Older Excerpt */}
                              <div className="border border-zinc-200/60 rounded bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                  <span>Older Document Excerpt</span>
                                  {sec.older_source_url && (
                                    <a
                                      href={sec.older_source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-indigo-600 hover:text-indigo-900 normal-case hover:underline font-semibold"
                                    >
                                      SEC Link &rarr;
                                    </a>
                                  )}
                                </div>
                                <div className="text-xs font-mono text-zinc-600 bg-zinc-50 p-2.5 rounded border border-zinc-100/50 max-h-48 overflow-y-auto leading-relaxed select-text whitespace-pre-wrap">
                                  {sec.older_excerpt || "(Section was empty or not present)"}
                                </div>
                              </div>

                              {/* Newer Excerpt */}
                              <div className="border border-zinc-200/60 rounded bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                  <span>Newer Document Excerpt</span>
                                  {sec.newer_source_url && (
                                    <a
                                      href={sec.newer_source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-indigo-600 hover:text-indigo-900 normal-case hover:underline font-semibold"
                                    >
                                      SEC Link &rarr;
                                    </a>
                                  )}
                                </div>
                                <div className="text-xs font-mono text-zinc-650 bg-zinc-50 p-2.5 rounded border border-zinc-100/50 max-h-48 overflow-y-auto leading-relaxed select-text whitespace-pre-wrap">
                                  {sec.newer_excerpt || "(Section was empty or not present)"}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
