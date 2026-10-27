"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/** Chip-style list editor. Enter or comma adds; Backspace on empty input removes the last chip. */
export function TagInput({
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
  id,
  max = 30,
  tone = "accent",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
  max?: number;
  tone?: "accent" | "neutral";
}) {
  const [draft, setDraft] = useState("");
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const add = (raw: string) => {
    const items = raw
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    const next = [...value];
    for (const item of items) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item.slice(0, 80));
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5 shadow-[inset_0_1px_1px_rgb(32_34_49/0.03)] transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15",
        invalid && "border-danger focus-within:border-danger focus-within:ring-danger/15",
      )}
      onClick={() => document.getElementById(inputId)?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border pl-2 pr-1 text-[13px] font-medium",
            tone === "accent" ? "border-accent-line bg-accent-soft text-accent-strong" : "border-line bg-surface-muted text-ink-soft",
          )}
        >
          {tag}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(value.filter((v) => v !== tag));
            }}
            className="grid size-5 place-items-center rounded hover:bg-surface/70"
            aria-label={`Remove ${tag}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = event.target.value;
          if (/[,;]$/.test(next)) add(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (/[,\n;]/.test(text)) {
            event.preventDefault();
            add(text);
          }
        }}
        placeholder={value.length ? "Add more…" : placeholder}
        className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-subtle"
      />
    </div>
  );
}

/**
 * One item per line, for longer requirement sentences. Uncontrolled: remount it
 * with a new `key` when the value is replaced from outside (e.g. after extraction).
 */
export function LineListInput({
  defaultValue,
  onChange,
  placeholder,
  id,
}: {
  defaultValue: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(defaultValue.join("\n"));
  const rows = Math.max(2, Math.min(6, text.split("\n").length + 1));
  return (
    <textarea
      id={id}
      value={text}
      rows={rows}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
      }}
      placeholder={placeholder}
      className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-6 text-ink shadow-[inset_0_1px_1px_rgb(32_34_49/0.03)] placeholder:text-subtle hover:border-line-hover focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15"
    />
  );
}
