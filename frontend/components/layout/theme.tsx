"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Toaster } from "sonner";

import { cn } from "@/lib/utils";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "talentlens.theme";

/**
 * Runs before first paint (inlined in <head>) so the page never flashes the
 * wrong theme. Kept dependency-free and wrapped in try/catch: storage may be
 * unavailable, in which case the system preference is used.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}");}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";})();`;

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function resolved(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolved(preference);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as ThemePreference);
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    (): "light" | "dark" => "light",
  );

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: still apply for this page view */
    }
    apply(next);
    listeners.forEach((l) => l());
  }, []);

  // Follow the operating system while the preference is "system".
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readPreference() === "system") {
        apply("system");
        listeners.forEach((l) => l());
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return { preference, resolvedTheme, setPreference };
}

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn("grid grid-cols-3 rounded-lg border border-line bg-surface-muted p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          title={`${label} theme`}
          onClick={() => setPreference(value)}
          className={cn(
            "flex h-7 items-center justify-center gap-1.5 rounded-md text-[11.5px] font-medium text-muted transition-[background-color,color,box-shadow] duration-150 hover:text-ink",
            preference === value && "bg-surface text-ink shadow-[var(--shadow-card)]",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      gap={8}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-line !bg-surface !text-ink !shadow-[var(--shadow-raised)] !font-sans",
          title: "!text-[13px] !font-semibold !text-ink",
          description: "!text-[13px] !text-muted",
        },
      }}
    />
  );
}
