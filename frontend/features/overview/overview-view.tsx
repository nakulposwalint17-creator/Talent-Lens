"use client";

import { ArrowRight, BookOpenText, ChevronRight, ClipboardCheck, Fingerprint, Scale, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Metric } from "@/components/shared/identity";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { SessionStatusBadge } from "@/features/history/session-status-badge";
import { WeightsBar } from "@/features/settings/weights-bar";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatRelative, formatScore } from "@/lib/format";
import type { SessionSummary } from "@/types/api";

/** Real processing outcomes for a session as a thin proportional bar. */
function OutcomeBar({ session }: { session: SessionSummary }) {
  const c = session.counts;
  if (!c.total) return <span className="type-meta">No resumes yet</span>;
  const unranked = Math.max(0, c.evaluated - c.ranked);
  const parts = [
    { label: "Ranked", value: c.ranked, className: "bg-accent" },
    { label: "Evaluated, not ranked", value: unranked, className: "bg-violet" },
    { label: "Awaiting or in progress", value: c.awaiting_evaluation + c.in_progress, className: "bg-line-strong" },
    { label: "Unreadable or failed", value: c.parse_failed + c.evaluation_failed, className: "bg-danger/70" },
  ].filter((p) => p.value > 0);
  return (
    <Tooltip
      content={
        <ul className="space-y-0.5">
          {parts.map((p) => (
            <li key={p.label} className="tabular">{p.value} · {p.label}</li>
          ))}
          {c.duplicates > 0 && <li className="tabular">{c.duplicates} flagged as duplicates</li>}
        </ul>
      }
    >
      <span className="flex h-1.5 w-full max-w-[160px] gap-[2px] overflow-hidden rounded-full" tabIndex={0} aria-label={parts.map((p) => `${p.value} ${p.label}`).join(", ")}>
        {parts.map((p) => (
          <span key={p.label} className={p.className} style={{ flexGrow: p.value, flexBasis: 0 }} />
        ))}
      </span>
    </Tooltip>
  );
}

function SessionRow({ session, index }: { session: SessionSummary; index: number }) {
  const c = session.counts;
  return (
    <li style={{ "--i": index } as React.CSSProperties}>
      <Link
        href={`/screenings/${session.id}`}
        className="row-accent group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors duration-150 hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_170px_96px_auto]"
      >
        <div className="min-w-0">
          <p className="type-name truncate">{session.job_title}</p>
          <p className="type-meta mt-0.5">
            {session.department ? `${session.department} · ` : ""}
            {c.total} resume{c.total === 1 ? "" : "s"}
            {c.needs_review > 0 && <span className="text-warning-ink"> · {c.needs_review} need review</span>}
          </p>
        </div>
        <div className="hidden sm:block">
          <OutcomeBar session={session} />
          <p className="type-meta mt-1.5">Updated {formatRelative(session.last_activity_at)}</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="tabular text-sm font-semibold text-ink">{formatScore(session.top_score)}</p>
          <p className="type-meta">top score</p>
        </div>
        <div className="flex items-center gap-3">
          <SessionStatusBadge status={session.status} />
          <ChevronRight className="size-4 text-subtle transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

/** Restrained motif: a document with one line brought into focus by a lens. */
function FocusMotif() {
  return (
    <svg viewBox="0 0 160 112" className="h-24 w-auto" aria-hidden>
      <rect x="28" y="8" width="76" height="96" rx="6" fill="var(--surface)" stroke="var(--line)" />
      {[24, 34, 44, 64, 74, 84].map((y, i) => (
        <rect key={y} x="40" y={y} width={i % 3 === 2 ? 34 : 52} height="4" rx="2" fill="var(--surface-sunken)" />
      ))}
      <rect x="40" y="54" width="48" height="4" rx="2" fill="var(--accent)" opacity="0.85" />
      <circle cx="96" cy="56" r="20" fill="var(--accent-soft)" fillOpacity="0.6" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M110 70l14 14" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const STEPS = [
  { icon: ClipboardCheck, title: "Confirm the criteria", body: "Extract requirements from the posting, then review and confirm them." },
  { icon: Fingerprint, title: "Verify the evidence", body: "Every quoted excerpt is checked against the resume text." },
  { icon: Scale, title: "Score transparently", body: "Weights are applied by code; missing evidence is labelled, never assumed." },
  { icon: UserRoundCheck, title: "You decide", body: "Overrides need a reason and never erase the original assessment." },
];

function Onboarding() {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
        <div>
          <p className="type-eyebrow">Get started</p>
          <h2 className="type-title mt-2">Start your first screening</h2>
          <p className="type-body mt-2 max-w-[56ch] text-muted">
            Define the role, confirm job-related criteria, then upload PDF or DOCX resumes. Synthetic sample resumes are
            in the repository&apos;s <code className="rounded bg-surface-muted px-1 font-mono text-[12.5px]">samples/</code> folder.
          </p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3">
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface-muted text-[11px] font-semibold text-ink-soft">
                  {i + 1}
                </span>
                <div>
                  <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                    <Icon className="size-3.5 text-accent" aria-hidden /> {title}
                  </p>
                  <p className="type-meta mt-0.5">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" asChild>
              <Link href="/screenings/new">Create a screening <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="/settings"><BookOpenText /> How scoring works</Link>
            </Button>
          </div>
        </div>
        <div className="hidden justify-center md:flex">
          <FocusMotif />
        </div>
      </div>
    </Card>
  );
}

const noopSubscribe = () => () => undefined;

function greetingText() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part} · ${new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(now)}`;
}

/** Local time-of-day greeting; rendered only on the client to avoid hydration mismatches. */
function Greeting() {
  const text = useSyncExternalStore(noopSubscribe, greetingText, () => "Overview");
  return <span suppressHydrationWarning>{text}</span>;
}

export function OverviewView() {
  const dashboard = useApi("dashboard", api.dashboard);
  const config = useApi("config", api.config);
  const data = dashboard.data;
  const hasSessions = !!data && data.recent_sessions.length > 0;

  return (
    <>
      <PageHeader
        eyebrow={<Greeting />}
        title="Your hiring workspace"
        description="Turn resumes into a shortlist you can explain."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/settings"><BookOpenText /> Methodology</Link>
            </Button>
            <Button variant="primary" asChild>
              <Link href="/screenings/new">New screening</Link>
            </Button>
          </>
        }
      />

      {dashboard.error ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refresh()} />
      ) : !data ? (
        <div className="grid gap-6">
          <Skeleton className="h-[116px] rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : !hasSessions ? (
        <Onboarding />
      ) : (
        <div className="grid gap-6">
          <Card>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4">
              {[
                { label: "Screening sessions", value: data.metrics.sessions, hint: "Saved locally" },
                { label: "Resumes processed", value: data.metrics.resumes_processed, hint: `${data.metrics.processing_failures} unreadable or failed` },
                { label: "Unique candidates", value: data.metrics.unique_candidates, hint: "Duplicates excluded" },
                { label: "Requiring review", value: data.metrics.requiring_review, hint: "Flags without a final decision", tone: "warning" as const },
              ].map((m) => (
                <div key={m.label} className="bg-surface px-5 py-5">
                  <Metric label={m.label} value={m.value} hint={m.hint} tone={m.tone} />
                </div>
              ))}
            </dl>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-labelledby="recent-heading">
              <div className="mb-3 flex items-end justify-between">
                <h2 id="recent-heading" className="type-section">Recent screenings</h2>
                <Button variant="link" size="sm" asChild>
                  <Link href="/history">All screenings <ArrowRight /></Link>
                </Button>
              </div>
              <Card className="overflow-hidden">
                <ul className="stagger divide-y divide-line">
                  {data.recent_sessions.map((s, i) => (
                    <SessionRow key={s.id} session={s} index={i} />
                  ))}
                </ul>
              </Card>
            </section>

            <section aria-labelledby="method-heading">
              <h2 id="method-heading" className="type-section mb-3">How scores are built</h2>
              <Card className="p-5">
                {config.data ? <WeightsBar weights={config.data.scoring.weights} /> : <Skeleton className="h-28" />}
                <ol className="mt-5 space-y-3.5 border-t border-line pt-4">
                  {STEPS.map(({ icon: Icon, title, body }) => (
                    <li key={title} className="flex gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      <div>
                        <p className="text-[13px] font-semibold text-ink">{title}</p>
                        <p className="type-meta mt-0.5">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <Button variant="link" size="sm" className="mt-4" asChild>
                  <Link href="/settings">Read the methodology <ArrowRight /></Link>
                </Button>
              </Card>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
