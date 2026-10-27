"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PenLine, Sparkles } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { InlineNotice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError } from "@/components/ui/primitives";
import { CriteriaEditor } from "@/features/job-setup/criteria-editor";
import { requirementsSchema, weightsSchema } from "@/features/job-setup/schema";
import { WeightsEditor } from "@/features/job-setup/weights-editor";
import { WeightsBar } from "@/features/settings/weights-bar";
import { api, errorMessage } from "@/lib/api";
import { formatYears } from "@/lib/format";
import type { SessionDetail } from "@/types/api";

const editSchema = z.object({ requirements: requirementsSchema, weights: weightsSchema });
type EditValues = z.infer<typeof editSchema>;

function TermList({ items, empty, tone = "neutral" }: { items: string[]; empty: string; tone?: "neutral" | "accent" }) {
  if (!items.length) return <p className="text-[13px] text-subtle">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Badge key={s} tone={tone} className="px-2 py-1 text-[12.5px]">{s}</Badge>
      ))}
    </div>
  );
}

function EditCriteriaDialog({
  session,
  open,
  onOpenChange,
  onSaved,
}: {
  session: SessionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: { requirements: session.requirements, weights: session.scoring_config.weights },
  });
  const evaluated = session.counts.evaluated > 0;

  const save = form.handleSubmit(async (values) => {
    try {
      await api.updateRequirements(session.id, { requirements: values.requirements, scoring_weights: values.weights });
      toast.success("Criteria updated", {
        description: evaluated ? "Existing evaluations were kept and marked as based on earlier criteria." : undefined,
      });
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error("Couldn't save criteria", { description: errorMessage(error) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit screening criteria" description="Changes apply to future evaluations. Nothing already saved is overwritten." className="max-w-2xl">
        <form onSubmit={save} noValidate>
          <div className="grid gap-6 px-5 py-5">
            {evaluated && (
              <InlineNotice tone="warning" icon={Sparkles}>
                {session.counts.evaluated} candidate(s) were evaluated with the current criteria. Their results stay in the audit trail; you
                can re-evaluate them against the new criteria afterwards.
              </InlineNotice>
            )}
            <CriteriaEditor control={form.control} errors={form.formState.errors.requirements} resetKey={open ? 1 : 0} />
            <div>
              <p className="mb-3 text-[13px] font-medium text-ink">Scoring weights</p>
              <Controller control={form.control} name="weights" render={({ field }) => <WeightsEditor value={field.value} onChange={field.onChange} />} />
              <FieldError>{form.formState.errors.weights?.root?.message ?? form.formState.errors.weights?.message}</FieldError>
            </div>
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Save criteria</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CriteriaPanel({
  session,
  onSaved,
  editOpen,
  setEditOpen,
}: {
  session: SessionDetail;
  onSaved: () => Promise<unknown>;
  editOpen: boolean;
  setEditOpen: (open: boolean) => void;
}) {
  const [showJd, setShowJd] = useState(false);
  const r = session.requirements;
  const busy = session.counts.in_progress > 0;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Confirmed criteria</CardTitle>
            <CardDescription>
              Version {session.requirements_version} · {session.requirements_source === "extracted" ? "extracted, then reviewed and confirmed" : "entered and confirmed"} by the recruiter
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditOpen(true)} disabled={busy}>
            <PenLine /> Edit criteria
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Required skills</p>
            <TermList items={r.required_skills} empty="None" tone="accent" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Preferred skills</p>
            <TermList items={r.preferred_skills} empty="None — the preferred-qualifications criterion is not used." />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Minimum relevant experience</p>
              <p className="text-sm text-ink">{r.min_years_experience !== null ? formatYears(r.min_years_experience) : `Not set (reference: ${session.scoring_config.experience_reference_years} yrs)`}</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Experience focus</p>
              <TermList items={r.experience_focus} empty="Not set" />
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Required qualifications</p>
              {r.qualifications.length ? (
                <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-ink-soft">{r.qualifications.map((q) => <li key={q}>{q}</li>)}</ul>
              ) : (
                <p className="text-[13px] text-subtle">None</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Additional criteria</p>
              {r.additional_criteria.length ? (
                <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 text-ink-soft">{r.additional_criteria.map((q) => <li key={q}>{q}</li>)}</ul>
              ) : (
                <p className="text-[13px] text-subtle">None</p>
              )}
            </div>
          </div>
          {session.job_description && (
            <div className="border-t border-line pt-4">
              <Button variant="link" size="sm" onClick={() => setShowJd((s) => !s)} aria-expanded={showJd}>
                {showJd ? "Hide" : "Show"} original job description
              </Button>
              {showJd && (
                <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-4 font-sans text-[13px] leading-6 text-ink-soft">
                  {session.job_description}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <div>
            <CardTitle className="text-sm">Scoring for this screening</CardTitle>
            <CardDescription className="font-mono text-xs">{session.scoring_config.version}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <WeightsBar weights={session.scoring_config.weights} />
          <dl className="mt-4 grid gap-1.5 border-t border-line pt-3 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Strong match</dt><dd className="tabular text-ink">≥ {session.scoring_config.strong_threshold}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Potential match</dt><dd className="tabular text-ink">{session.scoring_config.potential_threshold} – {(session.scoring_config.strong_threshold - 0.1).toFixed(1)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Lower evidence-based match</dt><dd className="tabular text-ink">&lt; {session.scoring_config.potential_threshold}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Min. evidence completeness</dt><dd className="tabular text-ink">{session.scoring_config.min_evidence_completeness * 100}%</dd></div>
          </dl>
        </CardContent>
      </Card>
      <EditCriteriaDialog session={session} open={editOpen} onOpenChange={setEditOpen} onSaved={onSaved} />
    </div>
  );
}
