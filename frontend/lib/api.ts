import type {
  AuditEvent,
  CandidateDetail,
  ConfigResponse,
  DashboardResponse,
  Decision,
  DecisionOut,
  DuplicateResolution,
  EvaluateResponse,
  ExtractResponse,
  HealthResponse,
  JobRequirements,
  CriterionKey,
  LoginResponse,
  SessionSummary,
  SessionWorkspace,
  UploadResponse,
  User,
} from "@/types/api";

import { clearToken, getToken } from "@/lib/auth";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetworkError() {
    return this.status === 0;
  }
}

const NETWORK_MESSAGE =
  "Can't reach the TalentLens API. Make sure the backend is running (see README) and try again.";

const LOGIN_PATH = "/api/auth/login";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** A rejected or expired token signs the user out; the auth gate then shows the sign-in page. */
function handleUnauthorized(status: number, path: string) {
  if (status === 401 && path !== LOGIN_PATH) clearToken();
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0, "network_error");
  }
  handleUnauthorized(response.status, path);
  return response;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return new ApiError(
    error?.message || `Request failed (${response.status}).`,
    response.status,
    error?.code || "http_error",
    error?.details,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    return null as T;
  }
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export interface SessionCreatePayload {
  job_title: string;
  department?: string | null;
  job_description: string;
  requirements: JobRequirements;
  requirements_source: "manual" | "extracted";
  extraction_meta?: Record<string, unknown> | null;
  scoring_weights?: Record<CriterionKey, number> | null;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>(LOGIN_PATH, { method: "POST", ...json({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/auth/password", {
      method: "POST",
      ...json({ current_password: currentPassword, new_password: newPassword }),
    }),
  health: () => request<HealthResponse>("/api/health"),
  config: () => request<ConfigResponse>("/api/config"),
  dashboard: () => request<DashboardResponse>("/api/dashboard"),
  extractRequirements: (jobTitle: string, jobDescription: string) =>
    request<ExtractResponse>("/api/requirements/extract", {
      method: "POST",
      ...json({ job_title: jobTitle, job_description: jobDescription }),
    }),
  listSessions: () => request<SessionSummary[]>("/api/sessions"),
  getSession: (id: string) => request<SessionWorkspace>(`/api/sessions/${encodeURIComponent(id)}`),
  createSession: (payload: SessionCreatePayload) =>
    request<SessionWorkspace>("/api/sessions", { method: "POST", ...json(payload) }),
  updateRequirements: (
    id: string,
    payload: { requirements: JobRequirements; scoring_weights?: Record<CriterionKey, number> | null },
  ) =>
    request<SessionWorkspace>(`/api/sessions/${encodeURIComponent(id)}/requirements`, {
      method: "PUT",
      ...json(payload),
    }),
  deleteSession: (id: string) => request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  evaluate: (id: string, scope: "pending" | "stale" | "failed" | "all" = "pending", candidateIds?: string[]) =>
    request<EvaluateResponse>(`/api/sessions/${encodeURIComponent(id)}/evaluate`, {
      method: "POST",
      ...json({ scope, candidate_ids: candidateIds ?? null }),
    }),
  events: (id: string) => request<AuditEvent[]>(`/api/sessions/${encodeURIComponent(id)}/events`),
  getCandidate: (id: string) => request<CandidateDetail>(`/api/candidates/${encodeURIComponent(id)}`),
  retryCandidate: (id: string) =>
    request<EvaluateResponse>(`/api/candidates/${encodeURIComponent(id)}/evaluate`, { method: "POST" }),
  recordDecision: (id: string, payload: { decision: Decision; reason?: string; notes?: string }) =>
    request<DecisionOut>(`/api/candidates/${encodeURIComponent(id)}/decisions`, { method: "POST", ...json(payload) }),
  resolveDuplicate: (id: string, resolution: DuplicateResolution) =>
    request<CandidateDetail>(`/api/candidates/${encodeURIComponent(id)}/duplicate-resolution`, {
      method: "PUT",
      ...json({ resolution }),
    }),
  exportPath: (id: string, filter: ExportFilter = "all") =>
    `/api/sessions/${encodeURIComponent(id)}/export.csv?filter=${filter}`,
};

export type ExportFilter = "all" | "ranked" | "advanced";

/** Filename from a Content-Disposition header, restricted to safe characters. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  const name = match?.[1]?.replace(/[^\w.\-]+/g, "-");
  return name || fallback;
}

/**
 * Download the CSV export. It is fetched with the bearer token (a plain link
 * can't send one) and handed to the browser as a file.
 */
export async function downloadExport(id: string, filter: ExportFilter = "all"): Promise<string> {
  const response = await send(api.exportPath(id, filter));
  if (!response.ok) throw await errorFrom(response);
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), "talentlens-export.csv");
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been handled so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return filename;
}

/** Upload a single file with progress reporting (fetch can't report upload progress). */
export function uploadResume(
  sessionId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/resumes`;
    xhr.open("POST", `${API_BASE_URL}${path}`);
    for (const [name, value] of Object.entries(authHeaders())) xhr.setRequestHeader(name, value);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onload = () => {
      handleUnauthorized(xhr.status, path);
      const body = xhr.response as UploadResponse & { error?: { code: string; message: string } };
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(body);
      } else {
        reject(new ApiError(body?.error?.message || `Upload failed (${xhr.status}).`, xhr.status, body?.error?.code || "upload_failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_MESSAGE, 0, "network_error"));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0, "aborted"));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("files", file, file.name);
    xhr.send(form);
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
