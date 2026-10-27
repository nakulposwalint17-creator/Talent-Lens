"use client";

import { Activity, Bot, Copy, FilePlus2, ListRestart, PenLine, UserRoundPen, XCircle } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/shared/states";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const ICONS: Record<string, typeof Activity> = {
  session_created: FilePlus2,
  resume_uploaded: FilePlus2,
  evaluation_queued: ListRestart,
  evaluation_completed: Bot,
  evaluation_failed: XCircle,
  recruiter_decision: UserRoundPen,
  duplicate_reviewed: Copy,
  criteria_updated: PenLine,
};

export function ActivityPanel({ sessionId, version }: { sessionId: string; version: string }) {
  const events = useApi(`events:${sessionId}:${version}`, () => api.events(sessionId));
  if (events.error) return <ErrorState error={events.error} onRetry={() => void events.refresh()} />;
  if (!events.data)
    return (
      <Card className="space-y-3 p-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
      </Card>
    );
  if (!events.data.length)
    return <Card><EmptyState icon={Activity} title="No activity yet" description="Uploads, evaluations and decisions will appear here." /></Card>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {events.data.map((e) => {
          const Icon = ICONS[e.event_type] ?? Activity;
          return (
            <li key={e.id} className="flex items-start gap-3 px-5 py-3">
              <Icon className={`mt-0.5 size-4 shrink-0 ${e.event_type === "evaluation_failed" ? "text-danger" : "text-subtle"}`} />
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink-soft">{e.message}</p>
              <time className="tabular shrink-0 text-xs text-subtle" dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
