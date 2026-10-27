"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Gavel,
  Loader2,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState, InlineNotice } from "@/components/shared/states";
import { Avatar } from "@/components/shared/identity";
import { DecisionBadge, ProcessingStatus } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { candidateLabel, formatBytes } from "@/lib/format";
import type { CandidateDetail } from "@/types/api";

import { AssessmentTab } from "./assessment-tab";
import { CandidateActionsContext } from "./context";
import { DecisionTab } from "./decision-tab";
import { DuplicatePanel } from "./duplicate-panel";
import { ResumeText } from "./evidence";

type Tab = "assessment" | "resume" | "decision";

function NoAssessment({ candidate, onRetry, retrying }: { candidate: CandidateDetail; onRetry: () => void; retrying: boolean }) {
  const c = candidate;
  if (c.parse_status === "needs_ocr")
    return (
      <InlineNotice tone="warning" icon={ScanLine} title="Scanned or image-only PDF">
        No text could be extracted, so this resume cannot be assessed automatically. OCR is not supported — open the original
        file and review it manually. You can still record a decision with a reason.
      </InlineNotice>
    );
  if (c.parse_status !== "parsed")
    return (
      <InlineNotice tone="danger" icon={AlertCircle} title="This file could not be read">
        {c.parse_error_message} It has not been scored or ranked. Ask the candidate for a readable PDF or DOCX copy.
      </InlineNotice>
    );
  if (c.evaluation_status === "queued" || c.evaluation_status === "running")
    return (
      <InlineNotice tone="accent" icon={Loader2} title="Evaluation in progress">
        This page refreshes automatically when the assessment is ready.
      </InlineNotice>
    );
  if (c.evaluation_status === "failed")
    return (
      <InlineNotice tone="danger" icon={AlertCircle} title="Unable to evaluate"
        action={<Button size="sm" onClick={onRetry} loading={retrying}><RotateCcw /> Retry evaluation</Button>}>
        {c.evaluation?.error_message ?? "The evaluation failed."} This is not a negative assessment — no score was assigned.
      </InlineNotice>
    );
  if (c.evaluation_status === "skipped_duplicate")
    return (
      <Card className="p-5">
        <InlineNotice tone="neutral" icon={Copy} title="Duplicate — not evaluated separately" className="mb-4">
          This resume matches an earlier upload, so it was excluded to avoid counting the same candidate twice.
          If these are different people, mark it as not a duplicate and evaluate it.
        </InlineNotice>
        <DuplicatePanel candidate={c} />
      </Card>
    );
  return (
    <InlineNotice tone="accent" icon={Sparkles} title="Not evaluated yet"
      action={<Button size="sm" variant="primary" onClick={onRetry} loading={retrying}><Play /> Evaluate now</Button>}>
      The resume text was extracted successfully and is ready for assessment.
    </InlineNotice>
  );
}

export function CandidateDrawer({
  candidateId,
  orderedIds,
  onClose,
  onNavigate,
  onWorkspaceRefresh,
}: {
  candidateId: string | null;
  orderedIds: string[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  onWorkspaceRefresh: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState<Tab>("assessment");
  const [active, setActive] = useState<{ start: number; end: number } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [lastId, setLastId] = useState(candidateId);
  if (lastId !== candidateId) {
    setLastId(candidateId);
    setTab("assessment");
    setActive(null);
  }

  const detail = useApi(
    candidateId ? `candidate:${candidateId}` : null,
    () => api.getCandidate(candidateId!),
    (d) => (d && (d.evaluation_status === "queued" || d.evaluation_status === "running") ? 1200 : false),
  );
  const candidate = detail.data && detail.data.id === candidateId ? detail.data : undefined;

  const refresh = useCallback(async () => {
    await Promise.all([detail.refresh(), onWorkspaceRefresh()]);
  }, [detail, onWorkspaceRefresh]);

  const retry = async () => {
    if (!candidateId) return;
    setRetrying(true);
    try {
      await api.retryCandidate(candidateId);
      toast.message("Evaluation queued");
      await refresh();
    } catch (error) {
      toast.error("Couldn't start evaluation", { description: errorMessage(error) });
    } finally {
      setRetrying(false);
    }
  };

  const ranges = useMemo(() => {
    if (!candidate?.result) return [];
    const r = candidate.result;
    const all = [
      ...r.criteria.flatMap((c) => c.evidence),
      ...r.skills.flatMap((s) => s.evidence),
      ...r.checks.flatMap((c) => c.evidence),
    ];
    return all.filter((e) => e.verified && e.start !== null && e.end !== null).map((e) => ({ start: e.start!, end: e.end! }));
  }, [candidate]);

  const index = candidateId ? orderedIds.indexOf(candidateId) : -1;
  const prev = index > 0 ? orderedIds[index - 1] : null;
  const next = index >= 0 && index < orderedIds.length - 1 ? orderedIds[index + 1] : null;
  const label = candidate ? candidateLabel(candidate) : "Candidate";

  return (
    <Sheet open={!!candidateId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title={label}>
        <CandidateActionsContext.Provider value={{ refresh, openCandidate: onNavigate }}>
          <header className="relative isolate flex items-center gap-3 overflow-hidden border-b border-line bg-surface px-5 py-4 sm:px-6">
            <div aria-hidden className="ambient pointer-events-none absolute inset-0 -z-10" />
            {candidate ? <Avatar label={label} size="lg" muted={candidate.rank === null} /> : <Skeleton className="size-11 rounded-full" />}
            <div className="min-w-0 flex-1">
              {candidate ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink" data-testid="drawer-title">{label}</h2>
                    {candidate.rank && <Badge tone="ink">#{candidate.rank}</Badge>}
                    <ProcessingStatus candidate={candidate} />
                    {candidate.decision && <DecisionBadge decision={candidate.decision.decision} override={candidate.decision.is_override} />}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <FileText className="size-3.5" /> {candidate.original_filename} · {formatBytes(candidate.file_size)}
                    {candidate.detected_format && ` · ${candidate.detected_format.toUpperCase()}`}
                    <span className="text-subtle"> · {candidate.session_job_title}</span>
                  </p>
                </>
              ) : (
                <>
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="mt-1.5 h-3.5 w-64" />
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Tooltip content="Previous candidate">
                <Button variant="ghost" size="icon-sm" aria-label="Previous candidate" disabled={!prev} onClick={() => prev && onNavigate(prev)}>
                  <ChevronLeft />
                </Button>
              </Tooltip>
              <Tooltip content="Next candidate">
                <Button variant="ghost" size="icon-sm" aria-label="Next candidate" disabled={!next} onClick={() => next && onNavigate(next)}>
                  <ChevronRight />
                </Button>
              </Tooltip>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close candidate details">
                  <X />
                </Button>
              </SheetClose>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {detail.error && !candidate ? (
              <div className="p-5">
                <ErrorState error={detail.error} onRetry={() => void detail.refresh()} />
              </div>
            ) : !candidate ? (
              <div className="grid gap-4 p-5">
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <div className="sticky top-0 z-10 bg-canvas/95 px-5 pt-2 backdrop-blur sm:px-6">
                  <TabsList>
                    <TabsTrigger value="assessment"><span className="sm:hidden">Assessment</span><span className="hidden sm:inline">Assessment & evidence</span></TabsTrigger>
                    <TabsTrigger value="resume" disabled={!candidate.extracted_text}><span className="sm:hidden">Resume</span><span className="hidden sm:inline">Resume text</span></TabsTrigger>
                    <TabsTrigger value="decision">
                      <Gavel className="hidden sm:block" /> <span className="sm:hidden">Decision</span><span className="hidden sm:inline">Decision & history</span>
                      {candidate.decision_history.length > 0 && (
                        <span className="tabular rounded bg-surface-sunken px-1.5 text-[11px] text-muted">{candidate.decision_history.length}</span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="p-5 sm:p-6">
                  <TabsContent value="assessment">
                    {candidate.result && candidate.evaluation?.status === "completed" && candidate.evaluation_status !== "running" && candidate.evaluation_status !== "queued" ? (
                      <AssessmentTab
                        candidate={candidate}
                        onDecide={() => setTab("decision")}
                        onLocate={(range) => {
                          setActive(range);
                          setTab("resume");
                        }}
                      />
                    ) : (
                      <NoAssessment candidate={candidate} onRetry={() => void retry()} retrying={retrying} />
                    )}
                    {candidate.evaluation_history.length > 0 && candidate.evaluation_status === "failed" && candidate.evaluation_history.some((e) => e.status === "completed") && (
                      <p className="mt-3 text-xs text-muted">Earlier completed assessments remain in the audit trail.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="resume">
                    {candidate.extracted_text && (
                      <>
                        <p className="mb-3 text-xs text-muted">
                          Extracted text, shown as plain data. <mark className="evidence-mark">Highlighted</mark> passages are verified
                          evidence cited in the assessment{active ? "; the selected passage is outlined." : "."}
                        </p>
                        <ResumeText text={candidate.extracted_text} ranges={ranges} active={active} />
                      </>
                    )}
                  </TabsContent>
                  <TabsContent value="decision">
                    <DecisionTab candidate={candidate} />
                  </TabsContent>
                </div>
              </Tabs>
            )}
          </div>
        </CandidateActionsContext.Provider>
      </SheetContent>
    </Sheet>
  );
}
