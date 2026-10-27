"use client";

import { CheckCircle2, Crosshair, MessageSquareQuote, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EvidenceRecord } from "@/types/api";

export type Locate = (range: { start: number; end: number }) => void;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Underline known skill terms inside a verified excerpt (exact, case-insensitive matches only). */
function HighlightedQuote({ text, terms }: { text: string; terms?: string[] }) {
  const usable = (terms ?? []).filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  if (!usable.length) return <>{text}</>;
  const pattern = new RegExp(`(?<![A-Za-z0-9])(${usable.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i} className="term-mark">{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

export function EvidenceQuote({
  record,
  onLocate,
  compact,
  terms,
  label,
}: {
  record: EvidenceRecord;
  onLocate?: Locate;
  compact?: boolean;
  terms?: string[];
  label?: string;
}) {
  const verified = record.verification === "verified";
  const rejected = record.verification === "unverified";
  return (
    <figure
      className={cn(
        "rounded-lg border bg-surface px-3.5 py-2.5",
        verified && "border-line border-l-2 border-l-teal",
        rejected && "border-danger-line border-l-2 border-l-danger bg-danger-soft/40",
        record.verification === "paraphrase" && "border-line border-l-2 border-l-line-strong",
      )}
    >
      {label && <p className="type-eyebrow mb-1 text-[10.5px]">{label}</p>}
      <blockquote
        className={cn(
          "text-[13.5px] leading-[1.55] text-ink",
          rejected && "text-muted line-through decoration-danger/40",
          compact && "line-clamp-3",
        )}
      >
        {record.verification === "paraphrase" ? record.quote : <>“{verified ? <HighlightedQuote text={record.quote} terms={terms} /> : record.quote}”</>}
      </blockquote>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        {verified && (
          <span className="inline-flex items-center gap-1 font-medium text-teal-ink">
            <CheckCircle2 className="size-3" aria-hidden /> Exact quote · verified in resume
            {record.page ? <span className="font-normal text-muted">· page {record.page}</span> : null}
          </span>
        )}
        {rejected && (
          <Tooltip content="This quote could not be found in the extracted resume text, so it is not treated as evidence.">
            <span tabIndex={0} className="inline-flex items-center gap-1 font-medium text-danger">
              <XCircle className="size-3" aria-hidden /> Rejected — not found in resume
            </span>
          </Tooltip>
        )}
        {record.verification === "paraphrase" && (
          <span className="inline-flex items-center gap-1 font-medium text-muted">
            <MessageSquareQuote className="size-3" aria-hidden /> Paraphrase — not a direct quote
          </span>
        )}
        {verified && onLocate && record.start !== null && record.end !== null && (
          <button
            type="button"
            onClick={() => onLocate({ start: record.start!, end: record.end! })}
            className="inline-flex items-center gap-1 rounded font-medium text-accent hover:underline"
          >
            <Crosshair className="size-3" aria-hidden /> Show in resume
          </button>
        )}
        {record.note && <span className="text-muted">{record.note}</span>}
      </figcaption>
    </figure>
  );
}

/** Extracted resume text with verified evidence highlighted. */
export function ResumeText({
  text,
  ranges,
  active,
}: {
  text: string;
  ranges: { start: number; end: number }[];
  active: { start: number; end: number } | null;
}) {
  const activeRef = useRef<HTMLElement>(null);
  const segments = useMemo(() => {
    const sorted = [...ranges, ...(active ? [active] : [])]
      .filter((r) => r.start >= 0 && r.end <= text.length && r.end > r.start)
      .sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    const out: { text: string; mark: boolean; active: boolean }[] = [];
    let cursor = 0;
    for (const r of merged) {
      if (r.start > cursor) out.push({ text: text.slice(cursor, r.start), mark: false, active: false });
      const isActive = !!active && active.start >= r.start && active.end <= r.end;
      out.push({ text: text.slice(r.start, r.end), mark: true, active: isActive });
      cursor = r.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), mark: false, active: false });
    return out;
  }, [text, ranges, active]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-5 py-5 font-mono text-[12.5px] leading-[1.75] text-ink-soft sm:px-7">
      {segments.map((s, i) =>
        s.mark ? (
          <mark key={i} ref={s.active ? activeRef : undefined} className="evidence-mark" data-active={s.active}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}
