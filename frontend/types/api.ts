// Types mirroring the FastAPI response models in backend/app/schemas/api.py.

export type CriterionKey = "required_skills" | "relevant_experience" | "projects" | "preferred_qualifications";
export type EvidenceStatus = "demonstrated" | "partial" | "not_found" | "ambiguous" | "not_assessable";
export type Recommendation = "strong_match" | "potential_match" | "lower_match" | "insufficient_evidence";
export type Decision = "advance" | "hold" | "reject" | "needs_review";
export type DuplicateResolution = "unreviewed" | "confirmed_duplicate" | "not_duplicate";
export type ParseStatus = "parsed" | "failed" | "needs_ocr" | "empty";
export type EvaluationStatus =
  | "not_applicable"
  | "not_started"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped_duplicate";
export type SessionStatus = "awaiting_resumes" | "ready_to_evaluate" | "evaluating" | "evaluated" | "needs_attention";

export interface ProviderInfo {
  name: string;
  mode: "demo" | "live";
  model: string | null;
  method_label: string;
  warning: string | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  database: "ok" | "error";
  provider: ProviderInfo;
  time: string;
}

export interface ScoringConfig {
  version: string;
  weights: Record<CriterionKey, number>;
  strong_threshold: number;
  potential_threshold: number;
  min_evidence_completeness: number;
  experience_reference_years: number;
}

export interface ConfigResponse {
  scoring: ScoringConfig;
  criterion_labels: Record<CriterionKey, string>;
  provider: ProviderInfo;
  limits: {
    max_upload_mb: number;
    max_files_per_request: number;
    max_pdf_pages: number;
    allowed_extensions: string[];
  };
  duplicates: { near_duplicate_threshold: number; methods: string[] };
  ocr_supported: boolean;
  missing_evidence_policy: string[];
  data_handling: string[];
  limitations: string[];
}

export interface JobRequirements {
  required_skills: string[];
  preferred_skills: string[];
  min_years_experience: number | null;
  experience_focus: string[];
  qualifications: string[];
  additional_criteria: string[];
}

export interface ExtractionNote {
  field: string;
  note: string;
}

export interface ExtractResponse {
  requirements: JobRequirements;
  suggested_title: string | null;
  notes: ExtractionNote[];
  provider: string;
  model: string | null;
  method: string;
}

export interface SessionCounts {
  total: number;
  parsed: number;
  parse_failed: number;
  evaluated: number;
  evaluation_failed: number;
  in_progress: number;
  awaiting_evaluation: number;
  needs_review: number;
  duplicates: number;
  decided: number;
  ranked: number;
}

export interface SessionSummary {
  id: string;
  job_title: string;
  department: string | null;
  created_at: string;
  updated_at: string;
  status: SessionStatus;
  counts: SessionCounts;
  top_score: number | null;
  last_activity_at: string;
  criteria_stale: boolean;
  provider_names: string[];
}

export interface SessionDetail extends SessionSummary {
  job_description: string;
  requirements: JobRequirements;
  requirements_source: string;
  requirements_version: number;
  extraction_meta: Record<string, unknown> | null;
  scoring_config: ScoringConfig;
}

export interface DuplicateInfo {
  status: "unique" | "exact_file" | "exact_text" | "near_duplicate";
  duplicate_of_id: string | null;
  duplicate_of_label: string | null;
  similarity: number | null;
  method: string | null;
  resolution: DuplicateResolution;
  excluded_from_ranking: boolean;
}

export interface CriterionPreview {
  criterion: CriterionKey;
  label: string;
  status: EvidenceStatus;
  score: number | null;
  weight: number;
  contribution: number | null;
  included: boolean;
}

export interface EvaluationSummary {
  id: string;
  attempt: number;
  status: "completed" | "failed";
  overall_score: number | null;
  recommendation: Recommendation | null;
  evidence_completeness: number | null;
  relevant_years: number | null;
  required_skills_matched: number | null;
  required_skills_total: number | null;
  preferred_skills_matched: number | null;
  preferred_skills_total: number | null;
  criteria: CriterionPreview[];
  key_skills: string[];
  missing_skills: string[];
  provider: string;
  model: string | null;
  scoring_version: string;
  stale: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface DecisionOut {
  id: string;
  decision: Decision;
  is_override: boolean;
  reason: string | null;
  notes: string | null;
  ai_recommendation: Recommendation | null;
  ai_score: number | null;
  evaluation_id: string | null;
  /** Email of the user who recorded the decision. */
  recorded_by?: string | null;
  created_at: string;
}

export interface ReviewFlag {
  code: string;
  message: string;
}

export interface CandidateSummary {
  id: string;
  session_id: string;
  rank: number | null;
  display_name: string | null;
  original_filename: string;
  detected_format: string | null;
  file_size: number;
  page_count: number | null;
  parse_status: ParseStatus;
  parse_error_code: string | null;
  parse_error_message: string | null;
  parse_warnings: string[];
  duplicate: DuplicateInfo;
  evaluation_status: EvaluationStatus;
  evaluation: EvaluationSummary | null;
  review_flags: ReviewFlag[];
  requires_review: boolean;
  decision: DecisionOut | null;
  created_at: string;
}

export interface EvidenceRecord {
  quote: string;
  kind: "exact_quote" | "paraphrase";
  note: string | null;
  verification: "verified" | "unverified" | "paraphrase";
  verified: boolean;
  start: number | null;
  end: number | null;
  page: number | null;
}

export interface CriterionResult {
  criterion: CriterionKey;
  label: string;
  status: EvidenceStatus;
  score: number | null;
  explanation: string;
  uncertainty: string | null;
  evidence: EvidenceRecord[];
}

export interface ContributionResult {
  criterion: CriterionKey;
  label: string;
  weight: number;
  effective_weight: number;
  status: EvidenceStatus;
  score: number | null;
  contribution: number | null;
  included: boolean;
  explanation: string;
}

export interface SkillResult {
  skill: string;
  kind: "required" | "preferred";
  status: EvidenceStatus;
  note: string | null;
  evidence: EvidenceRecord[];
}

export interface RoleEntry {
  title: string;
  start: string | null;
  end: string | null;
  months: number | null;
  relevant: boolean;
  quote: string | null;
}

export interface EvaluationResult {
  summary: string;
  candidate_name: string | null;
  method: string;
  criteria: CriterionResult[];
  scoring: {
    overall_score: number | null;
    recommendation: Recommendation | null;
    evidence_completeness: number;
    assessed_weight: number;
    contributions: ContributionResult[];
    notes: string[];
  };
  skills: SkillResult[];
  experience: {
    total_years: number | null;
    relevant_years: number | null;
    method: string;
    roles: RoleEntry[];
    notes: string[];
  };
  checks: { item: string; kind: "qualification" | "additional"; status: EvidenceStatus; note: string | null; evidence: EvidenceRecord[] }[];
  concerns: { category: string; description: string; evidence: EvidenceRecord[] }[];
  scoring_config: ScoringConfig;
  requirements_version: number;
}

export interface CandidateDetail extends CandidateSummary {
  extracted_text: string | null;
  result: EvaluationResult | null;
  evaluation_history: EvaluationSummary[];
  decision_history: DecisionOut[];
  related_duplicates: { id: string; label: string; status: string; similarity: number | null; resolution: string }[];
  session_job_title: string;
}

export interface SessionWorkspace {
  session: SessionDetail;
  candidates: CandidateSummary[];
}

export interface UploadItemResult {
  filename: string;
  ok: boolean;
  candidate: CandidateSummary | null;
  error: { code: string; message: string } | null;
}

export interface UploadResponse {
  results: UploadItemResult[];
  accepted: number;
  failed: number;
}

export interface EvaluateResponse {
  queued: number;
  candidate_ids: string[];
  message: string;
}

export interface AuditEvent {
  id: string;
  candidate_id: string | null;
  event_type: string;
  message: string;
  payload: Record<string, unknown> | null;
  /** Email of the user who caused the event; null for system events. */
  actor?: string | null;
  created_at: string;
}

export interface DashboardResponse {
  metrics: {
    sessions: number;
    resumes_processed: number;
    unique_candidates: number;
    evaluated: number;
    requiring_review: number;
    processing_failures: number;
    decisions_recorded: number;
  };
  recent_sessions: SessionSummary[];
  provider: ProviderInfo;
}

export type Role = "admin" | "recruiter";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface LoginResponse {
  token: string;
  token_type: "bearer";
  expires_at: string;
  user: User;
}
