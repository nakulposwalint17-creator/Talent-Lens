import { cn } from "@/lib/utils";

/** The TalentLens mark: a lens aperture resolving into a focused point. */
export function LensIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 rounded-[8px] ring-1 ring-line", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#202231" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#8f8fe8" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="4.6" fill="none" stroke="#c9c9f5" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="1.7" fill="#ffffff" />
      <path d="M22.2 22.2 26 26" stroke="#398b83" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LensIcon className={compact ? "size-7" : "size-8"} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[-0.015em] text-ink">TalentLens</span>
        {!compact && <span className="mt-1 text-[11px] font-medium text-muted">Recruitment intelligence</span>}
      </span>
    </span>
  );
}
