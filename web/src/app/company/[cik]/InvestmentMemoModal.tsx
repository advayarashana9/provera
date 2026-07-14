"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  generateInvestmentMemo,
  downloadInvestmentMemoPdf,
  InvestmentMemoResponse
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
  "Collecting financial statements...",
  "Comparing historical filings...",
  "Reviewing risk factors...",
  "Building competitive summary...",
  "Generating investment memo..."
];

export default function InvestmentMemoModal({ cik, companyName, ticker, isOpen, onClose }: Props) {
  const [periods, setPeriods] = useState<number>(4);
  const [memo, setMemo] = useState<InvestmentMemoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [peers, setPeers] = useState<number[]>([]);
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
    if (isOpen) {
      try {
        const stored = localStorage.getItem(`filinglens_compare_peers_${cik}`);
        if (stored) {
          interface PeerItemLocalStorage {
            cik: number;
          }
          const parsed = JSON.parse(stored) as PeerItemLocalStorage[];
          const peerCiks = parsed.map((p) => p.cik);
          setTimeout(() => {
            if (isMounted.current) {
              setPeers(peerCiks);
            }
          }, 0);
        } else {
          setTimeout(() => {
            if (isMounted.current) {
              setPeers([]);
            }
          }, 0);
        }
      } catch (e) {
        console.error(e);
        setTimeout(() => {
          if (isMounted.current) {
            setPeers([]);
          }
        }, 0);
      }
    }
  }, [isOpen, cik]);

  useEffect(() => {
    if (loading) {
      intervalRef.current = setInterval(() => {
        setStepIdx((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
      }, 2000);
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
    setMemo(null);
    try {
      const res = await generateInvestmentMemo(cik, peers, periods);
      if (isMounted.current) {
        setMemo(res);
      }
    } catch (err: unknown) {
      console.error(err);
      if (isMounted.current) {
        setError((err as Error).message || "Failed to generate investment memo. Please try again.");
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  const handleDownloadPdf = async () => {
    if (!memo) return;
    try {
      setPdfLoading(true);
      const blob = await downloadInvestmentMemoPdf(cik, memo);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${ticker}_Investment_Memo.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error(err);
      alert("Failed to download PDF memo");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleCopyMemo = () => {
    if (!memo) return;
    const text = `
${memo.title}

Executive Summary:
${memo.executive_summary.content}

Business Overview:
${memo.business_overview.content}

Financial Strength:
${memo.financial_strength.content}

Growth Drivers:
${memo.growth_drivers.content}

Key Risks:
${memo.key_risks.content}

Filing Changes:
${memo.filing_changes.content}

Competitive Position:
${memo.competitive_position.content}

Overall Assessment:
${memo.overall_assessment.content}

Sources & Evidence:
${memo.citations.map((c) => `[${c.id}] ${c.label || c.concept}: ${c.value} ${c.unit} (${c.period_end}, ${c.form})`).join("\n")}
    `.trim();

    navigator.clipboard.writeText(text);
    alert("Investment memo text copied to clipboard!");
  };

  const handlePrint = () => {
    if (!memo) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>${memo.title}</title>
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
          <h1>${memo.title}</h1>
          <div class="meta">Company Name: ${companyName} | Ticker: ${ticker} | CIK: ${cik} | Generated: ${new Date().toLocaleDateString()}</div>
          
          <h2>Executive Summary</h2>
          <p>${memo.executive_summary.content}</p>
          
          <h2>Business Overview</h2>
          <p>${memo.business_overview.content}</p>
          
          <h2>Financial Strength & Metrics</h2>
          <p>${memo.financial_strength.content}</p>
          
          <h2>Growth Drivers & Trends</h2>
          <p>${memo.growth_drivers.content}</p>
          
          <h2>Key Risks & Solvency</h2>
          <p>${memo.key_risks.content}</p>
          
          <h2>Filing Revisions & Diff Summary</h2>
          <p>${memo.filing_changes.content}</p>
          
          <h2>Competitive Benchmarks</h2>
          <p>${memo.competitive_position.content}</p>
          
          <h2>Overall Assessment</h2>
          <p>${memo.overall_assessment.content}</p>
          
          <h2>Sources & Citations Evidence</h2>
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Concept / Fact</th>
                <th>Period (Form)</th>
                <th>Reported Value</th>
              </tr>
            </thead>
            <tbody>
              ${memo.citations.map((c) => `
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
    const parts: (string | React.ReactNode)[] = [];
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
              <h3 className="font-bold text-sm text-zinc-900">Institutional Investment Memo</h3>
              <p className="text-[10px] text-zinc-500">{companyName} ({ticker}) • Verified Facts & Peer Benchmarks</p>
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
          {!memo && !loading && (
            <div className="max-w-md mx-auto text-center space-y-6 py-12 animate-fadeIn">
              <div className="h-12 w-12 bg-zinc-100 rounded-full flex items-center justify-center mx-auto border border-zinc-200">
                <FileText className="w-6 h-6 text-zinc-600" />
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-zinc-900">Generate Flagship Investment Memo</h4>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Synthesize an institutional investment-style report based on verified SEC filing disclosures, calculated metrics, and compared peers ({peers.length} selected).
                </p>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-left space-y-3">
                <label htmlFor="periods-select" className="block text-xs font-bold text-zinc-700 uppercase tracking-wider">
                  Select Context Range
                </label>
                <select
                  id="periods-select"
                  value={periods}
                  onChange={(e) => setPeriods(parseInt(e.target.value, 10))}
                  className="w-full text-xs p-2 bg-white border border-zinc-250 rounded focus:outline-none focus:border-zinc-500 font-semibold cursor-pointer"
                >
                  <option value={4}>4 Latest Filings (1 Year)</option>
                  <option value={8}>8 Latest Filings (2 Years)</option>
                  <option value={12}>12 Latest Filings (3 Years)</option>
                </select>
              </div>

              <button
                onClick={handleGenerate}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <span>Compile Investment Memo</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Loading Progress State */}
          {loading && (
            <div className="max-w-md mx-auto text-center py-16 space-y-6 animate-fadeIn">
              <div className="w-10 h-10 border-4 border-zinc-950 border-t-transparent rounded-full animate-spin mx-auto animate-fadeIn"></div>
              <div className="space-y-3">
                <div className="text-sm font-bold text-zinc-955">Generating Memo...</div>
                <div className="text-xs text-zinc-400 h-4 transition-all animate-pulse">
                  {STEPS[stepIdx]}
                </div>
              </div>

              {/* Progress Steps Indicators */}
              <div className="flex items-center justify-center gap-1.5 pt-4">
                {STEPS.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all ${
                      idx <= stepIdx ? "w-6 bg-zinc-950" : "w-2 bg-zinc-200"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error Alert Box */}
          {error && (
            <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg flex flex-col gap-3 text-xs animate-fadeIn shadow-xs my-12">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold block">Generation Failed</span>
                  <p className="text-red-750 font-medium">{error}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  className="bg-red-800 text-white font-bold rounded px-3 py-1.5 hover:bg-red-900 transition-colors cursor-pointer text-[10px]"
                >
                  Retry
                </button>
                <button
                  onClick={onClose}
                  className="bg-white border border-zinc-205 text-zinc-700 font-bold rounded px-3 py-1.5 hover:bg-zinc-100 transition-colors cursor-pointer text-[10px]"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Memo Presenter Box */}
          {memo && !loading && (
            <div className="space-y-8 text-xs select-text font-serif leading-relaxed text-zinc-900">
              
              {/* Title & Metadata */}
              <div className="border-b border-zinc-200 pb-4 text-center">
                <h2 className="text-lg font-bold font-serif text-zinc-950 leading-tight">
                  {memo.title}
                </h2>
                <div className="text-[10px] text-zinc-400 font-sans mt-2 font-semibold">
                  CIK: {cik} | Ticker: {ticker} | Generated SEC Context
                </div>
              </div>

              {/* Sections Story */}
              <div className="space-y-6 divide-y divide-zinc-100">
                
                {/* Executive Summary */}
                <div className="space-y-2">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.executive_summary.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.executive_summary.content)}
                  </p>
                </div>

                {/* Business Overview */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.business_overview.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.business_overview.content)}
                  </p>
                </div>

                {/* Financial Strength */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.financial_strength.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.financial_strength.content)}
                  </p>
                </div>

                {/* Growth Drivers */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.growth_drivers.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.growth_drivers.content)}
                  </p>
                </div>

                {/* Key Risks */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.key_risks.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.key_risks.content)}
                  </p>
                </div>

                {/* Filing Changes */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.filing_changes.title}
                  </h4>
                  <p className="text-zinc-650 text-justify">
                    {renderTextWithCitations(memo.filing_changes.content)}
                  </p>
                </div>

                {/* Competitive Position */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.competitive_position.title}
                  </h4>
                  <div className="text-zinc-650 text-justify whitespace-pre-line">
                    {renderTextWithCitations(memo.competitive_position.content)}
                  </div>
                </div>

                {/* Overall Assessment */}
                <div className="space-y-2 pt-4">
                  <h4 className="font-bold text-zinc-955 text-xs uppercase tracking-wider border-l-2 border-zinc-900 pl-2">
                    {memo.overall_assessment.title}
                  </h4>
                  <div className="text-zinc-650 text-justify whitespace-pre-line bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                    {renderTextWithCitations(memo.overall_assessment.content)}
                  </div>
                </div>

              </div>

              {/* Citations Appendix */}
              {memo.citations.length > 0 && (
                <div className="border-t border-zinc-200 pt-6 mt-8">
                  <h4 className="font-bold text-zinc-900 text-xs uppercase tracking-wider mb-4">
                    Sources & Evidence Citations
                  </h4>
                  <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 font-semibold text-zinc-500">
                          <th className="px-4 py-2 text-center w-12">Ref</th>
                          <th className="px-4 py-2">Concept / Fact Label</th>
                          <th className="px-4 py-2 w-44">Period End (Form)</th>
                          <th className="px-4 py-2 text-right w-44">Reported Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150">
                        {memo.citations.map((c) => (
                          <tr
                            key={c.id}
                            id={`citation-${c.id}`}
                            className="hover:bg-zinc-50 transition-colors font-sans text-zinc-650"
                          >
                            <td className="px-4 py-2.5 text-center font-mono font-bold text-zinc-900 bg-zinc-50/50">
                              [{c.id}]
                            </td>
                            <td className="px-4 py-2.5 font-medium text-zinc-800">
                              {c.label || c.concept}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[10px] text-zinc-400 whitespace-nowrap">
                              {c.period_end} ({c.form})
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-zinc-950">
                              {typeof c.value === "number" && c.unit.toLowerCase() !== "shares"
                                ? c.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                                : c.value}{" "}
                              <span className="text-[10px] text-zinc-400 font-normal uppercase">{c.unit}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {memo && (
              <>
                <button
                  onClick={handleCopyMemo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 rounded text-xs font-semibold hover:bg-zinc-100 transition-all text-zinc-700 focus:outline-none cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Memo</span>
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
              className="px-4 py-2 bg-white border border-zinc-250 hover:bg-zinc-50 font-semibold rounded-lg text-zinc-700 transition-colors cursor-pointer"
            >
              Close
            </button>
            {!memo && !loading && (
              <button
                onClick={handleGenerate}
                className="px-4 py-2 bg-zinc-950 hover:bg-zinc-800 font-bold rounded-lg text-white transition-colors cursor-pointer"
              >
                Generate Memo
              </button>
            )}
            {memo && (
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400 text-white rounded-lg font-bold shadow-xs focus:outline-none cursor-pointer"
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
