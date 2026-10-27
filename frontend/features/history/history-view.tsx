"use client";

import { ChevronRight, History, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { Segmented } from "@/components/ui/controls";
import { SearchField } from "@/components/ui/form-controls";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatRelative, formatScore } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/types/api";

import { SessionStatusBadge } from "./session-status-badge";

const GRID = "md:grid md:grid-cols-[minmax(200px,2fr)_104px_110px_72px_80px_92px_150px_40px] md:items-center md:gap-4";

function Num({ value, tone }: { value: number; tone?: string }) {
  return <span className={cn("tabular text-sm", value ? tone ?? "text-ink" : "text-subtle")}>{value}</span>;
}

export function HistoryView() {
  const router = useRouter();
  const sessions = useApi("sessions", api.listSessions, (data) =>
    data?.some((s) => s.counts.in_progress > 0) ? 2000 : false,
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "attention" | "evaluated">("all");
  const [toDelete, setToDelete] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sessions.data ?? [])
      .filter((s) => !q || s.job_title.toLowerCase().includes(q) || (s.department ?? "").toLowerCase().includes(q))
      .filter((s) =>
        status === "all" ||
        (status === "active" && ["awaiting_resumes", "ready_to_evaluate", "evaluating"].includes(s.status)) ||
        (status === "attention" && s.status === "needs_attention") ||
        (status === "evaluated" && s.status === "evaluated"),
      )
      .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
  }, [sessions.data, query, status]);

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteSession(toDelete.id);
      toast.success("Screening deleted");
      setToDelete(null);
      await sessions.refresh();
    } catch (error) {
      toast.error("Couldn't delete the screening", { description: errorMessage(error) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<span>Screening history</span>}
        title="Screening history"
        description="Every screening is saved with its criteria, results and decisions. Reopening one shows exactly what was recorded — nothing is re-scored."
        actions={
          <Button variant="primary" asChild>
            <Link href="/screenings/new"><Plus /> New screening</Link>
          </Button>
        }
      />
      {sessions.error ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refresh()} />
      ) : !sessions.data ? (
        <Card className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : sessions.data.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="No saved screenings" description="Screenings you create are saved automatically and listed here."
            action={<Button variant="primary" asChild><Link href="/screenings/new"><Plus /> Create a screening</Link></Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchField value={query} onChange={setQuery} placeholder="Search by job title or department" label="Search screenings" className="sm:w-80" />
            <Segmented
              label="Filter by status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "In progress" },
                { value: "attention", label: "Needs attention" },
                { value: "evaluated", label: "Evaluated" },
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            <div className={cn("hidden border-b border-line bg-surface-muted/60 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle", GRID)}>
              <span>Job</span><span>Created</span><span>Last updated</span><span>Resumes</span><span>Evaluated</span><span>Needs review</span><span>Status</span><span />
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">No screenings match these filters.</p>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((s) => (
                  <li key={s.id} onClick={() => router.push(`/screenings/${s.id}`)}
                    className={cn("row-accent group relative cursor-pointer px-5 py-4 transition-colors duration-150 hover:bg-surface-hover", GRID)}>
                    <div className="min-w-0">
                      <Link href={`/screenings/${s.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-sm font-semibold text-ink hover:text-accent-strong">
                        {s.job_title}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {s.department ?? "No department"}{s.top_score !== null && ` · top score ${formatScore(s.top_score)}`}
                      </p>
                    </div>
                    <span className="tabular mt-2 block text-[13px] text-ink-soft md:mt-0">{formatDate(s.created_at)}</span>
                    <span className="tabular block text-[13px] text-muted">
                      <span className="md:hidden">Updated </span>{formatRelative(s.last_activity_at)}
                    </span>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted md:contents">
                      <span className="md:block"><span className="md:hidden">Resumes </span><Num value={s.counts.total} /></span>
                      <span className="md:block"><span className="md:hidden">Evaluated </span><Num value={s.counts.evaluated} /></span>
                      <span className="md:block"><span className="md:hidden">Needs review </span><Num value={s.counts.needs_review} tone="text-warning-ink" /></span>
                    </div>
                    <div className="mt-2 md:mt-0"><SessionStatusBadge status={s.status} /></div>
                    <div className="absolute right-3 top-3 flex items-center md:static">
                      <Tooltip content="Delete screening">
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${s.job_title}`}
                          onClick={(e) => { e.stopPropagation(); setToDelete(s); }}
                          className="opacity-60 hover:text-danger group-hover:opacity-100">
                          <Trash2 />
                        </Button>
                      </Tooltip>
                      <ChevronRight className="hidden size-4 text-subtle md:hidden" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this screening?"
        description={<>This permanently deletes <span className="font-medium text-ink">{toDelete?.job_title}</span> and all of its resumes, assessments, decisions and audit history.</>}
        confirmLabel="Delete screening"
        destructive
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </>
  );
}
