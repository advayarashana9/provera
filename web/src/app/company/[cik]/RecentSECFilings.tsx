"use client";

import React from "react";
import { useSWR } from "@/lib/useSWR";
import { getRecentFilings, FilingSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface RecentSECFilingsProps {
  cik: number;
}

export default function RecentSECFilings({ cik }: RecentSECFilingsProps) {
  const fetcher = React.useCallback(() => getRecentFilings(cik, "10-K,10-Q,8-K", 20), [cik]);
  const { data, error, isValidating } = useSWR(`recent_filings_${cik}`, fetcher);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-750 text-xs rounded-xl p-4 shadow-sm">
        <p className="font-semibold">Unable to load recent filings.</p>
      </div>
    );
  }

  const filings = data?.filings || [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900">Recent SEC Filings</h2>
        {isValidating && (
          <span className="text-[10px] text-zinc-400 font-semibold animate-pulse font-sans">
            Refreshing…
          </span>
        )}
      </div>

      {!data ? (
        // Loading state
        <div className="border border-zinc-200 rounded bg-white overflow-hidden shadow-sm animate-pulse">
          <div className="bg-zinc-50 border-b border-zinc-200 h-10 w-full"></div>
          <div className="p-4 space-y-4">
            <div className="h-4 bg-zinc-100 rounded w-5/6"></div>
            <div className="h-4 bg-zinc-100 rounded w-3/4"></div>
            <div className="h-4 bg-zinc-100 rounded w-4/5"></div>
          </div>
        </div>
      ) : filings.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded p-6 text-center text-sm text-zinc-500">
          No recent filings found.
        </div>
      ) : (
        <div className="border border-zinc-200 rounded bg-white overflow-hidden shadow-sm">
          <table className="min-w-full divide-y divide-zinc-200 text-xs font-sans">
            <thead className="bg-zinc-50 font-semibold text-zinc-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left">Form</th>
                <th scope="col" className="px-6 py-3 text-left">Filing Date</th>
                <th scope="col" className="px-6 py-3 text-left">Report Date</th>
                <th scope="col" className="px-6 py-3 text-left">Primary Document</th>
                <th scope="col" className="px-6 py-3 text-right">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 font-normal text-zinc-600">
              {filings.map((filing: FilingSummary) => (
                <tr key={filing.accession_number} className="interactive-row hover:bg-zinc-50/50">
                  <td className="px-6 py-3.5">
                    <span className="font-mono font-bold text-xs bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded">
                      {filing.form}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 whitespace-nowrap">{formatDate(filing.filing_date)}</td>
                  <td className="px-6 py-3.5 whitespace-nowrap">{formatDate(filing.report_date)}</td>
                  <td className="px-6 py-3.5 truncate max-w-sm">
                    <div className="font-medium text-zinc-900">{filing.primary_document}</div>
                    {filing.primary_document_description && (
                      <div className="text-[10px] text-zinc-400 mt-0.5 truncate">{filing.primary_document_description}</div>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <a
                      href={filing.sec_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:text-indigo-900 hover:underline font-semibold"
                    >
                      SEC Document &rarr;
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
