"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Download,
  FileUp,
  FlaskConical,
  History,
  Loader2,
  MoreHorizontal,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useBackendStatus } from "@/components/layout/backend-status";
import { useActiveScreening } from "@/components/layout/screening-context";
import { Metric } from "@/components/shared/identity";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, InlineNotice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Progress, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { CandidateDrawer } from "@/features/candidate/candidate-drawer";
import { SessionStatusBadge } from "@/features/history/session-status-badge";
import { QuickDecisionDialog } from "@/features/shortlist/quick-decision-dialog";
import { Shortlist } from "@/features/shortlist/shortlist";
import { UploadPanel } from "@/features/upload/upload-panel";
import { useApi } from "@/hooks/use-api";
import { api, downloadExport, errorMessage, type ExportFilter } from "@/lib/api";
import { formatDate, formatRelative, formatYears } from "@/lib/format";
import type { CandidateSummary, SessionDetail, SessionWorkspace } from "@/types/api";

import { ActivityPanel } from "./activity-panel";
import { CriteriaPanel } from "./criteria-panel";

type Tab = "shortlist" | "upload" | "criteria" | "activity";
const TABS: Tab[] = ["shortlist", "upload", "criteria", "activity"];

function SummaryMetrics({ ws }: { ws: SessionWorkspace }) {
  const c = ws.session.counts;
  const strong = ws.candidates.filter((x) => x.rank !== null && x.evaluation?.recommendation === "strong_match").length;
  const unable = c.parse_failed + c.evaluation_failed;
  return (
    <Card className="mb-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4">
        <div className="bg-surface px-5 py-4">
          <Metric label="Successfully evaluated" value={c.evaluated} hint={`of ${c.total} uploaded`} />
        </div>
        <div className="bg-surface px-5 py-4">
          <Metric label="Strong matches" value={strong} tone="success" hint={`${c.ranked} ranked in total`} />
        </div>
        <div className="bg-surface px-5 py-4">
          <Metric label="Needs review" value={c.needs_review} tone="warning" hint="Flags without a final decision" />
        </div>
        <div className="bg-surface px-5 py-4">
          <Metric label="Unable to evaluate" value={unable} tone="danger" hint="Unreadable files or failed evaluations" />
        </div>
      </dl>
    </Card>
  );
}

function CriteriaSummary({ session, onView }: { session: SessionDetail; onView: () => void }) {
  const r = session.requirements;
  const w = session.scoring_config.weights;
  const shown = r.required_skills.slice(0, 4);
  return (
    <span className="type-meta flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-medium text-ink-soft">Assessed against</span>
      {shown.map((s) => (
        <span key={s} className="rounded border border-line bg-surface px-1.5 py-px text-[12px] text-ink-soft">{s}</span>
      ))}
      {r.required_skills.length > shown.length && <span>+{r.required_skills.length - shown.length} required</span>}
      <span aria-hidden>·</span>
      <span>{r.preferred_skills.length} preferred</span>
      {r.min_years_experience !== null && (
        <>
          <span aria-hidden>·</span>
          <span>{formatYears(r.min_years_experience)} minimum</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="tabular">
        weights {w.required_skills}/{w.relevant_experience}/{w.projects}/{w.preferred_qualifications}
      </span>
      <button type="button" onClick={onView} className="ml-1 font-medium text-accent hover:underline">
        View criteria
      </button>
    </span>
  );
}

export function WorkspaceView() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { health } = useBackendStatus();
  const { setActive } = useActiveScreening();

  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "shortlist";
  const candidateId = searchParams.get("candidate");

  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [deciding, setDeciding] = useState<CandidateSummary | null>(null);

  const workspace = useApi(`session:${sessionId}`, () => api.getSession(sessionId), (ws) =>
    ws && ws.session.counts.in_progress > 0 ? 1200 : false,
  );
  const config = useApi("config", api.config);
  const ws = workspace.data;
  const { refresh: refreshWorkspace } = workspace;
  const refresh = useCallback(() => refreshWorkspace(), [refreshWorkspace]);

  useEffect(() => {
    if (ws) setActive({ id: ws.session.id, title: ws.session.job_title, ranked: ws.session.counts.ranked, total: ws.session.counts.total });
  }, [ws, setActive]);

  const setQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const evaluate = async (scope: "pending" | "stale" | "failed") => {
    setEvaluating(true);
    try {
      const res = await api.evaluate(sessionId, scope);
      toast[res.queued ? "message" : "info"](res.message);
      await refresh();
    } catch (error) {
      toast.error("Couldn't start evaluation", { description: errorMessage(error) });
    } finally {
      setEvaluating(false);
    }
  };

  const retryOne = async (id: string) => {
    try {
      await api.retryCandidate(id);
      toast.message("Evaluation queued");
      await refresh();
    } catch (error) {
      toast.error("Couldn't retry", { description: errorMessage(error) });
    }
  };

  const exportCsv = async (filter: ExportFilter) => {
    try {
      await downloadExport(sessionId, filter);
    } catch (error) {
      toast.error("Couldn't export the CSV", { description: errorMessage(error) });
    }
  };

  const deleteSession = async () => {
    setDeleting(true);
    try {
      await api.deleteSession(sessionId);
      setActive(null);
      toast.success("Screening deleted", { description: "All candidate data for this screening was removed." });
      router.push("/history");
    } catch (error) {
      toast.error("Couldn't delete the screening", { description: errorMessage(error) });
      setDeleting(false);
    }
  };

  if (workspace.error && !ws)
    return (
      <div className="pt-6">
        <ErrorState error={workspace.error} onRetry={() => void refresh()} />
        <div className="mt-4 text-center">
          <Button variant="link" asChild>
            <Link href="/history">Back to screening history</Link>
          </Button>
        </div>
      </div>
    );

  if (!ws)
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading screening">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-[92px] rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );

  const s = ws.session;
  const c = s.counts;
  const done = c.evaluated + c.evaluation_failed;
  const live = health?.provider.mode === "live";

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/history" className="inline-flex items-center gap-1 rounded hover:text-ink">
              <ArrowLeft className="size-3.5" /> Screenings
            </Link>
            <span className="text-line-strong" aria-hidden>/</span>
            <span>{s.department ?? "Screening"}</span>
          </>
        }
        title={s.job_title}
        description={
          <span className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <SessionStatusBadge status={s.status} />
              <span className="tabular">
                {c.total} candidate{c.total === 1 ? "" : "s"} · created {formatDate(s.created_at)} · updated {formatRelative(s.last_activity_at)}
              </span>
              {health && (
                <Tooltip content={live ? `Assessments generated by the Anthropic API (${health.provider.model}), then verified and scored by the application.` : "Assessments are generated by transparent rules over the resume text — not by an AI model."}>
                  <span tabIndex={0}>
                    <Badge tone={live ? "accent" : "warning"}>
                      {live ? <Sparkles /> : <FlaskConical />}
                      {live ? "Live AI assessments" : "Demo heuristics"}
                    </Badge>
                  </span>
                </Tooltip>
              )}
            </span>
            <CriteriaSummary session={s} onView={() => setQuery({ tab: "criteria" })} />
          </span>
        }
        actions={
          <>
            {c.awaiting_evaluation > 0 && (
              <Button variant="primary" onClick={() => void evaluate("pending")} loading={evaluating} data-testid="evaluate-button">
                <Play /> Evaluate {c.awaiting_evaluation}
              </Button>
            )}
            <Button onClick={() => setQuery({ tab: "upload" })}>
              <FileUp /> Upload
            </Button>
            {c.total === 0 ? (
              <Button disabled disabledReason="Upload resumes before exporting results">
                <Download /> Export
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button><Download /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Download CSV</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => void exportCsv("all")}>All resumes ({c.total})</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportCsv("ranked")}>Ranked shortlist ({c.ranked})</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportCsv("advanced")}>Advanced candidates only</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => { setQuery({ tab: "criteria" }); setEditOpen(true); }} disabled={c.in_progress > 0}>
                  <PenLine /> Edit criteria
                </DropdownMenuItem>
                {c.evaluation_failed > 0 && (
                  <DropdownMenuItem onSelect={() => void evaluate("failed")}><RotateCcw /> Retry failed evaluations</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)} disabled={c.in_progress > 0}>
                  <Trash2 /> Delete screening
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {c.total > 0 && <SummaryMetrics ws={ws} />}

      <div className="mb-5 grid gap-3 empty:hidden" aria-live="polite">
        {c.in_progress > 0 && (
          <InlineNotice tone="accent" icon={Loader2} className="[&_svg.notice-icon]:animate-spin"
            title={`Evaluating candidates — ${done} of ${done + c.in_progress} complete`}>
            <Progress value={(done / Math.max(1, done + c.in_progress)) * 100} label="Evaluation progress" className="mt-2 max-w-md bg-surface/70" />
            <p className="mt-1.5 text-xs">
              {live ? "Each resume is sent to the AI provider in turn." : "Rule-based demo evaluation."} Results are saved as each one completes — you can keep working.
            </p>
          </InlineNotice>
        )}
        {s.criteria_stale && c.in_progress === 0 && (
          <InlineNotice tone="warning" icon={AlertTriangle} title="Criteria changed after some evaluations"
            action={<Button size="sm" onClick={() => void evaluate("stale")} loading={evaluating}><RotateCcw /> Re-evaluate</Button>}>
            Earlier results stay in each candidate&apos;s audit trail; re-evaluating adds a new assessment against the current criteria.
          </InlineNotice>
        )}
        {c.evaluation_failed > 0 && c.in_progress === 0 && (
          <InlineNotice tone="danger" icon={AlertTriangle} title={`${c.evaluation_failed} evaluation${c.evaluation_failed === 1 ? "" : "s"} could not be completed`}
            action={<Button size="sm" onClick={() => void evaluate("failed")} loading={evaluating}><RotateCcw /> Retry failed</Button>}>
            These candidates show “Unable to evaluate” and are not ranked. Successful results are unaffected.
          </InlineNotice>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setQuery({ tab: v === "shortlist" ? null : v })}>
        <TabsList className="mb-5">
          <TabsTrigger value="shortlist"><Users /> Shortlist <span className="tabular text-xs text-muted">{c.total}</span></TabsTrigger>
          <TabsTrigger value="upload"><FileUp /> Upload</TabsTrigger>
          <TabsTrigger value="criteria"><ClipboardList /> Criteria {s.criteria_stale && <Badge tone="warning">Changed</Badge>}</TabsTrigger>
          <TabsTrigger value="activity"><History /> Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="shortlist">
          <Shortlist
            candidates={ws.candidates}
            onOpenOrdered={(id, ids) => {
              setOrderedIds(ids);
              setQuery({ candidate: id });
            }}
            handlers={{ onDecide: setDeciding, onRetry: (id) => void retryOne(id), onChanged: refresh }}
            onUploadClick={() => setQuery({ tab: "upload" })}
          />
        </TabsContent>
        <TabsContent value="upload">
          <UploadPanel
            sessionId={sessionId}
            maxUploadMb={config.data?.limits.max_upload_mb ?? 10}
            candidates={ws.candidates}
            onUploaded={refresh}
            onViewShortlist={() => setQuery({ tab: null })}
          />
        </TabsContent>
        <TabsContent value="criteria">
          <CriteriaPanel session={s} onSaved={refresh} editOpen={editOpen} setEditOpen={setEditOpen} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityPanel sessionId={sessionId} version={`${s.last_activity_at}:${c.evaluated}:${c.decided}:${c.total}`} />
        </TabsContent>
      </Tabs>

      <CandidateDrawer
        candidateId={candidateId}
        orderedIds={orderedIds.length ? orderedIds : ws.candidates.map((x) => x.id)}
        onClose={() => setQuery({ candidate: null })}
        onNavigate={(id) => setQuery({ candidate: id })}
        onWorkspaceRefresh={refresh}
      />

      <QuickDecisionDialog
        candidate={deciding}
        onClose={() => setDeciding(null)}
        onRecorded={refresh}
        onOpenEvidence={(id) => setQuery({ candidate: id })}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this screening?"
        description={
          <>
            This permanently deletes <span className="font-medium text-ink">{s.job_title}</span>, its {c.total} resume record
            {c.total === 1 ? "" : "s"}, all assessments, recruiter decisions and the audit trail. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete screening"
        destructive
        loading={deleting}
        onConfirm={() => void deleteSession()}
      />
    </>
  );
}
