"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Copy,
  FileText,
  FileUp,
  Loader2,
  RotateCcw,
  ScanLine,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import { Checkbox } from "@/components/ui/form-controls";
import { Card } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { api, ApiError, uploadResume } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateSummary } from "@/types/api";

const ALLOWED = [".pdf", ".docx"];
const CONCURRENCY = 3;

type LocalStatus = "ready" | "invalid" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: LocalStatus;
  progress: number;
  message?: string;
  candidateId?: string;
}

function extension(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function validate(file: File, maxBytes: number): string | undefined {
  if (!ALLOWED.includes(extension(file.name)))
    return extension(file.name) === ".doc"
      ? "Legacy .doc isn't supported — save it as DOCX or PDF."
      : "Unsupported file type — upload PDF or DOCX.";
  if (file.size > maxBytes) return `Larger than the ${Math.round(maxBytes / 1048576)} MB limit.`;
  return undefined;
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
interface DisplayStatus {
  label: string;
  detail?: string;
  tone: Tone;
  icon: typeof CheckCircle2;
  spin?: boolean;
}

/** One honest status per file, combining the local upload state with the persisted server state. */
function displayStatus(item: QueueItem, c: CandidateSummary | undefined): DisplayStatus {
  if (item.status === "invalid") return { label: "Not uploaded", detail: item.message, tone: "danger", icon: AlertCircle };
  if (item.status === "error") return { label: "Upload failed", detail: item.message, tone: "danger", icon: AlertCircle };
  if (item.status === "ready") return { label: "Ready", tone: "neutral", icon: CircleDashed };
  if (item.status === "uploading")
    return item.progress >= 0.99
      ? { label: "Extracting text", detail: "Validating the file and checking for duplicates", tone: "accent", icon: Loader2, spin: true }
      : { label: `Uploading ${Math.round(item.progress * 100)}%`, tone: "accent", icon: Loader2, spin: true };
  if (!c) return { label: "Uploaded", tone: "neutral", icon: CheckCircle2 };
  if (c.parse_status === "needs_ocr")
    return { label: "Needs review", detail: "Scanned or image-only PDF — OCR isn't supported, so review it manually.", tone: "warning", icon: ScanLine };
  if (c.parse_status !== "parsed") return { label: "Failed", detail: c.parse_error_message ?? "The file could not be read.", tone: "danger", icon: AlertCircle };
  if (c.duplicate.status !== "unique" && c.duplicate.resolution !== "not_duplicate") {
    const exact = c.duplicate.status !== "near_duplicate";
    return {
      label: "Duplicate detected",
      detail: `${exact ? "Same content as" : "Very similar to"} ${c.duplicate.duplicate_of_label}${exact ? " — not evaluated separately" : " — evaluated and flagged for review"}.`,
      tone: "warning",
      icon: Copy,
    };
  }
  switch (c.evaluation_status) {
    case "queued":
    case "running":
      return { label: "Evaluating", detail: c.display_name ?? undefined, tone: "accent", icon: Loader2, spin: true };
    case "completed":
      return { label: "Complete", detail: c.display_name ? `${c.display_name} · assessed` : "Assessed", tone: "success", icon: CheckCircle2 };
    case "failed":
      return { label: "Failed", detail: `Unable to evaluate: ${c.evaluation?.error_message ?? "evaluation failed"}`, tone: "danger", icon: AlertCircle };
    default:
      return { label: "Extracted", detail: c.display_name ? `${c.display_name} · ready to evaluate` : "Ready to evaluate", tone: "success", icon: CheckCircle2 };
  }
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  accent: "text-accent-strong",
  success: "text-success",
  warning: "text-warning-ink",
  danger: "text-danger",
};

function StageSummary({ items, byId }: { items: QueueItem[]; byId: Map<string, CandidateSummary> }) {
  const sent = items.filter((i) => i.status !== "ready" && i.status !== "invalid");
  if (!sent.length) return null;
  const stored = sent.map((i) => (i.candidateId ? byId.get(i.candidateId) : undefined)).filter(Boolean) as CandidateSummary[];
  const uploaded = sent.filter((i) => i.status === "done").length;
  const extracted = stored.filter((c) => c.parse_status === "parsed").length;
  const unreadable = stored.length - extracted;
  const dups = stored.filter((c) => c.duplicate.status !== "unique" && c.duplicate.resolution !== "not_duplicate").length;
  const evaluable = stored.filter((c) => c.parse_status === "parsed" && c.evaluation_status !== "skipped_duplicate");
  const assessed = evaluable.filter((c) => c.evaluation_status === "completed" || c.evaluation_status === "failed").length;
  const stages = [
    { label: "Upload & validate", value: `${uploaded}/${sent.length}`, done: uploaded === sent.length },
    { label: "Extract text", value: unreadable ? `${extracted} read · ${unreadable} unreadable` : `${extracted} read`, done: uploaded === sent.length },
    { label: "Check duplicates", value: dups ? `${dups} found` : "None found", done: uploaded === sent.length },
    { label: "Assess candidates", value: evaluable.length ? `${assessed}/${evaluable.length}` : "—", done: evaluable.length > 0 && assessed === evaluable.length },
  ];
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4" aria-label="Batch progress">
      {stages.map((st, i) => (
        <li key={st.label} className="bg-surface px-4 py-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            {st.done ? <CheckCircle2 className="size-3.5 text-success" aria-hidden /> : <span className="tabular grid size-3.5 place-items-center text-[10px]">{i + 1}</span>}
            {st.label}
          </p>
          <p className="tabular mt-1 text-[13.5px] font-semibold text-ink">{st.value}</p>
        </li>
      ))}
    </ol>
  );
}

export function UploadPanel({
  sessionId,
  maxUploadMb,
  candidates,
  onUploaded,
  onViewShortlist,
}: {
  sessionId: string;
  maxUploadMb: number;
  candidates: CandidateSummary[];
  onUploaded: () => Promise<unknown> | void;
  onViewShortlist: () => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoEvaluate, setAutoEvaluate] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const maxBytes = maxUploadMb * 1024 * 1024;
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const next = Array.from(files).map<QueueItem>((file) => {
        const message = validate(file, maxBytes);
        return { id: crypto.randomUUID(), file, status: message ? "invalid" : "ready", progress: 0, message };
      });
      setItems((prev) => [...prev, ...next]);
    },
    [maxBytes],
  );

  const update = (id: string, patch: Partial<QueueItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const uploadOne = async (item: QueueItem): Promise<CandidateSummary | null> => {
    update(item.id, { status: "uploading", progress: 0, message: undefined });
    try {
      const response = await uploadResume(sessionId, item.file, (p) => update(item.id, { progress: p }));
      const result = response.results[0];
      if (!result?.ok || !result.candidate) {
        update(item.id, { status: "error", message: result?.error?.message ?? "The file could not be saved." });
        return null;
      }
      update(item.id, { status: "done", progress: 1, candidateId: result.candidate.id });
      return result.candidate;
    } catch (error) {
      update(item.id, { status: "error", message: error instanceof ApiError ? error.message : "Upload failed." });
      return null;
    }
  };

  const run = async (targets: QueueItem[]) => {
    if (!targets.length) return;
    setBusy(true);
    const results: (CandidateSummary | null)[] = [];
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
          const next = queue.shift();
          if (next) results.push(await uploadOne(next));
        }
      }),
    );
    const stored = results.filter((r): r is CandidateSummary => r !== null);
    const parsed = stored.filter((c) => c.parse_status === "parsed");
    const failedUploads = results.length - stored.length;
    await onUploaded();

    const parts = [`${parsed.length} readable`];
    if (stored.length - parsed.length) parts.push(`${stored.length - parsed.length} couldn't be read`);
    if (failedUploads) parts.push(`${failedUploads} failed to upload — retry below`);

    if (autoEvaluate && parsed.some((c) => c.evaluation_status === "not_started")) {
      try {
        const res = await api.evaluate(sessionId, "pending");
        if (res.queued) parts.push(`evaluating ${res.queued}`);
        await onUploaded();
      } catch (error) {
        toast.error("Couldn't start evaluation", { description: error instanceof Error ? error.message : undefined });
      }
    }
    // One summary per batch, reflecting what actually happened.
    (failedUploads ? toast.warning : toast.success)(`${stored.length} of ${results.length} file(s) processed`, { description: parts.join(" · ") });
    setBusy(false);
  };

  const ready = items.filter((i) => i.status === "ready");
  const finished = items.filter((i) => i.status === "done" || i.status === "invalid");
  const anyDone = items.some((i) => i.status === "done");

  return (
    <div className="grid gap-4">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center transition-[background-color,border-color,padding] duration-200 ease-[var(--ease-out)]",
          items.length ? "py-8" : "py-14",
          dragging ? "border-accent bg-accent-soft/70" : "border-line-strong bg-surface hover:border-line-hover",
        )}
      >
        <div
          className={cn(
            "mb-4 grid size-12 place-items-center rounded-xl border transition-[transform,background-color,border-color] duration-200 ease-[var(--ease-out)]",
            dragging ? "-translate-y-0.5 border-accent-line bg-surface" : "border-line bg-surface-muted",
          )}
        >
          <UploadCloud className={cn("size-5", dragging ? "text-accent" : "text-muted")} aria-hidden />
        </div>
        <p className="type-title text-[22px]">{dragging ? "Release to add these resumes" : "Bring your candidate pool into focus."}</p>
        <p className="type-body mt-1.5 text-muted">
          Drop resumes here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded font-medium text-accent underline-offset-4 hover:underline"
          >
            browse your files
          </button>
          .
        </p>
        <p className="type-meta mt-4">
          PDF or DOCX · up to {maxUploadMb} MB each · scanned PDFs are flagged for manual review (no OCR)
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <>
          <StageSummary items={items} byId={byId} />
          <Card className="overflow-hidden animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <p className="type-section">
                {items.length} file{items.length === 1 ? "" : "s"}
                <span className="tabular ml-2 text-[13px] font-normal text-muted">
                  {ready.length} ready to upload
                </span>
              </p>
              {finished.length > 0 && !busy && (
                <Button variant="ghost" size="sm" onClick={() => setItems((prev) => prev.filter((i) => !finished.includes(i)))}>
                  Clear finished
                </Button>
              )}
            </div>
            <ul className="max-h-[440px] divide-y divide-line overflow-y-auto" aria-live="polite">
              {items.map((item) => {
                const c = item.candidateId ? byId.get(item.candidateId) : undefined;
                const st = displayStatus(item, c);
                const ext = extension(item.file.name);
                return (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3 animate-fade-in sm:px-5">
                    <span
                      className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-muted text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft"
                      aria-hidden
                    >
                      {ALLOWED.includes(ext) ? ext.slice(1) : <FileText className="size-4 text-muted" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-[13.5px] font-medium text-ink" title={item.file.name}>{item.file.name}</p>
                        <span className="tabular shrink-0 text-xs text-subtle">
                          {ALLOWED.includes(ext) ? ext.slice(1).toUpperCase() : "—"} · {formatBytes(item.file.size)}
                        </span>
                      </div>
                      <p className={cn("mt-0.5 flex items-start gap-1.5 text-[12.5px] leading-5", TONE_TEXT[st.tone])}>
                        <st.icon className={cn("mt-[3px] size-3.5 shrink-0", st.spin && "animate-spin")} aria-hidden />
                        <span>
                          <span className="font-medium">{st.label}</span>
                          {st.detail && <span className="text-muted"> — {st.detail}</span>}
                        </span>
                      </p>
                      {item.status === "uploading" &&
                        (item.progress >= 0.99 ? (
                          <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label={`Processing ${item.file.name}`}>
                            <div className="absolute inset-y-0 w-1/3 rounded-full bg-accent animate-indeterminate" />
                          </div>
                        ) : (
                          <Progress value={item.progress * 100} label={`Uploading ${item.file.name}`} className="mt-2 h-1" />
                        ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.status === "error" && (
                        <Button size="sm" onClick={() => void run([item])} disabled={busy}>
                          <RotateCcw /> Retry
                        </Button>
                      )}
                      {(item.status === "ready" || item.status === "invalid" || item.status === "error") && (
                        <Tooltip content="Remove from list">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${item.file.name}`}
                            disabled={busy && item.status !== "invalid"}
                            onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                          >
                            <X />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-3 border-t border-line bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <Checkbox
                checked={autoEvaluate}
                onChange={(e) => setAutoEvaluate(e.target.checked)}
                label={<span className="text-[13px]">Evaluate readable resumes automatically after upload</span>}
              />
              <div className="flex flex-wrap gap-2">
                {ready.length > 0 && !busy && (
                  <Button variant="ghost" size="sm" onClick={() => setItems((prev) => prev.filter((i) => i.status !== "ready"))}>
                    <Trash2 /> Remove pending
                  </Button>
                )}
                {anyDone && !ready.length && !busy ? (
                  <Button variant="primary" onClick={onViewShortlist}>View shortlist</Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => void run(ready)}
                    disabled={!ready.length}
                    disabledReason={busy ? undefined : "Add PDF or DOCX files to upload"}
                    loading={busy}
                  >
                    <FileUp /> Upload {ready.length || ""} file{ready.length === 1 ? "" : "s"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
