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
  ExternalLink,
  MessageSquare,
  FileSpreadsheet
} from "lucide-react";

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
    title: "Connecting to FilingLens",
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
          FilingLens uses a free analysis server that may pause when inactive. It is waking up now,
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
        setActiveTab((prev) => (prev + 1) % 6);
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

  const focusSearch = () => {
    searchInputRef.current?.focus();
    searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const jumpToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const TABS = [
    { label: "Financial Dashboard", icon: BarChart3Icon },
    { label: "AI Chat", icon: MessageSquare },
    { label: "Filing Comparison", icon: GitCompare },
    { label: "Peer Comparison", icon: Users },
    { label: "Research Report", icon: FileText },
    { label: "Investment Memo", icon: FileSpreadsheet }
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
      q: "What data does FilingLens use?",
      a: "FilingLens relies exclusively on verified public disclosures fetched directly in real-time from the official U.S. Securities and Exchange Commission (SEC) EDGAR archive. We do not synthesize, guess, or integrate unverified third-party databases."
    },
    {
      q: "Does FilingLens provide investment advice?",
      a: "No. FilingLens does not provide buy, sell, or hold recommendations, price targets, or financial advice. All classifications are strictly descriptive ratings based on verified SEC disclosures."
    },
    {
      q: "How are calculations verified?",
      a: "We run deterministic accounting and solvency validation rules directly against raw XBRL facts extracted from the filings. Every check clearly flags variance thresholds, equation parameters, and provides source links."
    },
    {
      q: "Can I compare filings?",
      a: "Yes. The Filing Diff compare tool allows selecting compatible historical disclosures (10-K with 10-K, 10-Q with 10-Q) to compare metric revisions and narrative section alterations side-by-side."
    },
    {
      q: "Can I export reports?",
      a: "Yes. Both the flagship Research Report and the Investment Memo are exportable as print-ready ReportLab PDF documents containing structural cover sheets, Table of Contents index sheets, and citation indices."
    },
    {
      q: "What happens when evidence is insufficient?",
      a: "If compatible facts or values are missing from primary disclosures, the system leaves calculations blank or tags them as 'N/M' (Not Meaningful), explaining the exact reason to the analyst instead of inventing placeholders."
    }
  ];

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 font-sans text-zinc-900 scroll-smooth">
      {/* Header bar */}
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
            onClick={focusSearch}
            className="px-4 py-2 bg-blue-800 hover:bg-blue-750 text-white font-semibold rounded-lg text-xs hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 cursor-pointer"
          >
            Analyze a Company
          </button>
        </div>
      </header>

      {/* Hero Section */}
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
          <h1 
            className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-950 font-serif leading-tight animate-entrance"
            style={{ animationDelay: "80ms" }}
          >
            Analyze SEC filings with verified financial intelligence.
          </h1>
          <p 
            className="max-w-2xl mx-auto text-zinc-500 text-sm md:text-base leading-relaxed font-normal animate-entrance"
            style={{ animationDelay: "160ms" }}
          >
            FilingLens audits public disclosures in real-time, combining deterministic financial checks with source-grounded AI responses to generate institutional-quality reports.
          </p>

          {/* Search bar inside hero */}
          <div 
            ref={containerRef} 
            className="relative max-w-2xl w-full mx-auto pt-2 pb-2 z-30 animate-entrance"
            style={{ animationDelay: "240ms" }}
          >
            <div className="relative rounded-xl border border-zinc-300 bg-zinc-50/30 p-2 focus-within:border-blue-700 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 transition-all shadow-md">
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
                  className="w-full bg-transparent px-3 py-2.5 text-zinc-955 placeholder:text-zinc-400 focus:outline-none text-base font-sans"
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
                {/* In-box spinner shown only during very brief loads (before stage panel kicks in) */}
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

            {/* Polished search loading / error panel — shown below the search field */}
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

            {/* AutocompleteDropdown overlay */}
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
                          <span className="font-semibold text-zinc-955 truncate">
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

          {/* Trust Row */}
          <div 
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-zinc-500 text-xs py-2 max-w-3xl mx-auto border-b border-zinc-100 pb-6 animate-entrance z-10"
            style={{ animationDelay: "320ms" }}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              Built on official U.S. SEC EDGAR filings
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Verified financial calculations
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              Source-grounded AI responses
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <FileText className="w-3.5 h-3.5 text-emerald-600" />
              Institutional-quality reports
            </span>
          </div>

          {/* CTAs */}
          <div 
            className="flex flex-wrap items-center justify-center gap-3 pt-2 animate-entrance z-10"
            style={{ animationDelay: "400ms" }}
          >
            <button
              onClick={focusSearch}
              className="px-6 py-3 bg-blue-800 hover:bg-blue-750 text-white font-semibold rounded-lg text-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 cursor-pointer shadow-sm"
            >
              Analyze a Company
            </button>
            <button
              onClick={() => jumpToSection("how-it-works")}
              className="px-6 py-3 border border-zinc-250 bg-white hover:bg-zinc-55 hover:border-zinc-300 text-zinc-700 font-semibold rounded-lg text-sm hover:-translate-y-0.5 hover:shadow-xs active:translate-y-0 transition-all duration-200 cursor-pointer"
            >
              See How It Works
            </button>
          </div>

          {/* macOS Looping Animated Product Demo (The centerpiece) */}
          <div 
            id="product-preview" 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="relative mx-auto max-w-5xl rounded-xl border border-zinc-200 bg-white shadow-2xl overflow-hidden mt-8 text-left animate-entrance animate-float"
            style={{ animationDelay: "480ms" }}
          >
            {/* macOS Window Title bar */}
            <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-400 block"></span>
                <span className="w-3 h-3 rounded-full bg-amber-400 block"></span>
                <span className="w-3 h-3 rounded-full bg-emerald-400 block"></span>
                <span className="text-[11px] text-zinc-400 font-mono ml-4 select-none">FilingLens Analyzer App</span>
              </div>
              <div className="h-2 w-32 bg-zinc-200 rounded"></div>
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
                      isActive ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100/50"
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
              
              {/* Tab 0: Dashboard */}
              {activeTab === 0 && (
                <div className="space-y-4 animate-fade-in-slide-up">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-955 font-sans">Financial Dashboard</h4>
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
                      <span className="text-[10px] text-zinc-550 font-sans font-semibold">▲ +8.50% vs prior period</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-4.5 space-y-1.5 shadow-xs">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Gross Margin</span>
                      <span className="text-2xl font-bold font-mono text-zinc-950 block">
                        <CountUpValue value={46.20} suffix="%" />
                      </span>
                      <span className="text-[10px] text-zinc-550 font-sans font-semibold">▲ +3.30% vs prior period</span>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-4.5 space-y-1.5 shadow-xs">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Net Income</span>
                      <span className="text-2xl font-bold font-mono text-zinc-950 block">
                        <CountUpValue value={23.64} prefix="$" suffix="B" />
                      </span>
                      <span className="text-[10px] text-zinc-550 font-sans font-semibold">▲ +4.20% vs prior period</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 1: AI Chat */}
              {activeTab === 1 && (
                <div className="space-y-4 animate-fade-in-slide-up">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-955 font-sans">Ask FilingLens</h4>
                      <p className="text-[10px] text-zinc-400">Trace AI-generated answers directly back to official SEC EDGAR page anchors.</p>
                    </div>
                    <span className="h-2 w-2 rounded-full bg-blue-800 animate-pulse"></span>
                  </div>

                  <div className="max-w-2xl mx-auto space-y-3">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-xs text-zinc-800 max-w-[85%] ml-auto text-right font-medium">
                      What explained the gross margin change in Q1?
                    </div>
                    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs text-zinc-900 max-w-[90%] leading-relaxed space-y-2">
                      <p>Gross margin increased from 42.9% to 46.2% due to operational leverage and premium product mix.</p>
                      <div className="flex items-center gap-2 pt-1 border-t border-zinc-100">
                        <span className="text-[9px] bg-blue-50 border border-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold font-mono">
                          [1] SEC Form 10-Q (page 24)
                        </span>
                        <a href="#" className="text-[9px] text-zinc-400 hover:text-zinc-600 flex items-center gap-0.5">
                          View source link <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Filing Comparison */}
              {activeTab === 2 && (
                <div className="space-y-4 animate-fade-in-slide-up">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Filing Diff Compare</h4>
                      <p className="text-[10px] text-zinc-400">Audit differences in metric points and narrative disclosures side-by-side.</p>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden text-xs">
                    <div className="grid grid-cols-5 gap-2 bg-zinc-50 border-b border-zinc-150 p-2.5 font-bold text-zinc-500 uppercase tracking-wider text-[9px]">
                      <span className="col-span-2">Concept / Metric</span>
                      <span className="text-right">Older Value</span>
                      <span className="text-right">Newer Value</span>
                      <span className="text-right">Variance</span>
                    </div>
                    <div className="divide-y divide-zinc-100 font-medium">
                      <div className="grid grid-cols-5 gap-2 p-2.5">
                        <span className="col-span-2 text-zinc-800">Revenue</span>
                        <span className="text-right font-mono text-zinc-550">
                          <CountUpValue value={117.15} prefix="$" suffix="B" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={119.58} prefix="$" suffix="B" />
                        </span>
                        <span className="text-right font-mono text-zinc-950 font-bold">
                          <CountUpValue value={2.07} prefix="▲ +" suffix="%" />
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2 p-2.5">
                        <span className="col-span-2 text-zinc-800">Cost of Goods Sold</span>
                        <span className="text-right font-mono text-zinc-550">
                          <CountUpValue value={66.89} prefix="$" suffix="B" />
                        </span>
                        <span className="text-right font-mono text-zinc-950">
                          <CountUpValue value={64.33} prefix="$" suffix="B" />
                        </span>
                        <span className="text-right font-mono text-zinc-950 font-bold text-red-600">
                          <CountUpValue value={-3.83} prefix="▼ " suffix="%" />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Peer Comparison */}
              {activeTab === 3 && (
                <div className="space-y-4 animate-fade-in-slide-up">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Peer Comparison Benchmarking</h4>
                      <p className="text-[10px] text-zinc-400">Benchmark core performance indicators directly with industry peers.</p>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden text-xs">
                    <div className="grid grid-cols-4 gap-2 bg-zinc-50 border-b border-zinc-150 p-2.5 font-bold text-zinc-500 uppercase tracking-wider text-[9px]">
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
                <div className="space-y-4 animate-fade-in-slide-up text-xs">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-950 font-sans">Generate Research Report</h4>
                      <p className="text-[10px] text-zinc-400">Generate structured institution-grade reports with clean validation indices.</p>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl bg-white p-4 space-y-3 shadow-xs">
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

              {/* Tab 5: Investment Memo */}
              {activeTab === 5 && (
                <div className="space-y-4 animate-fade-in-slide-up text-xs">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                    <div>
                      <h4 className="text-sm font-bold text-zinc-955 font-sans">Investment Memo Synthesis</h4>
                      <p className="text-[10px] text-zinc-400">Assemble core valuation matrices, solvency tests, and risk checks on demand.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-2">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Financial Strengths</span>
                      <p className="text-[11px] text-zinc-650 font-normal leading-relaxed">
                        CUpertino shows stable revenue expansion with high gross profit margins, backed by conservative solvency covenants.
                      </p>
                    </div>
                    <div className="border border-zinc-200 bg-white rounded-xl p-3.5 space-y-2">
                      <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider block">Identified Risks</span>
                      <p className="text-[11px] text-zinc-650 font-normal leading-relaxed">
                        Regulatory compliance exposures and competitive margins risks from hardware supplier concentrations.
                      </p>
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

      {/* Feature Section */}
      <section className="py-24 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Product Features</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              An institutional toolkit for filings.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Card 1 */}
            <ScrollReveal delay={0}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Deterministic verification</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Confirms balance sheet math and flags variance inconsistencies using strict logic models.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 2 */}
            <ScrollReveal delay={80}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Source-grounded AI</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Generates explanations and extracts footnotes linking back directly to the SEC EDGAR folder.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 3 */}
            <ScrollReveal delay={160}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <GitCompare className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Filing comparison</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Runs diffing audits to identify metric changes and narrative text deletions or modifications.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 4 */}
            <ScrollReveal delay={240}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Peer benchmarking</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Compares revenue, profits, margins, leverage, and capitalization side-by-side with peers.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 5 */}
            <ScrollReveal delay={320}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Research reports</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Creates structured reports compiling verified financial facts, calculations, and takeaways.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* Card 6 */}
            <ScrollReveal delay={400}>
              <div className="border border-zinc-200 hover:border-zinc-350 bg-white p-6 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all duration-200 flex flex-col justify-between min-h-[180px] shadow-xs">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-800 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">Investment memos</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    Generates institutional memos including SWOT assessment and comparison snapshots.
                  </p>
                </div>
              </div>
            </ScrollReveal>

          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 border-b border-zinc-200 bg-zinc-50/50">
        <div className="mx-auto max-w-4xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Workflow</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-950 font-serif">
              Three steps to verified filings.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <ScrollReveal delay={0}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">01 / Search</span>
                <h3 className="text-sm font-bold text-zinc-955">Search a public company</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Query by ticker or company name to fetch live SEC disclosures.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={80}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">02 / Verify</span>
                <h3 className="text-sm font-bold text-zinc-955">Analyze verified SEC facts</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Review deterministic verification checks and cross-references.
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={160}>
              <div className="space-y-3 bg-white p-6 rounded-xl border border-zinc-200 shadow-xs h-full">
                <span className="text-xs font-bold font-mono text-zinc-400">03 / Synthesize</span>
                <h3 className="text-sm font-bold text-zinc-955">Generate insights & reports</h3>
                <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                  Run comparative diffs, query with AI, and download citation PDFs.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="use-cases" className="py-24 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Target Audience</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-955 font-serif">
              Designed for professional workflow tasks.
            </h2>
            <p className="max-w-xl mx-auto text-zinc-500 text-xs">
              Supports analysis workflows without replacing professional judgment or auditing diligence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            
            <ScrollReveal delay={0}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-955 uppercase tracking-wider">Equity Research</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Quickly audit balance sheets and compile historical peer tables.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={80}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-955 uppercase tracking-wider">Independent Investors</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Trace statements to source disclosures with verified citation links.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={160}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-955 uppercase tracking-wider">Transaction Advisory</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Review solvency covenants, leverage parameters, and valuation factors.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={240}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-955 uppercase tracking-wider">Audit & Diligence</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Confirm consistent calculations across consecutive 10-K/Q filings.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={320}>
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50/20 text-left space-y-2 h-full">
                <h3 className="text-xs font-bold text-zinc-955 uppercase tracking-wider">University Funds</h3>
                <p className="text-[11px] text-zinc-500 font-normal leading-relaxed">
                  Train analysts using official, verified filing sources and clean formulas.
                </p>
              </div>
            </ScrollReveal>

          </div>
        </div>
      </section>

      {/* Trust & Methodology Section */}
      <section id="methodology" className="py-24 border-b border-zinc-200 bg-zinc-50/50">
        <div className="mx-auto max-w-4xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Our Methodology</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-955 font-serif">
              An unwavering commitment to accuracy.
            </h2>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-8 space-y-6 shadow-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y md:divide-y-0 md:divide-x divide-zinc-150">
              <ScrollReveal delay={0}>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <h3 className="font-bold text-sm text-zinc-955 font-sans">Verified SEC EDGAR Data</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    All facts are parsed directly from raw SEC disclosures. We preserve index anchors and context-specific footnotes to eliminate hallucinations.
                  </p>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={80} className="md:pl-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <h3 className="font-bold text-sm text-zinc-955 font-sans">Deterministic Arithmetic</h3>
                  </div>
                  <p className="text-xs text-zinc-500 font-normal leading-relaxed">
                    We use AI strictly for explanation and synthesis—never for arithmetic. Calculations like margins, liquidity, and leverage are derived using deterministic equations.
                  </p>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-[10px] font-bold tracking-wider text-blue-800 uppercase block">Frequently Asked Questions</span>
            <h2 className="text-3xl font-normal tracking-tight text-zinc-955 font-serif">
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
                      <span className="text-xs font-bold text-zinc-805 uppercase tracking-wider flex items-center gap-2">
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
                      <div className="p-5 bg-zinc-50/20 border-t border-zinc-100 text-xs text-zinc-650 font-normal leading-relaxed animate-fadeIn">
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

      {/* Final CTA Section */}
      <section className="py-24 bg-white border-t border-zinc-200 text-center">
        <ScrollReveal>
          <div className="mx-auto max-w-3xl px-6 py-12 bg-zinc-50/50 border border-zinc-200 rounded-2xl shadow-xs space-y-6">
            <h2 className="text-3xl md:text-4xl font-normal font-serif tracking-tight text-zinc-955 leading-tight">
              Turn SEC filings into verified financial insight.
            </h2>
            <p className="max-w-md mx-auto text-zinc-500 text-xs leading-relaxed font-normal">
              Eliminate errors, trace citations directly to EDGAR disclosures, and download verified research reports.
            </p>
            <button
              onClick={focusSearch}
              className="group px-6 py-3 bg-blue-800 hover:bg-blue-750 text-white font-bold rounded-lg text-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 cursor-pointer inline-flex items-center gap-2"
            >
              <span>Analyze a Company</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
            </button>
          </div>
        </ScrollReveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-14">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="space-y-3">
            <Logo />
            <p className="text-[10px] text-zinc-400 font-normal">Verified SEC filing audits & summaries.</p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-6 text-xs font-semibold text-zinc-500">
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Product</span>
              <button onClick={() => jumpToSection("product-preview")} className="hover:text-zinc-950 transition-colors block text-left cursor-pointer font-semibold">Preview</button>
              <button onClick={() => jumpToSection("how-it-works")} className="hover:text-zinc-955 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">Workflow</button>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Methodology</span>
              <button onClick={() => jumpToSection("methodology")} className="hover:text-zinc-955 transition-colors block text-left cursor-pointer font-semibold">Trust Model</button>
              <button onClick={() => jumpToSection("faq")} className="hover:text-zinc-955 transition-colors block text-left mt-1.5 cursor-pointer font-semibold">FAQs</button>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold block mb-2.5">Terms</span>
              <span className="text-zinc-400 font-normal block">Privacy Policy</span>
              <span className="text-zinc-400 font-normal block mt-1.5">Contact Support</span>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 border-t border-zinc-150 mt-10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] text-zinc-455 font-normal">
          <span>&copy; {new Date().getFullYear()} FilingLens. All rights reserved.</span>
          <span>Source data: U.S. SEC EDGAR.</span>
        </div>
      </footer>
    </div>
  );
}
