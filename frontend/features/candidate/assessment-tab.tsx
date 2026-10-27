"use client";

import {
  AlertTriangle,
  Bot,
  Briefcase,
  CircleSlash,
  ClipboardCheck,
  Copy,
  Info,
  ListChecks,
  Quote,
  ShieldAlert,
  UserRoundPen,
} from "lucide-react";

import { ScoreHero } from "@/components/shared/score";
import { InlineNotice } from "@/components/shared/states";
import { DecisionBadge, EvidenceStatusBadge, RecommendationBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/form-controls";
import { Badge, Card } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import {
  CRITERION_COLORS,
  CRITERION_ORDER,
  EVIDENCE_STATUS_LABELS,
  formatDateTime,
  formatPercent,
  formatScore,
  formatYears,
  providerLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateDetail, ContributionResult, CriterionResult, EvaluationResult, SkillResult } from "@/types/api";

import { DuplicatePanel } from "./duplicate-panel";
import { EvidenceQuote, type Locate } from "./evidence";

function Section({
  icon: Icon,
  title,
  aside,
  children,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={id} className="type-section flex items-center gap-2">
          <Icon className="size-4 text-muted" /> {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Two clearly separated layers: the immutable assessment and the recruiter's decision. */
function LayeredHeader({
  candidate,
  result,
  onDecide,
}: {
  candidate: CandidateDetail;
  result: EvaluationResult;
  onDecide: () => void;
}) {
  const ev = candidate.evaluation!;
  const d = candidate.decision;
  return (
    <Card className="grid grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="type-eyebrow flex items-center gap-1.5">
            <Bot className="size-3.5 text-accent" aria-hidden />
            Original assessment · {ev.provider === "demo" ? "rule-based demo" : "AI"}
          </p>
          <Tooltip content="Recruiter decisions are stored separately and never modify this assessment.">
            <span tabIndex={0} className="type-meta">Read-only</span>
          </Tooltip>
        </div>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          <ScoreHero score={ev.overall_score} recommendation={ev.recommendation} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <RecommendationBadge value={ev.recommendation} />
              <Badge tone="outline">{formatPercent(ev.evidence_completeness)} evidence assessed</Badge>
              {candidate.rank && <Badge tone="neutral">Rank #{candidate.rank}</Badge>}
            </div>
            <p className="type-body mt-3">{result.summary}</p>
          </div>
        </div>
        <p className="type-meta mt-4 border-t border-line pt-3">
          {result.method} · {providerLabel(ev.provider, ev.model)} · <span className="whitespace-nowrap font-mono text-[11.5px]">{ev.scoring_version}</span> ·{" "}
          <span className="whitespace-nowrap">{formatDateTime(ev.created_at)}</span>
        </p>
      </div>
      <div className="border-t border-line bg-surface-muted p-5 md:border-l md:border-t-0">
        <p className="type-eyebrow flex items-center gap-1.5">
          <UserRoundPen className="size-3.5 text-ink-soft" aria-hidden /> Recruiter decision
        </p>
        {d ? (
          <div className="mt-4 space-y-2">
            <DecisionBadge decision={d.decision} override={d.is_override} />
            {d.reason && <p className="type-body">“{d.reason}”</p>}
            <p className="type-meta">Recorded {formatDateTime(d.created_at)}</p>
            <Button size="sm" variant="ghost" className="-ml-2" onClick={onDecide}>Change decision</Button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="type-body text-muted">No decision recorded yet. The assessment is a starting point for your review.</p>
            <Button size="sm" className="mt-3" onClick={onDecide}>Record decision</Button>
          </div>
        )}
      </div>
      {ev.stale && (
        <div className="border-t border-line px-5 py-3 md:col-span-2">
          <InlineNotice tone="warning" icon={AlertTriangle}>
            The job criteria changed after this assessment. Re-evaluate from the shortlist to assess against the current criteria.
          </InlineNotice>
        </div>
      )}
    </Card>
  );
}

function Breakdown({ contributions, notes }: { contributions: ContributionResult[]; notes: string[] }) {
  const ordered = CRITERION_ORDER.map((k) => contributions.find((c) => c.criterion === k)).filter(Boolean) as ContributionResult[];
  const included = ordered.filter((c) => c.included);
  const total = included.reduce((s, c) => s + (c.contribution ?? 0), 0);
  return (
    <Card className="p-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <caption className="sr-only">Score breakdown by criterion</caption>
          <thead>
            <tr className="type-eyebrow text-[10.5px]">
              <th scope="col" className="pb-2.5 font-semibold">Criterion</th>
              <th scope="col" className="pb-2.5 text-right font-semibold">
                <Tooltip content="Configured weight → weight after renormalising over the criteria that could be assessed">
                  <span tabIndex={0} className="cursor-help border-b border-dotted border-subtle">Weight</span>
                </Tooltip>
              </th>
              <th scope="col" className="w-[36%] pb-2.5 pl-5 font-semibold">Score</th>
              <th scope="col" className="pb-2.5 text-right font-semibold">Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ordered.map((c) => (
              <tr key={c.criterion} className={cn(!c.included && "text-muted")}>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-[3px]" style={{ background: CRITERION_COLORS[c.criterion] }} aria-hidden />
                    <span className="font-medium text-ink">{c.label}</span>
                  </div>
                  <p className="mt-0.5 pl-4 text-[12px] text-muted">{EVIDENCE_STATUS_LABELS[c.status]}</p>
                </td>
                <td className="tabular py-3 text-right text-ink-soft">
                  {c.weight}%
                  {c.included && c.effective_weight !== c.weight && (
                    <span className="block text-[11px] text-muted">→ {c.effective_weight.toFixed(1)}%</span>
                  )}
                </td>
                <td className="py-3 pl-5">
                  {c.included ? (
                    <div className="flex items-center gap-2.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]"
                          style={{ width: `${c.score ?? 0}%`, background: CRITERION_COLORS[c.criterion] }} />
                      </div>
                      <span className="tabular w-10 text-right text-ink">{formatScore(c.score)}</span>
                    </div>
                  ) : (
                    <span className="text-xs">Excluded — not assessable from the resume</span>
                  )}
                </td>
                <td className="tabular py-3 text-right font-semibold text-ink">{c.included ? `+${formatScore(c.contribution)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <td className="pt-3 text-ink" colSpan={3}>
                <span className="font-semibold">Overall</span>
                <span className="tabular ml-2 text-muted">= {included.map((c) => formatScore(c.contribution)).join(" + ")}</span>
              </td>
              <td className="tabular pt-3 text-right text-[16px] font-semibold text-ink">{formatScore(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
          {notes.map((n, i) => (
            <li key={i} className="type-meta flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {n}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CriterionEvidence({
  criterion,
  contribution,
  onLocate,
  terms,
  defaultOpen,
}: {
  criterion: CriterionResult;
  contribution?: ContributionResult;
  onLocate: Locate;
  terms: string[];
  defaultOpen: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <Collapsible
        defaultOpen={defaultOpen}
        headerClassName="px-5 py-3.5 transition-colors hover:bg-surface-hover"
        title={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="size-2 rounded-[3px]" style={{ background: CRITERION_COLORS[criterion.criterion] }} aria-hidden />
            <span className="text-[14px] font-semibold text-ink">{criterion.label}</span>
            <span className="tabular text-[12.5px] text-muted">
              {criterion.score !== null ? `${formatScore(criterion.score)}/100` : "not scored"}
              {contribution?.included ? ` · +${formatScore(contribution.contribution)} pts` : ""}
              {` · ${criterion.evidence.length} excerpt${criterion.evidence.length === 1 ? "" : "s"}`}
            </span>
          </span>
        }
        meta={<EvidenceStatusBadge status={criterion.status} compact />}
      >
        <div className="space-y-3 border-t border-line px-5 py-4">
          <p className="type-body">{criterion.explanation}</p>
          {criterion.uncertainty && (
            <p className="flex gap-2 text-[13px] leading-5 text-warning-ink">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {criterion.uncertainty}
            </p>
          )}
          {criterion.evidence.length ? (
            <div className="grid gap-2">
              {criterion.evidence.map((e, i) => (
                <EvidenceQuote key={i} record={e} onLocate={onLocate} terms={terms} />
              ))}
            </div>
          ) : (
            <p className="type-meta">No supporting excerpt was found in the available resume text.</p>
          )}
        </div>
      </Collapsible>
    </Card>
  );
}

function SkillList({ skills, onLocate }: { skills: SkillResult[]; onLocate: Locate }) {
  return (
    <ul className="divide-y divide-line">
      {skills.map((skill) => (
        <li key={skill.skill}>
          <Collapsible
            headerClassName={cn("py-2.5", !skill.evidence.length && "pointer-events-none [&>svg]:invisible")}
            title={
              <span className="block min-w-0">
                <span className="text-[13.5px] font-medium text-ink">{skill.skill}</span>
                {skill.evidence[0] && <span className="mt-0.5 block truncate text-xs text-muted">“{skill.evidence[0].quote}”</span>}
                {!skill.evidence.length && skill.note && <span className="mt-0.5 block text-xs text-muted">{skill.note}</span>}
              </span>
            }
            meta={<EvidenceStatusBadge status={skill.status} compact />}
          >
            <div className="space-y-2 pb-3">
              {skill.note && <p className="type-meta">{skill.note}</p>}
              {skill.evidence.map((e, i) => (
                <EvidenceQuote key={i} record={e} onLocate={onLocate} terms={[skill.skill]} compact />
              ))}
            </div>
          </Collapsible>
        </li>
      ))}
    </ul>
  );
}

function MissingEvidence({ result }: { result: EvaluationResult }) {
  const skills = result.skills.filter((s) => s.status === "not_found" || s.status === "ambiguous");
  const criteria = result.criteria.filter((c) => c.status === "ambiguous" || c.status === "not_assessable");
  const checks = result.checks.filter((c) => c.status === "not_found" || c.status === "ambiguous");
  if (!skills.length && !criteria.length && !checks.length)
    return <p className="type-meta">Every criterion had supporting evidence in the resume text.</p>;
  return (
    <Card className="p-5">
      <p className="type-body text-muted">
        These items were not established by the available resume text. That is not evidence the candidate lacks them — confirm in conversation if they matter.
      </p>
      <ul className="mt-4 space-y-2.5">
        {criteria.map((c) => (
          <li key={c.criterion} className="flex gap-2.5 text-[13px] leading-5">
            <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-medium text-ink">{c.label}</span>
              <span className="text-muted"> — {EVIDENCE_STATUS_LABELS[c.status].toLowerCase()}. {c.uncertainty ?? c.explanation}</span>
            </span>
          </li>
        ))}
        {skills.map((s) => (
          <li key={s.skill} className="flex gap-2.5 text-[13px] leading-5">
            <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-medium text-ink">{s.skill}</span>
              <span className="text-muted"> — {s.kind} skill, {s.status === "ambiguous" ? "evidence unclear" : "not found in resume"}.</span>
            </span>
          </li>
        ))}
        {checks.map((c) => (
          <li key={c.item} className="flex gap-2.5 text-[13px] leading-5">
            <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-medium text-ink">{c.item}</span>
              <span className="text-muted"> — {c.kind === "qualification" ? "required qualification" : "additional criterion"} not established.</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AssessmentTab({
  candidate,
  onLocate,
  onDecide,
}: {
  candidate: CandidateDetail;
  onLocate: Locate;
  onDecide: () => void;
}) {
  const result = candidate.result!;
  const required = result.skills.filter((s) => s.kind === "required");
  const preferred = result.skills.filter((s) => s.kind === "preferred");
  const terms = result.skills.map((s) => s.skill);
  const exp = result.experience;

  return (
    <div className="grid grid-cols-1 gap-8 [&>*]:min-w-0">
      <LayeredHeader candidate={candidate} result={result} onDecide={onDecide} />

      <Section icon={ListChecks} title="How the score was calculated" id="breakdown-heading">
        <Breakdown contributions={result.scoring.contributions} notes={result.scoring.notes} />
      </Section>

      <Section icon={Quote} title="Evidence by criterion" id="evidence-heading"
        aside={<span className="type-meta hidden sm:inline">Underlined terms match the job&apos;s skills</span>}>
        <div className="grid gap-2.5">
          {CRITERION_ORDER.map((key, i) => {
            const crit = result.criteria.find((c) => c.criterion === key);
            return crit ? (
              <CriterionEvidence key={key} criterion={crit} onLocate={onLocate} terms={terms} defaultOpen={i < 2}
                contribution={result.scoring.contributions.find((c) => c.criterion === key)} />
            ) : null;
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Section icon={ListChecks} title="Required skills"
          aside={<span className="tabular type-meta">{required.filter((s) => s.status === "demonstrated").length}/{required.length} demonstrated</span>}>
          <Card className="px-5 py-1"><SkillList skills={required} onLocate={onLocate} /></Card>
        </Section>
        <Section icon={ListChecks} title="Preferred skills">
          {preferred.length ? (
            <Card className="px-5 py-1"><SkillList skills={preferred} onLocate={onLocate} /></Card>
          ) : (
            <Card className="p-5"><p className="type-meta">This job defines no preferred skills.</p></Card>
          )}
        </Section>
      </div>

      <Section icon={CircleSlash} title="Missing or ambiguous evidence" id="missing-heading">
        <MissingEvidence result={result} />
      </Section>

      <Section icon={ShieldAlert} title="Potential concerns requiring verification" id="concerns-heading">
        {candidate.review_flags.length ? (
          <Card className="p-5">
            <ul className="space-y-2.5">
              {candidate.review_flags.map((f, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-5 text-ink-soft">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  {f.message}
                </li>
              ))}
            </ul>
            {result.concerns.some((c) => c.evidence.length) && (
              <div className="mt-4 grid gap-2 border-t border-line pt-4">
                {result.concerns.flatMap((c, i) => c.evidence.map((e, j) => <EvidenceQuote key={`${i}-${j}`} record={e} onLocate={onLocate} compact />))}
              </div>
            )}
            <p className="type-meta mt-4">Prompts for a person to check — not conclusions about the candidate. Employment gaps and career changes are never flagged.</p>
          </Card>
        ) : (
          <p className="type-meta">No potential concerns were identified.</p>
        )}
      </Section>

      <Section icon={Briefcase} title="Relevant experience">
        <Card className="p-5">
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-line">
            {[
              ["Relevant, dated", formatYears(exp.relevant_years)],
              ["Total, dated", formatYears(exp.total_years)],
              ["Roles with dates", String(exp.roles.length)],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface-muted px-3 py-2.5">
                <dt className="type-meta">{label}</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {exp.roles.length > 0 && (
            <ol className="mt-4 space-y-2">
              {exp.roles.map((role, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", role.relevant ? "bg-teal" : "bg-line-strong")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{role.title}</p>
                    <p className="tabular type-meta">{role.start} – {role.end} · {role.months ?? "?"} months</p>
                  </div>
                  <Badge tone={role.relevant ? "teal" : "outline"}>{role.relevant ? "Relevant" : "Not matched"}</Badge>
                </li>
              ))}
            </ol>
          )}
          {exp.notes.map((n, i) => (
            <p key={i} className="type-meta mt-3 flex gap-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {n}</p>
          ))}
          {exp.method && <p className="type-meta mt-3 border-t border-line pt-3">Method: {exp.method}</p>}
        </Card>
      </Section>

      {result.checks.length > 0 && (
        <Section icon={ClipboardCheck} title="Qualification and criteria checks"
          aside={<span className="type-meta hidden sm:inline">For verification — not scored</span>}>
          <Card className="divide-y divide-line">
            {result.checks.map((check, i) => (
              <div key={i} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-medium text-ink">
                    <span className="type-meta mr-1.5">{check.kind === "qualification" ? "Qualification" : "Additional"}</span>
                    {check.item}
                  </p>
                  <EvidenceStatusBadge status={check.status} compact />
                </div>
                {check.note && <p className="type-meta mt-1">{check.note}</p>}
                {check.evidence.map((e, j) => (
                  <div key={j} className="mt-2"><EvidenceQuote record={e} onLocate={onLocate} compact /></div>
                ))}
              </div>
            ))}
          </Card>
        </Section>
      )}

      {(candidate.duplicate.status !== "unique" || candidate.related_duplicates.length > 0) && (
        <Section icon={Copy} title="Duplicate review">
          <Card className="p-5"><DuplicatePanel candidate={candidate} /></Card>
        </Section>
      )}
    </div>
  );
}
