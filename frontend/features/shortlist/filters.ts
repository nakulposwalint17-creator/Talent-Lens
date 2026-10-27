import { candidateLabel } from "@/lib/format";
import type { CandidateSummary, Recommendation } from "@/types/api";

export type RecFilter = "all" | Recommendation | "unable";
export type ReviewFilter = "all" | "needs_review" | "awaiting" | "advance" | "hold" | "reject" | "marked_review";
export type ProcessingFilter = "all" | "evaluated" | "pending" | "problems";
export type DuplicateFilter = "all" | "only" | "hide";
export type SortKey = "rank" | "experience" | "name" | "uploaded";
export type SortDir = "asc" | "desc";

export interface Filters {
  query: string;
  rec: RecFilter;
  review: ReviewFilter;
  processing: ProcessingFilter;
  duplicates: DuplicateFilter;
}

export const EMPTY_FILTERS: Filters = { query: "", rec: "all", review: "all", processing: "all", duplicates: "all" };

export const FILTER_OPTIONS = {
  rec: [
    { value: "all", label: "Any recommendation" },
    { value: "strong_match", label: "Strong match" },
    { value: "potential_match", label: "Potential match" },
    { value: "lower_match", label: "Lower evidence-based match" },
    { value: "insufficient_evidence", label: "Insufficient evidence" },
    { value: "unable", label: "Unable to evaluate" },
  ],
  review: [
    { value: "all", label: "Any review status" },
    { value: "needs_review", label: "Has review flags" },
    { value: "awaiting", label: "Awaiting decision" },
    { value: "advance", label: "Advanced" },
    { value: "hold", label: "On hold" },
    { value: "reject", label: "Rejected" },
    { value: "marked_review", label: "Marked needs review" },
  ],
  processing: [
    { value: "all", label: "Any processing status" },
    { value: "evaluated", label: "Evaluated" },
    { value: "pending", label: "Not evaluated yet" },
    { value: "problems", label: "Unreadable or failed" },
  ],
  duplicates: [
    { value: "all", label: "Include duplicates" },
    { value: "only", label: "Duplicates only" },
    { value: "hide", label: "Hide duplicates" },
  ],
} as const;

export const FILTER_GROUP_LABELS: Record<Exclude<keyof Filters, "query">, string> = {
  rec: "Recommendation",
  review: "Review status",
  processing: "Processing",
  duplicates: "Duplicates",
};

export function matches(c: CandidateSummary, f: Filters): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !candidateLabel(c).toLowerCase().includes(q) && !c.original_filename.toLowerCase().includes(q)) return false;
  const evaluated = c.evaluation_status === "completed";
  const unable = c.parse_status !== "parsed" || c.evaluation_status === "failed";
  if (f.rec !== "all") {
    if (f.rec === "unable") {
      if (!unable) return false;
    } else if (!evaluated || c.evaluation?.recommendation !== f.rec) return false;
  }
  const decision = c.decision?.decision;
  switch (f.review) {
    case "needs_review":
      if (!c.requires_review) return false;
      break;
    case "awaiting":
      if (decision && decision !== "needs_review") return false;
      break;
    case "advance":
    case "hold":
    case "reject":
      if (decision !== f.review) return false;
      break;
    case "marked_review":
      if (decision !== "needs_review") return false;
      break;
  }
  if (f.processing === "evaluated" && !evaluated) return false;
  if (f.processing === "pending" && !["not_started", "queued", "running"].includes(c.evaluation_status)) return false;
  if (f.processing === "problems" && !unable) return false;
  const dup = c.duplicate.status !== "unique" && c.duplicate.resolution !== "not_duplicate";
  if (f.duplicates === "only" && !dup) return false;
  if (f.duplicates === "hide" && dup) return false;
  return true;
}

export function comparator(key: SortKey, dir: SortDir) {
  const name = (c: CandidateSummary) => candidateLabel(c).toLowerCase();
  const sign = dir === "asc" ? 1 : -1;
  return (a: CandidateSummary, b: CandidateSummary): number => {
    let primary = 0;
    switch (key) {
      case "rank":
        // Ascending rank = best first. Unranked always last.
        primary = (a.rank ?? 1e9) - (b.rank ?? 1e9);
        if (a.rank !== null && b.rank !== null) primary *= sign;
        break;
      case "experience": {
        const ay = a.evaluation?.relevant_years;
        const by = b.evaluation?.relevant_years;
        if (ay == null && by == null) primary = 0;
        else if (ay == null) primary = 1;
        else if (by == null) primary = -1;
        else primary = (ay - by) * sign;
        break;
      }
      case "name":
        primary = name(a).localeCompare(name(b)) * sign;
        break;
      case "uploaded":
        primary = a.created_at.localeCompare(b.created_at) * sign;
        break;
    }
    return primary || name(a).localeCompare(name(b)) || a.id.localeCompare(b.id);
  };
}
