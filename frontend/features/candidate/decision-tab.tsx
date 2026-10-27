"use client";

import { Bot, FileUp, History, UserRoundPen, XCircle } from "lucide-react";

import { DecisionBadge, RecommendationBadge } from "@/components/shared/status";
import { Card } from "@/components/ui/primitives";
import { formatDateTime, formatScore, providerLabel, RECOMMENDATION_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateDetail } from "@/types/api";

import { DecisionForm } from "./decision-form";

type TimelineItem = { at: string; icon: typeof Bot; tone: string; title: React.ReactNode; body?: React.ReactNode };

function AuditTrail({ candidate }: { candidate: CandidateDetail }) {
  const items: TimelineItem[] = [];
  for (const d of candidate.decision_history) {
    items.push({
      at: d.created_at,
      icon: UserRoundPen,
      tone: "bg-accent-soft text-accent",
      title: (
        <span className="flex flex-wrap items-center gap-2">
          Recruiter decision <DecisionBadge decision={d.decision} override={d.is_override} />
        </span>
      ),
      body: (
        <>
          {d.ai_recommendation && (
            <p>
              AI recommendation at the time: {RECOMMENDATION_LABELS[d.ai_recommendation]} ({formatScore(d.ai_score)})
            </p>
          )}
          {d.reason && <p><span className="font-medium text-ink">Reason:</span> {d.reason}</p>}
          {d.notes && <p><span className="font-medium text-ink">Notes:</span> {d.notes}</p>}
        </>
      ),
    });
  }
  for (const e of candidate.evaluation_history) {
    items.push({
      at: e.created_at,
      icon: e.status === "completed" ? Bot : XCircle,
      tone: e.status === "completed" ? "bg-surface-sunken text-ink-soft" : "bg-danger-soft text-danger",
      title:
        e.status === "completed" ? (
          <span className="flex flex-wrap items-center gap-2">
            Assessment #{e.attempt} <RecommendationBadge value={e.recommendation} />
            <span className="tabular text-ink">{formatScore(e.overall_score)}</span>
            {e.stale && <span className="text-xs font-normal text-warning-ink">(earlier criteria)</span>}
          </span>
        ) : (
          `Assessment #${e.attempt} failed — unable to evaluate`
        ),
      body: (
        <p>
          {providerLabel(e.provider, e.model)} · {e.scoring_version}
          {e.error_message && <span className="block text-danger">{e.error_message}</span>}
        </p>
      ),
    });
  }
  items.push({
    at: candidate.created_at,
    icon: FileUp,
    tone: "bg-surface-sunken text-ink-soft",
    title: `Resume uploaded · ${candidate.original_filename}`,
    body: (
      <p>
        {candidate.parse_status === "parsed"
          ? `Text extracted from ${candidate.detected_format?.toUpperCase()}${candidate.page_count ? ` (${candidate.page_count} page${candidate.page_count === 1 ? "" : "s"})` : ""}.`
          : candidate.parse_error_message}
        {candidate.parse_warnings.map((w) => (
          <span key={w} className="block text-warning-ink">{w}</span>
        ))}
      </p>
    ),
  });
  items.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line">
      {items.map((item, i) => (
        <li key={i} className="relative flex gap-3.5">
          <span className={cn("relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-canvas", item.tone)}>
            <item.icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[13px] font-semibold text-ink">{item.title}</div>
            <p className="tabular mt-0.5 text-xs text-subtle">{formatDateTime(item.at)}</p>
            {item.body && <div className="mt-1.5 space-y-1 text-[13px] leading-5 text-muted">{item.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DecisionTab({ candidate }: { candidate: CandidateDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
      <Card className="p-5">
        <h3 className="type-section">Recruiter decision</h3>
        <p className="type-meta mb-4 mt-1">Stored as a separate layer. The original assessment is never changed.</p>
        <DecisionForm candidate={candidate} />
      </Card>
      <Card className="p-5">
        <h3 className="type-section mb-4 flex items-center gap-2">
          <History className="size-4 text-muted" /> Decision history & audit trail
        </h3>
        <AuditTrail candidate={candidate} />
      </Card>
    </div>
  );
}
