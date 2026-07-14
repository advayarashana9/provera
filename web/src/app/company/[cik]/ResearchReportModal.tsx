"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  generateResearchReport,
  downloadResearchReportPdf,
  AIResearchReportResponse
} from "../../../lib/api";
import {
  X,
  FileText,
  Copy,
  Printer,
  Download,
  AlertTriangle,
  ArrowRight
} from "lucide-react";

interface Props {
  cik: number;
  companyName: string;
  ticker: string;
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  "Fetching filing data...",
  "Collecting verified metrics...",
  "Generating analysis...",
  "Building report..."
];

export default function ResearchReportModal({ cik, companyName, ticker, isOpen, onClose }: Props) {
  const [periods, setPeriods] = useState<number>(4);
  const [report, setReport] = useState<AIResearchReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isMounted = useRef(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setMounted(true);
    }, 0);
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      clearTimeout(t);
    };
  }, []);

  // Background body scroll lock hook
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (loading) {
      intervalRef.current = setInterval(() => {
        setStepIdx((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
      }, 1800);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  if (!isOpen) return null;
  if (!mounted) return null;

  const handleGenerate = async () => {
    setLoading(true);
    setStepIdx(0);
    setError(null);
    setReport(null);
    try {
      const res = await generateResearchReport(cik, periods);
      if (isMounted.current) {
        setReport(res);
      }
    } catch (err: unknown) {
      console.error(err);
      if (isMounted.current) {
        setError((err as Error).message || "Failed to generate research report. Please try again.");
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  const handleDownloadPdf = async () => {
    if (!report) return;
    try {
      setPdfLoading(true);
      const blob = await downloadResearchReportPdf(cik, report);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${ticker}_AI_Research_Report.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error(err);
      alert("Failed to download PDF report");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleCopyReport = () => {
    if (!report) return;
    const text = `
${report.title}
=========================================

Executive Summary:
${report.executive_summary.content}

Business Overview:
${report.business_overview.content}

Financial Highlights:
${report.financial_highlights.content}

Balance Sheet:
${report.balance_sheet.content}

Income Statement:
${report.income_statement.content}

Cash Flow:
${report.cash_flow.content}

Profitability:
${report.profitability.content}

Risks:
${report.risks.content}

Recent Changes:
${report.recent_changes.content}

Management Discussion:
${report.management_discussion.content}

Conclusion:
${report.conclusion.content}

Sources & Evidence:
${report.citations.map(c => `[${c.id}] ${c.label || c.concept}: ${c.value} ${c.unit} (${c.period_end}, ${c.form})`).join("\n")}
    `.trim();

    navigator.clipboard.writeText(text);
    alert("Research report text copied to clipboard!");
  };

  const handlePrint = () => {
    if (!report) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #18181b; padding: 40px; line-height: 1.5; font-size: 14px; }
            h1 { font-size: 22px; font-weight: bold; border-bottom: 2px solid #e4e4e7; padding-bottom: 8px; margin-bottom: 4px; }
            h2 { font-size: 15px; font-weight: bold; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #f4f4f5; padding-bottom: 4px; }
            p { margin-bottom: 12px; text-align: justify; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
            th, td { border: 1px solid #e4e4e7; padding: 6px 8px; text-align: left; }
            th { background-color: #f4f4f5; font-weight: bold; }
            .meta { font-size: 11px; color: #71717a; margin-bottom: 20px; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <h1>${report.title}</h1>
          <div class="meta">Company Name: ${companyName} | Ticker: ${ticker} | CIK: ${cik} | Generated: ${new Date().toLocaleDateString()}</div>
          
          <h2>Executive Summary</h2>
          <p>${report.executive_summary.content}</p>
          
          <h2>Business Overview</h2>
          <p>${report.business_overview.content}</p>
          
          <h2>Financial Highlights</h2>
          <p>${report.financial_highlights.content}</p>
          
          <h2>Balance Sheet Analysis</h2>
          <p>${report.balance_sheet.content}</p>
          
          <h2>Income Statement Analysis</h2>
          <p>${report.income_statement.content}</p>
          
          <h2>Cash Flow & Reserves</h2>
          <p>${report.cash_flow.content}</p>
          
          <h2>Profitability Metrics</h2>
          <p>${report.profitability.content}</p>
          
          <h2>Risk & Internal Controls</h2>
          <p>${report.risks.content}</p>
          
          <h2>Recent Changes & Filing Diff Summary</h2>
          <p>${report.recent_changes.content}</p>
          
          <h2>Management Discussion & Analysis Summary</h2>
          <p>${report.management_discussion.content}</p>
          
          <h2>Conclusion & Wrap-Up</h2>
          <p>${report.conclusion.content}</p>
          
          <h2 style="page-break-before: always;">Sources & Citations Evidence</h2>
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">Ref</th>
                <th>Concept / Fact Source</th>
                <th>Period End (Form)</th>
                <th>Reported Value</th>
              </tr>
            </thead>
            <tbody>
              ${report.citations.map(c => `
                <tr>
                  <td>[${c.id}]</td>
                  <td>${c.label || c.concept}</td>
                  <td>${c.period_end} (${c.form})</td>
                  <td>${c.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.close();
            };
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const renderTextWithCitations = (text: string) => {
    const regex = /\[(\d+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const index = match.index;
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }
      const citId = parseInt(match[1], 10);
      parts.push(
        <a
          key={index}
          href={`#citation-${citId}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`citation-${citId}`)?.scrollIntoView({ behavior: "smooth" });
          }}
          className="text-indigo-600 hover:text-indigo-900 font-bold font-mono text-[10px] mx-0.5"
          title={`View Source Evidence [${citId}]`}
        >
          [{citId}]
        </a>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay modal-backdrop-animate">
      <div className="bg-white border border-zinc-200 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] md:max-h-[85vh] flex flex-col overflow-hidden text-zinc-900 modal-dialog-animate">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-zinc-600" />
            <div>
              <h3 className="font-bold text-sm text-zinc-900">AI Institutional Research Report</h3>
              <p className="text-[10px] text-zinc-500">{companyName} ({ticker}) • Grounded SEC Facts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content / Action Center */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Config Area (Before generating) */}
          {!report && !loading && !error && (
            <div className="max-w-md mx-auto text-center space-y-6 py-12">
              <div className="h-12 w-12 bg-zinc-100 rounded-full flex items-center justify-center mx-auto border border-zinc-200">
                <FileText className="w-6 h-6 text-zinc-600" />
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-lg">Generate Institutional Report</h4>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  Analyze sequential quarter filings, calculate deterministic ratios, and structure verified facts using official SEC filings.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 border border-zinc-150 p-4 rounded-lg bg-zinc-50/50">
                <label htmlFor="periods" className="text-xs font-semibold text-zinc-600">Filing Period Span:</label>
                <select
                  id="periods"
                  value={periods}
                  onChange={(e) => setPeriods(Number(e.target.value))}
                  className="px-2 py-1 bg-white border border-zinc-200 rounded text-xs focus:outline-none focus:border-zinc-500 font-semibold cursor-pointer"
                >
                  <option value={4}>Latest 4 Filings (1 Year)</option>
                  <option value={8}>Latest 8 Filings (2 Years)</option>
                  <option value={12}>Latest 12 Filings (3 Years)</option>
                  <option value={16}>Latest 16 Filings (4 Years)</option>
                </select>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="inline-flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 cursor-pointer disabled:bg-zinc-105 disabled:text-zinc-400"
              >
                <span>{loading ? "Generating…" : "Generate Research Report"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Loading step tracker */}
          {loading && (
            <div className="max-w-md mx-auto py-12 space-y-8 animate-fadeIn">
              <div className="text-center space-y-2">
                <div className="relative h-10 w-10 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-full border-2 border-zinc-200"></div>
                  <div className="absolute inset-0 rounded-full border-2 border-t-zinc-900 animate-spin"></div>
                </div>
                <h4 className="font-bold text-base text-zinc-900">Generating Institutional Report...</h4>
                <p className="text-xs text-zinc-400">Please wait while FilingLens processes live SEC EDGAR data.</p>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 space-y-4 text-sm shadow-inner">
                {[
                  { label: "Fetching SEC filing…", active: stepIdx >= 0 && stepIdx < 2, done: stepIdx >= 2 },
                  { label: "Extracting financial facts…", active: stepIdx >= 2 && stepIdx < 4, done: stepIdx >= 4 },
                  { label: "Generating analysis…", active: stepIdx === 4, done: stepIdx >= 5 },
                  { label: "Building report…", active: stepIdx === 5, done: !loading && report !== null },
                ].map((item, idx) => {
                  const isDone = item.done;
                  const isActive = item.active && loading;
                  return (
                    <div key={idx} className="flex items-center justify-between text-xs font-sans">
                      <div className="flex items-center gap-3">
                        {isDone ? (
                          <span className="text-emerald-600 font-bold">✓</span>
                        ) : isActive ? (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-800 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-900"></span>
                          </span>
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300"></span>
                        )}
                        <span className={`font-semibold ${isDone ? "text-zinc-550 line-through decoration-zinc-300" : isActive ? "text-zinc-900 font-bold" : "text-zinc-400"}`}>
                          {item.label}
                        </span>
                      </div>
                      {isActive && <span className="text-[10px] font-mono text-zinc-400 animate-pulse font-bold">In Progress</span>}
                      {isDone && <span className="text-[10px] font-mono text-emerald-600 font-bold">Done</span>}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-zinc-900 h-1.5 transition-all duration-700 rounded-full"
                    style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }}
                  ></div>
                </div>
                <div className="text-[10px] text-zinc-400 font-mono text-center font-medium">
                  {STEPS[stepIdx]}
                </div>
              </div>

              {/* Skeleton paragraphs below loader */}
              <div className="space-y-6 pt-6 border-t border-zinc-150/80 animate-pulse">
                <div className="space-y-2">
                  <div className="h-4 w-1/4 shimmer-bg rounded"></div>
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-full shimmer-bg rounded"></div>
                    <div className="h-3.5 w-5/6 shimmer-bg rounded"></div>
                    <div className="h-3.5 w-4/5 shimmer-bg rounded"></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-1/3 shimmer-bg rounded"></div>
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-full shimmer-bg rounded"></div>
                    <div className="h-3.5 w-11/12 shimmer-bg rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Board */}
          {error && (
            <div className="p-6 border border-red-200 rounded-xl bg-red-50 text-red-800 text-center space-y-4 max-w-lg mx-auto my-12 shadow-xs animate-fadeIn">
              <div className="flex items-center justify-center gap-2 font-bold text-red-900 text-sm">
                <AlertTriangle className="w-5 h-5 text-red-700" />
                <span>Unable to load SEC data.</span>
              </div>
              <p className="text-xs leading-relaxed text-red-700 font-medium">Please try again in a few moments.</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleGenerate}
                  className="bg-red-800 hover:bg-red-900 text-white text-xs px-4 py-2 rounded-lg font-bold transition-all focus:outline-none cursor-pointer"
                >
                  Retry Generation
                </button>
                <button
                  onClick={onClose}
                  className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs px-4 py-2 rounded-lg font-bold transition-all focus:outline-none cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Report Presenter */}
          {report && !loading && (
            <div className="space-y-8 select-text font-serif leading-relaxed text-zinc-800 pr-2">
              
              {/* Report Header Title */}
              <div className="border-b border-zinc-200 pb-4 text-center">
                <h2 className="text-2xl font-bold font-serif text-zinc-950 leading-tight">{report.title}</h2>
                <div className="text-xs text-zinc-400 font-sans mt-2 font-medium">
                  CIK: {cik} | Ticker: {ticker} | Normalized SEC Evidence
                </div>
              </div>

              {/* Filing Metadata Panel */}
              {report.metadata && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 p-4 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-sans text-zinc-600">
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">Filing Type</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.filing_type}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">Filing Date</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.filing_date}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">Period End</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.period_end}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">Fiscal Quarter</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.fiscal_quarter}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">CIK</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.cik}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-400 block uppercase text-[9px] tracking-wider">Exchange</span>
                    <span className="font-bold text-zinc-800 text-[13px]">{report.metadata.exchange}</span>
                  </div>
                </div>
              )}

              {/* Investment Snapshot Card */}
              {report.investment_snapshot && (
                <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-xs font-sans">
                  <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-3 flex items-center justify-between">
                    <h4 className="font-bold text-zinc-900 text-xs tracking-wider uppercase">Investment Snapshot</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                      report.investment_snapshot.overall_assessment.toUpperCase() === "POSITIVE"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-150"
                        : report.investment_snapshot.overall_assessment.toUpperCase() === "CAUTIOUS"
                        ? "bg-red-50 text-red-700 border border-red-150"
                        : "bg-zinc-100 text-zinc-700 border border-zinc-200"
                    }`}>
                      {report.investment_snapshot.overall_assessment}
                    </span>
                  </div>
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-xs">
                    <div className="space-y-1">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider">Financial Health</span>
                      <p className="text-zinc-800 leading-relaxed font-serif text-[13px]">{report.investment_snapshot.financial_health}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider">Liquidity</span>
                      <p className="text-zinc-800 leading-relaxed font-serif text-[13px]">{report.investment_snapshot.liquidity}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider">Profitability</span>
                      <p className="text-zinc-800 leading-relaxed font-serif text-[13px]">{report.investment_snapshot.profitability}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider">Leverage</span>
                      <p className="text-zinc-800 leading-relaxed font-serif text-[13px]">{report.investment_snapshot.leverage}</p>
                    </div>
                    <div className="space-y-1 border-t border-zinc-100 pt-3">
                      <span className="font-bold text-emerald-700 uppercase text-[9px] tracking-wider">Biggest Strength</span>
                      <p className="font-bold text-zinc-900 font-sans text-xs">{report.investment_snapshot.biggest_strength}</p>
                    </div>
                    <div className="space-y-1 border-t border-zinc-100 pt-3">
                      <span className="font-bold text-red-700 uppercase text-[9px] tracking-wider">Biggest Risk</span>
                      <p className="font-bold text-zinc-900 font-sans text-xs">{report.investment_snapshot.biggest_risk}</p>
                    </div>
                    <div className="space-y-2 md:col-span-2 border-t border-zinc-100 pt-3">
                      <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider">Key Metrics to Watch Next Quarter</span>
                      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-1">
                        {report.investment_snapshot.metrics_to_watch_next_quarter.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 text-zinc-800 bg-zinc-55 border border-zinc-200/60 p-2 rounded-md text-[11px] leading-relaxed">
                            <span className="text-zinc-400 select-none">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Sections list mapping */}
              {[
                { title: "I. Executive Summary", section: report.executive_summary },
                { title: "II. Business Overview", section: report.business_overview },
                { title: "III. Financial Highlights", section: report.financial_highlights },
                { title: "IV. Balance Sheet Analysis", section: report.balance_sheet },
                { title: "V. Income Statement Analysis", section: report.income_statement },
                { title: "VI. Cash Flow & Reserves", section: report.cash_flow },
                { title: "VII. Profitability Metrics", section: report.profitability },
                { title: "VIII. Risk & Internal Controls", section: report.risks },
                { title: "IX. Recent Changes & Filing Diff Summary", section: report.recent_changes },
                { title: "X. Management Discussion & Analysis Summary", section: report.management_discussion },
                { title: "XI. Conclusion & Wrap-Up", section: report.conclusion }
              ].map((s, idx) => (
                <div key={idx} className="space-y-2">
                  <h4 className="font-bold text-zinc-900 text-sm font-sans tracking-wide uppercase">{s.title}</h4>
                  <div className="text-[13px] whitespace-pre-line font-normal text-zinc-800 pl-4 border-l border-zinc-200">
                    {renderTextWithCitations(s.section.content)}
                  </div>
                  
                  {/* Directly below Executive Summary, inject the Key Metrics Grid */}
                  {s.title.includes("Executive Summary") && report.key_metrics && (
                    <div className="mt-4 pt-4 border-t border-zinc-150 space-y-3 font-sans">
                      <h5 className="font-bold text-zinc-700 text-xs tracking-wider uppercase">Key Metrics at a Glance</h5>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {report.key_metrics.map((m) => {
                          const isGrowth = ["revenue_growth", "net_income_growth", "cash_change"].includes(m.key);
                          const trendText = m.change_percentage !== null 
                            ? (isGrowth 
                                ? `${m.change_percentage > 0 ? "+" : ""}${(m.change_percentage * 100).toFixed(1)}% YoY` 
                                : `${m.change_percentage > 0 ? "+" : ""}${m.change_percentage.toFixed(2)} Abs`)
                            : null;
                          
                          const badgeColor = m.status === "increased"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-150"
                            : m.status === "decreased"
                            ? "bg-red-50 text-red-700 border-red-150"
                            : "bg-zinc-100 text-zinc-650 border-zinc-200";
                            
                          const indicatorArrow = m.status === "increased" ? "▲" : m.status === "decreased" ? "▼" : "";

                          return (
                            <div key={m.key} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex flex-col justify-between shadow-3xs hover:border-zinc-300 transition-colors">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">{m.label}</span>
                              <div className="my-2">
                                <span className="text-base font-bold font-mono text-zinc-900 tracking-tight">{m.value}</span>
                              </div>
                              {trendText ? (
                                <span className={`inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-md text-[9px] font-bold border ${badgeColor}`}>
                                  {indicatorArrow && <span>{indicatorArrow}</span>}
                                  <span>{trendText}</span>
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-400 font-medium">—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Sources & Citations Table */}
              {report.citations.length > 0 && (
                <div className="space-y-4 pt-6 border-t border-zinc-200 font-sans">
                  <h4 className="font-bold text-zinc-900 text-sm tracking-wide uppercase">Sources & Citations Evidence</h4>
                  <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
                    <table className="w-full text-left text-[11px] border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase tracking-wider">
                          <th className="px-3 py-2 w-16 text-center">Reference</th>
                          <th className="px-3 py-2">Concept</th>
                          <th className="px-3 py-2 text-right">Reported Value</th>
                          <th className="px-3 py-2 text-center w-16">Unit</th>
                          <th className="px-3 py-2 text-center w-24">Period</th>
                          <th className="px-3 py-2 text-center w-16">Form</th>
                          <th className="px-3 py-2 text-center w-24">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150">
                        {report.citations.map((c) => {
                          const hasValue = c.value !== null && c.value !== undefined;
                          const valStr = hasValue ? (
                            c.unit === "%" 
                              ? c.value.toFixed(2)
                              : c.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          ) : "N/A";
                          return (
                            <tr
                              key={c.id}
                              id={`citation-${c.id}`}
                              className="hover:bg-zinc-50/50 transition-colors"
                            >
                              <td className="px-3 py-2.5 font-mono font-bold text-center text-zinc-400">
                                [{c.id}]
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-semibold text-zinc-900">{c.label || c.concept}</span>
                                <div className="text-[9px] text-zinc-400 font-mono mt-0.5">{c.concept}</div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-950">
                                {valStr}
                              </td>
                              <td className="px-3 py-2.5 text-center font-semibold text-zinc-500 font-sans">
                                {c.unit || "—"}
                              </td>
                              <td className="px-3 py-2.5 text-center text-zinc-600 font-mono">
                                {c.period_end}
                              </td>
                              <td className="px-3 py-2.5 text-center font-bold text-zinc-700">
                                {c.form}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {c.source_url ? (
                                  <a
                                    href={c.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-650 hover:underline hover:text-indigo-900 font-bold"
                                  >
                                    SEC Link
                                  </a>
                                ) : (
                                  <span className="text-zinc-400 font-medium">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Modal Actions Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {report && (
              <>
                <button
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 rounded text-xs font-semibold hover:bg-zinc-100 transition-all text-zinc-700 focus:outline-none cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Report</span>
                </button>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 rounded text-xs font-semibold hover:bg-zinc-100 transition-all text-zinc-700 focus:outline-none cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-zinc-200 bg-white hover:bg-zinc-100 rounded-lg text-xs font-semibold text-zinc-700 transition-all focus:outline-none cursor-pointer"
            >
              Close
            </button>
            {report && (
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400 text-white rounded-lg text-xs font-semibold transition-all shadow-xs focus:outline-none cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{pdfLoading ? "Generating..." : "Download as PDF"}</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}
