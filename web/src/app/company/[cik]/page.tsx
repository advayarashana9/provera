import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompanyOverview } from "@/lib/api";
import { formatCIK, formatFiscalYearEnd } from "@/lib/format";
import HeaderSearch from "./HeaderSearch";
import AskFilingLens from "./AskFilingLens";
import FilingDiff from "./FilingDiff";
import FinancialDashboard from "./FinancialDashboard";
import PeerComparison from "./PeerComparison";
import SectionNavigation from "./SectionNavigation";
import VerificationDashboard from "./VerificationDashboard";
import RecentSECFilings from "./RecentSECFilings";

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

  // Fetch only company overview on the server
  let overview;
  try {
    overview = await getCompanyOverview(cik);
  } catch (err) {
    throw err;
  }

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
              <FilingDiff key={cik} cik={cik} />
            </div>

            {/* Verification Summary Dashboard */}
            <VerificationDashboard key={`ver_${cik}`} cik={cik} />

            {/* Recent SEC Filings */}
            <div id="recent-filings" data-scroll-section="Recent Filings">
              <RecentSECFilings key={`filings_${cik}`} cik={cik} />
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
