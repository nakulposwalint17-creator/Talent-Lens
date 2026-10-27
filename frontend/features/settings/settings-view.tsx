"use client";

import {
  Calculator,
  Database,
  FileCheck2,
  FlaskConical,
  Gauge,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Split,
  UserRoundPen,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, InlineNotice } from "@/components/shared/states";
import { Collapsible } from "@/components/ui/form-controls";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { CRITERION_LABELS, CRITERION_ORDER } from "@/lib/format";

import { WeightsBar } from "./weights-bar";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-ink-soft">
          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-subtle" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Topic({
  icon: Icon,
  title,
  summary,
  children,
  defaultOpen,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <li>
      <Collapsible
        defaultOpen={defaultOpen}
        headerClassName="px-5 py-4 transition-colors hover:bg-surface-hover sm:px-6"
        title={
          <span className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="type-section block">{title}</span>
              <span className="type-meta mt-0.5 block">{summary}</span>
            </span>
          </span>
        }
      >
        <div className="px-5 pb-5 pl-12 sm:px-6 sm:pl-[52px]">{children}</div>
      </Collapsible>
    </li>
  );
}

export function SettingsView() {
  const { data, error, refresh } = useApi("config", api.config);
  return (
    <>
      <PageHeader
        eyebrow={<span>Methodology</span>}
        title="How TalentLens assesses candidates"
        description="The live configuration of this workspace, in plain language. Weights can be adjusted per screening; the provider and limits are set by whoever runs the application."
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refresh()} />
      ) : !data ? (
        <div className="grid gap-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              <Topic icon={Calculator} title="How scores are calculated" defaultOpen
                summary="Four weighted criteria, combined by application code — never by a model.">
                <WeightsBar weights={data.scoring.weights} />
                <p className="mt-4 rounded-lg bg-surface-muted px-4 py-3 font-mono text-[12.5px] leading-6 text-ink-soft">
                  overall = {CRITERION_ORDER.map((k) => `${(data.scoring.weights[k] / 100).toFixed(2)} × ${CRITERION_LABELS[k].toLowerCase()}`).join(" + ")}
                </p>
                <p className="type-body mt-3">
                  Each criterion is scored 0–100 from resume evidence. The weights are product defaults, not universal hiring standards —
                  adjust them per screening when a role calls for it. Weights are renormalised over the criteria that could actually be assessed.
                </p>
                <p className="type-meta mt-2">Scoring version <span className="font-mono">{data.scoring.version}</span></p>
              </Topic>

              <Topic icon={Gauge} title="What the recommendations mean"
                summary="Bands that describe the strength of documented evidence — never a hiring decision.">
                <dl className="grid gap-2 text-[13px]">
                  {[
                    ["Strong match", `${data.scoring.strong_threshold} – 100`, "bg-success"],
                    ["Potential match", `${data.scoring.potential_threshold} – ${(data.scoring.strong_threshold - 0.1).toFixed(1)}`, "bg-accent"],
                    ["Lower evidence-based match", `below ${data.scoring.potential_threshold}`, "bg-[var(--chart-neutral)]"],
                    ["Insufficient evidence", `under ${data.scoring.min_evidence_completeness * 100}% of weight assessable`, "bg-warning"],
                  ].map(([label, range, color]) => (
                    <div key={label} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                      <span className={`size-2 rounded-full ${color}`} aria-hidden />
                      <dt className="flex-1 font-medium text-ink">{label}</dt>
                      <dd className="tabular text-muted">{range}</dd>
                    </div>
                  ))}
                </dl>
                <p className="type-meta mt-3">A lower score never rejects a candidate automatically. Insufficient-evidence candidates are listed for human review, not ranked.</p>
              </Topic>

              <Topic icon={FileCheck2} title="How missing evidence is handled"
                summary="“Not found in the resume” never means “the candidate lacks it”.">
                <Bullets items={data.missing_evidence_policy} />
              </Topic>

              <Topic icon={UserRoundPen} title="How recruiter decisions work"
                summary="You decide. Decisions are a separate layer with a full audit trail.">
                <Bullets
                  items={[
                    "Record Advance, Hold, Reject or Needs review for any candidate — from the shortlist menu or the evidence panel.",
                    "A decision that differs from the recommendation is an override and requires a reason. Rejections, and decisions on resumes without an assessment, also require a reason.",
                    "The original assessment is never changed. Both layers are shown side by side, and every decision is kept with its reason, notes and time.",
                    "If criteria change later, earlier assessments are kept and marked; re-evaluating adds a new assessment rather than replacing the old one.",
                  ]}
                />
              </Topic>

              <Topic icon={Split} title="How duplicates are detected"
                summary={`Three checks; near-duplicate threshold ${data.duplicates.near_duplicate_threshold}.`}>
                <Bullets items={data.duplicates.methods} />
                <p className="type-meta mt-3">Records are never merged. You can confirm or dismiss each match, and change your mind later.</p>
              </Topic>

              <Topic icon={ScanLine} title="Files, limits and OCR"
                summary={`PDF and DOCX up to ${data.limits.max_upload_mb} MB · OCR ${data.ocr_supported ? "supported" : "not supported"}.`}>
                <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-[13.5px]">
                  <dt className="text-muted">Formats</dt><dd className="text-ink">PDF, DOCX — checked by file content, not extension</dd>
                  <dt className="text-muted">Max file size</dt><dd className="tabular text-ink">{data.limits.max_upload_mb} MB</dd>
                  <dt className="text-muted">Files per upload</dt><dd className="tabular text-ink">{data.limits.max_files_per_request}</dd>
                  <dt className="text-muted">PDF pages read</dt><dd className="tabular text-ink">First {data.limits.max_pdf_pages}</dd>
                  <dt className="text-muted">Scanned PDFs</dt><dd className="text-ink">{data.ocr_supported ? "Read with OCR" : "Flagged for manual review — OCR is not supported"}</dd>
                </dl>
              </Topic>

              <Topic icon={Database} title="Where data is stored" summary="Locally, on the machine running TalentLens.">
                <Bullets items={data.data_handling} />
              </Topic>

              <Topic icon={ShieldAlert} title="Limitations" summary="What this tool can't do, stated plainly.">
                <Bullets items={data.limitations} />
              </Topic>
            </ul>
          </Card>

          <aside className="grid content-start gap-4 lg:sticky lg:top-10">
            <Card className="p-5">
              <p className="type-eyebrow">Active provider</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={data.provider.mode === "live" ? "accent" : "warning"}>
                  {data.provider.mode === "live" ? <Sparkles /> : <FlaskConical />}
                  {data.provider.mode === "live" ? "Live AI mode" : "Demo mode"}
                </Badge>
                {data.provider.model && <Badge tone="outline" className="font-mono">{data.provider.model}</Badge>}
              </div>
              <p className="type-body mt-3">
                {data.provider.mode === "live"
                  ? "Assessments come from the Anthropic API. Output is validated against a strict schema and every quote is checked against the resume before the application scores it."
                  : "No AI model is called. Assessments come from transparent keyword, section and date rules over the real resume text, then go through the same verification and scoring as live mode."}
              </p>
              {data.provider.warning && <InlineNotice tone="warning" icon={ShieldAlert} className="mt-3">{data.provider.warning}</InlineNotice>}
            </Card>
            <Card className="p-5">
              <p className="type-eyebrow">Responsible use</p>
              <p className="type-body mt-3">
                TalentLens supports human judgement. It has not been audited for bias or legal compliance, and it assesses only
                job-related evidence — never age, gender, ethnicity, religion, disability, family status, photographs or names.
              </p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
