// Colours used from JavaScript (inline styles, SVG, Recharts). They resolve to the
// CSS custom properties in app/globals.css, so they follow the active theme.
import type { CriterionKey, Recommendation } from "@/types/api";

export const COLORS = {
  ink: "var(--ink)",
  muted: "var(--muted)",
  subtle: "var(--subtle)",
  line: "var(--line)",
  track: "var(--track)",
  accent: "var(--accent)",
  teal: "var(--teal)",
  success: "var(--success)",
  warning: "var(--warning)",
  neutral: "var(--chart-neutral)",
} as const;

export const RECOMMENDATION_COLORS: Record<Recommendation, string> = {
  strong_match: COLORS.success,
  potential_match: COLORS.accent,
  lower_match: COLORS.neutral,
  insufficient_evidence: COLORS.warning,
};

/** Two-hue system (indigo, teal) with tints, so breakdowns stay calm. */
export const CRITERION_COLORS: Record<CriterionKey, string> = {
  required_skills: "var(--crit-1)",
  relevant_experience: "var(--crit-2)",
  projects: "var(--crit-3)",
  preferred_qualifications: "var(--crit-4)",
};
