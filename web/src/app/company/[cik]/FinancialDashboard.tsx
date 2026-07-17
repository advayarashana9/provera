"use client";

import React, { useState, useEffect } from "react";
import {
  getFinancialDashboard,
  FinancialDashboardResponse,
  DashboardSeriesPoint
} from "../../../lib/api";
import { useSWR } from "@/lib/useSWR";
import ResearchReportModal from "./ResearchReportModal";
import InvestmentMemoModal from "./InvestmentMemoModal";
import SourceEvidenceModal, { metricsToEvidence, seriesPointsToEvidence, EvidenceItem } from "./SourceEvidenceModal";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import {
  AlertTriangle,
  ExternalLink,
  Calendar,
  Layers,
  FileText,
  DollarSign,
  TrendingUp
} from "lucide-react";

interface Props {
  cik: number;
}

interface AlignedMarginItem {
  period_end: string;
  revenue?: number;
  gross_profit?: number;
  operating_income?: number;
  net_income?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
}

interface AlignedAssetLiabItem {
  period_end: string;
  assets?: number;
  liabilities?: number;
}

// Pure format & utility helpers declared outside the component to avoid hook issues
const formatCompact = (val: number | null | undefined, unit: string | null | undefined) => {
  if (val === null || val === undefined) return "N/A";
  const isCurrency = !unit || unit.toUpperCase() === "USD";
  const prefix = isCurrency ? "$" : "";
  const absVal = Math.abs(val);

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

  if (unit && unit.toUpperCase() !== "USD") {
    formatted = `${formatted} ${unit}`;
  }
  return formatted;
};

const formatPercent = (val: number | null | undefined) => {
  if (val === null || val === undefined) return "N/M";
  return `${val > 0 ? "+" : ""}${(val * 100).toFixed(2)}%`;
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return dateStr;
  }
};

const renderNeutralBadge = (
  status: string, 
  changeVal: number | null | undefined, 
  isPercentage: boolean
) => {
  const neutralClass = "bg-zinc-100 text-zinc-700 border border-zinc-200/60 font-mono text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap flex items-center gap-1 w-fit select-none";
  
  if (status === "unavailable") {
    return <span className={neutralClass}>—</span>;
  }
  
  let arrow = "→";
  let text = "0.0%";
  if (!isPercentage) text = "0.00";
  
  if (status === "increased") {
    arrow = "▲";
    if (changeVal !== null && changeVal !== undefined) {
      text = isPercentage ? formatPercent(changeVal) : `+${changeVal.toFixed(2)}`;
    } else {
      text = "N/M";
    }
  } else if (status === "decreased") {
    arrow = "▼";
    if (changeVal !== null && changeVal !== undefined) {
      text = isPercentage ? formatPercent(changeVal) : `${changeVal.toFixed(2)}`;
    } else {
      text = "N/M";
    }
  }
  
  return (
    <span className={neutralClass}>
      <span>{arrow}</span>
      <span>{text}</span>
    </span>
  );
};

// Recharts custom tooltip interface & component
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: {
      period_end: string;
      form?: string | null;
      fiscal_period?: string | null;
      fiscal_year?: number | null;
      [key: string]: unknown;
    };
  }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-zinc-200 rounded p-3.5 shadow-md text-xs font-sans space-y-1.5 text-zinc-800">
        <div className="font-bold border-b border-zinc-150 pb-1.5 mb-1.5 text-zinc-900">
          Period End: {formatDate(label)}
        </div>
        {payload.map((p, idx) => {
          const pt = p.payload;
          return (
            <div key={idx} className="flex flex-col border-t border-zinc-50 pt-1.5 first:border-t-0 first:pt-0">
              <span className="font-semibold text-zinc-950">
                {p.name}: {p.name.includes("Margin") ? `${p.value?.toFixed(2)}%` : formatCompact(p.value, "USD")}
              </span>
              {pt && (pt.form || pt.fiscal_period) && (
                <span className="text-[10px] text-zinc-400 font-mono mt-0.5">
                  Form: {pt.form || "N/A"} | Fiscal Period: {pt.fiscal_period || "N/A"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function FinancialDashboard({ cik }: Props) {
  const [periods, setPeriods] = useState<number>(8);
  const [viewType, setViewType] = useState<"quarterly" | "annual">("quarterly");
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isMemoOpen, setIsMemoOpen] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState<{ open: boolean; title: string; items: EvidenceItem[]; context?: string }>({
    open: false, title: "", items: [], context: undefined,
  });
  const [retryTrigger, setRetryTrigger] = useState(0);

  const openEvidenceModal = (title: string, items: EvidenceItem[], context?: string) => {
    setEvidenceModal({ open: true, title, items, context });
  };
  const closeEvidenceModal = () => setEvidenceModal((prev) => ({ ...prev, open: false }));

  const fetcher = React.useCallback(() => getFinancialDashboard(cik, "10-K,10-Q", periods), [cik, periods]);
  const { data, error, isValidating } = useSWR(`dashboard_${cik}_${periods}_${retryTrigger}`, fetcher);

  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (data || error) {
      setSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setSeconds((s: number) => s + 0.5);
    }, 500);
    return () => clearInterval(interval);
  }, [data, error]);

  const getProgressLabel = () => {
    if (seconds < 1.0) return "Connecting to Provera";
    if (seconds < 2.5) return "Fetching SEC filing data";
    if (seconds < 4.0) return "Normalizing financial facts";
    if (seconds < 5.0) return "Calculating metrics and ratios";
    return "Preparing charts";
  };

  if (!data && !error) {
    const pct = Math.min(95, Math.round((seconds / 6) * 100));
    return (
      <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-8 space-y-6">
        {/* Centered Loading Panel */}
        <div className="flex flex-col items-center justify-center py-8 space-y-4 max-w-sm mx-auto">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-800" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm font-semibold text-zinc-800 font-sans tracking-tight">
              {getProgressLabel()}…
            </span>
          </div>

          <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-blue-800 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="text-center min-h-[16px]">
            {seconds >= 15.0 ? (
              <p className="text-[11px] text-amber-600 font-medium font-sans">
                Still working. Large SEC datasets can take longer on the free server.
              </p>
            ) : seconds >= 5.0 ? (
              <p className="text-[11px] text-zinc-500 font-medium font-sans">
                Free servers may take a few extra seconds to wake up
              </p>
            ) : null}
          </div>
        </div>

        {/* Dashboard Metric Card Skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-pulse">
          <div className="border border-zinc-200 rounded-xl p-5 bg-white space-y-4">
            <div className="h-3 w-1/3 shimmer-bg rounded"></div>
            <div className="h-8 w-2/3 shimmer-bg rounded"></div>
            <div className="h-4 w-1/2 shimmer-bg rounded pt-2"></div>
          </div>
          <div className="border border-zinc-200 rounded-xl p-5 bg-white space-y-4">
            <div className="h-3 w-1/4 shimmer-bg rounded"></div>
            <div className="h-8 w-1/2 shimmer-bg rounded"></div>
            <div className="h-4 w-2/3 shimmer-bg rounded pt-2"></div>
          </div>
          <div className="border border-zinc-200 rounded-xl p-5 bg-white space-y-4">
            <div className="h-3 w-1/3 shimmer-bg rounded"></div>
            <div className="h-8 w-3/4 shimmer-bg rounded"></div>
            <div className="h-4 w-1/2 shimmer-bg rounded pt-2"></div>
          </div>
        </div>

        {/* Chart Skeletons */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/30 h-64 flex flex-col justify-between">
            <div className="h-4 w-1/4 shimmer-bg rounded"></div>
            <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 font-medium">
              Chart loading...
            </div>
          </div>
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/30 h-64 flex flex-col justify-between">
            <div className="h-4 w-1/4 shimmer-bg rounded"></div>
            <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 font-medium">
              Chart loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-6 mb-8 flex flex-col gap-4 animate-fadeIn">
        <div className="flex items-center gap-2 font-bold text-red-900 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-700" />
          <span>Unable to load SEC data.</span>
        </div>
        <p className="text-xs text-red-700 leading-normal font-medium">Please try again in a few moments.</p>
        <button
          onClick={() => setRetryTrigger(prev => prev + 1)}
          className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-700 w-fit cursor-pointer active:scale-[0.98] shadow-xs"
        >
          Retry Dashboard Load
        </button>
      </div>
    );
  }

  // Align Margins Data dynamically for Recharts
  const alignMarginData = (): AlignedMarginItem[] => {
    const isQ = viewType === "quarterly";
    const revPoints = data.series.find(s => s.key === (isQ ? "revenue_quarterly" : "revenue_annual"))?.points || [];
    const gpPoints = data.series.find(s => s.key === (isQ ? "gross_profit_quarterly" : "gross_profit_annual"))?.points || [];
    const opPoints = data.series.find(s => s.key === (isQ ? "operating_income_quarterly" : "operating_income_annual"))?.points || [];
    const niPoints = data.series.find(s => s.key === (isQ ? "net_income_quarterly" : "net_income_annual"))?.points || [];

    const alignedMap: { [date: string]: AlignedMarginItem } = {};
    revPoints.forEach(p => {
      alignedMap[p.period_end] = { period_end: p.period_end, revenue: p.value };
    });
    gpPoints.forEach(p => {
      if (alignedMap[p.period_end]) alignedMap[p.period_end].gross_profit = p.value;
    });
    opPoints.forEach(p => {
      if (alignedMap[p.period_end]) alignedMap[p.period_end].operating_income = p.value;
    });
    niPoints.forEach(p => {
      if (alignedMap[p.period_end]) alignedMap[p.period_end].net_income = p.value;
    });

    return Object.values(alignedMap)
      .map((item) => {
        const grossMargin = item.revenue && item.gross_profit ? (item.gross_profit / item.revenue) * 100 : null;
        const operatingMargin = item.revenue && item.operating_income ? (item.operating_income / item.revenue) * 100 : null;
        const netMargin = item.revenue && item.net_income ? (item.net_income / item.revenue) * 100 : null;
        return {
          period_end: item.period_end,
          grossMargin: grossMargin ?? undefined,
          operatingMargin: operatingMargin ?? undefined,
          netMargin: netMargin ?? undefined
        };
      })
      .sort((a, b) => a.period_end.localeCompare(b.period_end));
  };

  // Align Assets vs Liabilities
  const alignAssetsLiabilitiesData = (): AlignedAssetLiabItem[] => {
    const isQ = viewType === "quarterly";
    const assetsPoints = data.series.find(s => s.key === (isQ ? "assets_quarterly" : "assets_annual"))?.points || [];
    const liabPoints = data.series.find(s => s.key === (isQ ? "liabilities_quarterly" : "liabilities_annual"))?.points || [];

    const alignedMap: { [date: string]: AlignedAssetLiabItem } = {};
    assetsPoints.forEach(p => {
      alignedMap[p.period_end] = { period_end: p.period_end, assets: p.value };
    });
    liabPoints.forEach(p => {
      if (alignedMap[p.period_end]) alignedMap[p.period_end].liabilities = p.value;
    });

    return Object.values(alignedMap)
      .sort((a, b) => a.period_end.localeCompare(b.period_end));
  };

  const getSeriesPoints = (key: string) => {
    const isQ = viewType === "quarterly";
    const fullKey = `${key}_${isQ ? "quarterly" : "annual"}`;
    return data.series.find(s => s.key === fullKey)?.points || [];
  };

  const handleCardClick = (key: string) => {
    const labels: { [key: string]: string } = {
      revenue: "revenue",
      net_income: "net income",
      cash: "cash",
      assets: "assets",
      liabilities: "liabilities",
      equity: "stockholders' equity"
    };
    const label = labels[key] || key;
    const query = `Explain the recent ${label} change using SEC filing evidence.`;
    const event = new CustomEvent("prefill-query", { detail: { query } });
    window.dispatchEvent(event);
  };

  const formatXAxisDate = (points: DashboardSeriesPoint[]) => (dateStr: string) => {
    const pt = points.find(p => p.period_end === dateStr);
    if (pt && pt.fiscal_year && pt.fiscal_period) {
      return `${pt.fiscal_period} ${pt.fiscal_year}`;
    }
    return dateStr.slice(0, 7);
  };

  const formatXAxisMarginDate = (dateStr: string) => {
    const pt = data.series[0]?.points.find(p => p.period_end === dateStr);
    if (pt && pt.fiscal_year && pt.fiscal_period) {
      return `${pt.fiscal_period} ${pt.fiscal_year}`;
    }
    return dateStr.slice(0, 7);
  };

  const formatXAxisAssetsLiabDate = (dateStr: string) => {
    const pt = data.series.find(s => s.key.startsWith("assets"))?.points.find(p => p.period_end === dateStr);
    if (pt && pt.fiscal_year && pt.fiscal_period) {
      return `${pt.fiscal_period} ${pt.fiscal_year}`;
    }
    return dateStr.slice(0, 7);
  };

  const marginData = alignMarginData();
  const balanceSheetData = alignAssetsLiabilitiesData();

  return (
    <section className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 mb-8 text-zinc-900" aria-label="Financial Dashboard">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 pb-5 mb-6">
        <div>
          <div className="flex items-center flex-wrap gap-2">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 font-serif">Financial Dashboard</h2>
            {isValidating && (
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-800 animate-pulse bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                Refreshing…
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-500 mt-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span>Latest Period: <span className="font-semibold text-zinc-700">{formatDate(data.latest_period_end)}</span></span>
            <span className="text-zinc-300">•</span>
            <Layers className="w-3.5 h-3.5 ml-1" />
            <span>Filing: <span className="font-semibold text-zinc-700">{data.latest_form}</span></span>
          </p>
        </div>

        {/* Actions & Period Selector Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsReportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 cursor-pointer active:scale-[0.98]"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Generate Research Report</span>
          </button>

          <button
            onClick={() => setIsMemoOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 cursor-pointer active:scale-[0.98]"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Generate Investment Memo</span>
          </button>

          <div className="flex items-center gap-2">
            <label htmlFor="periods-select" className="text-xs font-medium text-zinc-500">Periods:</label>
            <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 bg-zinc-50">
            {[4, 8, 12, 16].map((p) => (
              <button
                key={p}
                onClick={() => setPeriods(p)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  periods === p
                    ? "bg-white text-zinc-950 shadow-sm border border-zinc-200/50"
                    : "text-zinc-500 hover:text-zinc-955"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>

      {/* Warnings Area */}
      {data.warnings.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200/60 rounded-xl space-y-1">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Dashboard Warning Messages</span>
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-800 space-y-0.5">
            {data.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI Cards Grid */}
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Key Performance Indicators</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {data.metrics.map((m) => (
          <div
            key={m.key}
            role="button"
            tabIndex={0}
            onClick={() => handleCardClick(m.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCardClick(m.key);
              }
            }}
            className="text-left w-full border border-zinc-200 hover:border-zinc-300 rounded-xl p-5 bg-white premium-card shadow-sm hover:shadow-md transition-all flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 cursor-pointer"
            aria-label={`View details and ask about ${m.label}`}
          >
            <div className="flex items-start justify-between gap-2 w-full">
              <div>
                <span className="text-xs font-semibold text-zinc-400 block">{m.label}</span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 block mt-1">
                  {formatCompact(m.value, m.unit)}
                </span>
              </div>
              {renderNeutralBadge(m.status, m.percentage_change, true)}
            </div>

            {/* Changes and Comparatives */}
            <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500 w-full">
              <div>
                {m.absolute_change !== null && (
                  <span className="font-semibold text-zinc-700">
                    Change: {formatCompact(m.absolute_change, m.unit)}
                  </span>
                )}
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  vs {formatDate(m.prior_period_end)}
                </div>
              </div>
              {m.source_url && (
                <a
                  href={m.source_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-zinc-400 hover:text-zinc-700 p-1 rounded hover:bg-zinc-100/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900"
                  title="Open source filing on SEC"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Ratio Cards Grid */}
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Key Financial Ratios</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {data.ratios.map((r) => {
          const isMargin = r.key.endsWith("margin");
          const formatRatio = (val: number | null) => {
            if (val === null) return "N/A";
            return isMargin ? `${(val * 100).toFixed(2)}%` : val.toFixed(2);
          };
          return (
            <div
              key={r.key}
              className="border border-zinc-200 rounded-xl p-5 bg-white premium-card shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-zinc-400 block">{r.label}</span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 block mt-1">
                  {formatRatio(r.value)}
                </span>
                <span className="text-[10px] text-zinc-400 block mt-1.5 font-mono italic">
                  {r.formula}
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
                <span>
                  {r.absolute_change !== null && (
                    <span className="font-semibold text-zinc-700">
                      Change: {isMargin ? `${(r.absolute_change * 100).toFixed(2)}%` : r.absolute_change.toFixed(2)}
                    </span>
                  )}
                </span>
                {renderNeutralBadge(r.status, r.absolute_change, isMargin)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Trends & Charts Section */}
      <div className="border-t border-zinc-200 pt-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Financial Trends</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Visualization of historical performance.</p>
          </div>

          {/* Quarterly / Annual Toggle */}
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 bg-zinc-50">
            <button
              onClick={() => setViewType("quarterly")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                viewType === "quarterly"
                  ? "bg-white text-zinc-950 shadow-sm border border-zinc-200/50"
                  : "text-zinc-500 hover:text-zinc-950"
              }`}
            >
              Quarterly View
            </button>
            <button
              onClick={() => setViewType("annual")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                viewType === "annual"
                  ? "bg-white text-zinc-955 shadow-sm border border-zinc-200/50"
                  : "text-zinc-500 hover:text-zinc-950"
              }`}
            >
              Annual View
            </button>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Chart 1: Revenue */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-zinc-400" />
                <span>Revenue Trend</span>
              </h4>
              <button
                onClick={() => openEvidenceModal(
                  "Revenue Trend",
                  seriesPointsToEvidence(getSeriesPoints("revenue"), "Revenue"),
                  "Data points powering the Revenue Trend bar chart."
                )}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {getSeriesPoints("revenue").length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No revenue series points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getSeriesPoints("revenue")} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisDate(getSeriesPoints("revenue"))} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, "USD").replace("USD", "")} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="Revenue" dataKey="value" fill="#1e40af" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 2: Net Income */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
                <span>Net Income Trend</span>
              </h4>
              <button
                onClick={() => openEvidenceModal(
                  "Net Income Trend",
                  seriesPointsToEvidence(getSeriesPoints("net_income"), "Net Income"),
                  "Data points powering the Net Income Trend line chart."
                )}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {getSeriesPoints("net_income").length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No net income series points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getSeriesPoints("net_income")} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisDate(getSeriesPoints("net_income"))} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, "USD").replace("USD", "")} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line name="Net Income" type="monotone" dataKey="value" stroke="#1e40af" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 3: Cash Trend */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span>Cash & Equivalents</span>
              </h4>
              <button
                onClick={() => document.getElementById("source-evidence-table")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {getSeriesPoints("cash").length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No cash series points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getSeriesPoints("cash")} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisDate(getSeriesPoints("cash"))} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, "USD").replace("USD", "")} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line name="Cash" type="monotone" dataKey="value" stroke="#1e40af" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 4: Assets and Liabilities */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Assets vs Liabilities</span>
              </h4>
              <button
                onClick={() => document.getElementById("source-evidence-table")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {balanceSheetData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No balance sheet series points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={balanceSheetData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisAssetsLiabDate} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, "USD").replace("USD", "")} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="Assets" dataKey="assets" fill="#1e40af" />
                    <Bar name="Liabilities" dataKey="liabilities" fill="#93c5fd" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 5: Operating Cash Flow */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span>Operating Cash Flow Trend</span>
              </h4>
              <button
                onClick={() => document.getElementById("source-evidence-table")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {getSeriesPoints("operating_cash_flow").length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No operating cash flow points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getSeriesPoints("operating_cash_flow")} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisDate(getSeriesPoints("operating_cash_flow"))} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, "USD").replace("USD", "")} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="Operating Cash Flow" dataKey="value" fill="#1e40af" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 6: Margin Trends */}
          <div className="border border-zinc-150 rounded-xl p-4 bg-zinc-50/10 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4 w-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
                <span>Profitability Margins</span>
              </h4>
              <button
                onClick={() => document.getElementById("source-evidence-table")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[10px] font-bold text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded"
              >
                <span>View source evidence</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="h-64 w-full">
              {marginData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  No margin trend points available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={marginData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="period_end" tickFormatter={formatXAxisMarginDate} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line name="Gross Margin" type="monotone" dataKey="grossMargin" stroke="#1e40af" strokeWidth={2} dot={{ r: 4 }} />
                    <Line name="Operating Margin" type="monotone" dataKey="operatingMargin" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                    <Line name="Net Margin" type="monotone" dataKey="netMargin" stroke="#93c5fd" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Source-Evidence Audit Trail — now a modal-triggered summary panel */}
      <div className="mt-8 border-t border-zinc-200 pt-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Audit Trail / Source Evidence</h4>
          <button
            onClick={() => openEvidenceModal(
              "All Dashboard KPI Evidence",
              metricsToEvidence(data.metrics),
              "All verified SEC XBRL facts backing the KPI cards on this dashboard."
            )}
            className="text-[10px] font-bold text-zinc-500 hover:text-zinc-900 flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-zinc-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <ExternalLink className="w-3 h-3" />
            <span>View All Source Evidence</span>
          </button>
        </div>
        <div className="overflow-x-auto border border-zinc-200 rounded-lg bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                <th className="px-4 py-2">Metric</th>
                <th className="px-4 py-2">US GAAP Concept</th>
                <th className="px-4 py-2">Period End</th>
                <th className="px-4 py-2">Filing</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-150">
              {data.metrics.filter(m => m.value !== null).map((m, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{m.label}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-zinc-500">{m.concept}</td>
                  <td className="px-4 py-2.5 text-zinc-600">{m.period_end || "—"}</td>
                  <td className="px-4 py-2.5">
                    {m.accession_number ? (
                      <span className="font-mono text-[9px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                        {m.accession_number}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.source_url ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-bold">
                        ✓ VERIFIED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold">
                        Derived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => openEvidenceModal(
                        m.label,
                        metricsToEvidence([m]),
                        `Source evidence for ${m.label} KPI card.`
                      )}
                      className="text-[10px] font-bold text-blue-800 hover:text-blue-700 hover:underline flex items-center gap-1 ml-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-700 rounded"
                    >
                      <span>Inspect</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ResearchReportModal
        cik={cik}
        companyName={data.company_name}
        ticker={data.ticker || "AAPL"}
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
      />

      <InvestmentMemoModal
        cik={cik}
        companyName={data.company_name}
        ticker={data.ticker || "AAPL"}
        isOpen={isMemoOpen}
        onClose={() => setIsMemoOpen(false)}
      />

      <SourceEvidenceModal
        isOpen={evidenceModal.open}
        onClose={closeEvidenceModal}
        title={evidenceModal.title}
        items={evidenceModal.items}
        context={evidenceModal.context}
      />
    </section>
  );
}
