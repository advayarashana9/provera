"use client";

import React, { useState, useRef, useEffect } from "react";
import { SAMPLE_REPORTS, SampleReport } from "./sampleReports";
import { UploadCloud, Sparkles, AlertCircle, Check } from "lucide-react";

interface VerificationInputProps {
  initialText?: string;
  onVerify: (text: string) => void;
  isLoading: boolean;
}

const VerificationInput = React.forwardRef<HTMLTextAreaElement, VerificationInputProps>(
  function VerificationInput({ initialText = "", onVerify, isLoading }, ref) {
    const [text, setText] = useState(initialText);
    const [activeSample, setActiveSample] = useState<SampleReport | null>(null);
    const [prevSampleId, setPrevSampleId] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [fileSuccess, setFileSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Track if text in editor is loaded from a sample or custom typed by user
    const [isSampleText, setIsSampleText] = useState(false);

    // Custom Inline Confirmation banner state
    const [pendingAction, setPendingAction] = useState<{
      type: "sample" | "file";
      payload: SampleReport | { file: File; content: string };
    } | null>(null);

    // Animated typing demonstration states
    const [isTypingDemo, setIsTypingDemo] = useState(false);
    const [demoText, setDemoText] = useState("");
    const [demoSample, setDemoSample] = useState<SampleReport | null>(null);
    const [cursorVisible, setCursorVisible] = useState(true);
    const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const charIndexRef = useRef(0);

    // Sync initialText if it changes (e.g. on mount from searchParams)
    useEffect(() => {
      if (initialText) {
        setIsTypingDemo(false);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setTimeout(() => {
          setText(initialText);
          const matched = SAMPLE_REPORTS.find(r => r.text.trim() === initialText.trim());
          if (matched) {
            setActiveSample(matched);
            setIsSampleText(true);
          } else {
            setIsSampleText(false);
          }
        }, 0);
      }
    }, [initialText]);

    // Start typing demo on mount if initialText is empty
    useEffect(() => {
      if (!initialText) {
        // Pick a random sample report
        const randomIndex = Math.floor(Math.random() * SAMPLE_REPORTS.length);
        const sample = SAMPLE_REPORTS[randomIndex];
        setDemoSample(sample);
        setIsTypingDemo(true);
        charIndexRef.current = 0;
        setDemoText("");
      }
      return () => {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      };
    }, [initialText]);

    // Blinking cursor effect
    useEffect(() => {
      if (!isTypingDemo) return;
      const interval = setInterval(() => {
        setCursorVisible((v) => !v);
      }, 500);
      return () => clearInterval(interval);
    }, [isTypingDemo]);

    // Typing speed loop (simulates ChatGPT dynamic streaming)
    useEffect(() => {
      if (!isTypingDemo || !demoSample) return;

      const targetText = demoSample.text;

      const tick = () => {
        if (charIndexRef.current >= targetText.length) {
          // Finished typing!
          setIsTypingDemo(false);
          setText(targetText);
          setActiveSample(demoSample);
          setIsSampleText(true);
          return;
        }

        // Add 1-4 random characters to simulate natural ChatGPT text production
        const charsToAdd = Math.floor(Math.random() * 3) + 1;
        charIndexRef.current = Math.min(charIndexRef.current + charsToAdd, targetText.length);
        setDemoText(targetText.slice(0, charIndexRef.current));

        // Random delay between keystrokes (20ms to 70ms)
        const delay = Math.random() * 50 + 20;
        typingTimerRef.current = setTimeout(tick, delay);
      };

      typingTimerRef.current = setTimeout(tick, 300);

      return () => {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      };
    }, [isTypingDemo, demoSample]);

    // Cancellation of demo upon manual action
    const cancelTypingDemo = (finalTextToSet?: string) => {
      if (isTypingDemo) {
        setIsTypingDemo(false);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        const textToUse = finalTextToSet !== undefined ? finalTextToSet : demoText;
        setText(textToUse);
        setActiveSample(null);
        setIsSampleText(false);
      }
    };

    // Word count helper
    const activeText = isTypingDemo ? demoText : text;
    const wordCount = activeText.trim() ? activeText.trim().split(/\s+/).length : 0;
    const isInvalidLength = wordCount > 0 && (wordCount < 10 || wordCount > 2500);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      // Ensure we submit the final text when calling verification
      const textToSubmit = isTypingDemo ? demoText : text;
      if (!textToSubmit.trim() || isInvalidLength || isLoading) return;
      onVerify(textToSubmit);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (isTypingDemo) {
        cancelTypingDemo(e.target.value);
      } else {
        setText(e.target.value);
        setActiveSample(null); // Clear loaded label on manual edit
        setIsSampleText(false); // Text is now custom typed
      }
      if (pendingAction) {
        setPendingAction(null); // Dismiss replace confirmation on typing
      }
    };

    const handleFocus = () => {
      cancelTypingDemo();
    };

    const handleMouseDown = () => {
      cancelTypingDemo();
    };

    // Safe load mechanism
    const loadReportContent = (report: SampleReport) => {
      setIsTypingDemo(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      const isTextEmpty = !text.trim();
      
      // Overwrite immediately if empty or if currently loaded content is a sample
      if (isTextEmpty || isSampleText) {
        setText(report.text);
        setActiveSample(report);
        setPrevSampleId(report.id);
        setIsSampleText(true);
        setFileError(null);
        setFileSuccess(null);
        setPendingAction(null);
        return;
      }

      setPendingAction({ type: "sample", payload: report });
    };

    // Random load report
    const handleRandomSample = () => {
      setIsTypingDemo(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      const candidates = SAMPLE_REPORTS.filter(r => r.id !== prevSampleId);
      const pool = candidates.length > 0 ? candidates : SAMPLE_REPORTS;
      const randomIndex = Math.floor(Math.random() * pool.length);
      loadReportContent(pool[randomIndex]);
    };

    // Load specific chip
    const handleChipClick = (ticker: string) => {
      setIsTypingDemo(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      const report = SAMPLE_REPORTS.find(r => r.ticker === ticker);
      if (report) {
        loadReportContent(report);
      }
    };

    // Drag and drop handlers
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = () => {
      setIsDragging(false);
    };

    const processFile = (file: File) => {
      setIsTypingDemo(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setFileError(null);
      setFileSuccess(null);

      if (file.size > 1024 * 1024) {
        setFileError("File exceeds 1MB limit. Please paste or upload a smaller TXT file.");
        return;
      }

      const nameLower = file.name.toLowerCase();
      if (nameLower.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result;
          if (typeof content === "string") {
            const isTextEmpty = !text.trim();
            if (isTextEmpty || isSampleText) {
              setText(content);
              setActiveSample(null);
              setIsSampleText(true);
              setFileSuccess(`Successfully loaded text from ${file.name}`);
              setPendingAction(null);
            } else {
              setPendingAction({ type: "file", payload: { file, content } });
            }
          }
        };
        reader.onerror = () => {
          setFileError("Failed to read the file. Please check file permissions.");
        };
        reader.readAsText(file);
      } else if (nameLower.endsWith(".pdf") || nameLower.endsWith(".docx")) {
        setFileError("PDF and DOCX support is coming later. Please paste the report text or upload a TXT file.");
      } else {
        setFileError("Unsupported file format. Only plain text (.txt) files are currently supported.");
      }
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isLoading) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
      }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFile(e.target.files[0]);
      }
    };

    return (
      <div 
        className="w-full max-w-4xl mx-auto space-y-4 relative"
        onDragOver={handleDragOver}
      >
        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".txt,text/plain"
          onChange={handleFileInputChange}
          disabled={isLoading}
        />

        {/* Elegant Inline Sample Controls */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-zinc-400 select-none pb-1">
          <span>Need an example?</span>
          {["AAPL", "MSFT", "NVDA", "TSLA"].map((ticker) => {
            const names: Record<string, string> = {
              AAPL: "Apple",
              MSFT: "Microsoft",
              NVDA: "NVIDIA",
              TSLA: "Tesla"
            };
            const isCurrent = activeSample?.ticker === ticker;
            return (
              <React.Fragment key={ticker}>
                <button
                  type="button"
                  onClick={() => handleChipClick(ticker)}
                  disabled={isLoading}
                  className={`hover:text-zinc-800 transition-colors cursor-pointer font-bold ${
                    isCurrent ? "text-blue-800 underline underline-offset-2" : "text-zinc-500"
                  }`}
                  title={names[ticker]}
                >
                  {names[ticker]}
                </button>
                <span>•</span>
              </React.Fragment>
            );
          })}
          <button
            type="button"
            onClick={handleRandomSample}
            disabled={isLoading}
            className="text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer font-bold"
            title="Random Sample"
          >
            Random
          </button>
        </div>

        {/* Editor Card Container */}
        <div 
          className="bg-white rounded-[24px] border border-zinc-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04),0_1px_3px_rgb(0,0,0,0.02)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.06),0_1px_3px_rgb(0,0,0,0.02)] p-5 relative overflow-hidden transition-all duration-300 focus-within:border-blue-600/70 focus-within:ring-4 focus-within:ring-blue-600/5"
          onDragOver={handleDragOver}
        >
          {/* Elegant Drag & Drop Overlay */}
          {isDragging && (
            <div 
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="absolute inset-0 bg-blue-50/95 backdrop-blur-xs border-2 border-dashed border-blue-600 rounded-[24px] flex flex-col items-center justify-center z-40 animate-fade-in select-none"
            >
              <UploadCloud className="w-8 h-8 text-blue-600 animate-bounce mb-2" />
              <span className="text-xs font-bold text-blue-800">Drop your TXT report here (TXT files supported)</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Top Toolbar */}
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5 mb-1 select-none">
              <div className="flex items-center gap-4 text-xs font-bold">
                <button 
                  type="button"
                  onClick={() => (ref as React.RefObject<HTMLTextAreaElement> | null)?.current?.focus() || textareaRef.current?.focus()}
                  className="text-zinc-900 border-b-2 border-zinc-900 pb-1 cursor-pointer"
                >
                  Paste Text
                </button>
                <button 
                  type="button"
                  onClick={() => !isLoading && fileInputRef.current?.click()}
                  className="text-zinc-500 hover:text-zinc-800 pb-1 cursor-pointer transition-colors"
                >
                  Upload TXT
                </button>
              </div>
              
              <div className="flex items-center gap-3 text-[10px] font-semibold text-zinc-400">
                {isTypingDemo && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsTypingDemo(false);
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      if (demoSample) {
                        setText(demoSample.text);
                        setActiveSample(demoSample);
                        setIsSampleText(true);
                      }
                    }}
                    className="hover:text-zinc-700 transition-colors cursor-pointer"
                  >
                    Skip typing
                  </button>
                )}

                {!isTypingDemo && isSampleText && activeSample && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsTypingDemo(true);
                      charIndexRef.current = 0;
                      setDemoText("");
                    }}
                    className="hover:text-zinc-700 transition-colors cursor-pointer"
                  >
                    Replay demo
                  </button>
                )}

                {((!isTypingDemo && text.trim().length > 0) || (isTypingDemo && demoText.trim().length > 0)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsTypingDemo(false);
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      setText("");
                      setActiveSample(null);
                      setIsSampleText(false);
                    }}
                    className="hover:text-zinc-700 transition-colors cursor-pointer"
                  >
                    Clear editor
                  </button>
                )}

                {activeSample && !isTypingDemo && (
                  <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider font-mono animate-fade-in border-l border-zinc-200 pl-3">
                    <Sparkles className="w-3 h-3 text-zinc-400" />
                    <span>Sample: {activeSample.company} {activeSample.period}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Input area */}
            <div className="relative">
              <textarea
                ref={ref || textareaRef}
                id="report-textarea"
                className="w-full h-40 md:h-48 px-3 py-2 bg-transparent text-zinc-950 placeholder:text-zinc-400 focus:outline-none text-sm font-sans resize-none transition-all duration-200 animate-fadeIn"
                value={isTypingDemo ? demoText + (cursorVisible ? "▊" : "") : text}
                onChange={handleTextChange}
                onFocus={handleFocus}
                onMouseDown={handleMouseDown}
                disabled={isLoading}
                spellCheck="false"
                placeholder="Paste your financial report here (minimum 10 words)..."
              />
            </div>

            {/* File Upload Status indicators */}
            {fileError && (
              <div className="flex items-center gap-2 bg-rose-50/60 border border-rose-100 text-xs font-semibold text-rose-700 p-2.5 rounded-xl animate-fade-in text-left">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{fileError}</span>
              </div>
            )}
            {fileSuccess && (
              <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-100 text-xs font-semibold text-emerald-700 p-2.5 rounded-xl animate-fade-in text-left">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>{fileSuccess}</span>
              </div>
            )}

            {/* Custom Inline Confirmation Warning */}
            {pendingAction && (
              <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-slide-down text-left">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-amber-800 block">Replace your current report?</span>
                  <span className="text-[11px] text-amber-700 font-semibold leading-normal block">
                    Loading this example will replace your custom text.
                  </span>
                </div>
                <div className="flex items-center gap-2 select-none self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setPendingAction(null)}
                    className="px-3 py-1.5 bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 hover:border-zinc-400 font-bold rounded-lg text-[10px] transition-all duration-150 cursor-pointer shadow-3xs"
                  >
                    Keep Current
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingAction.type === "sample") {
                        const r = pendingAction.payload as SampleReport;
                        setText(r.text);
                        setActiveSample(r);
                        setPrevSampleId(r.id);
                        setIsSampleText(true);
                        setFileError(null);
                        setFileSuccess(null);
                      } else if (pendingAction.type === "file") {
                        const { file, content } = pendingAction.payload as { file: File; content: string };
                        setText(content);
                        setActiveSample(null);
                        setIsSampleText(true);
                        setFileSuccess(`Successfully loaded text from ${file.name}`);
                      }
                      setPendingAction(null);
                    }}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white border border-blue-700 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] font-bold rounded-lg text-[10px] transition-all duration-150 cursor-pointer"
                  >
                    Replace With {pendingAction.type === "sample" ? (pendingAction.payload as SampleReport).company : "File"}
                  </button>
                </div>
              </div>
            )}

            {/* Form Actions Footer */}
            <div className="flex items-center justify-between gap-4 pt-1 select-none">
              <span className={`text-[10px] font-bold ${isInvalidLength ? "text-amber-600 animate-pulse" : "text-zinc-400"}`}>
                {isInvalidLength 
                  ? (wordCount < 10 ? "Too short (minimum 10 words)" : "Exceeds 2,500 words") 
                  : `${wordCount} words`
                }
              </span>

              <button
                type="submit"
                disabled={isTypingDemo || !activeText.trim() || isInvalidLength || isLoading}
                className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white border border-blue-700 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] disabled:bg-zinc-200 disabled:text-zinc-500 disabled:border-zinc-200 disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer"
              >
                {isLoading ? "Auditing..." : "Start Audit"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }
);

export default VerificationInput;
