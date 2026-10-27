import {
  AlertCircle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Copy,
  FileWarning,
  Loader2,
  PauseCircle,
  ScanLine,
  ShieldQuestion,
  UserCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { DECISION_LABELS, EVIDENCE_STATUS_LABELS, RECOMMENDATION_LABELS, RECOMMENDATION_SHORT } from "@/lib/format";
import type { CandidateSummary, Decision, EvidenceStatus, Recommendation } from "@/types/api";

export const RECOMMENDATION_TONE: Record<Recommendation, "success" | "accent" | "neutral" | "warning"> = {
  strong_match: "success",
  potential_match: "accent",
  lower_match: "neutral",
  insufficient_evidence: "warning",
};

export function RecommendationBadge({ value, short = false }: { value: Recommendation | null; short?: boolean }) {
  if (!value) return <span className="text-sm text-subtle">—</span>;
  return (
    <Badge tone={RECOMMENDATION_TONE[value]} title={RECOMMENDATION_LABELS[value]}>
      {value === "insufficient_evidence" && <ShieldQuestion />}
      {short ? RECOMMENDATION_SHORT[value] : RECOMMENDATION_LABELS[value]}
    </Badge>
  );
}

const DECISION_STYLE: Record<Decision, { tone: "success" | "neutral" | "danger" | "warning"; icon: typeof UserCheck }> = {
  advance: { tone: "success", icon: UserCheck },
  hold: { tone: "neutral", icon: PauseCircle },
  reject: { tone: "danger", icon: Ban },
  needs_review: { tone: "warning", icon: CircleHelp },
};

export function DecisionBadge({ decision, override }: { decision: Decision; override?: boolean }) {
  const { tone, icon: Icon } = DECISION_STYLE[decision];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={tone}>
        <Icon />
        {DECISION_LABELS[decision]}
      </Badge>
      {override && (
        <Badge tone="outline" title="Differs from the AI recommendation">
          Override
        </Badge>
      )}
    </span>
  );
}

const EVIDENCE_STYLE: Record<EvidenceStatus, { tone: "success" | "teal" | "neutral" | "warning" | "outline"; icon: typeof CheckCircle2 }> = {
  demonstrated: { tone: "success", icon: CheckCircle2 },
  partial: { tone: "teal", icon: CircleDashed },
  not_found: { tone: "neutral", icon: CircleSlash },
  ambiguous: { tone: "warning", icon: AlertCircle },
  not_assessable: { tone: "outline", icon: CircleHelp },
};

export function EvidenceStatusBadge({ status, compact }: { status: EvidenceStatus; compact?: boolean }) {
  const { tone, icon: Icon } = EVIDENCE_STYLE[status];
  const label = compact
    ? { demonstrated: "Demonstrated", partial: "Partial", not_found: "Not found", ambiguous: "Ambiguous", not_assessable: "N/A" }[status]
    : EVIDENCE_STATUS_LABELS[status];
  return (
    <Badge tone={tone}>
      <Icon />
      {label}
    </Badge>
  );
}

/** A single, prioritised processing status for a candidate row. */
export function ProcessingStatus({ candidate }: { candidate: CandidateSummary }) {
  const c = candidate;
  if (c.parse_status === "needs_ocr")
    return (
      <Badge tone="warning">
        <ScanLine /> Needs OCR / manual review
      </Badge>
    );
  if (c.parse_status !== "parsed")
    return (
      <Badge tone="danger">
        <FileWarning /> Unreadable file
      </Badge>
    );
  switch (c.evaluation_status) {
    case "queued":
      return (
        <Badge tone="neutral">
          <CircleDashed /> Queued
        </Badge>
      );
    case "running":
      return (
        <Badge tone="accent">
          <Loader2 className="animate-spin" /> Evaluating
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger">
          <AlertCircle /> Unable to evaluate
        </Badge>
      );
    case "skipped_duplicate":
      return (
        <Badge tone="neutral">
          <Copy /> Duplicate — not evaluated
        </Badge>
      );
    case "not_started":
      return <Badge tone="outline">Not evaluated yet</Badge>;
    case "completed":
      return (
        <Badge tone="success">
          <CheckCircle2 /> Evaluated
        </Badge>
      );
    default:
      return <Badge tone="outline">{c.evaluation_status}</Badge>;
  }
}

export function DuplicateBadge({ candidate }: { candidate: CandidateSummary }) {
  const d = candidate.duplicate;
  if (d.status === "unique") return null;
  if (d.resolution === "not_duplicate") return null;
  const label =
    d.status === "near_duplicate"
      ? d.resolution === "confirmed_duplicate"
        ? "Confirmed duplicate"
        : `Possible duplicate${d.similarity ? ` · ${Math.round(d.similarity * 100)}%` : ""}`
      : d.status === "exact_file"
        ? "Identical file"
        : "Identical content";
  return (
    <Badge tone={d.status === "near_duplicate" && d.resolution === "unreviewed" ? "warning" : "neutral"}>
      <Copy />
      {label}
    </Badge>
  );
}
