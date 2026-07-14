import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompanyOverview, getRecentFilings, verifyCompany } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent, formatDate, formatCIK, formatFiscalYearEnd } from "@/lib/format";
import HeaderSearch from "./HeaderSearch";
import AskFilingLens from "./AskFilingLens";
import FilingDiff from "./FilingDiff";
import FinancialDashboard from "./FinancialDashboard";
import PeerComparison from "./PeerComparison";
import SectionNavigation from "./SectionNavigation";

interface PageProps {
  params: Promise<{ cik: string }>;
}

const Logo = () => (
  <div className="flex items-center gap-2 select-none">
    <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-blue-800 text-white shadow-sm">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15l2 2 4-4" />
      </svg>
    </div>
    <span className="font-semibold text-zinc-955 text-sm tracking-tight font-sans">FilingLens</span>
  </div>
);

export default async function CompanyPage({ params }: PageProps) {
  const { cik: rawCik } = await params;
  const cik = parseInt(rawCik, 10);

  if (isNaN(cik)) {
    return notFound();
  }

  // Fetch all necessary profile and verification data in parallel
  let overview;
  let filingsData;
  let verification;

  try {
    [overview, filingsData, verification] = await Promise.all([
      getCompanyOverview(cik),
      getRecentFilings(cik, "10-K,10-Q,8-K", 20),
      verifyCompany(cik, "10-K,10-Q", 8)
    ]);
  } catch (err) {
    // Let Next.js Error Boundary catch the error
    throw err;
  }

  const { filings } = filingsData;
  const { findings } = verification;

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900">
      {/* Header bar */}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link href="/" scroll={true} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 rounded-lg">
            <Logo />
          </Link>
          <HeaderSearch />
        </div>
      </header>

      {/* Sticky Sub-Navigation */}
      <SectionNavigation key={cik} />

      {/* Main Content */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-6 py-10 space-y-12">
        {/* Back Link */}
        <div className="mb-2">
          <Link href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded w-fit">
            &larr; Return to search
          </Link>
        </div>

        {/* Company Header Card */}
        <section className="bg-white border border-zinc-200 rounded p-6 shadow-sm animate-fade-in-up">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 font-serif">
                {overview.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-zinc-500">
                <span>CIK: {formatCIK(overview.cik)}</span>
                {overview.tickers && overview.tickers.length > 0 && (
                  <span>Ticker: {overview.tickers.join(", ")}</span>
                )}
                {overview.exchanges && overview.exchanges.length > 0 && (
                  <span>Exchange: {overview.exchanges.join(", ")}</span>
                )}
              </div>
            </div>
            <div className="border-t md:border-t-0 md:border-l border-zinc-100 pt-4 md:pt-0 md:pl-6 text-xs text-zinc-500 space-y-1.5">
              <div><span className="font-semibold text-zinc-700">SIC:</span> {overview.sic || "—"} ({overview.sic_description || "No description"})</div>
              <div><span className="font-semibold text-zinc-700">Fiscal Year End:</span> {formatFiscalYearEnd(overview.fiscal_year_end)}</div>
              <div><span className="font-semibold text-zinc-700">State:</span> {overview.state_of_incorporation || "—"}</div>
            </div>
          </div>
        </section>

        {/* Financial Dashboard (Full Width) */}
        <div className="mb-8 animate-fade-in-up" id="dashboard" data-scroll-section="Dashboard">
          <FinancialDashboard key={cik} cik={cik} />
        </div>

        {/* Peer Comparison (Full Width) */}
        <div className="mb-8 animate-fade-in-up" id="peer-comparison" data-scroll-section="Peer Comparison">
          <PeerComparison key={cik} cik={cik} companyName={overview.name} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-fade-in-up">
          {/* Ask FilingLens Assistant (Mobile: stacks first below dashboard, Desktop: sticky right column) */}
          <div className="lg:col-span-1 lg:order-2 lg:sticky lg:top-24" id="ask-filinglens">
            <AskFilingLens key={cik} cik={cik} companyName={overview.name} />
          </div>

          {/* Left Column (Mobile: stacks second, Desktop: spans 2 columns on left) */}
          <div className="lg:col-span-2 lg:order-1 space-y-12">
            {/* Compare Filings (Filing Diff) */}
            <div id="compare-filings" data-scroll-section="Compare Filings">
              <FilingDiff key={cik} cik={cik} filings={filings} />
            </div>

            {/* Verification Summary Dashboard */}
            <div id="verification" className="space-y-12" data-scroll-section="Verification">
              <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900">Verification Summary</h2>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500 font-medium font-sans">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-600"></span>
                  Verification complete
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
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
            </section>

            {/* Verification Findings Section */}
            <section className="space-y-4">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">Verification Findings</h2>
              {findings.length === 0 ? (
                <div className="bg-white border border-zinc-200 rounded p-6 shadow-sm space-y-2">
                  <p className="text-sm font-medium text-zinc-800">
                    No confirmed inconsistencies or review items were found in the compatible facts examined.
                  </p>
                  <p className="text-xs text-zinc-500">
                    Skipped checks indicate that sufficiently compatible XBRL facts were not available for comparison.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {findings.map((finding, idx) => {
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

            {/* Recent SEC Filings */}
            <div id="recent-filings" data-scroll-section="Recent Filings">
            <section className="space-y-4">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">Recent SEC Filings</h2>
              {filings.length === 0 ? (
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
                      {filings.map((filing) => (
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
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-6 text-center text-xs text-zinc-400 font-normal">
          Source data: U.S. SEC EDGAR.
        </div>
      </footer>
    </div>
  );
}
