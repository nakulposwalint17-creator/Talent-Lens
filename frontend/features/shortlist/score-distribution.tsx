"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui/primitives";
import { candidateLabel, formatScore, RECOMMENDATION_LABELS } from "@/lib/format";
import { COLORS as T, RECOMMENDATION_COLORS } from "@/lib/tokens";
import type { CandidateSummary, Recommendation } from "@/types/api";

const COLORS = RECOMMENDATION_COLORS;

/** Ranked candidates' overall scores against the recommendation thresholds. */
export function ScoreDistribution({
  candidates,
  onOpen,
  strong = 80,
  potential = 65,
}: {
  candidates: CandidateSummary[];
  onOpen: (id: string) => void;
  strong?: number;
  potential?: number;
}) {
  const data = [...candidates]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((c) => ({
      id: c.id,
      name: candidateLabel(c),
      short: `#${c.rank} ${candidateLabel(c).split(" ")[0]}`,
      score: c.evaluation?.overall_score ?? 0,
      recommendation: c.evaluation?.recommendation ?? "lower_match",
    }));
  const counts = data.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.recommendation]: (acc[d.recommendation] ?? 0) + 1 }), {});

  return (
    <Card className="hidden px-5 pb-3 pt-4 sm:block">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section">Score distribution</h3>
          <p className="type-meta mt-0.5">Overall scores of ranked candidates against the recommendation thresholds.</p>
        </div>
        <ul className="flex flex-wrap gap-3 text-xs text-ink-soft">
          {(["strong_match", "potential_match", "lower_match"] as Recommendation[]).map((r) => (
            <li key={r} className="flex items-center gap-1.5">
              <span className="size-2 rounded-[3px]" style={{ background: COLORS[r] }} />
              {RECOMMENDATION_LABELS[r]} <span className="tabular text-muted">{counts[r] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2 h-[148px]" role="img" aria-label={`Bar chart of ${data.length} candidate scores`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 72, bottom: 0, left: -18 }} barCategoryGap="22%">
            <XAxis dataKey="short" tickLine={false} axisLine={{ stroke: T.line }} tick={{ fontSize: 11, fill: T.muted }} interval={0} />
            <YAxis domain={[0, 100]} ticks={[0, potential, strong, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: T.subtle }} />
            <ReferenceLine y={strong} stroke={T.success} strokeDasharray="3 3" strokeOpacity={0.6}
              label={{ value: `Strong ${strong}`, position: "right", fontSize: 10, fill: T.success }} />
            <ReferenceLine y={potential} stroke={T.accent} strokeDasharray="3 3" strokeOpacity={0.6}
              label={{ value: `Potential ${potential}`, position: "right", fontSize: 10, fill: T.accent }} />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md bg-ink px-2.5 py-1.5 text-xs text-on-ink shadow-[var(--shadow-raised)]">
                    <p className="font-medium">{d.name}</p>
                    <p className="opacity-80">
                      {formatScore(d.score)} · {RECOMMENDATION_LABELS[d.recommendation as Recommendation]}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive
              onClick={(entry) => onOpen((entry as unknown as { id: string }).id)} className="cursor-pointer">
              {data.map((d) => (
                <Cell key={d.id} fill={COLORS[d.recommendation as Recommendation]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
