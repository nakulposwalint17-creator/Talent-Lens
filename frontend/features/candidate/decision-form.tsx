"use client";

import { Ban, Bot, CircleHelp, PauseCircle, UserCheck, UserRoundPen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { InlineNotice } from "@/components/shared/states";
import { DecisionBadge, RecommendationBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { ALIGNED_DECISIONS, DECISION_LABELS, formatScore, RECOMMENDATION_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateSummary, Decision } from "@/types/api";

import { useCandidateActions } from "./context";

const OPTIONS: { value: Decision; label: string; hint: string; icon: typeof UserCheck; active: string }[] = [
  { value: "advance", label: "Advance", hint: "Move to the next stage", icon: UserCheck, active: "border-success bg-success-soft ring-success/20" },
  { value: "hold", label: "Hold", hint: "Keep under consideration", icon: PauseCircle, active: "border-ink-soft bg-surface-muted ring-ink/10" },
  { value: "reject", label: "Reject", hint: "Do not progress · reason required", icon: Ban, active: "border-danger bg-danger-soft ring-danger/20" },
  { value: "needs_review", label: "Needs review", hint: "Flag for further human review", icon: CircleHelp, active: "border-warning bg-warning-soft ring-warning/20" },
];

export function DecisionForm({ candidate, onRecorded }: { candidate: CandidateSummary; onRecorded?: () => void }) {
  const { refresh } = useCandidateActions();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ev = candidate.evaluation;
  const aiRec = ev && ev.status === "completed" ? ev.recommendation : null;
  const isOverride = !!decision && !!aiRec && !ALIGNED_DECISIONS[aiRec].includes(decision);
  const reasonRequired =
    !!decision && (isOverride || decision === "reject" || (!aiRec && decision !== "needs_review"));
  const busy = candidate.evaluation_status === "queued" || candidate.evaluation_status === "running";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!decision) return setError("Choose a decision.");
    if (reasonRequired && !reason.trim()) return setError("Please record a reason for this decision.");
    setError(null);
    setSubmitting(true);
    try {
      await api.recordDecision(candidate.id, { decision, reason: reason.trim() || undefined, notes: notes.trim() || undefined });
      toast.success(`Recruiter decision recorded: ${DECISION_LABELS[decision]}`, {
        description: isOverride ? "Saved as an override. The original assessment is unchanged." : "Saved to the audit trail.",
      });
      setDecision(null);
      setReason("");
      setNotes("");
      onRecorded?.();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      toast.error("Couldn't record the decision", { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface-muted/60 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">
            <Bot className="size-3.5" /> AI recommendation
          </p>
          <div className="mt-2 flex items-center gap-2">
            {aiRec ? (
              <>
                <RecommendationBadge value={aiRec} />
                <span className="tabular text-sm font-semibold text-ink">{formatScore(ev?.overall_score)}</span>
              </>
            ) : (
              <span className="text-[13px] text-muted">No completed assessment</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">
            <UserRoundPen className="size-3.5" /> Current recruiter decision
          </p>
          <div className="mt-2">
            {candidate.decision ? (
              <DecisionBadge decision={candidate.decision.decision} override={candidate.decision.is_override} />
            ) : (
              <span className="text-[13px] text-muted">None recorded</span>
            )}
          </div>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink">{candidate.decision ? "Record a new decision" : "Your decision"}</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map(({ value, label, hint, icon: Icon, active }) => {
            const selected = decision === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDecision(value)}
                disabled={busy}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] hover:border-line-strong disabled:opacity-50",
                  selected && `ring-[3px] ${active}`,
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {isOverride && aiRec && (
        <InlineNotice tone="warning" icon={UserRoundPen} title="This is an override">
          It differs from the AI recommendation ({RECOMMENDATION_LABELS[aiRec]}). Both are kept: the original assessment stays visible and
          your decision and reason are added to the audit trail.
        </InlineNotice>
      )}

      {decision && (
        <div className="grid gap-4 animate-fade-in">
          <div className="grid gap-1.5">
            <Label htmlFor="decision-reason">
              Reason {reasonRequired ? <span className="text-danger">*</span> : <span className="font-normal text-subtle">(optional)</span>}
            </Label>
            <Textarea
              id="decision-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!error && reasonRequired && !reason.trim() ? true : undefined}
              placeholder="Job-related reason, e.g. 'Verified Kubernetes experience in phone screen.'"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="decision-notes">
              Notes <span className="font-normal text-subtle">(optional)</span>
            </Label>
            <Textarea id="decision-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything colleagues should know" />
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!decision || busy} loading={submitting}>
          Record decision
        </Button>
      </div>
    </form>
  );
}

