"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
  refresh: () => Promise<T | undefined>;
  setData: (updater: T | ((previous: T | undefined) => T)) => void;
}

/**
 * Minimal data-fetching hook: loads on mount / when `key` changes, exposes a
 * `refresh`, and optionally polls while `pollInterval(data)` returns a number.
 * Stale responses from superseded requests are ignored.
 */
export function useApi<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  pollInterval?: (data: T | undefined) => number | false,
): ApiState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  const pollRef = useRef(pollInterval);

  useEffect(() => {
    fetcherRef.current = fetcher;
    pollRef.current = pollInterval;
  });

  const run = useCallback(async (): Promise<T | undefined> => {
    const id = ++requestId.current;
    try {
      const result = await fetcherRef.current();
      if (id === requestId.current) {
        setDataState(result);
        setError(null);
        setLoadedKey(key);
      }
      return result;
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoadedKey(key);
      }
      return undefined;
    }
  }, [key]);

  // Initial load whenever the key changes.
  useEffect(() => {
    if (key === null) return;
    void run();
  }, [key, run]);

  // Poll based on the latest result, so any refresh that reveals in-progress
  // work (e.g. right after starting an evaluation) resumes polling.
  useEffect(() => {
    if (key === null) return;
    const delay = pollRef.current?.(data);
    if (typeof delay !== "number") return;
    const timer = setTimeout(() => void run(), delay);
    return () => clearTimeout(timer);
  }, [data, error, key, run]);

  const setData = useCallback((updater: T | ((previous: T | undefined) => T)) => {
    setDataState((previous) =>
      typeof updater === "function" ? (updater as (p: T | undefined) => T)(previous) : updater,
    );
  }, []);

  return {
    data,
    error,
    loading: key !== null && loadedKey !== key && data === undefined,
    refresh: run,
    setData,
  };
}
