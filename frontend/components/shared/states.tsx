import { AlertTriangle, RefreshCw, ServerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-xl border border-line bg-surface-muted">
        <Icon className="size-5 text-muted" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <div className="mt-1.5 max-w-md text-sm leading-6 text-muted">{description}</div>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const offline = error instanceof ApiError && error.isNetworkError;
  const notFound = error instanceof ApiError && error.status === 404;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-12 text-center", className)}
    >
      <div
        className={cn(
          "mb-4 grid size-11 place-items-center rounded-xl border",
          offline ? "border-line bg-surface-muted" : "border-danger-line bg-danger-soft",
        )}
      >
        {offline ? <ServerOff className="size-5 text-muted" /> : <AlertTriangle className="size-5 text-danger" />}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">
        {title ?? (offline ? "The backend isn't reachable" : notFound ? "Not found" : "Couldn't load this page")}
      </h3>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted">{message}</p>
      {offline && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-muted px-4 py-2.5 text-left font-mono text-xs text-ink-soft">
          ./scripts/dev.sh{"\n"}# or: cd backend && .venv/bin/uvicorn app.main:app --port 8000
        </pre>
      )}
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function InlineNotice({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: "neutral" | "warning" | "danger" | "accent" | "success";
  icon?: React.ComponentType<{ className?: string }>;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-surface-muted text-ink-soft [&_svg.notice-icon]:text-muted",
    warning: "border-warning-line bg-warning-soft text-warning-ink [&_svg.notice-icon]:text-warning",
    danger: "border-danger-line bg-danger-soft text-danger-ink [&_svg.notice-icon]:text-danger",
    accent: "border-accent-line bg-accent-soft text-accent-strong [&_svg.notice-icon]:text-accent",
    success: "border-success-line bg-success-soft text-success-ink [&_svg.notice-icon]:text-success",
  } as const;
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center", tones[tone], className)}>
      <div className="flex min-w-0 flex-1 gap-2.5">
        {Icon && <Icon className="notice-icon mt-0.5 size-4 shrink-0" />}
        <div className="min-w-0 text-[13px] leading-5">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}
