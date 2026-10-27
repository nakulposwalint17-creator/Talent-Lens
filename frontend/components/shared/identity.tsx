"use client";

import { useEffect, useRef, useState } from "react";

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Neutral initials avatar. Never derived from photos or demographic inferences. */
export function Avatar({ label, size = "md", muted }: { label: string; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold tracking-[0.02em]",
        size === "sm" && "size-7 text-[10.5px]",
        size === "md" && "size-8 text-[11px]",
        size === "lg" && "size-11 text-[13px]",
        muted ? "bg-surface-sunken text-muted" : "bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent-line",
      )}
    >
      {initials(label)}
    </span>
  );
}

/** Tweens to a new value when real data changes (not on every render). */
export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - t0) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + (value - start) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display.toFixed(decimals)}</>;
}

export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: number | null;
  hint?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  className?: string;
}) {
  const toneClass = {
    neutral: "text-ink",
    success: "text-success",
    warning: "text-warning-ink",
    danger: "text-danger",
    accent: "text-accent-strong",
  }[tone];
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="type-meta truncate">{label}</dt>
      <dd className={cn("type-metric mt-2", value ? toneClass : "text-ink")}>
        {value === null ? <span className="text-subtle">—</span> : <AnimatedNumber value={value} />}
      </dd>
      {hint && <dd className="type-meta mt-1.5">{hint}</dd>}
    </div>
  );
}
