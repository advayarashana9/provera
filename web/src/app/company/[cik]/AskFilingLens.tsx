"use client";

import React, { useState, useRef, useEffect } from "react";
import { askQuestion, ChatCitation, ChatComparison } from "@/lib/api";
import { formatPercent, formatDate } from "@/lib/format";

interface AskFilingLensProps {
  cik: number;
  companyName: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  comparisons?: ChatComparison[];
  insufficientEvidence?: boolean;
}

export default function AskFilingLens({ cik, companyName }: AskFilingLensProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hello! I answer questions using source-linked SEC filing facts and deterministic calculations. Try asking about cash reserves, revenue, operating expenses, or assets!`,
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [loadingSeconds, setLoadingSeconds] = useState(0);

  const [expandedSources, setExpandedSources] = useState<{ [key: number]: boolean }>({});
  const [showAllSourcesMap, setShowAllSourcesMap] = useState<{ [key: number]: boolean }>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isLoading) {
      setLoadingSeconds(0);
      interval = setInterval(() => {
        setLoadingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setLoadingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLoading]);

  useEffect(() => {
    if (messages.length > 1 || isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const handlePrefill = (e: Event) => {
      const customEvent = e as CustomEvent<{ query: string }>;
      setInput(customEvent.detail.query);
      
      const chatElement = document.getElementById("ask-filinglens-container");
      if (chatElement) {
        chatElement.scrollIntoView({ behavior: "smooth" });
        const inputElement = chatElement.querySelector("input");
        if (inputElement) {
          (inputElement as HTMLInputElement).focus();
        }
      }
    };
    window.addEventListener("prefill-query", handlePrefill);
    return () => {
      window.removeEventListener("prefill-query", handlePrefill);
    };
  }, []);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleSubmit = async (e?: React.FormEvent, customText?: string) => {
    e?.preventDefault();
    const textToSend = customText || input;
    if (!textToSend.trim() || isLoading) return;

    setError(null);
    setInput("");
    setLastQuery(textToSend);
    setIsLoading(true);

    const userMessage: Message = { role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await askQuestion(cik, textToSend);
      if (!isMounted.current) return;
      
      const assistantMessage: Message = {
        role: "assistant",
        content: response.answer,
        citations: response.citations,
        comparisons: response.comparisons,
        insufficientEvidence: response.insufficient_evidence,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      console.error("Chat error:", err);
      if (!isMounted.current) return;
      setError("The SEC filing is temporarily unavailable.");
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  };

  const handlePresetQuestion = (question: string) => {
    handleSubmit(undefined, question);
  };

  const toggleSources = (index: number) => {
    setExpandedSources((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleShowAllSources = (index: number) => {
    setShowAllSourcesMap((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Format large numbers compactly (e.g. $379.3B or 50.2M shares)
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

  // Safe basic markdown parser rendering bold, lists, and citations
  const parseMarkdown = (text: string, citations: ChatCitation[]) => {
    // 1. Clean raw HTML elements
    const safeText = text.replace(/<[^>]*>/g, "");
    
    // 2. Split by lines to parse paragraphs and list elements
    const lines = safeText.split("\n");
    const elements: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];
    let currentListType: "ul" | "ol" | null = null;

    const flushList = (key: string | number) => {
      if (currentListType === "ul") {
        elements.push(
          <ul key={`ul-${key}`} className="list-disc pl-5 mb-3.5 space-y-1 text-zinc-800 font-sans">
            {currentList}
          </ul>
        );
      } else if (currentListType === "ol") {
        elements.push(
          <ol key={`ol-${key}`} className="list-decimal pl-5 mb-3.5 space-y-1 text-zinc-800 font-sans">
            {currentList}
          </ol>
        );
      }
      currentList = [];
      currentListType = null;
    };

    const parseInline = (inlineText: string) => {
      const inlineRegex = /(\*\*.*?\*\*|\[\d+\])/g;
      const parts = inlineText.split(inlineRegex);
      return parts.map((part, pIdx) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={pIdx} className="font-bold text-zinc-950">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("[") && part.endsWith("]")) {
          const citId = parseInt(part.slice(1, -1), 10);
          const cit = citations.find((c) => c.id === citId);
          if (cit) {
            return (
              <a
                key={pIdx}
                href={cit.source_url || "#"}
                target={cit.source_url ? "_blank" : undefined}
                rel={cit.source_url ? "noreferrer" : undefined}
                className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 rounded text-[10px] font-bold font-mono bg-blue-50 border border-blue-100 hover:bg-blue-100 text-blue-800 transition-colors shadow-xs"
                title={cit.source_url ? `Open SEC document for ${cit.concept}` : `Citation [${citId}]: ${cit.concept}`}
              >
                [{citId}]
              </a>
            );
          }
        }
        return part;
      });
    };

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList(lineIdx);
        return;
      }

      // Bullet list item
      const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bulletMatch) {
        if (currentListType !== "ul") {
          flushList(lineIdx);
          currentListType = "ul";
        }
        currentList.push(
          <li key={`li-${lineIdx}`} className="text-zinc-800 text-sm leading-relaxed">
            {parseInline(bulletMatch[2])}
          </li>
        );
        return;
      }

      // Numbered list item
      const numMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (numMatch) {
        if (currentListType !== "ol") {
          flushList(lineIdx);
          currentListType = "ol";
        }
        currentList.push(
          <li key={`li-${lineIdx}`} className="text-zinc-800 text-sm leading-relaxed">
            {parseInline(numMatch[2])}
          </li>
        );
        return;
      }

      // Regular paragraph line
      flushList(lineIdx);
      elements.push(
        <p key={`p-${lineIdx}`} className="mb-3 text-zinc-800 text-sm leading-relaxed">
          {parseInline(line)}
        </p>
      );
    });

    flushList("end");
    return elements;
  };

  const presets = [
    "What changed in revenue recently?",
    "Explain the latest cash position.",
    "What are the largest balance sheet changes?",
    "Summarize the latest filing.",
    "Show the asset and liabilities verification check."
  ];

  return (
    <div id="ask-filinglens-container" className="flex flex-col h-[650px] border border-zinc-200 bg-white rounded-xl shadow-sm overflow-hidden font-sans">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-800 animate-pulse"></div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-zinc-900 flex items-center gap-1.5 font-serif">
              Ask FilingLens
            </h3>
            <p className="text-[10px] text-zinc-500 font-medium font-sans">
              AI assistant grounded in SEC XBRL filing facts
            </p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-zinc-50/30">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} w-full`}
          >
            {/* Bubble */}
            <div
              className={`max-w-[90%] rounded-xl p-3.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-zinc-900 text-white font-medium shadow-xs"
                  : "bg-white border border-zinc-200 text-zinc-900 shadow-xs w-full"
              }`}
            >
              <div className="select-text">
                {msg.role === "user"
                  ? <p className="text-sm leading-relaxed whitespace-pre-line">{msg.content}</p>
                  : parseMarkdown(msg.content, msg.citations || [])}
              </div>

              {/* Deterministic Comparisons Box (with columns: Metric, Prior, Current, Change, Percent) */}
              {msg.role === "assistant" && msg.comparisons && msg.comparisons.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                  <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Calculated Trend Comparisons (Deterministic)
                  </h4>
                  <div className="border border-zinc-200/60 rounded bg-zinc-50/50 overflow-x-auto w-full">
                    <table className="min-w-full divide-y divide-zinc-200/60 text-[11px] text-left text-zinc-600 font-sans table-auto">
                      <thead className="bg-zinc-100/70 font-semibold text-zinc-700">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Metric</th>
                          <th className="px-3 py-2 text-right font-semibold">Prior</th>
                          <th className="px-3 py-2 text-right font-semibold">Current</th>
                          <th className="px-3 py-2 text-right font-semibold">Change</th>
                          <th className="px-3 py-2 text-right font-semibold">Percent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200/40 bg-white/70">
                        {msg.comparisons.map((c, cIdx) => {
                          const isNeg = c.absolute_change < 0;
                          return (
                            <tr key={cIdx} className="hover:bg-zinc-50/50">
                              <td className="px-3 py-2 font-medium text-zinc-900 break-words min-w-[120px]" title={c.label || c.concept}>
                                {c.label || c.concept}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-[10px] whitespace-nowrap">
                                {formatCompact(c.prior_value, c.unit)}
                                <div className="text-[9px] text-zinc-400 font-sans mt-0.5">{formatDate(c.prior_period_end)}</div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-[10px] whitespace-nowrap">
                                {formatCompact(c.current_value, c.unit)}
                                <div className="text-[9px] text-zinc-400 font-sans mt-0.5">{formatDate(c.current_period_end)}</div>
                              </td>
                              <td className={`px-3 py-2 text-right font-mono text-[10px] whitespace-nowrap font-bold ${isNeg ? 'text-red-600' : 'text-green-700'}`}>
                                {c.absolute_change > 0 ? "+" : ""}{formatCompact(c.absolute_change, c.unit)}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono text-[10px] whitespace-nowrap font-bold ${isNeg ? 'text-red-600' : 'text-green-700'}`}>
                                {c.percentage_change !== null && c.percentage_change !== undefined
                                  ? `${c.percentage_change > 0 ? "+" : ""}${formatPercent(c.percentage_change)}`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* View Source Evidence Toggle */}
              {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                <div className="mt-3.5 pt-2 border-t border-zinc-150/70 flex items-center justify-between">
                  <button
                    onClick={() => toggleSources(idx)}
                    aria-expanded={!!expandedSources[idx]}
                    className="text-[10px] font-bold text-zinc-500 hover:text-zinc-800 transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 rounded px-1 py-0.5"
                  >
                    🔍 {expandedSources[idx] ? "Hide source evidence" : `View source evidence (${msg.citations.length})`}
                  </button>
                </div>
              )}
            </div>

            {/* Sources Accordion */}
            {msg.role === "assistant" && msg.citations && expandedSources[idx] && (
              <div className="mt-2 w-full max-w-[95%] bg-zinc-50 border border-zinc-200 rounded-xl p-4.5 space-y-2.5 text-xs text-zinc-650 shadow-inner animate-fadeIn">
                <p className="font-bold text-zinc-700 text-[10px] uppercase tracking-wider">
                  Sources Section
                </p>
                <div className="border border-zinc-200 rounded-xl bg-white overflow-x-auto w-full">
                  <table className="min-w-full divide-y divide-zinc-200 text-left text-[11px] font-sans">
                    <thead className="bg-zinc-100/80 font-bold text-zinc-700">
                      <tr>
                        <th className="px-3 py-2 w-8 text-center">Ref</th>
                        <th className="px-3 py-2">Label / Concept</th>
                        <th className="px-3 py-2 text-right">Value</th>
                        <th className="px-3 py-2 text-center">Form</th>
                        <th className="px-3 py-2 whitespace-nowrap">Period End</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white">
                      {(showAllSourcesMap[idx] ? msg.citations : msg.citations.slice(0, 12)).map((cit, cIdx) => {
                        return (
                          <tr key={cIdx} className="hover:bg-zinc-50/50">
                            <td className="px-3 py-2 font-mono text-[10px] text-center text-zinc-400 font-bold">
                              [{cit.id}]
                            </td>
                            <td className="px-3 py-2 break-words max-w-[180px]">
                              {cit.source_url ? (
                                <a
                                  href={cit.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-800 hover:text-blue-700 hover:underline font-semibold"
                                >
                                  {cit.label || cit.concept}
                                </a>
                              ) : (
                                <span>{cit.label || cit.concept}</span>
                              )}
                              <div className="text-[9px] text-zinc-400 font-mono mt-0.5 truncate">{cit.concept}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-zinc-950 whitespace-nowrap">
                              {formatCompact(cit.value, cit.unit)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="font-mono bg-zinc-100 text-zinc-600 px-1 py-0.5 rounded text-[10px] font-bold">
                                {cit.form || "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                              {formatDate(cit.period_end)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Show all sources toggle button */}
                {msg.citations.length > 12 && (
                  <button
                    onClick={() => toggleShowAllSources(idx)}
                    className="text-[10px] font-bold text-blue-800 hover:text-blue-700 hover:underline transition-colors block w-fit"
                  >
                    {showAllSourcesMap[idx] ? "Show fewer sources" : `Show all sources (${msg.citations.length - 12} more exist)`}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex flex-col items-start animate-fadeIn">
            <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-xs text-zinc-650 flex flex-col space-y-2 max-w-[90%]">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-blue-800 rounded-full animate-bounce shrink-0"></span>
                <span className="h-1.5 w-1.5 bg-blue-800 rounded-full animate-bounce delay-100 shrink-0"></span>
                <span className="h-1.5 w-1.5 bg-blue-800 rounded-full animate-bounce delay-200 shrink-0"></span>
                <span className="text-xs font-semibold text-zinc-500">
                  FilingLens is analyzing the filing…
                </span>
              </div>
              {loadingSeconds >= 15 ? (
                <p className="text-[10px] text-amber-600 font-semibold italic animate-fade-in-up">
                  Still analyzing. Large filings can take up to 20 seconds to process
                </p>
              ) : loadingSeconds >= 5 ? (
                <p className="text-[10px] text-zinc-400 font-semibold italic animate-fade-in-up">
                  This may take a little longer on free servers
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* Error panel */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-750 text-xs rounded-xl p-4 shadow-sm space-y-3 max-w-[90%] animate-fadeIn">
            <div className="font-bold flex items-center gap-1.5 text-red-900 text-xs uppercase tracking-wider">
              ⚠️ The SEC filing is temporarily unavailable.
            </div>
            <p className="font-medium text-red-700 leading-relaxed">Please try again in a few moments.</p>
            <button
              onClick={() => handleSubmit(undefined, lastQuery)}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-900 text-white rounded-lg text-[10px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-700 cursor-pointer active:scale-[0.98] w-fit shadow-xs"
            >
              Retry last question
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Preset quick buttons */}
      {messages.length === 1 && !isLoading && (
        <div className="px-5 py-3.5 border-t border-zinc-100 bg-white space-y-2.5">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Suggested Questions:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handlePresetQuestion(q)}
                className="text-[10px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 hover:text-zinc-955 px-2.5 py-1.5 rounded-lg transition-all shadow-xs border border-zinc-200/50 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-zinc-100 bg-white flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${companyName}'s filings...`}
          disabled={isLoading}
          className="flex-1 h-9 px-3 border border-zinc-200 rounded-lg text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 disabled:bg-zinc-50 font-normal transition-all"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="h-9 px-4 bg-blue-800 hover:bg-blue-700 disabled:bg-zinc-100 text-white disabled:text-zinc-400 font-semibold rounded-lg text-xs transition-all active:scale-[0.98] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 flex items-center justify-center min-w-[70px]"
        >
          {isLoading ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
