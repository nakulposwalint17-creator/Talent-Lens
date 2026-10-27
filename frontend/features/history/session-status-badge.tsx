import { Badge } from "@/components/ui/primitives";
import { SESSION_STATUS_LABELS } from "@/lib/format";
import type { SessionStatus } from "@/types/api";

const TONES: Record<SessionStatus, "neutral" | "accent" | "success" | "warning" | "outline"> = {
  awaiting_resumes: "outline",
  ready_to_evaluate: "accent",
  evaluating: "accent",
  evaluated: "success",
  needs_attention: "warning",
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge tone={TONES[status]}>
      {status === "evaluating" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {SESSION_STATUS_LABELS[status]}
    </Badge>
  );
}
