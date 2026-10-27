"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CRITERION_COLORS, CRITERION_LABELS, CRITERION_ORDER } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DEFAULT_WEIGHTS, type Weights } from "./schema";

export function WeightsEditor({ value, onChange }: { value: Weights; onChange: (next: Weights) => void }) {
  const total = CRITERION_ORDER.reduce((sum, key) => sum + (Number.isFinite(value[key]) ? value[key] : 0), 0);
  const valid = Math.abs(total - 100) < 1e-6;
  return (
    <div>
      <div className="grid gap-4">
        {CRITERION_ORDER.map((key) => (
          <div key={key} className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[200px_minmax(0,1fr)_76px]">
            <label htmlFor={`w-${key}`} className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <span className="size-2 rounded-[3px]" style={{ background: CRITERION_COLORS[key] }} aria-hidden />
              {CRITERION_LABELS[key]}
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={value[key]}
              aria-label={`${CRITERION_LABELS[key]} weight`}
              onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
              className="order-3 col-span-2 h-1.5 w-full cursor-pointer accent-[var(--accent)] sm:order-none sm:col-span-1"
            />
            <div className="relative">
              <input
                id={`w-${key}`}
                type="number"
                min={0}
                max={100}
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.target.value === "" ? 0 : Number(event.target.value) })}
                className="tabular h-8 w-full rounded-md border border-line-strong bg-surface pl-2.5 pr-6 text-right text-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-subtle">%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <p className={cn("tabular text-[13px] font-medium", valid ? "text-success" : "text-danger")} role="status">
          Total {total}% {valid ? "· balanced" : "· must equal 100%"}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...DEFAULT_WEIGHTS })}>
          <RotateCcw /> Reset to defaults
        </Button>
      </div>
    </div>
  );
}
