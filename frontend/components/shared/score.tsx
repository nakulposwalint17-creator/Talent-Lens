"use client";

import { AnimatedNumber } from "@/components/shared/identity";
import { Tooltip } from "@/components/ui/tooltip";
import { CRITERION_LABELS, CRITERION_ORDER, formatScore, RECOMMENDATION_LABELS } from "@/lib/format";
import { CRITERION_COLORS, RECOMMENDATION_COLORS } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import type { CriterionPreview, Recommendation } from "@/types/api";

const THRESHOLDS = [65, 80];

/**
 * Compact score: a legible number over a thin bar with tick marks at the
 * recommendation thresholds. Colour is reserved for the filled portion.
 */
export function ScoreMeter({
  score,
  recommendation,
  className,
}: {
  score: number | null;
  recommendation: Recommendation | null;
  className?: string;
}) {
  const color = recommendation ? RECOMMENDATION_COLORS[recommendation] : "var(--chart-neutral)";
  return (
    <div
      className={cn("w-[84px]", className)}
      aria-label={score === null ? "No score" : `Score ${formatScore(score)} of 100${recommendation ? `, ${RECOMMENDATION_LABELS[recommendation]}` : ""}`}
    >
      <div className="flex items-baseline gap-1">
        <span className="tabular text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {score === null ? "—" : <AnimatedNumber value={score} decimals={1} />}
        </span>
        <span className="text-[11px] text-subtle">/100</span>
      </div>
      <div className="relative mt-2 h-1 rounded-full bg-surface-sunken" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${score ?? 0}%`, background: color }}
        />
        {THRESHOLDS.map((t) => (
          <span key={t} className="absolute -top-0.5 h-2 w-px bg-line-strong" style={{ left: `${t}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Large score treatment for the candidate detail header. */
export function ScoreHero({ score, recommendation }: { score: number | null; recommendation: Recommendation | null }) {
  const color = recommendation ? RECOMMENDATION_COLORS[recommendation] : "var(--chart-neutral)";
  return (
    <div className="w-full max-w-[220px]">
      <p className="type-eyebrow">Overall score</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular font-display text-[52px] leading-none tracking-[-0.02em] text-ink">
          {score === null ? "—" : <AnimatedNumber value={score} decimals={1} />}
        </span>
        <span className="text-sm text-muted">/ 100</span>
      </p>
      <div className="relative mt-3 h-1.5 rounded-full bg-surface-sunken" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[var(--ease-out)]"
          style={{ width: `${score ?? 0}%`, background: color }} />
        {THRESHOLDS.map((t) => (
          <span key={t} className="absolute -top-1 h-3.5 w-px bg-line-strong" style={{ left: `${t}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-subtle" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: "65%" }}>65</span>
        <span className="absolute -translate-x-1/2" style={{ left: "80%" }}>80</span>
      </div>
    </div>
  );
}

/** Stacked bar: each criterion's weighted contribution against its maximum (its weight). */
export function BreakdownBar({ criteria, className }: { criteria: CriterionPreview[]; className?: string }) {
  const byKey = Object.fromEntries(criteria.map((c) => [c.criterion, c]));
  return (
    <div
      className={cn("flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full", className)}
      role="img"
      aria-label={criteria
        .map((c) => `${CRITERION_LABELS[c.criterion]} ${c.included ? formatScore(c.score) : "not assessed"}`)
        .join(", ")}
    >
      {CRITERION_ORDER.map((key) => {
        const c = byKey[key];
        if (!c || c.weight <= 0) return null;
        const fill = c.included && c.score !== null ? c.score : 0;
        return (
          <Tooltip
            key={key}
            content={
              <span>
                <span className="font-medium">{CRITERION_LABELS[key]}</span> · weight {c.weight}%
                <br />
                {c.included ? `Score ${formatScore(c.score)} → +${formatScore(c.contribution)} pts` : "Not assessed (excluded)"}
              </span>
            }
          >
            <span
              className="relative h-full overflow-hidden bg-surface-sunken"
              style={{
                flexGrow: c.weight,
                flexBasis: 0,
                backgroundImage: c.included ? undefined : "repeating-linear-gradient(135deg,var(--hatch-a) 0 3px,var(--hatch-b) 3px 6px)",
              }}
            >
              <span
                className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-[var(--ease-out)]"
                style={{ width: `${fill}%`, background: CRITERION_COLORS[key] }}
              />
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function CompletenessMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sm text-subtle">—</span>;
  const pct = Math.round(value * 100);
  const tone = pct >= 100 ? "bg-success" : pct >= 60 ? "bg-teal" : "bg-warning";
  return (
    <Tooltip content={`${pct}% of the criteria weight could be assessed from resume evidence.`}>
      <span className="inline-flex items-center gap-2" tabIndex={0} aria-label={`Evidence completeness ${pct}%`}>
        <span className="flex gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-3 w-1 rounded-sm", pct > i * 25 ? tone : "bg-surface-sunken")} />
          ))}
        </span>
        <span className="tabular text-[13px] text-ink-soft">{pct}%</span>
      </span>
    </Tooltip>
  );
}
