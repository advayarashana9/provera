import { useState, useEffect, useRef } from "react";

// Global cache storage
const cache = new Map<string, any>();
const inFlight = new Map<string, Promise<any>>();
const listeners = new Map<string, Set<(data: any) => void>>();

export interface SWRResponse<T> {
  data: T | null;
  error: Error | null;
  isValidating: boolean;
  mutate: (newData: T) => void;
}

export function useSWR<T>(
  key: string | null,
  fetcher: () => Promise<T>
): SWRResponse<T> {
  const [data, setData] = useState<T | null>(() => {
    return key ? (cache.get(key) || null) : null;
  });
  const [error, setError] = useState<Error | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;

    // Register listener for this key
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    const keyListeners = listeners.get(key)!;
    const listener = (newData: any) => {
      setData(newData);
      setError(null);
    };
    keyListeners.add(listener);

    // Initial state setup from cache
    const cached = cache.get(key);
    if (cached !== undefined) {
      setData(cached);
    }

    // Trigger revalidation
    async function revalidate() {
      setIsValidating(true);
      try {
        let promise = inFlight.get(key!);
        if (!promise) {
          promise = fetcherRef.current();
          inFlight.set(key!, promise);
        }
        const result = await promise;
        inFlight.delete(key!);
        cache.set(key!, result);
        
        // Notify all listeners
        const currentListeners = listeners.get(key!);
        if (currentListeners) {
          currentListeners.forEach((l) => l(result));
        }
      } catch (err: any) {
        inFlight.delete(key!);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsValidating(false);
      }
    }

    revalidate();

    return () => {
      keyListeners.delete(listener);
      if (keyListeners.size === 0) {
        listeners.delete(key);
      }
    };
  }, [key]);

  const mutate = (newData: T) => {
    if (!key) return;
    cache.set(key, newData);
    const keyListeners = listeners.get(key);
    if (keyListeners) {
      keyListeners.forEach((l) => l(newData));
    }
  };

  return {
    data,
    error,
    isValidating,
    mutate
  };
}
