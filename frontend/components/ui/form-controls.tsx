"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Styled native checkbox: keeps native semantics and keyboard behaviour. */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode; description?: React.ReactNode }
>(({ label, description, className, id, ...props }, ref) => {
  const generated = React.useId();
  const inputId = id ?? generated;
  return (
    <label htmlFor={inputId} className={cn("group flex cursor-pointer items-start gap-3", className)}>
      <span className="relative mt-[3px] grid size-4 shrink-0 place-items-center">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="peer size-4 appearance-none rounded-[4px] border border-line-strong bg-surface transition-colors duration-150 checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent group-hover:border-line-hover checked:group-hover:border-accent-strong"
          {...props}
        />
        <Check className="pointer-events-none absolute size-3 text-on-accent opacity-0 transition-opacity duration-150 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm leading-6 text-ink">{label}</span>
        {description && <span className="block type-meta">{description}</span>}
      </span>
    </label>
  );
});
Checkbox.displayName = "Checkbox";

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-md border border-line-strong bg-surface pl-9 pr-8 text-sm text-ink placeholder:text-subtle transition-[border-color,box-shadow] duration-150 hover:border-line-hover focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-subtle hover:bg-surface-muted hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Disclosure with an animated height transition (CSS grid rows; reduced-motion safe). */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
  className,
  headerClassName,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-3 text-left", headerClassName)}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {meta}
        <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform duration-200 ease-[var(--ease-out)]", open && "rotate-180")} />
      </button>
      <div
        id={contentId}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)]",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
