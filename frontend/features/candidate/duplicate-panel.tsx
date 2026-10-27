"use client";

import { CheckCircle2, RotateCcw, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import type { CandidateDetail, DuplicateResolution } from "@/types/api";

import { useCandidateActions } from "./context";

const STATUS_TEXT: Record<string, string> = {
  exact_file: "Identical file",
  exact_text: "Identical content (different file or format)",
  near_duplicate: "Near-duplicate",
};

const RESOLUTION_TEXT: Record<DuplicateResolution, string> = {
  unreviewed: "Not reviewed",
  confirmed_duplicate: "Confirmed duplicate",
  not_duplicate: "Marked as distinct",
};

export function DuplicatePanel({ candidate }: { candidate: CandidateDetail }) {
  const { refresh, openCandidate } = useCandidateActions();
  const [pending, setPending] = useState<DuplicateResolution | null>(null);
  const d = candidate.duplicate;

  const resolve = async (resolution: DuplicateResolution) => {
    setPending(resolution);
    try {
      await api.resolveDuplicate(candidate.id, resolution);
      toast.success(
        resolution === "not_duplicate" ? "Marked as a distinct candidate" : resolution === "confirmed_duplicate" ? "Duplicate confirmed" : "Duplicate review reset",
        { description: "The original records are preserved; this can be changed at any time." },
      );
      await refresh();
    } catch (error) {
      toast.error("Couldn't update duplicate status", { description: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      {d.status !== "unique" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
            <Badge tone={d.status === "near_duplicate" ? "warning" : "neutral"}>{STATUS_TEXT[d.status]}</Badge>
            of
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => d.duplicate_of_id && openCandidate(d.duplicate_of_id)}>
              {d.duplicate_of_label}
            </button>
            {d.similarity !== null && d.status === "near_duplicate" && (
              <span className="tabular text-muted">· {(d.similarity * 100).toFixed(1)}% similar</span>
            )}
          </div>
          <dl className="grid gap-1 text-xs text-muted sm:grid-cols-[110px_1fr]">
            <dt>Detection method</dt>
            <dd className="text-ink-soft">{d.method}</dd>
            <dt>Review status</dt>
            <dd className="text-ink-soft">{RESOLUTION_TEXT[d.resolution]}</dd>
            <dt>Ranking</dt>
            <dd className="text-ink-soft">{d.excluded_from_ranking ? "Excluded from ranking and unique-candidate counts" : "Included in ranking"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {d.resolution !== "confirmed_duplicate" && (
              <Button size="sm" onClick={() => void resolve("confirmed_duplicate")} loading={pending === "confirmed_duplicate"}>
                <CheckCircle2 /> Confirm duplicate
              </Button>
            )}
            {d.resolution !== "not_duplicate" && (
              <Button size="sm" onClick={() => void resolve("not_duplicate")} loading={pending === "not_duplicate"}>
                <Unlink /> Not a duplicate
              </Button>
            )}
            {d.resolution !== "unreviewed" && (
              <Button size="sm" variant="ghost" onClick={() => void resolve("unreviewed")} loading={pending === "unreviewed"}>
                <RotateCcw /> Reset review
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">Records are never merged or deleted. Distinct people can have similar resumes.</p>
        </div>
      )}
      {candidate.related_duplicates.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Other uploads matching this resume</p>
          <ul className="space-y-1.5">
            {candidate.related_duplicates.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[13px]">
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => openCandidate(r.id)}>
                  {r.label}
                </button>
                <span className="text-muted">
                  {STATUS_TEXT[r.status] ?? r.status}
                  {r.similarity !== null && r.status === "near_duplicate" ? ` · ${(r.similarity * 100).toFixed(0)}%` : ""} ·{" "}
                  {RESOLUTION_TEXT[r.resolution as DuplicateResolution] ?? r.resolution}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
