import { CRITERION_COLORS, CRITERION_LABELS, CRITERION_ORDER } from "@/lib/format";
import type { CriterionKey } from "@/types/api";

export function WeightsBar({ weights }: { weights: Record<CriterionKey, number> }) {
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {CRITERION_ORDER.filter((k) => weights[k] > 0).map((key) => (
          <span key={key} style={{ flexGrow: weights[key], flexBasis: 0, background: CRITERION_COLORS[key] }} />
        ))}
      </div>
      <dl className="mt-3 grid gap-y-2">
        {CRITERION_ORDER.map((key) => (
          <div key={key} className="flex items-center gap-2 text-[13px]">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: CRITERION_COLORS[key] }} aria-hidden />
            <dt className="min-w-0 flex-1 truncate text-ink-soft">{CRITERION_LABELS[key]}</dt>
            <dd className="tabular font-semibold text-ink">{weights[key]}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
