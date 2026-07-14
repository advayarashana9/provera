"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { MessageSquare } from "lucide-react";

const SECTIONS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "peer-comparison", label: "Peer Comparison" },
  { id: "compare-filings", label: "Compare Filings" },
  { id: "verification", label: "Verification" },
  { id: "recent-filings", label: "Recent Filings" }
];

export default function SectionNavigation() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [isScrollspyActive, setIsScrollspyActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isClickingRef = useRef(false);

  // Manual scroll restoration on mount/unmount to avoid browser restoration conflicts
  useEffect(() => {
    const originalScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = originalScrollRestoration;
    };
  }, []);

  // Delay scrollspy observation until initial loading / rendering shifts settle (600ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsScrollspyActive(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Measure and compute the active section deterministically using scroll boundaries
  const calculateActiveSection = useCallback(() => {
    if (!isScrollspyActive || isClickingRef.current) return;

    const scrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    const winHeight = window.innerHeight;

    // Measure dynamic dimensions
    const headerEl = document.querySelector("header");
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const subnavEl = containerRef.current?.parentElement;
    const subnavHeight = subnavEl ? subnavEl.getBoundingClientRect().height : 0;

    // Reference Line = Site Header Height + Sub-nav Height + Padding offset
    const referenceLine = scrollY + headerHeight + subnavHeight + 24;

    // Force Recent Filings active if scrolled near the bottom of the page
    if (winHeight + scrollY >= docHeight - 40) {
      setActiveSection("recent-filings");
      if (window.location.hash !== "#recent-filings") {
        window.history.replaceState(null, "", "#recent-filings");
      }
      return;
    }

    let currentActive = "dashboard";

    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) {
        const sectionTop = el.getBoundingClientRect().top + scrollY;
        if (sectionTop <= referenceLine) {
          currentActive = section.id;
        }
      }
    }

    setActiveSection(currentActive);
    if (window.location.hash !== `#${currentActive}`) {
      window.history.replaceState(null, "", `#${currentActive}`);
    }
  }, [isScrollspyActive]);

  // Scrollspy: Scroll & Resize triggers with requestAnimationFrame
  useEffect(() => {
    let activeFrame: number;

    const handleScroll = () => {
      cancelAnimationFrame(activeFrame);
      activeFrame = requestAnimationFrame(calculateActiveSection);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    // Initial run
    handleScroll();

    return () => {
      cancelAnimationFrame(activeFrame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isScrollspyActive, calculateActiveSection]);

  // ResizeObserver: Recalculate offsets dynamically as dashboard content grows/shrinks
  useEffect(() => {
    const mainEl = document.querySelector("main");
    if (!mainEl) return;

    let resizeFrame: number;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(calculateActiveSection);
    });

    resizeObserver.observe(mainEl);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
    };
  }, [isScrollspyActive, calculateActiveSection]);

  // Auto-scroll sub-nav active buttons into center of horizontal list
  useEffect(() => {
    if (containerRef.current) {
      const activeBtn = containerRef.current.querySelector('[aria-current="location"]');
      if (activeBtn) {
        activeBtn.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center"
        });
      }
    }
  }, [activeSection]);

  // Handle URL hash target scrolling on mount or scroll-to-top fallback
  useEffect(() => {
    const handleHashScroll = () => {
      const hash = window.location.hash;
      const validHashes = ["#dashboard", "#peer-comparison", "#compare-filings", "#verification", "#recent-filings"];

      if (hash && validHashes.includes(hash)) {
        const targetId = hash.replace("#", "");
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          setTimeout(() => {
            const headerEl = document.querySelector("header");
            const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
            const subnavEl = containerRef.current?.parentElement;
            const subnavHeight = subnavEl ? subnavEl.getBoundingClientRect().height : 0;

            const sectionTop = targetEl.getBoundingClientRect().top + window.scrollY;
            const targetScrollTop = sectionTop - headerHeight - subnavHeight - 16;

            window.scrollTo({ top: targetScrollTop, behavior: "auto" });
            setActiveSection(targetId);
          }, 250);
        }
      } else {
        // No hash (or invalid hash): Enforce starting at the very top of the page
        window.scrollTo({ top: 0, behavior: "auto" });
        setActiveSection("dashboard");
      }
    };

    if (document.readyState === "complete") {
      handleHashScroll();
    } else {
      window.addEventListener("load", handleHashScroll);
    }

    return () => {
      window.removeEventListener("load", handleHashScroll);
    };
  }, []);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      isClickingRef.current = true;
      setActiveSection(id);

      window.history.replaceState(null, "", `#${id}`);

      const headerEl = document.querySelector("header");
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const subnavEl = containerRef.current?.parentElement;
      const subnavHeight = subnavEl ? subnavEl.getBoundingClientRect().height : 0;

      const sectionTop = el.getBoundingClientRect().top + window.scrollY;
      const targetScrollTop = sectionTop - headerHeight - subnavHeight - 16;

      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      window.scrollTo({
        top: targetScrollTop,
        behavior: prefersReduced ? "auto" : "smooth"
      });

      const handleScrollEnd = () => {
        isClickingRef.current = false;
        window.removeEventListener("scrollend", handleScrollEnd);
      };

      if ("onscrollend" in window) {
        window.addEventListener("scrollend", handleScrollEnd);
      }

      setTimeout(() => {
        isClickingRef.current = false;
        window.removeEventListener("scrollend", handleScrollEnd);
      }, 800);
    }
  };

  const handleAskClick = () => {
    const chatContainer = document.getElementById("ask-filinglens-container");
    if (chatContainer) {
      const headerEl = document.querySelector("header");
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const subnavEl = containerRef.current?.parentElement;
      const subnavHeight = subnavEl ? subnavEl.getBoundingClientRect().height : 0;

      const sectionTop = chatContainer.getBoundingClientRect().top + window.scrollY;
      const targetScrollTop = sectionTop - headerHeight - subnavHeight - 16;

      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      window.scrollTo({
        top: targetScrollTop,
        behavior: prefersReduced ? "auto" : "smooth"
      });

      const inputEl = chatContainer.querySelector("input");
      if (inputEl) {
        setTimeout(() => {
          (inputEl as HTMLInputElement).focus();
        }, 300);
      }
    }
  };

  return (
    <div className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-zinc-200 py-2.5 shadow-xs">
      <div className="mx-auto max-w-7xl w-full px-6 flex items-center justify-between gap-4">
        {/* Scrollspy tab buttons list */}
        <div
          ref={containerRef}
          className="flex items-center justify-start gap-1 overflow-x-auto scrollbar-none"
          role="tablist"
          aria-label="Section navigation"
        >
          {SECTIONS.map((s) => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleClick(s.id)}
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? "location" : undefined}
                className={`sub-nav-link relative outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                  isActive
                    ? "text-blue-800 bg-blue-50/70 font-bold border-b-2 border-blue-800"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/50"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Dedicated Chat Action button */}
        <button
          onClick={handleAskClick}
          aria-label="Focus Ask FilingLens assistant chat input"
          className="flex-shrink-0 h-8 px-3 border border-blue-200 text-blue-800 bg-blue-50/30 hover:bg-blue-50 rounded-lg text-xs font-semibold shadow-xs transition-all active:scale-[0.98] cursor-pointer flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Ask FilingLens</span>
        </button>
      </div>
    </div>
  );
}
