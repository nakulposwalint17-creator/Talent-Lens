"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookOpenText,
  CornerDownLeft,
  History,
  LayoutGrid,
  Loader2,
  Monitor,
  Moon,
  ScanSearch,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

import { useActiveScreening } from "@/components/layout/screening-context";
import { useTheme } from "@/components/layout/theme";
import { api } from "@/lib/api";
import { candidateLabel, formatScore, RECOMMENDATION_SHORT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateSummary, SessionSummary } from "@/types/api";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

const Ctx = createContext<{ open: () => void }>({ open: () => undefined });
export const useCommandMenu = () => useContext(Ctx);

function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { active } = useActiveScreening();
  const { setPreference } = useTheme();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  // Load real data each time the menu opens (cheap, local API).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.listSessions().then(
      (data) => !cancelled && setSessions(data),
      () => !cancelled && setLoadError(true),
    );
    if (active) {
      api.getSession(active.id).then(
        (ws) => !cancelled && setCandidates(ws.candidates),
        () => !cancelled && setCandidates([]),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [open, active]);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      { id: "nav-overview", group: "Go to", label: "Overview", icon: LayoutGrid, run: () => go("/") },
      { id: "nav-new", group: "Go to", label: "Screen candidates", hint: "New screening", icon: ScanSearch, run: () => go("/screenings/new") },
      { id: "nav-history", group: "Go to", label: "Screening history", icon: History, run: () => go("/history") },
      { id: "nav-method", group: "Go to", label: "Methodology", icon: BookOpenText, run: () => go("/settings") },
    ];
    if (active && candidates) {
      for (const c of candidates) {
        const ev = c.evaluation;
        list.push({
          id: `cand-${c.id}`,
          group: `Candidates · ${active.title}`,
          label: candidateLabel(c),
          hint:
            c.rank !== null && ev?.recommendation
              ? `#${c.rank} · ${formatScore(ev.overall_score)} · ${RECOMMENDATION_SHORT[ev.recommendation]}`
              : c.original_filename,
          icon: UserRound,
          run: () => go(`/screenings/${active.id}?candidate=${c.id}`),
        });
      }
    }
    for (const s of sessions ?? []) {
      list.push({
        id: `sess-${s.id}`,
        group: "Screenings",
        label: s.job_title,
        hint: `${s.counts.total} resume${s.counts.total === 1 ? "" : "s"}${s.department ? ` · ${s.department}` : ""}`,
        icon: ScanSearch,
        run: () => go(`/screenings/${s.id}`),
      });
    }
    const theme = (value: "light" | "dark" | "system") => () => {
      setPreference(value);
      onOpenChange(false);
    };
    list.push(
      { id: "theme-light", group: "Appearance", label: "Light theme", icon: Sun, run: theme("light") },
      { id: "theme-dark", group: "Appearance", label: "Dark theme", icon: Moon, run: theme("dark") },
      { id: "theme-system", group: "Appearance", label: "Match system theme", icon: Monitor, run: theme("system") },
    );
    return list;
  }, [active, candidates, sessions, go, setPreference, onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(q));
  }, [items, query]);

  const safeIndex = Math.min(index, Math.max(0, filtered.length - 1));
  const activeItem = filtered[safeIndex];

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, filtered]);

  const groups: [string, Item[]][] = [];
  for (const item of filtered) {
    const g = groups.find(([name]) => name === item.group);
    if (g) g[1].push(item);
    else groups.push([item.group, [item]]);
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setIndex(0);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-scrim backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[var(--z-overlay)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-overlay)] data-[state=open]:animate-scale-in focus:outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Search TalentLens</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && activeItem) {
                  e.preventDefault();
                  activeItem.run();
                }
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
              aria-label="Search pages, screenings and candidates"
              placeholder="Search pages, screenings and candidates…"
              className="h-14 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle focus-visible:outline-none"
            />
            {sessions === null && !loadError && <Loader2 className="size-4 animate-spin text-subtle" aria-label="Loading" />}
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
            {groups.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted">No matches for “{query}”.</li>}
            {groups.map(([name, groupItems]) => (
              <li key={name} role="presentation">
                <p className="type-eyebrow px-3 pb-1.5 pt-3 text-[10.5px]">{name}</p>
                <ul role="presentation">
                  {groupItems.map((item) => {
                    const isActive = item === activeItem;
                    return (
                      <li
                        key={item.id}
                        id={`${listId}-${item.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive}
                        onMouseMove={() => setIndex(filtered.indexOf(item))}
                        onClick={item.run}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-100",
                          isActive ? "bg-accent-soft text-ink" : "text-ink-soft",
                        )}
                      >
                        <item.icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-subtle")} aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                        {item.hint && <span className="tabular hidden shrink-0 truncate text-xs text-muted sm:block">{item.hint}</span>}
                        {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4 border-t border-line bg-surface-muted px-4 py-2 text-[11.5px] text-muted">
            <span><kbd className="font-sans">↑↓</kbd> navigate</span>
            <span><kbd className="font-sans">↵</kbd> open</span>
            <span><kbd className="font-sans">esc</kbd> close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandMenu open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}
