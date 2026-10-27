import type {
  CandidateSummary,
  CriterionKey,
  Decision,
  EvidenceStatus,
  Recommendation,
  SessionStatus,
} from "@/types/api";

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  required_skills: "Required skills",
  relevant_experience: "Relevant experience",
  projects: "Projects & demonstrated work",
  preferred_qualifications: "Preferred qualifications",
};

export const CRITERION_SHORT: Record<CriterionKey, string> = {
  required_skills: "Required",
  relevant_experience: "Experience",
  projects: "Projects",
  preferred_qualifications: "Preferred",
};

export const CRITERION_ORDER: CriterionKey[] = [
  "required_skills",
  "relevant_experience",
  "projects",
  "preferred_qualifications",
];

export { CRITERION_COLORS } from "@/lib/tokens";

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_match: "Strong match",
  potential_match: "Potential match",
  lower_match: "Lower evidence-based match",
  insufficient_evidence: "Insufficient evidence",
};

export const RECOMMENDATION_SHORT: Record<Recommendation, string> = {
  strong_match: "Strong match",
  potential_match: "Potential match",
  lower_match: "Lower match",
  insufficient_evidence: "Insufficient evidence",
};

export const DECISION_LABELS: Record<Decision, string> = {
  advance: "Advance",
  hold: "Hold",
  reject: "Reject",
  needs_review: "Needs review",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  demonstrated: "Demonstrated",
  partial: "Partially demonstrated",
  not_found: "Not found in resume",
  ambiguous: "Ambiguous",
  not_assessable: "Not assessable",
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  awaiting_resumes: "Awaiting resumes",
  ready_to_evaluate: "Ready to evaluate",
  evaluating: "Evaluating",
  evaluated: "Evaluated",
  needs_attention: "Needs attention",
};

/** Decisions consistent with each AI recommendation (mirrors backend/app/services/decisions.py). */
export const ALIGNED_DECISIONS: Record<Recommendation, Decision[]> = {
  strong_match: ["advance"],
  potential_match: ["advance", "hold"],
  lower_match: ["hold", "reject"],
  insufficient_evidence: ["needs_review"],
};

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "—" : score.toFixed(1);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function formatYears(years: number | null | undefined): string {
  if (years === null || years === undefined) return "—";
  return `${years % 1 === 0 ? years.toFixed(0) : years.toFixed(1)} yr${years === 1 ? "" : "s"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export function candidateLabel(c: Pick<CandidateSummary, "display_name" | "original_filename">): string {
  return c.display_name || c.original_filename;
}

export function initials(name: string): string {
  const parts = name.replace(/\.[a-z]+$/i, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function providerLabel(provider: string, model: string | null): string {
  if (provider === "demo") return "Rule-based demo";
  if (provider === "anthropic") return model ? `Anthropic · ${model}` : "Anthropic";
  if (provider === "system") return "System";
  return model ? `${provider} · ${model}` : provider;
}
