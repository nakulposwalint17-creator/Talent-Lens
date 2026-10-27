"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export interface ActiveScreening {
  id: string;
  title: string;
  ranked: number;
  total: number;
}

const KEY = "talentlens.activeScreening";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: ActiveScreening | null = null;

// Per-tab convenience only: storage may be unavailable (private mode), so failures are ignored.
function read(): ActiveScreening | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    return cachedValue;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? (JSON.parse(raw) as ActiveScreening) : null;
    } catch {
      cachedValue = null;
    }
  }
  return cachedValue;
}

function write(next: ActiveScreening | null) {
  try {
    if (next) window.sessionStorage.setItem(KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    cachedValue = next;
    cachedRaw = null;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const Ctx = createContext<{ active: ActiveScreening | null; setActive: (s: ActiveScreening | null) => void }>({
  active: null,
  setActive: () => undefined,
});

/** Remembers the screening most recently opened in this tab, for sidebar context. */
export function ActiveScreeningProvider({ children }: { children: React.ReactNode }) {
  const active = useSyncExternalStore(subscribe, read, () => null);
  const setActive = useCallback((next: ActiveScreening | null) => {
    const current = read();
    if (JSON.stringify(current) !== JSON.stringify(next)) write(next);
  }, []);
  return <Ctx.Provider value={{ active, setActive }}>{children}</Ctx.Provider>;
}

export function useActiveScreening() {
  return useContext(Ctx);
}
