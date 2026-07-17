"use client";

import React, { useState, useEffect, useRef } from "react";

const PHRASES = [
  "Paste an investment memo...",
  "Paste an equity research report...",
  "Paste AI-generated financial analysis...",
  "Paste an earnings summary...",
  "Paste a hedge fund memo..."
];

interface TypingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

const TypingPlaceholderTextarea = React.forwardRef<HTMLTextAreaElement, TypingTextareaProps>(
  function TypingPlaceholderTextarea(
    { value, onChange, onFocus, onBlur, placeholder, ...props },
    ref
  ) {
    const [isFocused, setIsFocused] = useState(false);
    const [currentPlaceholder, setCurrentPlaceholder] = useState("");
    const [prefersReduced, setPrefersReduced] = useState(false);
    
    const stateRef = useRef({
      phraseIndex: 0,
      charIndex: 0,
      isDeleting: false
    });

    // Check user preference for motion
    useEffect(() => {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReduced(mediaQuery.matches);
      
      const listener = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }, []);

    // Run typing animation loop
    useEffect(() => {
      if (prefersReduced || isFocused || value.trim().length > 0) {
        return;
      }

      let timer: number | null = null;

      const tick = () => {
        const currentPhrase = PHRASES[stateRef.current.phraseIndex];
        let delay = 60; // speed of typing

        if (stateRef.current.isDeleting) {
          stateRef.current.charIndex--;
          delay = 30; // speed of erasing
        } else {
          stateRef.current.charIndex++;
        }

        const nextText = currentPhrase.substring(0, stateRef.current.charIndex);
        setCurrentPlaceholder(nextText);

        if (!stateRef.current.isDeleting && stateRef.current.charIndex === currentPhrase.length) {
          stateRef.current.isDeleting = true;
          delay = 2000; // pause at end of typing
        } else if (stateRef.current.isDeleting && stateRef.current.charIndex === 0) {
          stateRef.current.isDeleting = false;
          stateRef.current.phraseIndex = (stateRef.current.phraseIndex + 1) % PHRASES.length;
          delay = 400; // pause before next phrase starts
        }

        timer = window.setTimeout(tick, delay);
      };

      timer = window.setTimeout(tick, 200);

      return () => {
        if (timer) window.clearTimeout(timer);
      };
    }, [prefersReduced, isFocused, value]);

    const activePlaceholder = (prefersReduced || isFocused || value.trim().length > 0)
      ? (placeholder || "Paste your financial report here...")
      : currentPlaceholder;

    return (
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onFocus={(e) => {
          setIsFocused(true);
          if (onFocus) onFocus(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          if (onBlur) onBlur(e);
        }}
        placeholder={activePlaceholder}
        {...props}
      />
    );
  }
);

export default TypingPlaceholderTextarea;
