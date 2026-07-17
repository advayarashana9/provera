"use client";

import React, { useState, useEffect } from "react";
import {
  getPeerComparison,
  searchCompanies,
  PeerComparisonResponse,
  FinancialDashboardResponse
} from "../../../lib/api";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import {
  Search,
  Plus,
  X,
  TrendingUp,
  BarChart3,
  AlertTriangle,
  ArrowRightLeft
} from "lucide-react";

interface Props {
  cik: number;
  companyName: string;
}

interface PeerItem {
  cik: number;
  ticker: string;
  name: string;
}

interface SearchCompanyResult {
  cik: number;
  name: string;
  tickers?: string[];
  exchanges?: string[];
}

interface MetricRow {
  key: string;
  label: string;
  unit: string;
  type: string;
}

interface AlignedChartRow {
  period_end: string;
  [companyTicker: string]: number | string;
}

const COLORS = ["#18181b", "#4f46e5", "#10b981", "#f97316"]; // Zinc 900, Indigo 600, Emerald 600, Orange 500

const METRIC_ROWS: MetricRow[] = [
  { key: "revenue", label: "Revenue", unit: "USD", type: "metric" },
  { key: "net_income", label: "Net Income", unit: "USD", type: "metric" },
  { key: "cash", label: "Cash & Equivalents", unit: "USD", type: "metric" },
  { key: "assets", label: "Total Assets", unit: "USD", type: "metric" },
  { key: "liabilities", label: "Total Liabilities", unit: "USD", type: "metric" },
  { key: "equity", label: "Stockholders' Equity", unit: "USD", type: "metric" },
  { key: "gross_margin", label: "Gross Margin", unit: "%", type: "ratio" },
  { key: "operating_margin", label: "Operating Margin", unit: "%", type: "ratio" },
  { key: "net_margin", label: "Net Margin", unit: "%", type: "ratio" },
  { key: "current_ratio", label: "Current Ratio", unit: "Ratio", type: "ratio" },
  { key: "debt_to_equity", label: "Debt to Equity", unit: "Ratio", type: "ratio" },
  { key: "return_on_assets", label: "Return on Assets", unit: "%", type: "ratio" },
  { key: "return_on_equity", label: "Return on Equity", unit: "%", type: "ratio" }
];

const formatCompact = (val: number | null | undefined, unit: string | null | undefined) => {
  if (val === null || val === undefined) return "—";
  if (unit === "%") {
    return `${(val * (val < 1 && val > -1 ? 100 : 1)).toFixed(2)}%`;
  }
  if (unit === "Ratio") {
    return val.toFixed(2);
  }
  
  const absVal = Math.abs(val);
  const prefix = "$";

  let formatted = "";
  if (absVal >= 1e9) {
    formatted = `${prefix}${(val / 1e9).toFixed(2)}B`;
  } else if (absVal >= 1e6) {
    formatted = `${prefix}${(val / 1e6).toFixed(2)}M`;
  } else if (absVal >= 1e3) {
    formatted = `${prefix}${(val / 1e3).toFixed(2)}K`;
  } else {
    formatted = `${prefix}${val.toFixed(2)}`;
  }
  return formatted;
};

export default function PeerComparison({ cik, companyName }: Props) {
  const [peers, setPeers] = useState<PeerItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`provera_compare_peers_${cik}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        setTimeout(() => {
          setPeers(parsed);
          setIsLoaded(true);
        }, 0);
      } else {
        setTimeout(() => {
          setPeers([]);
          setIsLoaded(true);
        }, 0);
      }
    } catch (e) {
      console.error("Failed to load peers from localStorage:", e);
      setTimeout(() => {
        setIsLoaded(true);
      }, 0);
    }
  }, [cik]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(`provera_compare_peers_${cik}`, JSON.stringify(peers));
    } catch (e) {
      console.error(e);
    }
  }, [peers, isLoaded, cik]);

  const [data, setData] = useState<PeerComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Search CIK
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchCompanyResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [loadingSeconds, setLoadingSeconds] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (loading) {
      const t = setTimeout(() => {
        setLoadingSeconds(0);
      }, 0);
      interval = setInterval(() => {
        setLoadingSeconds((prev: number) => prev + 1);
      }, 1000);
      return () => {
        clearTimeout(t);
        if (interval) clearInterval(interval);
      };
    } else {
      const t = setTimeout(() => {
        setLoadingSeconds(0);
      }, 0);
      return () => {
        clearTimeout(t);
      };
    }
  }, [loading]);

  const getProgressMessage = (seconds: number): string => {
    if (seconds < 3) return "Connecting to Provera";
    if (seconds < 7) return "Fetching SEC filing data";
    if (seconds < 12) return "Calculating comparable metrics";
    return "Still working on a large SEC dataset";
  };

  // Selector controls
  const [selectedBarMetric, setSelectedBarMetric] = useState("revenue");
  const [selectedLineMetric, setSelectedLineMetric] = useState("revenue");
  const [viewType, setViewType] = useState<"quarterly" | "annual">("quarterly");

  // Fetch search results when query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }
    let active = true;
    const delayDebounce = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await searchCompanies(searchQuery);
        if (!active) return;
        // Exclude currently selected base company and already added peers
        const filtered = res.filter(
          (c: SearchCompanyResult) => c.cik !== cik && !peers.some((p) => p.cik === c.cik)
        );
        setSearchResults(filtered);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        if (active) {
          setSearchLoading(false);
        }
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [searchQuery, cik, peers]);

  // Fetch comparison data whenever peer CIKs change
  useEffect(() => {
    if (!hasInteracted) return;
    let active = true;
    async function loadComparison() {
      setLoading(true);
      setError(null);
      try {
        const peerCiksStr = peers.map((p) => p.cik).join(",");
        const res = await getPeerComparison(cik, peerCiksStr, 8);
        if (active) {
          setData(res);
        }
      } catch {
        if (active) {
          setError("Unable to load peer comparison. Please try again in a few moments.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    loadComparison();
    return () => {
      active = false;
    };
  }, [cik, peers, retryTrigger, hasInteracted]);

  const handleAddPeer = (company: SearchCompanyResult) => {
    if (peers.length >= 3) {
      alert("You can compare with a maximum of 3 peer companies.");
      return;
    }
    const peerTicker = company.tickers && company.tickers.length > 0 ? company.tickers[0] : `CIK:${company.cik}`;
    const newPeer: PeerItem = {
      cik: company.cik,
      ticker: peerTicker,
      name: company.name
    };
    setPeers([...peers, newPeer]);
    setSearchQuery("");
    setShowDropdown(false);
  };

  const handleRemovePeer = (peerCik: number) => {
    setPeers(peers.filter((p) => p.cik !== peerCik));
  };

  // Extract latest value for specific company and metric row
  const getMetricValueForCompany = (comp: FinancialDashboardResponse, row: MetricRow) => {
    if (row.type === "metric") {
      const m = comp.metrics.find((x) => x.key === row.key);
      return m ? m.value : null;
    } else {
      const r = comp.ratios.find((x) => x.key === row.key);
      return r ? r.value : null;
    }
  };

  // Grouped Bar Data for selected metric
  const getBarChartData = () => {
    if (!data) return [];
    const targetRow = METRIC_ROWS.find((r) => r.key === selectedBarMetric);
    if (!targetRow) return [];

    return data.companies.map((comp) => {
      const val = getMetricValueForCompany(comp, targetRow);
      return {
        name: comp.ticker || comp.company_name.split(" ")[0],
        value: val !== null ? val : 0,
        fullName: comp.company_name
      };
    });
  };

  // Dynamic Multi-Line Trend Alignment
  const getAlignedLineChartData = (): AlignedChartRow[] => {
    if (!data) return [];
    const isQ = viewType === "quarterly";
    const fullKey = `${selectedLineMetric}_${isQ ? "quarterly" : "annual"}`;

    // Get all unique period_end dates from all companies' series for selected key
    const allDates = Array.from(
      new Set(
        data.companies.flatMap((comp) => {
          const series = comp.series.find((s) => s.key === fullKey);
          return series ? series.points.map((p) => p.period_end) : [];
        })
      )
    ).sort();

    // Map dates to aligned values
    return allDates.map((date) => {
      const row: AlignedChartRow = { period_end: date };
      data.companies.forEach((comp) => {
        const series = comp.series.find((s) => s.key === fullKey);
        const pt = series ? series.points.find((p) => p.period_end === date) : null;
        if (pt) {
          row[comp.ticker || comp.company_name] = pt.value;
        }
      });
      return row;
    });
  };

  const getFormatType = (metricKey: string) => {
    const row = METRIC_ROWS.find((r) => r.key === metricKey);
    return row ? row.unit : "USD";
  };

  const alignedLineData = getAlignedLineChartData();
  const barChartData = getBarChartData();

  const columns = data ? [
    {
      cik: cik,
      name: companyName,
      ticker: data.companies[0]?.ticker || "Base",
      isBase: true,
      status: (loading && !data) ? ("loading" as const) : ("loaded" as const),
      companyData: data.companies[0] || null
    },
    ...peers.map((peer) => {
      const companyData = data.companies.find((c) => c.cik === peer.cik) || null;
      let status: "loading" | "loaded" | "error" = "loaded";
      if (!companyData && error) {
        status = "error";
      } else if (loading && !companyData) {
        status = "loading";
      }
      return {
        cik: peer.cik,
        name: peer.name,
        ticker: peer.ticker,
        isBase: false,
        status,
        companyData
      };
    })
  ] : [];

  if (!hasInteracted) {
    return (
      <section className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 mb-8 text-zinc-900" aria-label="Peer Comparison Dashboard">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 pb-5 mb-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 font-serif flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-zinc-700" />
              <span>Peer Comparison</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Compare financial performance of {companyName} with up to 3 public peer companies.
            </p>
          </div>
        </div>

        <div className="py-12 text-center space-y-4 max-w-sm mx-auto animate-fadeIn">
          <div className="w-12 h-12 rounded-full bg-zinc-50 border border-zinc-200 flex items-center justify-center mx-auto text-zinc-400">
            <ArrowRightLeft className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-zinc-950">Peer Benchmarking & Comparison</h4>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Compare metrics, margins, and trends side-by-side with industry peers. Generates comparative charts and balance sheet breakdowns from SEC facts.
            </p>
          </div>
          <button
            onClick={() => {
              setHasInteracted(true);
              // Trigger initial comparison fetch for base company immediately
              getPeerComparison(cik, "", 8).then((res) => {
                setData(res);
              }).catch(() => {});
            }}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-800 hover:bg-blue-750 text-white rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-[0.98]"
          >
            <span>Initialize Peer Comparison</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 mb-8 text-zinc-900" aria-label="Peer Comparison Dashboard">
      
      {/* Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 pb-5 mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 font-serif flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-zinc-700" />
            <span>Peer Comparison</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Compare financial performance of {companyName} with up to 3 public peer companies.
          </p>
        </div>

        {/* Search & Add Peer Controls */}
        <div className="relative w-full md:w-80">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search ticker or company name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setSearchResults([]);
                }
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className="pl-9 pr-4 py-2 w-full text-xs bg-white border border-zinc-250 rounded-lg focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setShowDropdown(false);
                }}
                className="absolute right-3 top-2.5 hover:text-zinc-700 text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search Dropdown */}
          {showDropdown && searchQuery && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-zinc-200 rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-zinc-100">
              {searchLoading ? (
                <div className="p-4 text-xs text-zinc-500 flex items-center justify-center gap-2 bg-zinc-50/50">
                  <svg className="animate-spin h-4 w-4 text-zinc-450" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Searching SEC companies…</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-3 text-xs text-zinc-500 italic text-center">No compatible peer found.</div>
              ) : (
                searchResults.map((company) => {
                  const tickerStr = company.tickers && company.tickers.length > 0 ? company.tickers[0] : "";
                  return (
                    <button
                      key={company.cik}
                      onClick={() => handleAddPeer(company)}
                      className="w-full text-left p-3 hover:bg-zinc-50 flex items-center justify-between text-xs transition-colors"
                    >
                      <div className="truncate max-w-[200px]">
                        <span className="font-semibold text-zinc-950 block">{company.name}</span>
                        <span className="text-[10px] text-zinc-400 font-mono">CIK: {company.cik}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {tickerStr && (
                          <span className="font-mono font-bold px-1.5 py-0.5 bg-zinc-100 rounded text-zinc-700 text-[10px]">
                            {tickerStr}
                          </span>
                        )}
                        <Plus className="w-3.5 h-3.5 text-zinc-500" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Selected Peers Pill list */}
      {peers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6 p-3 bg-zinc-50/50 border border-zinc-200/50 rounded-lg items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">Compared Peers:</span>
          {peers.map((p) => (
            <div
              key={p.cik}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-white border border-zinc-250 text-xs font-semibold text-zinc-700 shadow-sm"
            >
              <span>{p.ticker}</span>
              <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[80px]">{p.name}</span>
              <button
                onClick={() => handleRemovePeer(p.cik)}
                className="p-0.5 rounded-full hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                title={`Remove ${p.ticker}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <span className="text-[10px] text-zinc-400 italic ml-auto">{peers.length}/3 peers compared</span>
        </div>
      )}

      {/* Placeholder State when no peer added */}
      {peers.length === 0 && (
        <div className="py-16 text-center space-y-4 max-w-sm mx-auto">
          <div className="w-12 h-12 rounded-full bg-zinc-50 border border-zinc-200 flex items-center justify-center mx-auto text-zinc-400">
            <ArrowRightLeft className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-zinc-950">Add Companies to Compare</h4>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Use the search bar above to select public companies and view side-by-side metric tables, comparison bar charts, and historical line overlay trends.
            </p>
          </div>
        </div>
      )}

      {/* Compare Dashboard */}
      {peers.length > 0 && (
        <div className="space-y-8">
          {loading && !data ? (
            <div className="space-y-6 animate-pulse">
              {/* Table skeleton */}
              <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                      <th className="px-4 py-3 w-1/4">Metric Name</th>
                      <th className="px-4 py-3 w-1/4">Formula</th>
                      <th className="px-4 py-3 text-right">Base Company</th>
                      {peers.map((peer) => (
                        <th key={peer.cik} className="px-4 py-3 text-right">{peer.ticker}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-150">
                    {[1, 2, 3, 4, 5, 6].map((idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3"><div className="h-4 w-1/2 shimmer-bg rounded"></div></td>
                        <td className="px-4 py-3"><div className="h-3 w-1/3 shimmer-bg rounded"></div></td>
                        <td className="px-4 py-3 text-right"><div className="h-4 w-16 shimmer-bg rounded ml-auto"></div></td>
                        {peers.map((peer) => (
                          <td key={peer.cik} className="px-4 py-3 text-right">
                            <div className="h-4 w-16 shimmer-bg rounded ml-auto"></div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Chart placeholders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="border border-zinc-150 rounded-xl p-5 bg-zinc-50/30 h-64 flex flex-col justify-between">
                  <div className="h-4 w-1/3 shimmer-bg rounded"></div>
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 font-medium">
                    Benchmarking chart loading...
                  </div>
                </div>
                <div className="border border-zinc-150 rounded-xl p-5 bg-zinc-50/30 h-64 flex flex-col justify-between">
                  <div className="h-4 w-1/3 shimmer-bg rounded"></div>
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 font-medium">
                    Trend chart loading...
                  </div>
                </div>
              </div>
            </div>
          ) : (error && !data) ? (
            <div className="p-5 bg-red-50 border border-red-200 text-red-800 rounded-xl flex flex-col gap-4 text-xs animate-fadeIn">
              <div className="flex items-center gap-2 font-bold text-red-900 text-sm">
                <AlertTriangle className="w-5 h-5 text-red-700" />
                <span>Unable to load peer comparison.</span>
              </div>
              <p className="text-red-750 font-medium leading-normal">Please try again in a few moments.</p>
              <button
                onClick={() => setRetryTrigger(prev => prev + 1)}
                className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-700 w-fit cursor-pointer active:scale-[0.98] shadow-xs"
              >
                Retry Peer Comparison
              </button>
            </div>
          ) : data && (
            <>
              {/* 1. Aligned Comparison Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Metrics Side-by-Side Comparison</h3>
                <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                        <th className="px-4 py-3">Metric Name</th>
                        <th className="px-4 py-3">Formula / Concept</th>
                        {columns.map((col) => (
                          <th key={col.cik} className="px-4 py-3 text-right">
                            {col.isBase ? (
                              <>
                                <span className="font-bold text-zinc-900 block font-sans">{col.name}</span>
                                <span className="text-[10px] text-zinc-400 font-normal block mt-0.5 font-mono">{col.ticker}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-bold text-zinc-950 block font-sans truncate max-w-[150px] ml-auto">{col.name}</span>
                                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-zinc-400 font-normal">Peer company</span>
                                  {col.status === "loading" ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100 animate-pulse">
                                      Loading...
                                    </span>
                                  ) : col.status === "error" ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-700 border border-red-100">
                                      Error
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-zinc-400 font-mono">({col.ticker})</span>
                                  )}
                                </div>
                              </>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-150">
                      {METRIC_ROWS.map((row, rowIndex) => (
                        <tr key={row.key} className="interactive-row hover:bg-zinc-50/50">
                          <td className="px-4 py-2.5 font-medium text-zinc-800">{row.label}</td>
                          <td className="px-4 py-2.5 font-mono text-[9px] text-zinc-400">
                            {row.type === "metric" ? row.key : METRIC_ROWS.find(x => x.key === row.key)?.label || row.key}
                          </td>
                          {columns.map((col) => {
                            if (col.status === "loading") {
                              if (rowIndex === 0) {
                                  return (
                                    <td
                                      key={col.cik}
                                      rowSpan={METRIC_ROWS.length}
                                      className="relative border-l border-r border-zinc-200 align-middle select-none w-48 font-sans p-0 overflow-hidden"
                                    >
                                      {/* Shimmering Skeleton rows matching table heights */}
                                      <div className="absolute inset-0 flex flex-col divide-y divide-zinc-150">
                                        {METRIC_ROWS.map((_, idx) => (
                                          <div key={idx} className="flex-1 flex items-center justify-center min-h-[38px] bg-zinc-50/15">
                                            <div className="h-3 w-16 bg-zinc-200/50 animate-pulse rounded-md"></div>
                                          </div>
                                        ))}
                                      </div>

                                      {/* Loading panel content overlay centered */}
                                      <div className="relative z-10 py-16 flex flex-col items-center justify-center p-4 text-center space-y-4 bg-blue-50/90 backdrop-blur-[0.5px] h-full">
                                        <svg className="animate-spin h-6 w-6 text-blue-800" viewBox="0 0 24 24" fill="none">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                          <span className="sr-only">Loading comparison data</span>
                                        </svg>
                                        <div className="space-y-1">
                                          <h4 className="text-xs font-bold text-zinc-900 leading-tight">{col.name}</h4>
                                          <p className="text-[11px] text-blue-800 font-bold tracking-tight">Loading comparison...</p>
                                        </div>
                                        <p aria-live="polite" className="text-[10px] text-zinc-650 leading-normal max-w-[155px] mx-auto font-medium">
                                          {getProgressMessage(loadingSeconds)}
                                        </p>
                                        <p className="text-[9px] text-zinc-400 font-medium">
                                          This usually takes 5–15 seconds the first time.
                                        </p>
                                      </div>
                                    </td>
                                  );
                              }
                              return null;
                            }

                            if (col.status === "error") {
                              if (rowIndex === 0) {
                                  return (
                                    <td
                                      key={col.cik}
                                      rowSpan={METRIC_ROWS.length}
                                      className="px-4 py-12 text-center bg-red-50/20 border-l border-r border-red-150 align-middle select-none w-48 font-sans"
                                    >
                                      <div className="flex flex-col items-center justify-center p-4 text-center space-y-4 max-w-[160px] mx-auto">
                                        <AlertTriangle className="w-6 h-6 text-red-700 shrink-0" />
                                        <div className="space-y-1">
                                          <h4 className="text-xs font-bold text-red-950">Unable to load peer data</h4>
                                          <p className="text-[10px] text-red-750 font-semibold leading-normal">
                                            We could not retrieve enough comparable SEC data for this company.
                                          </p>
                                        </div>
                                        <div className="flex flex-col gap-2 w-full pt-2">
                                          <button
                                            onClick={() => setRetryTrigger((prev: number) => prev + 1)}
                                            className="w-full px-3 py-1.5 bg-red-800 hover:bg-red-900 text-white rounded-lg text-[10px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-700 cursor-pointer active:scale-[0.98] shadow-xs"
                                          >
                                            Retry
                                          </button>
                                          <button
                                            onClick={() => handleRemovePeer(col.cik)}
                                            className="w-full px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-250 rounded-lg text-[10px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-zinc-400 cursor-pointer active:scale-[0.98]"
                                          >
                                            Remove peer
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  );
                              }
                              return null;
                            }

                            const val = col.companyData ? getMetricValueForCompany(col.companyData, row) : null;
                            return (
                              <td key={col.cik} className="px-4 py-2.5 text-right font-mono font-medium text-zinc-950">
                                {formatCompact(val, row.unit)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-t border-zinc-200 pt-6">
                
                {/* Chart 1: Grouped Bar Chart */}
                <div className="border border-zinc-150 rounded-xl p-5 bg-zinc-50/10 flex flex-col justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 w-full">
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Metric Benchmarking</span>
                      </h4>
                      <p className="text-[10px] text-zinc-400 mt-0.5">Benchmarking latest period facts.</p>
                    </div>

                    {/* Metric Selector Dropdown */}
                    <select
                      value={selectedBarMetric}
                      onChange={(e) => setSelectedBarMetric(e.target.value)}
                      className="px-2 py-1 bg-white border border-zinc-250 rounded-lg text-xs focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 transition-all font-semibold"
                    >
                      {METRIC_ROWS.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barChartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={(v: number) => formatCompact(v, getFormatType(selectedBarMetric))} tick={{ fontSize: 10 }} />
                        <Tooltip
                          formatter={(value: string | number | readonly (string | number)[] | undefined) => [
                            formatCompact(Number(value), getFormatType(selectedBarMetric)),
                            METRIC_ROWS.find((m) => m.key === selectedBarMetric)?.label || ""
                          ]}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Bar name="Latest Period" dataKey="value" fill="#18181b">
                          {barChartData.map((entry, idx) => (
                            <Bar key={idx} dataKey="value" fill={COLORS[idx % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Multi-Line Trend Chart */}
                <div className="border border-zinc-150 rounded-xl p-5 bg-zinc-50/10 flex flex-col justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 w-full">
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Trend Comparisons</span>
                      </h4>
                      <p className="text-[10px] text-zinc-400 mt-0.5">Historical trend overlays.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Metric Selector Dropdown */}
                      <select
                        value={selectedLineMetric}
                        onChange={(e) => setSelectedLineMetric(e.target.value)}
                        className="px-2 py-1 bg-white border border-zinc-250 rounded-lg text-xs focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 transition-all font-semibold"
                      >
                        {METRIC_ROWS.map((m) => (
                          <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                      </select>

                      {/* View Type Toggle */}
                      <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 bg-white">
                        <button
                          onClick={() => setViewType("quarterly")}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                            viewType === "quarterly" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-950"
                          }`}
                        >
                          Q
                        </button>
                        <button
                          onClick={() => setViewType("annual")}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                            viewType === "annual" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-950"
                          }`}
                        >
                          A
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    {alignedLineData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                        No trend data points available for comparison.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={alignedLineData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                          <XAxis dataKey="period_end" tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={(v: number) => formatCompact(v, getFormatType(selectedLineMetric))} tick={{ fontSize: 9 }} />
                          <Tooltip
                            formatter={(value: string | number | readonly (string | number)[] | undefined) => [
                              formatCompact(Number(value), getFormatType(selectedLineMetric)),
                              ""
                            ]}
                            contentStyle={{ fontSize: 11 }}
                          />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {data.companies.map((comp, idx) => {
                            const tKey = comp.ticker || comp.company_name;
                            return (
                              <Line
                                key={comp.cik}
                                type="monotone"
                                dataKey={tKey}
                                name={comp.ticker || comp.company_name.split(" ")[0]}
                                stroke={COLORS[idx % COLORS.length]}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                                connectNulls
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      )}

    </section>
  );
}
