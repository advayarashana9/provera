"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { searchCompanies, CompanySearchResult } from "@/lib/api";
import { formatCIK } from "@/lib/format";

export default function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search logic
  useEffect(() => {
    if (!query.trim()) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const searchResults = await searchCompanies(query, controller.signal);
        setResults(searchResults.slice(0, 5));
      } catch {
        // ignore errors in compact search quietly
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Click outside dropdown handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      if (focusedIndex >= 0 && focusedIndex < results.length) {
        e.preventDefault();
        setQuery("");
        setIsDropdownOpen(false);
        router.push(`/company/${results[focusedIndex].cik}`);
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-48 sm:w-64">
      <div className="relative rounded border border-zinc-200 bg-white focus-within:border-blue-700 focus-within:ring-2 focus-within:ring-blue-100/50 transition-all">
        <label htmlFor="header-search" className="sr-only">
          Search companies
        </label>
        <input
          id="header-search"
          type="text"
          role="combobox"
          className="w-full bg-transparent px-3 py-1.5 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-0 text-xs font-sans font-normal"
          placeholder="Search ticker or name..."
          value={query}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            setFocusedIndex(-1);
            if (val.trim()) {
              setIsLoading(true);
              setIsDropdownOpen(true);
            } else {
              setResults([]);
              setIsLoading(false);
              setIsDropdownOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim()) setIsDropdownOpen(true);
          }}
          aria-autocomplete="list"
          aria-controls="header-search-results"
          aria-expanded={isDropdownOpen && (results.length > 0 || isLoading)}
          autoComplete="off"
          spellCheck="false"
        />
        {isLoading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden="true">
            <svg className="animate-spin h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
      </div>

      {isDropdownOpen && (results.length > 0 || isLoading) && (
        <ul
          id="header-search-results"
          className="absolute right-0 z-20 mt-1 w-64 rounded border border-zinc-200 bg-white shadow-lg divide-y divide-zinc-100 overflow-hidden text-left"
          role="listbox"
        >
          {isLoading && results.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-zinc-500 flex items-center gap-2 bg-zinc-50/50">
              <svg className="animate-spin h-3.5 w-3.5 text-zinc-450" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Searching SEC companies…</span>
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-3 text-center text-[11px] text-zinc-400 font-medium">
              No companies found
            </li>
          ) : (
            results.map((comp, idx) => (
              <li
                key={comp.cik}
                role="option"
                aria-selected={focusedIndex === idx}
                className={`focus:outline-none ${focusedIndex === idx ? "bg-zinc-50" : ""}`}
              >
                <Link
                  href={`/company/${comp.cik}`}
                  className="block px-3 py-2 hover:bg-zinc-50 transition-colors flex items-center justify-between text-xs"
                  onClick={() => {
                    setQuery("");
                    setIsDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono font-bold text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded shrink-0">
                      {comp.ticker}
                    </span>
                    <span className="font-medium text-zinc-900 truncate">{comp.name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono shrink-0 ml-1">
                    {formatCIK(comp.cik)}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
