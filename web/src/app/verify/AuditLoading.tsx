"use client";

import { useEffect, useState, useRef } from "react";
import { Check } from "lucide-react";

const STAGES = [
  { label: "Reading report", sublabel: "Parsing document structure" },
  { label: "Extracting claims", sublabel: "Identifying measurable statements" },
  { label: "Identifying companies", sublabel: "Resolving entities and CIK metadata" },
  { label: "Matching SEC facts", sublabel: "Querying official EDGAR database" },
  { label: "Running deterministic calculations", sublabel: "Evaluating mathematical claims" },
  { label: "Generating explanations", sublabel: "Writing context descriptions" },
  { label: "Preparing report", sublabel: "Assembling audit workspace" },
];

interface AuditLoadingProps {
  reportTitle?: string;
  isApiReady: boolean;
  onComplete: () => void;
}

export default function AuditLoading({ reportTitle, isApiReady, onComplete }: AuditLoadingProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const timerRef = useRef<number | null>(null);
  const stageRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setTimeout(() => setPrefersReducedMotion(mediaQuery.matches), 0);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", listener);

    const start = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaQuery.removeEventListener("change", listener);
    };
  }, []);

  // Visibly progress pipeline stages. When results load, run sequential completion.
  useEffect(() => {
    if (stageRef.current) window.clearInterval(stageRef.current);

    const runTick = () => {
      setStageIndex((prev) => {
        if (prev < STAGES.length - 1) return prev + 1;
        if (isApiReady) {
          if (stageRef.current) window.clearInterval(stageRef.current);
          setTimeout(() => onCompleteRef.current(), 400);
        }
        return prev;
      });
    };

    let stepDelay = 560;
    if (isApiReady && stageIndex < STAGES.length - 1) {
      const stagesLeft = STAGES.length - 1 - stageIndex;
      stepDelay = Math.max(110, Math.min(240, Math.round(900 / stagesLeft)));
    }

    stageRef.current = window.setInterval(runTick, stepDelay);
    return () => { if (stageRef.current) window.clearInterval(stageRef.current); };
  }, [isApiReady, stageIndex]);

  const progressPercent = Math.round(((stageIndex + 1) / STAGES.length) * 100);
  const currentStage = STAGES[stageIndex];

  const delayWarning =
    elapsed >= 20
      ? "Checking all metrics against the SEC archives takes a few additional seconds."
      : elapsed >= 10
      ? "Parsing calculations and retrieving filing logs from EDGAR databases..."
      : null;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 animate-entrance">

      {/* Main status card */}
      <div
        role="status"
        aria-live="polite"
        className="bg-white border border-zinc-200 shadow-sm rounded-2xl overflow-hidden"
      >
        <div className="h-0.5 bg-zinc-100 w-full">
          <div
            className="h-full bg-blue-600 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="p-8">
          <div className="flex items-start gap-4 mb-7">
            <div className="relative flex-shrink-0 mt-0.5">
              <svg
                className={`w-9 h-9 ${prefersReducedMotion ? "" : "animate-spin"}`}
                style={{ animationDuration: "1.4s" }}
                viewBox="0 0 36 36"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="18" cy="18" r="15" stroke="#e4e4e7" strokeWidth="3" />
                <path
                  d="M18 3 A15 15 0 0 1 33 18"
                  stroke="#1d4ed8"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="min-w-0">
              {reportTitle && (
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 truncate">
                  {reportTitle}
                </p>
              )}
              <p className="text-base font-semibold text-zinc-900 leading-snug">
                {currentStage.label}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5 font-medium">{currentStage.sublabel}</p>
            </div>

            <span className="ml-auto text-xs font-mono font-bold text-zinc-400 flex-shrink-0 tabular-nums">
              {progressPercent}%
            </span>
          </div>

          <div
            className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-700 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {delayWarning && (
            <p className="mt-5 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-4 py-2.5 rounded-xl animate-fade-in font-medium">
              {delayWarning}
            </p>
          )}
        </div>
      </div>

      {/* Pipeline list */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100">
          <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest select-none">
            Audit Pipeline
          </h3>
        </div>

        <ul className="divide-y divide-zinc-100">
          {STAGES.map((stage, idx) => {
            const isDone = idx < stageIndex;
            const isActive = idx === stageIndex;
            const isPending = idx > stageIndex;

            return (
              <li
                key={stage.label}
                className={`flex items-center gap-3.5 px-5 py-3 transition-colors duration-200 animate-pipeline-step ${
                  isActive ? "bg-blue-50/40" : isPending ? "opacity-40" : ""
                }`}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                    isDone
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200 animate-scale-in"
                      : isActive
                      ? "bg-blue-100 border border-blue-200 ring-4 ring-blue-50"
                      : "bg-zinc-100 border border-zinc-200"
                  }`}
                >
                  {isDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700 stroke-[3]" />
                  ) : isActive && !prefersReducedMotion ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  ) : (
                    <span className="text-[10px] font-mono font-bold text-zinc-400">{idx + 1}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span
                    className={`text-xs font-semibold leading-snug block ${
                      isActive ? "text-zinc-900" : isDone ? "text-zinc-500" : "text-zinc-400"
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>

                <div className="flex-shrink-0">
                  {isDone && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono animate-scale-in">
                      Done
                    </span>
                  )}
                  {isActive && (
                    <span
                      className={`text-[9px] font-bold text-blue-800 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${
                        prefersReducedMotion ? "" : "animate-pulse"
                      }`}
                    >
                      Running
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
