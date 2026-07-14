"use client";

import React from "react";
import { useSWR } from "@/lib/useSWR";
import { verifyCompany, VerificationFinding } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent, formatDate } from "@/lib/format";

interface VerificationDashboardProps {
  cik: number;
}

export default function VerificationDashboard({ cik }: VerificationDashboardProps) {
  const fetcher = React.useCallback(() => verifyCompany(cik, "10-K,10-Q", 8), [cik]);
  const { data: verification, error, isValidating } = useSWR(`verify_${cik}`, fetcher);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-750 text-xs rounded-xl p-4 shadow-sm">
        <p className="font-semibold">Unable to run verification checks.</p>
      </div>
    );
  }

  const findings = verification?.findings || [];

  return (
    <div id="verification" className="space-y-12" data-scroll-section="Verification">
      {/* Verification Summary Dashboard */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">Verification Summary</h2>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500 font-medium font-sans">
            {!verification ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-ping"></span>
                <span>Running deterministic checks...</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-600"></span>
                <span>Verification complete</span>
                {isValidating && <span className="ml-1 text-[10px] text-zinc-400 font-semibold animate-pulse">(Refreshing…)</span>}
              </>
            )}
          </span>
        </div>

        {!verification ? (
          // Skeletons
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center h-20 flex flex-col justify-center space-y-2">
                <div className="h-6 bg-zinc-100 rounded w-1/2 mx-auto"></div>
                <div className="h-3 bg-zinc-50 rounded w-3/4 mx-auto"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 animate-fadeIn">
            <div className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center">
              <div className="text-2xl font-bold tracking-tight text-zinc-900">{verification.checks_run}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">Checks Run</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center">
              <div className="text-2xl font-bold tracking-tight text-green-700">{verification.checks_passed}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">Checks Passed</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center">
              <div className="text-2xl font-bold tracking-tight text-red-600">{verification.confirmed_inconsistencies}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">Confirmed Inconsistencies</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center">
              <div className="text-2xl font-bold tracking-tight text-amber-600">{verification.review_items}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">Review Items</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-4 shadow-sm text-center">
              <div className="text-2xl font-bold tracking-tight text-zinc-500">{verification.skipped_checks}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mt-1">Skipped Checks</div>
            </div>
          </div>
        )}
      </section>

      {/* Verification Findings Section */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900">Verification Findings</h2>
        {!verification ? (
          // Loading skeleton for findings
          <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm space-y-4 animate-pulse">
            <div className="h-4 bg-zinc-100 rounded w-1/3"></div>
            <div className="h-16 bg-zinc-50 rounded w-full"></div>
          </div>
        ) : findings.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm space-y-2 animate-fadeIn">
            <p className="text-sm font-medium text-zinc-800">
              No confirmed inconsistencies or review items were found in the compatible facts examined.
            </p>
            <p className="text-xs text-zinc-500">
              Skipped checks indicate that sufficiently compatible XBRL facts were not available for comparison.
            </p>
          </div>
        ) : (
          <div className="space-y-6 animate-fadeIn">
            {findings.map((finding: VerificationFinding, idx: number) => {
              const isUsd = finding.unit.toUpperCase() === "USD";
              const formatValue = isUsd ? formatCurrency : formatNumber;
              const isError = finding.status === "confirmed_inconsistency";

              return (
                <div
                  key={`${finding.check_id}-${idx}`}
                  className={`bg-white border rounded shadow-sm overflow-hidden ${
                    isError ? "border-red-200" : "border-amber-200"
                  }`}
                >
                  {/* Findings Card Header */}
                  <div className={`px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b ${
                    isError ? "bg-red-50/50 border-red-100" : "bg-amber-50/50 border-amber-100"
                  }`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          isError ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                        }`}>
                          {finding.status.replace("_", " ")}
                        </span>
                        <span className="text-xs font-mono font-medium text-zinc-500">
                          {finding.check_id}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-zinc-900">{finding.title}</h3>
                    </div>
                    
                    {/* Metas */}
                    <div className="flex gap-x-6 text-[11px] font-mono text-zinc-500">
                      <div>
                        <span className="font-sans font-semibold text-zinc-700">Period:</span> {formatDate(finding.period_end)}
                      </div>
                      {finding.form && (
                        <div>
                          <span className="font-sans font-semibold text-zinc-700">Form:</span> {finding.form}
                        </div>
                      )}
                      <div>
                        <span className="font-sans font-semibold text-zinc-700">Severity:</span> <span className="capitalize">{finding.severity}</span>
                      </div>
                      <div>
                        <span className="font-sans font-semibold text-zinc-700">Confidence:</span> {formatPercent(finding.confidence)}
                      </div>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-6 space-y-6">
                    {/* Mismatch & Equation metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-zinc-50 p-4 border border-zinc-150 rounded text-sm">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-500">Reported Value</div>
                        <div className="font-mono text-zinc-900 font-bold">{formatValue(finding.reported_value)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-500">Expected Value</div>
                        <div className="font-mono text-zinc-900 font-bold">{formatValue(finding.expected_value)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-500">Variance / Difference</div>
                        <div className="font-mono text-red-600 font-bold">
                          {formatValue(finding.difference)}
                          {finding.relative_difference !== null && finding.relative_difference !== undefined && (
                            <span className="text-xs text-zinc-500 font-normal ml-2">
                              ({formatPercent(finding.relative_difference)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Explanation Texts */}
                    <div className="space-y-4 text-sm leading-6">
                      <div>
                        <h4 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider mb-1">Explanation</h4>
                        <p className="text-zinc-700 font-normal">{finding.explanation}</p>
                      </div>

                      {finding.equation && (
                        <div>
                          <h4 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider mb-1">Equation Evaluated</h4>
                          <code className="text-xs font-mono bg-zinc-100 text-zinc-800 px-2 py-1 rounded block w-fit border border-zinc-150">
                            {finding.equation}
                          </code>
                        </div>
                      )}

                      {finding.possible_explanations && finding.possible_explanations.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider mb-1">Possible Explanations</h4>
                          <ul className="list-disc list-inside space-y-1 text-zinc-600 text-xs">
                            {finding.possible_explanations.map((exp, idx) => (
                              <li key={idx} className="font-normal">{exp}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Evidence Sub-Table */}
                    <div className="space-y-2">
                      <h4 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider">Source Evidence</h4>
                      <div className="border border-zinc-200 rounded overflow-hidden">
                        <table className="min-w-full divide-y divide-zinc-200 text-xs font-sans">
                          <thead className="bg-zinc-50 font-semibold text-zinc-700">
                            <tr>
                              <th scope="col" className="px-4 py-2 text-left">Concept</th>
                              <th scope="col" className="px-4 py-2 text-left">Label</th>
                              <th scope="col" className="px-4 py-2 text-right">Value</th>
                              <th scope="col" className="px-4 py-2 text-left">Unit</th>
                              <th scope="col" className="px-4 py-2 text-left">Period</th>
                              <th scope="col" className="px-4 py-2 text-right">Source</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200 bg-white font-normal text-zinc-600">
                            {finding.evidence.map((ev, evIdx) => {
                              const evIsUsd = ev.unit.toUpperCase() === "USD";
                              const formatEvVal = evIsUsd ? formatCurrency : formatNumber;
                              const dateStr = ev.start_date
                                ? `${formatDate(ev.start_date)} to ${formatDate(ev.end_date)}`
                                : formatDate(ev.end_date);

                              return (
                                <tr key={evIdx} className="interactive-row hover:bg-zinc-50/50">
                                  <td className="px-4 py-2 font-mono text-[11px] text-zinc-900">{ev.concept}</td>
                                  <td className="px-4 py-2 truncate max-w-xs">{ev.label || "—"}</td>
                                  <td className="px-4 py-2 text-right font-mono font-medium text-zinc-900">
                                    {formatEvVal(ev.value)}
                                  </td>
                                  <td className="px-4 py-2 font-mono text-[10px] uppercase">{ev.unit}</td>
                                  <td className="px-4 py-2 whitespace-nowrap">{dateStr}</td>
                                  <td className="px-4 py-2 text-right">
                                    {ev.source_url ? (
                                      <a
                                        href={ev.source_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-indigo-600 hover:text-indigo-900 hover:underline font-semibold"
                                      >
                                        SEC Folder &rarr;
                                      </a>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
