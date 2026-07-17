"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { searchCompanies, CompanySearchResult } from "@/lib/api";
import { formatCIK } from "@/lib/format";
import {
  Search,
  FileText,
  TrendingUp,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  ShieldCheck,
  Database,
  GitCompare,
  Users,
  ChevronDown,
  ExternalLink
} from "lucide-react";
import VerificationInput from "./verify/VerificationInput";

const Logo = () => (
  <div className="flex items-center gap-2 select-none">
    {/* Provera P-mark: geometric letterform on deep navy — works at 16×16+ */}
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1e3a5f"/>
      {/* Stem */}
      <rect x="10" y="8" width="3" height="16" rx="1.5" fill="white"/>
      {/* Bowl top */}
      <rect x="10" y="8" width="10" height="3" rx="1.5" fill="white"/>
      {/* Bowl mid */}
      <rect x="10" y="15" width="9" height="2.5" rx="1.25" fill="white"/>
      {/* Bowl right */}
      <rect x="17" y="8" width="3" height="9.5" rx="1.5" fill="white"/>
      {/* Verification dot */}
      <circle cx="22.5" cy="22.5" r="2.5" fill="#3b82f6"/>
      <path d="M21.3 22.5 L22.2 23.4 L23.8 21.6" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <span className="font-semibold text-zinc-900 text-sm tracking-tight font-sans">Provera</span>
  </div>
);

function CountUpValue({ value, suffix = "", prefix = "", duration = 750 }: { value: number; suffix?: string; prefix?: string; duration?: number }) {
  const [currentVal, setCurrentVal] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    let frameId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCurrentVal(progress * value);
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [value, duration]);

  return (
    <span className="font-mono">
      {prefix}
      {currentVal.toFixed(2)}
      {suffix}
    </span>
  );
}

function ScrollReveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setTimeout(() => setIsVisible(true), 0);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.05 }
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-out`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(16px)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Search loading stage definitions
// ─────────────────────────────────────────────────────────────────────────────
interface SearchStage {
  title: string;
  subtitle: string;
  showNote: boolean;
}

const SEARCH_STAGES: Array<{ afterMs: number } & SearchStage> = [
  {
    afterMs: 0,
    title: "Searching SEC companies",
    subtitle: "Looking for matching public companies and ticker symbols.",
    showNote: false,
  },
  {
    afterMs: 3000,
    title: "Connecting to Provera",
    subtitle: "The analysis server is starting and preparing your request.",
    showNote: false,
  },
  {
    afterMs: 8000,
    title: "Waking up the analysis server",
    subtitle: "The free server may need a few extra seconds after a period of inactivity.",
    showNote: true,
  },
  {
    afterMs: 20000,
    title: "Still getting things ready",
    subtitle: "Your request is still active. The first search is usually the slowest, and later searches should be much faster.",
    showNote: true,
  },
];

function useSearchStage(isLoading: boolean) {
  const [stage, setStage] = useState<SearchStage | null>(null);
  const startRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Clear previous timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!isLoading) {
      // Defer to avoid synchronous setState-in-effect lint violation
      const clearId = setTimeout(() => {
        setStage(null);
        startRef.current = null;
      }, 0);
      return () => clearTimeout(clearId);
    }

    startRef.current = Date.now();

    // Schedule each stage transition
    SEARCH_STAGES.forEach((s) => {
      const id = setTimeout(
        () => setStage({ title: s.title, subtitle: s.subtitle, showNote: s.showNote }),
        s.afterMs
      );
      timersRef.current.push(id);
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [isLoading]);

  return stage;
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchLoadingPanel component
// ─────────────────────────────────────────────────────────────────────────────
function SearchLoadingPanel({
  stage,
  onRetry,
  searchError,
}: {
  stage: SearchStage | null;
  onRetry: () => void;
  searchError: string | null;
}) {
  const prefersReduced =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  if (searchError) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 shadow-sm px-5 py-4 text-left"
        style={{ backdropFilter: "blur(4px)" }}
      >
        <p className="text-sm font-semibold text-zinc-800">Unable to reach the analysis server</p>
        <p className="text-xs text-zinc-500 mt-0.5 mb-3">Please try again in a few moments.</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
        >
          Retry search
        </button>
      </div>
    );
  }

  if (!stage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${stage.title}: ${stage.subtitle}`}
      className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 shadow-sm px-5 py-4 text-left animate-search-panel"
      style={{ backdropFilter: "blur(4px)" }}
    >
      <div className="flex items-start gap-3">
        {/* Spinner */}
        <div className="flex-shrink-0 mt-0.5" aria-hidden="true">
          <svg
            className={`h-4 w-4 text-blue-700 ${prefersReduced ? "" : "animate-spin"}`}
            viewBox="0 0 24 24"
            fill="none"
          >
            <title>Loading</title>
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path
              className="opacity-90"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-800 leading-snug">{stage.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{stage.subtitle}</p>
        </div>
      </div>

      {/* Indeterminate progress bar */}
      <div
        className="mt-3 h-0.5 w-full rounded-full bg-blue-100 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Loading in progress"
      >
        <div
          className={`h-full bg-blue-400 rounded-full ${prefersReduced ? "w-1/2" : "animate-search-progress"}`}
        />
      </div>

      {/* Informational note after 8 s */}
      {stage.showNote && (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-400 border-t border-blue-100 pt-2.5">
          <span className="font-medium text-zinc-500">Why is this taking longer?</span>{" "}
          Provera uses a free analysis server that may pause when inactive. It is waking up now,
          and future requests should load faster.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isStickyHeader, setIsStickyHeader] = useState(false);

  const searchStage = useSearchStage(isLoading);

  // Typewriter placeholder animation state
  const [placeholder, setPlaceholder] = useState("Search companies...");
  
  // Interactive slideshow tab state
  const [activeTab, setActiveTab] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const isHoveredRef = useRef(isHovered);

  useEffect(() => {
    isHoveredRef.current = isHovered;
  }, [isHovered]);

  // FAQ Accordion State
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Typewriter Loop
  useEffect(() => {
    const list = [
      "Apple (AAPL)...",
      "NVIDIA (NVDA)...",
      "Microsoft (MSFT)...",
      "Costco (COST)...",
      "Berkshire Hathaway (BRK.B)..."
    ];
    let wordIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let typingTimer: NodeJS.Timeout;

    const tick = () => {
      const currentWord = list[wordIdx];
      if (!deleting) {
        setPlaceholder("Search " + currentWord.substring(0, charIdx + 1));
        charIdx++;
        if (charIdx === currentWord.length) {
          deleting = true;
          typingTimer = setTimeout(tick, 2000); // Pause on typed word
        } else {
          typingTimer = setTimeout(tick, 80); // Typing speed
        }
      } else {
        setPlaceholder("Search " + currentWord.substring(0, charIdx - 1));
        charIdx--;
        if (charIdx === 0) {
          deleting = false;
          wordIdx = (wordIdx + 1) % list.length;
          typingTimer = setTimeout(tick, 500); // Pause before next word
        } else {
          typingTimer = setTimeout(tick, 40); // Deleting speed
        }
      }
    };

    typingTimer = setTimeout(tick, 500);
    return () => clearTimeout(typingTimer);
  }, []);

  // Monitor header sticky state on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsStickyHeader(true);
      } else {
        setIsStickyHeader(false);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Looping slideshow rotator logic (4 seconds per tab - pauses on hover)
  useEffect(() => {
    const intervalTime = 40; // 40ms interval
    const totalDuration = 4000; // 4s total duration
    const steps = totalDuration / intervalTime;
    let currentStep = 0;

    const timer = setInterval(() => {
      if (isHoveredRef.current) return; // Pause on hover
      currentStep++;
      const currentPercent = (currentStep / steps) * 100;
      setProgress(currentPercent);

      if (currentStep >= steps) {
        setActiveTab((prev) => (prev + 1) % 5);
        setProgress(0);
        currentStep = 0;
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, [activeTab]);

  // Clear search on mount or route transition back to "/"
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery("");
      setResults([]);
      setIsDropdownOpen(false);
      setIsLoading(false);
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      const t = setTimeout(() => {
        setResults([]);
        setError(null);
        setSearchError(null);
        setIsLoading(false);
        setIsDropdownOpen(false);
      }, 0);
      return () => clearTimeout(t);
    }

    let active = true;
    const controller = new AbortController();

    // Trigger loading state immediately (deferred to prevent React lint warning)
    const tLoader = setTimeout(() => {
      if (active) {
        setIsLoading(true);
        setError(null);
        setSearchError(null);
      }
    }, 0);

    const timer = setTimeout(async () => {
      if (!active) return;
      try {
        const searchResults = await searchCompanies(query, controller.signal);
        if (active) {
          setResults(searchResults.slice(0, 8));
          setSearchError(null);
        }
      } catch (err) {
        if (active && err instanceof Error && err.name !== "AbortError") {
          setSearchError(err.message || "Failed to retrieve search results.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(tLoader);
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll focused option into view during keyboard navigation
  useEffect(() => {
    if (focusedIndex >= 0) {
      const activeEl = document.getElementById(`search-option-${focusedIndex}`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    if (!isDropdownOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIsDropdownOpen(true);
        setFocusedIndex(e.key === "ArrowDown" ? 0 : results.length - 1);
        return;
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      if (focusedIndex >= 0 && focusedIndex < results.length) {
        e.preventDefault();
        setIsDropdownOpen(false);
        const targetCik = results[focusedIndex].cik;
        setQuery("");
        setResults([]);
        router.push(`/company/${targetCik}`);
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
    }
  };

  // Focus the company search input is pre-defined but not used directly
  // const focusSearch = () => {
  //   searchInputRef.current?.focus();
  //   searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  // };

  // Focus the report editor — primary "Start an Audit" action
  const focusEditor = () => {
    const el = editorRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.focus(), 300);
    }
  };

  const jumpToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const TABS = [
    { label: "Financial Dashboard", icon: BarChart3Icon },
    { label: "Claim Verification", icon: ShieldCheck },
    { label: "Company Overview", icon: Database },
    { label: "Peer Comparison", icon: Users },
    { label: "Research Report", icon: FileText }
  ];

  function BarChart3Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    );
  }

  const FAQS = [
    {
      q: "What does Provera verify?",
      a: "Provera extracts individual measurable financial claims from pasted text—revenue figures, growth rates, margins, ratios, comparisons, and calculations—and evaluates each one separately against official SEC EDGAR data."
    },
    {
      q: "What sources does Provera use?",
      a: "Provera relies exclusively on verified public disclosures fetched directly in real-time from the official U.S. Securities and Exchange Commission (SEC) EDGAR archive, including structured XBRL data and filing documents. We do not synthesize, guess, or use unverified third-party databases."
    },
    {
      q: "Can Provera verify opinions or forecasts?",
      a: "No. Provera is designed to verify factual, measurable financial claims that can be checked against historical SEC disclosures. Opinions, forward-looking statements, projections, and analyst estimates are flagged as such rather than evaluated as true or false."
    },
    {
      q: "What happens when evidence is insufficient?",
      a: "If compatible facts or values are missing from primary disclosures, Provera will return a verdict of insufficient evidence, requires human review, opinion, or forward-looking instead of forcing a claim into a binary true or false. The reason is always explained."
    },
    {
      q: "Does Provera provide investment advice?",
      a: "No. Provera does not provide buy, sell, or hold recommendations, price targets, or financial advice. All classifications are strictly descriptive ratings based on verified SEC disclosures."
    },
    {
      q: "How are calculations checked?",
      a: "We run deterministic accounting and solvency validation rules directly against raw XBRL facts extracted from the filings. Margins, growth rates, ratios, and comparisons are recalculated using explicit formulas. Every check clearly flags variance thresholds, equation parameters, and provides source links."
    },
    {
      q: "Can I upload PDF or DOCX files?",
      a: "TXT upload and pasted text are currently supported. PDF and DOCX parsing are planned but not yet available. You can copy text from any document and paste it directly into the editor."
    }
  ];

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900 scroll-smooth">

      {/* ── Header ── */}
      <header
        className={`sticky top-0 z-50 transition-all duration-200 border-b animate-entrance ${
          isStickyHeader
            ? "bg-white/95 backdrop-blur-md border-zinc-200/80 shadow-sm"
            : "bg-white border-zinc-200"
        }`}
        style={{ animationDelay: "0ms" }}
      >
        <div className="mx-auto max-w-7xl px-6 py-3.5 flex items-center justify-between">
          <Link
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
              setQuery("");
              setResults([]);
              setIsDropdownOpen(false);
              router.push("/");
            }}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 rounded-lg"
          >
            <Logo />
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-500">
            <button onClick={() => jumpToSection("product-preview")} className="nav-link hover:text-zinc-900 cursor-pointer font-medium">Product</button>
            <button onClick={() => jumpToSection("how-it-works")} className="nav-link hover:text-zinc-900 cursor-pointer font-medium">How It Works</button>
            <button onClick={() => jumpToSection("use-cases")} className="nav-link hover:text-zinc-900 cursor-pointer font-medium">Use Cases</button>
            <button onClick={() => jumpToSection("methodology")} className="nav-link hover:text-zinc-900 cursor-pointer font-medium">Methodology</button>
            <button onClick={() => jumpToSection("faq")} className="nav-link hover:text-zinc-900 cursor-pointer font-medium">FAQ</button>
          </nav>
          <button
            id="header-cta"
            onClick={focusEditor}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white border border-blue-700 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] font-bold rounded-xl text-xs transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Start an Audit
          </button>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="relative bg-white border-b border-zinc-200 pt-16 pb-12 overflow-hidden">
        {/* Subtle floating keywords behind the hero contents */}
        <div className="absolute inset-0 select-none pointer-events-none hidden lg:block" aria-hidden="true">
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-1" style={{ left: "10%", top: "18%" }}>10-K</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-2" style={{ right: "8%", top: "14%" }}>Revenue</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-3" style={{ left: "12%", bottom: "24%" }}>10-Q</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-4" style={{ right: "12%", bottom: "28%" }}>Gross Margin</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-1" style={{ left: "5%", top: "45%" }}>Cash Flow</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-2" style={{ right: "5%", top: "48%" }}>Assets</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-3" style={{ left: "15%", top: "8%" }}>EDGAR</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-4" style={{ right: "18%", bottom: "8%" }}>XBRL</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-1" style={{ left: "8%", bottom: "8%" }}>ROE</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-2" style={{ right: "10%", top: "30%" }}>EPS</div>
          <div className="absolute font-mono text-[10px] font-bold text-zinc-500/20 animate-float-keyword-3" style={{ left: "20%", bottom: "45%" }}>Liabilities</div>
        </div>

        <div className="relative mx-auto max-w-6xl px-6 text-center space-y-6 z-10">
          {/* New hero headline */}
          <h1
            className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-950 font-serif leading-tight animate-entrance"
            style={{ animationDelay: "80ms" }}
          >
            Verify financial research against official SEC evidence before you publish it.
          </h1>
          <p
            className="max-w-2xl mx-auto text-zinc-500 text-sm md:text-base leading-relaxed font-normal animate-entrance"
            style={{ animationDelay: "160ms" }}
          >
            Paste an investment memo, research report, earnings summary, or analyst note. Provera verifies each measurable financial claim against primary-source SEC EDGAR disclosures.
          </p>

          {/* Report Editor */}
          <div
            className="max-w-3xl w-full mx-auto pt-2 pb-2 z-30 animate-entrance text-left space-y-4"
            style={{ animationDelay: "240ms" }}
          >
            <VerificationInput
              ref={editorRef}
              onVerify={(text) => router.push(`/verify?text=${encodeURIComponent(text)}`)}
              isLoading={false}
            />

            {/* Workflow Bar — 3 truthful steps (no Export) */}
            <div className="flex flex-wrap items-center justify-between gap-4 text-[10px] font-bold text-zinc-400 bg-zinc-50 border border-zinc-200 px-4 py-3.5 rounded-xl select-none shadow-3xs">
              <button
                type="button"
                id="workflow-step-1"
                onClick={() => editorRef.current?.focus()}
                className="flex items-center gap-1.5 text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg hover:bg-blue-100/50 transition-all cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                <span>1. Paste Report</span>
              </button>

              <span className="text-zinc-300 select-none">→</span>

              <button
                type="button"
                id="workflow-step-2"
                onClick={() => {
                  if (editorRef.current?.value.trim()) {
                    router.push(`/verify?text=${encodeURIComponent(editorRef.current.value)}`);
                  } else {
                    editorRef.current?.focus();
                  }
                }}
                className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 transition-all cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                <span>2. Audit Claims</span>
              </button>

              <span className="text-zinc-300 select-none">→</span>

              <div
                id="workflow-step-3"
                className="flex items-center gap-1.5 text-zinc-400 cursor-not-allowed"
                title="Review Evidence is available after starting an audit."
                aria-disabled="true"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />
                <span>3. Review Evidence</span>
              </div>
            </div>

            <div className="flex justify-center items-center gap-4 pt-1.5">
              <button
                onClick={() => jumpToSection("explore-companies")}
                className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800 transition-colors cursor-pointer"
              >
                <span>Or explore company SEC filings</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Trust Indicators */}
          <div
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-zinc-500 text-xs py-2 max-w-3xl mx-auto border-b border-zinc-100 pb-6 animate-entrance z-10"
            style={{ animationDelay: "320ms" }}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              Primary-source SEC EDGAR data
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Claim-by-claim evidence audit
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              Source-linked explanations
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <FileText className="w-3.5 h-3.5 text-emerald-600" />
              Deterministic XBRL calculations
            </span>
          </div>

          {/* Secondary CTA */}
          <div
            className="flex items-center justify-center pt-2 animate-entrance z-10"
            style={{ animationDelay: "400ms" }}
          >
            <button
              onClick={() => jumpToSection("how-it-works")}
              className="px-6 py-3 border border-zinc-300 bg-white hover:bg-zinc-50 hover:border-zinc-400 text-zinc-700 font-bold rounded-xl text-sm hover:-translate-y-0.5 active:translate-y-px active:scale-[0.99] transition-all duration-150 cursor-pointer shadow-3xs"
            >
              See How It Works
            </button>
          </div>

          {/* macOS Looping Animated Product Preview */}
          <div
            id="product-preview"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="relative mx-auto max-w-5xl rounded-[24px] border border-zinc-200/90 bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1),0_10px_30px_-10px_rgba(0,0,0,0.05)] overflow-hidden mt-8 text-left animate-entrance animate-float"
            style={{ animationDelay: "480ms" }}
          >
            {/* macOS Window Title bar */}
            <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-400 block" />
                <span className="w-3 h-3 rounded-full bg-amber-400 block" />
                <span className="w-3 h-3 rounded-full bg-emerald-400 block" />
                <span className="text-[11px] text-zinc-400 font-mono ml-4 select-none">Provera — SEC Filing Intelligence</span>
              </div>
              <div className="h-2 w-32 bg-zinc-200 rounded" />
            </div>

            {/* Loop Selectors (Tabs) */}
            <div className="bg-zinc-50/50 border-b border-zinc-200 px-4 py-1.5 flex items-center gap-1 overflow-x-auto select-none">
              {TABS.map((tab, idx) => {
                const Icon = tab.icon;
                const isActive = activeTab === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveTab(idx)}
                    className={`relative px-3 py-2 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
                      isActive ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-blue-800" : "text-zinc-400"}`} />
                    <span>{tab.label}</span>
                    {isActive && (
                      <div className="absolute bottom-0 left-0 h-0.5 bg-blue-800 transition-all rounded-full" style={{ width: `${progress}%` }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Showcase Dashboard Rotating Area */}
            <div className="p-6 bg-zinc-50/20 min-h-[300px] flex flex-col justify-between">

              {/* Tab 0: Financial Dashboard */}
              {activeTab === 0 && (
                <div className="space-y-4 animate-fade-in-slide-up">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Financial Dashboard</h4>
                      <p className="text-[10px] text-zinc-400">Deterministic key performance indicators derived from SEC XBRL facts.</p>
                    </div>
                    <span className="text-xs font-bold font-mono text-zinc-400">Apple Inc. (AAPL)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border border-zinc-200 bg-white rounded-xl p-4.5 space-y-1.5 shadow-xs">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Revenue</span>
                      <span className="text-2xl font-bold font-mono text-zinc-950 block">
                        <CountUpValue value={94.93} prefix="$" suffix="B" />
                      </span>
                      <span className="text-[10px] text-zinc-500 font-sans font-semibold">▲ +8.50% vs prior period</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-4.5 space-y-1.5 shadow-xs">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Gross Margin</span>
                      <span className="text-2xl font-bold font-mono text-zinc-950 block">
                        <CountUpValue value={46.20} suffix="%" />
                      </span>
                      <span className="text-[10px] text-zinc-500 font-sans font-semibold">▲ +3.30% vs prior period</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-4.5 space-y-1.5 shadow-xs">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Net Income</span>
                      <span className="text-2xl font-bold font-mono text-zinc-950 block">
                        <CountUpValue value={23.64} prefix="$" suffix="B" />
                      </span>
                      <span className="text-[10px] text-zinc-500 font-sans font-semibold">▲ +4.20% vs prior period</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 1: Claim Verification */}
              {activeTab === 1 && (
                <div className="space-y-4 animate-fade-in-slide-up text-xs text-left">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Claim Verification Engine</h4>
                      <p className="text-[10px] text-zinc-400 font-medium">Extract individual financial claims and verify against SEC database facts.</p>
                    </div>
                    <span className="text-xs font-bold font-mono text-zinc-400">NVIDIA Corp. (NVDA)</span>
                  </div>

                  <div className="border border-zinc-200 rounded-2xl bg-white p-4 space-y-4 shadow-3xs">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Audited Text</span>
                        <blockquote className="text-[11px] text-zinc-700 italic border-l-2 border-zinc-300 pl-3 leading-relaxed">
                          &ldquo;NVIDIA&apos;s gross margin expanded to 75.1% in Q4 FY24, driving significant operating leverage.&rdquo;
                        </blockquote>
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold rounded-lg uppercase tracking-wider flex-shrink-0 animate-pulse">
                        Verified
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-100 text-[11px]">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">SEC EDGAR Evidence</span>
                        <div className="flex items-center gap-1.5 font-semibold text-zinc-800">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                          <span>Gross Margin: 75.15% (Q4 FY2024)</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Accession Number</span>
                        <span className="font-mono text-zinc-500">0001045810-24-000022 (Form 10-K)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Company Overview */}
              {activeTab === 2 && (
                <div className="space-y-4 animate-fade-in-slide-up text-xs text-left">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Company Overview Disclosures</h4>
                      <p className="text-[10px] text-zinc-400 font-medium">View official registered database metadata and filing logs.</p>
                    </div>
                    <span className="text-xs font-bold font-mono text-zinc-400">Microsoft Corp. (MSFT)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-1 shadow-3xs">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">CIK Number</span>
                      <span className="text-sm font-bold font-mono text-zinc-900">0000789019</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-1 shadow-3xs">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Fiscal Year End</span>
                      <span className="text-sm font-bold text-zinc-900">June 30</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-1 shadow-3xs">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">SEC Profile</span>
                      <span className="text-xs font-semibold text-zinc-500 flex items-center gap-0.5 select-none">
                        SEC Link <ExternalLink className="w-3 h-3 text-zinc-400" />
                      </span>
                    </div>
                  </div>

                  <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-2 shadow-3xs">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Recent SEC Submissions</span>
                    <div className="space-y-1.5 font-semibold text-zinc-700">
                      <div className="flex items-center justify-between">
                        <span>Form 10-K (Annual Report)</span>
                        <span className="font-mono text-[10px] text-zinc-400">Filed 2025-07-28</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Form 10-Q (Quarterly Report)</span>
                        <span className="font-mono text-[10px] text-zinc-400">Filed 2026-01-25</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Peer Comparison */}
              {activeTab === 3 && (
                <div className="space-y-4 animate-fade-in-slide-up text-xs text-left">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Peer Comparison Benchmarking</h4>
                      <p className="text-[10px] text-zinc-400 font-medium">Benchmark core performance indicators directly with industry peers.</p>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden text-[11px] shadow-3xs">
                    <div className="grid grid-cols-4 gap-2 bg-zinc-50 border-b border-zinc-200 p-2.5 font-bold text-zinc-400 uppercase tracking-wider text-[9px]">
                      <span>Metric</span>
                      <span className="text-right">Apple (AAPL)</span>
                      <span className="text-right">Microsoft (MSFT)</span>
                      <span className="text-right">NVIDIA (NVDA)</span>
                    </div>
                    <div className="divide-y divide-zinc-100 font-medium">
                      <div className="grid grid-cols-4 gap-2 p-2.5">
                        <span className="text-zinc-800">Gross Margin</span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={46.20} suffix="%" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={70.10} suffix="%" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={75.15} suffix="%" />
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 p-2.5">
                        <span className="text-zinc-800">Return on Assets (ROA)</span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={28.45} suffix="%" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={19.20} suffix="%" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={54.30} suffix="%" />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Research Report */}
              {activeTab === 4 && (
                <div className="space-y-4 animate-fade-in-slide-up text-xs text-left">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Generate Research Report</h4>
                      <p className="text-[10px] text-zinc-400 font-medium">Generate structured institution-grade reports with clean validation indices.</p>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl bg-white p-4 space-y-3 shadow-3xs">
                    <div className="flex justify-between items-center text-[10px] font-bold text-zinc-400 uppercase pb-1 border-b border-zinc-100">
                      <span>Report Section</span>
                      <span>Verification Status</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="font-semibold text-zinc-800">1. Executive Summary Overview</span>
                      <span className="text-emerald-700 font-bold">✓ Verified Facts</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="font-semibold text-zinc-800">2. Financial Strength Audits</span>
                      <span className="text-emerald-700 font-bold">✓ Math Checks Passed</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="font-semibold text-zinc-800">3. Filing Revisions Summary</span>
                      <span className="text-emerald-700 font-bold">✓ Footnote Checked</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between text-[10px] text-zinc-400 font-medium">
                <span>Calculations derived using deterministic check rules.</span>
                <span>Source EDGAR archives.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works (moved up — before Features) ── */}
      <section id="how-it-works" className="py-24 border-b border-zinc-200 bg-zinc-50/50">
        <div className="mx-auto max-w-4xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Workflow</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              Three steps to verified research.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <ScrollReveal delay={0}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">01 / Submit</span>
                <h3 className="text-sm font-bold text-zinc-950">Paste a report</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Add an investment memo, research note, earnings summary, or AI-generated financial analysis.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={80}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">02 / Verify</span>
                <h3 className="text-sm font-bold text-zinc-950">Audit every claim</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Provera identifies companies, reporting periods, metrics, comparisons, and calculations.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={160}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">03 / Review</span>
                <h3 className="text-sm font-bold text-zinc-950">Inspect evidence</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Review supported, contradicted, outdated, partially supported, and unsupported claims with direct SEC sources.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Core Product Features ── */}
      <section className="py-24 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Product Features</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              An institutional toolkit for verification.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Card 1 — primary */}
            <ScrollReveal delay={0}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Claim-by-Claim Verification</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Breaks financial research into individual measurable claims and evaluates each one separately.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 2 — primary */}
            <ScrollReveal delay={80}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Official SEC Evidence</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Matches claims to structured SEC facts, reporting periods, accession numbers, and source filings.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 3 — primary */}
            <ScrollReveal delay={160}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Deterministic Calculations</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Recalculates growth rates, margins, ratios, and comparisons using explicit formulas rather than model guesses.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 4 — secondary */}
            <ScrollReveal delay={240}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <GitCompare className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Filing Comparison</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Tracks changes across filing versions and historical disclosures.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 5 — secondary */}
            <ScrollReveal delay={320}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Company Analysis</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Provides financial dashboards, SEC facts, and peer comparisons for any public company.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 6 — secondary */}
            <ScrollReveal delay={400}>
              <div className="border border-zinc-200 hover:border-zinc-300 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Research Workflows</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Supports investment memos, equity research, earnings summaries, and AI-generated financial content.
                  </p>
                </div>
              </div>
            </ScrollReveal>

          </div>
        </div>
      </section>

      {/* ── Target Audience / Use Cases ── */}
      <section id="use-cases" className="py-24 border-b border-zinc-200 bg-zinc-50/50">
        <div className="mx-auto max-w-7xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Target Audience</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              Designed for research that needs to be right.
            </h2>
            <p className="max-w-xl mx-auto text-zinc-500 text-xs">
              Built for teams where financial accuracy is a professional requirement, not a preference.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

            <ScrollReveal delay={0}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wider">Financial AI Companies</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Verify AI-generated financial output before it reaches users.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={80}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wider">Equity Research Teams</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Audit research notes, investment theses, and earnings summaries before publication.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={160}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wider">Boutique Investment Firms</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Reduce manual checking across public-company research.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={240}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wider">Financial Publishers</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Catch outdated, unsupported, or incorrect claims before publication.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={320}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-950 uppercase tracking-wider">Independent Analysts</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Trace each important claim back to official evidence.
                </p>
              </div>
            </ScrollReveal>

          </div>
        </div>
      </section>

      {/* ── Company Explorer (secondary workflow — moved below Use Cases) ── */}
      <section id="explore-companies" className="py-24 bg-gradient-to-b from-white to-zinc-50/40 border-b border-zinc-200">
        <div className="mx-auto max-w-4xl px-6 space-y-8 text-center">
          <div className="space-y-2">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Company Database Lookup</span>
            <h2 className="text-2xl font-normal tracking-tight text-zinc-950 font-serif">
              Explore Verified SEC Filing Summaries
            </h2>
            <p className="max-w-xl mx-auto text-xs text-zinc-500 font-medium">
              Search by ticker or company name to view dashboard summaries, peer benchmarking, chat with documents, or compare filing revisions.
            </p>
          </div>

          <div
            ref={containerRef}
            className="relative max-w-2xl w-full mx-auto z-30 text-left"
          >
            <div className="relative rounded-xl border border-zinc-300 bg-white p-2 focus-within:border-blue-700 focus-within:ring-2 focus-within:ring-blue-100 transition-all shadow-md animate-fade-in">
              <label htmlFor="company-search" className="sr-only">
                Search public companies by ticker or name
              </label>
              <div className="flex items-center">
                <Search className="w-5 h-5 text-zinc-400 ml-3 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  id="company-search"
                  type="text"
                  role="combobox"
                  className="w-full bg-transparent px-3 py-2.5 text-zinc-950 placeholder:text-zinc-400 focus:outline-none text-base font-sans"
                  placeholder={placeholder}
                  value={query}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuery(val);
                    setFocusedIndex(-1);
                    if (val.trim()) {
                      setIsLoading(true);
                      setError(null);
                      setIsDropdownOpen(true);
                    } else {
                      setResults([]);
                      setIsLoading(false);
                      setError(null);
                      setIsDropdownOpen(false);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    if (query.trim()) setIsDropdownOpen(true);
                  }}
                  aria-autocomplete="list"
                  aria-controls="search-results-list"
                  aria-expanded={!!(isDropdownOpen && (results.length > 0 || error || (!isLoading && query.trim() !== "")))}
                  aria-activedescendant={focusedIndex >= 0 ? `search-option-${focusedIndex}` : undefined}
                  autoComplete="off"
                  spellCheck="false"
                />
                {isLoading && !searchStage && (
                  <div className="absolute right-6 top-1/2 -translate-y-1/2" aria-hidden="true">
                    <svg className="animate-spin h-5 w-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Polished search loading / error panel */}
            {(searchStage || searchError) && (
              <SearchLoadingPanel
                stage={searchStage}
                searchError={searchError}
                onRetry={() => {
                  setSearchError(null);
                  setIsLoading(true);
                  const controller = new AbortController();
                  searchCompanies(query, controller.signal)
                    .then((r) => { setResults(r.slice(0, 8)); setSearchError(null); })
                    .catch((err) => {
                      if (err instanceof Error && err.name !== "AbortError") {
                        setSearchError(err.message || "Failed to retrieve search results.");
                      }
                    })
                    .finally(() => setIsLoading(false));
                }}
              />
            )}

            {/* Autocomplete Dropdown */}
            {isDropdownOpen && !isLoading && (results.length > 0 || error || (!isLoading && query.trim() !== "")) && (
              <ul
                id="search-results-list"
                className="absolute z-50 left-0 right-0 mt-2 w-full rounded-xl border border-zinc-200 bg-white shadow-xl divide-y divide-zinc-100 overflow-hidden text-left animate-autocomplete-dropdown max-h-64 overflow-y-auto"
                role="listbox"
              >
                {error ? (
                  <li className="px-4 py-3.5 text-xs text-red-600 bg-red-50">
                    {error}
                  </li>
                ) : results.length === 0 ? (
                  <li className="px-4 py-6 text-center text-xs text-zinc-500 font-medium bg-zinc-50/50">
                    No companies found matching &ldquo;{query}&rdquo;
                  </li>
                ) : (
                  results.map((comp, idx) => (
                    <li
                      key={comp.cik}
                      role="option"
                      id={`search-option-${idx}`}
                      aria-selected={focusedIndex === idx}
                      className={`focus:outline-none transition-colors duration-150 ${
                        focusedIndex === idx ? "bg-zinc-100/80" : "hover:bg-zinc-50"
                      }`}
                    >
                      <Link
                        href={`/company/${comp.cik}`}
                        className="block px-4 py-3.5 flex items-center justify-between gap-4 text-sm"
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setQuery("");
                          setResults([]);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono font-bold text-xs bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-md flex-shrink-0">
                            {comp.ticker}
                          </span>
                          <span className="font-semibold text-zinc-950 truncate">
                            {comp.name}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-400 font-mono flex-shrink-0">
                          CIK {formatCIK(comp.cik)}
                        </span>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Methodology ── */}
      <section id="methodology" className="py-24 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Our Methodology</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              Built for accuracy, not approximation.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ScrollReveal delay={0}>
              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-xs h-full space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <h3 className="font-bold text-sm text-zinc-950 font-sans">Official SEC Evidence</h3>
                </div>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Facts are sourced directly from SEC EDGAR filings and structured XBRL data. Every verified claim links back to the original disclosure.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={80}>
              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-xs h-full space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <h3 className="font-bold text-sm text-zinc-950 font-sans">Deterministic Calculations</h3>
                </div>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Margins, growth rates, ratios, and comparisons are calculated using explicit formulas. AI is only used for explanation and synthesis—not arithmetic.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={160}>
              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-xs h-full space-y-3">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-blue-700 flex-shrink-0" />
                  <h3 className="font-bold text-sm text-zinc-950 font-sans">Careful Uncertainty Handling</h3>
                </div>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Unsupported, opinion-based, or forward-looking statements are labeled appropriately instead of being forced into true or false conclusions.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── FAQ (updated questions) ── */}
      <section id="faq" className="py-24 border-b border-zinc-200 bg-zinc-50/50">
        <div className="mx-auto max-w-3xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Frequently Asked Questions</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              Common questions answered.
            </h2>
          </div>

          <ScrollReveal>
            <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-xs divide-y divide-zinc-200">
              {FAQS.map((faq, idx) => {
                const isExpanded = expandedFaq === idx;
                return (
                  <div key={idx} className="bg-white">
                    <button
                      type="button"
                      onClick={() => setExpandedFaq(isExpanded ? null : idx)}
                      className="w-full flex items-center justify-between p-5 text-left hover:bg-zinc-50/50 focus:outline-none transition-colors"
                    >
                      <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-2">
                        <HelpCircle className="w-4 h-4 text-zinc-400" />
                        {faq.q}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                          isExpanded ? "transform rotate-180" : ""
                        }`}
                      />
                    </button>
                    {isExpanded && (
                      <div className="p-5 bg-zinc-50/20 border-t border-zinc-100 text-xs text-zinc-600 font-normal leading-relaxed animate-fadeIn">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Final CTA (updated copy + dual buttons) ── */}
      <section className="py-24 bg-white border-t border-zinc-200 text-center">
        <ScrollReveal>
          <div className="mx-auto max-w-3xl px-6 py-12 bg-zinc-50 border border-zinc-200 rounded-2xl shadow-xs space-y-6">
            <h2 className="text-3xl md:text-4xl font-normal font-serif tracking-tight text-zinc-950 leading-tight">
              Verify financial research before it reaches your customers.
            </h2>
            <p className="max-w-md mx-auto text-zinc-500 text-xs leading-relaxed font-normal">
              Catch unsupported, outdated, and incorrect financial claims using official SEC evidence and deterministic calculations.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                id="final-cta-start-audit"
                onClick={focusEditor}
                className="group px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white border border-blue-700 shadow-sm hover:shadow-md active:translate-y-px active:scale-[0.99] font-bold rounded-xl text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer inline-flex items-center gap-2"
              >
                <span>Start an Audit</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
              </button>
              <button
                id="final-cta-explore-company"
                onClick={() => jumpToSection("explore-companies")}
                className="px-6 py-3 border border-zinc-300 bg-white hover:bg-zinc-50 hover:border-zinc-400 text-zinc-700 font-bold rounded-xl text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 cursor-pointer"
              >
                Explore a Company
              </button>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ── Footer (updated links) ── */}
      <footer className="border-t border-zinc-200 bg-white py-14">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="space-y-3">
            <Logo />
            <p className="text-[10px] text-zinc-400 font-normal">Evidence-backed financial claim verification.</p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-6 text-xs font-semibold text-zinc-500">
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Product</span>
              <button onClick={focusEditor} className="hover:text-zinc-900 transition-colors block text-left cursor-pointer font-semibold">Start Audit</button>
              <button onClick={() => jumpToSection("explore-companies")} className="hover:text-zinc-950 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">Company Explorer</button>
              <button onClick={() => jumpToSection("product-preview")} className="hover:text-zinc-950 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">Product Preview</button>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Methodology</span>
              <button onClick={() => jumpToSection("how-it-works")} className="hover:text-zinc-900 transition-colors block text-left cursor-pointer font-semibold">How It Works</button>
              <button onClick={() => jumpToSection("methodology")} className="hover:text-zinc-950 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">Verification Method</button>
              <button onClick={() => jumpToSection("faq")} className="hover:text-zinc-950 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">FAQs</button>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Legal</span>
              <span className="text-zinc-400 font-normal block">Privacy Policy</span>
              <span className="text-zinc-400 font-normal block mt-1.5">Terms</span>
              <span className="text-zinc-400 font-normal block mt-1.5">Contact Support</span>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 border-t border-zinc-200 mt-10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] text-zinc-400 font-normal">
          <span>&copy; {new Date().getFullYear()} Provera. All rights reserved.</span>
          <span>Source data: U.S. SEC EDGAR.</span>
        </div>
      </footer>
    </div>
  );
}
