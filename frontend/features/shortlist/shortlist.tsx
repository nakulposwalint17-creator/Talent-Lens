"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Gavel,
  Inbox,
  MoreHorizontal,
  RotateCcw,
  SearchX,
  SlidersHorizontal,
  Unlink,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/shared/identity";
import { BreakdownBar, ScoreMeter } from "@/components/shared/score";
import { EmptyState } from "@/components/shared/states";
import { DecisionBadge, DuplicateBadge, ProcessingStatus, RecommendationBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { SearchField } from "@/components/ui/form-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { Badge, Card } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api";
import { candidateLabel, formatPercent, formatYears } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateSummary } from "@/types/api";

import {
  comparator,
  EMPTY_FILTERS,
  FILTER_GROUP_LABELS,
  FILTER_OPTIONS,
  matches,
  type Filters,
  type SortDir,
  type SortKey,
} from "./filters";
import { ScoreDistribution } from "./score-distribution";

/** Full table from 1320px; below that, rows reflow into readable stacked cards. */
const GRID =
  "min-[1320px]:grid min-[1320px]:grid-cols-[32px_minmax(190px,1.25fr)_92px_minmax(170px,1.1fr)_60px_minmax(150px,0.9fr)_minmax(120px,0.8fr)_100px] min-[1320px]:items-center min-[1320px]:gap-4";

export function notRankedReason(c: CandidateSummary): string {
  if (c.parse_status === "needs_ocr")
    return "Scanned or image-only PDF — no extractable text. OCR is not supported; review the file manually.";
  if (c.parse_status !== "parsed") return c.parse_error_message ?? "The file could not be read.";
  if (c.duplicate.excluded_from_ranking)
    return `Duplicate of ${c.duplicate.duplicate_of_label ?? "another upload"} — excluded so the same resume isn't counted twice.`;
  if (c.evaluation_status === "failed") return `Unable to evaluate: ${c.evaluation?.error_message ?? "evaluation failed"}`;
  if (c.evaluation_status === "queued" || c.evaluation_status === "running") return "Evaluation in progress…";
  if (c.evaluation_status === "not_started") return "Text extracted — not evaluated yet.";
  if (c.evaluation?.recommendation === "insufficient_evidence")
    return "Insufficient evidence to rank reliably — needs human review.";
  return "Not ranked.";
}

export interface RowHandlers {
  onOpen: (id: string) => void;
  onDecide: (candidate: CandidateSummary) => void;
  onRetry: (id: string) => void;
  onChanged: () => Promise<unknown>;
}

function RowMenu({ c, handlers }: { c: CandidateSummary; handlers: RowHandlers }) {
  const canRetry = c.parse_status === "parsed" && c.evaluation_status === "failed";
  const dupOpen = c.duplicate.status !== "unique" && c.duplicate.resolution !== "not_duplicate";
  const busy = c.evaluation_status === "queued" || c.evaluation_status === "running";
  const markDistinct = async () => {
    try {
      await api.resolveDuplicate(c.id, "not_duplicate");
      toast.success("Marked as a distinct candidate", { description: "You can change this from the candidate details." });
      await handlers.onChanged();
    } catch (error) {
      toast.error("Couldn't update duplicate status", { description: errorMessage(error) });
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${candidateLabel(c)}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => handlers.onOpen(c.id)}>Review evidence</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onDecide(c)} disabled={busy}>
          <Gavel /> Record decision…
        </DropdownMenuItem>
        {(canRetry || dupOpen) && <DropdownMenuSeparator />}
        {canRetry && (
          <DropdownMenuItem onSelect={() => handlers.onRetry(c.id)}>
            <RotateCcw /> Retry evaluation
          </DropdownMenuItem>
        )}
        {dupOpen && (
          <DropdownMenuItem onSelect={() => void markDistinct()}>
            <Unlink /> Not a duplicate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KeyEvidence({ c }: { c: CandidateSummary }) {
  const ev = c.evaluation;
  if (!ev) return null;
  const shown = ev.key_skills.slice(0, 2);
  const more = ev.key_skills.length - shown.length;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1">
        {shown.map((s) => (
          <span key={s} className="rounded border border-teal-line bg-teal-soft px-1.5 py-px text-[11.5px] font-medium text-teal-ink">
            {s}
          </span>
        ))}
        {more > 0 && <span className="text-[11.5px] text-muted">+{more}</span>}
        {!shown.length && <span className="text-[12.5px] text-muted">No required skill shown in described work</span>}
      </div>
      <p className="tabular mt-1 text-[11.5px] text-muted">
        {ev.required_skills_matched}/{ev.required_skills_total} required found
        {ev.missing_skills.length > 0 && (
          <Tooltip content={`Not found in resume text: ${ev.missing_skills.join(", ")}. This doesn't mean the candidate lacks them.`}>
            <span tabIndex={0} className="cursor-help">
              {" "}· <span className="border-b border-dotted border-subtle">{ev.missing_skills.length} not found</span>
            </span>
          </Tooltip>
        )}
      </p>
    </div>
  );
}

function ReviewCell({ c }: { c: CandidateSummary }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {c.decision ? (
        <DecisionBadge decision={c.decision.decision} override={c.decision.is_override} />
      ) : (
        <span className="text-[12.5px] text-muted">Awaiting decision</span>
      )}
      {c.review_flags.length > 0 && (
        <Tooltip
          content={
            <ul className="list-disc space-y-1 pl-4">
              {c.review_flags.slice(0, 5).map((f, i) => <li key={i}>{f.message}</li>)}
              {c.review_flags.length > 5 && <li>+{c.review_flags.length - 5} more</li>}
            </ul>
          }
        >
          <span tabIndex={0} className={cn("inline-flex items-center gap-1 text-[11.5px] font-medium", c.requires_review ? "text-warning-ink" : "text-muted")}>
            <AlertTriangle className="size-3" aria-hidden />
            {c.review_flags.length} to verify
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function RankedRow({ c, index, handlers }: { c: CandidateSummary; index: number; handlers: RowHandlers }) {
  const ev = c.evaluation!;
  const label = candidateLabel(c);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    handlers.onOpen(c.id);
  };
  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      onClick={() => handlers.onOpen(c.id)}
      className={cn("row-accent group relative cursor-pointer px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover sm:px-5", GRID)}
      data-testid="candidate-row"
    >
      <span className="tabular hidden text-[13px] font-semibold text-muted min-[1320px]:block">{c.rank}</span>
      <div className="flex min-w-0 items-center gap-3 pr-10 min-[1320px]:pr-0">
        <Avatar label={label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="tabular text-[12px] font-semibold text-muted min-[1320px]:hidden">#{c.rank}</span>
            <button type="button" onClick={open} className="type-name truncate text-left hover:text-accent-strong focus-visible:text-accent-strong">
              {label}
            </button>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="max-w-full truncate text-xs text-muted">{c.original_filename}</span>
            {ev.stale && <Badge tone="warning">Criteria changed</Badge>}
            <DuplicateBadge candidate={c} />
          </div>
        </div>
        <div className="shrink-0 min-[1320px]:hidden">
          <ScoreMeter score={ev.overall_score} recommendation={ev.recommendation} />
        </div>
      </div>
      <div className="hidden min-[1320px]:block">
        <ScoreMeter score={ev.overall_score} recommendation={ev.recommendation} />
      </div>
      <div className="mt-3 pl-11 min-[1320px]:mt-0 min-[1320px]:pl-0">
        <KeyEvidence c={c} />
      </div>
      <div className="tabular hidden text-[13px] text-ink min-[1320px]:block">{formatYears(ev.relevant_years)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 min-[1320px]:mt-0 min-[1320px]:block min-[1320px]:pl-0">
        <RecommendationBadge value={ev.recommendation} short />
        <p className="tabular text-[11.5px] text-muted min-[1320px]:mt-1">
          <span className="min-[1320px]:hidden">
            {ev.relevant_years === null ? "Experience undated" : `${formatYears(ev.relevant_years)} relevant`} ·{" "}
          </span>
          {formatPercent(ev.evidence_completeness)} evidence
        </p>
        <BreakdownBar criteria={ev.criteria} className="mt-1.5 hidden w-[120px] min-[1320px]:flex" />
      </div>
      <div className="mt-3 pl-11 min-[1320px]:mt-0 min-[1320px]:pl-0">
        <ReviewCell c={c} />
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-1 min-[1320px]:static min-[1320px]:justify-end">
        <Button size="sm" variant="ghost" className="hidden min-[1320px]:inline-flex" onClick={open}>
          Review
        </Button>
        <RowMenu c={c} handlers={handlers} />
      </div>
    </li>
  );
}

function UnrankedRow({ c, index, handlers }: { c: CandidateSummary; index: number; handlers: RowHandlers }) {
  const label = candidateLabel(c);
  const insufficient = c.evaluation?.recommendation === "insufficient_evidence" && c.evaluation_status === "completed";
  return (
    <li
      style={{ "--i": index } as React.CSSProperties}
      onClick={() => handlers.onOpen(c.id)}
      className="row-accent group flex cursor-pointer flex-col gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover sm:flex-row sm:items-center sm:px-5"
      data-testid="unranked-row"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar label={label} muted />
        <div className="min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlers.onOpen(c.id);
            }}
            className="type-name block max-w-full truncate text-left hover:text-accent-strong"
          >
            {label}
          </button>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-muted">
            {c.display_name && <span>{c.original_filename} · </span>}
            {notRankedReason(c)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 sm:pl-0">
        {insufficient ? <RecommendationBadge value="insufficient_evidence" /> : <ProcessingStatus candidate={c} />}
        <DuplicateBadge candidate={c} />
        {c.decision && <DecisionBadge decision={c.decision.decision} override={c.decision.is_override} />}
        {c.evaluation_status === "failed" && c.parse_status === "parsed" && (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handlers.onRetry(c.id);
            }}
          >
            <RotateCcw /> Retry
          </Button>
        )}
        <RowMenu c={c} handlers={handlers} />
      </div>
    </li>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  defaultDir,
  invert,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (next: { key: SortKey; dir: SortDir }) => void;
  defaultDir: SortDir;
  /** Score is the inverse of rank: best rank first means highest score first. */
  invert?: boolean;
}) {
  const active = sort.key === sortKey;
  const shownDir = invert ? (sort.dir === "asc" ? "desc" : "asc") : sort.dir;
  const Icon = !active ? ArrowUpDown : shownDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: sortKey, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : defaultDir })}
      aria-label={`Sort by ${label}${active ? `, currently ${shownDir === "asc" ? "ascending" : "descending"}` : ""}`}
      className={cn("inline-flex items-center gap-1 uppercase transition-colors hover:text-ink", active && "text-ink")}
    >
      {label}
      <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
    </button>
  );
}

function FilterMenu({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const groups = ["rec", "review", "processing", "duplicates"] as const;
  const active = groups.filter((k) => filters[k] !== "all").length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <SlidersHorizontal /> Filters
          {active > 0 && <span className="tabular rounded bg-accent px-1.5 text-[11px] font-semibold text-on-accent">{active}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={12} className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto">
        {groups.map((group, i) => (
          <div key={group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{FILTER_GROUP_LABELS[group]}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filters[group]} onValueChange={(v) => setFilters({ ...filters, [group]: v })}>
              {FILTER_OPTIONS[group].map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value} onSelect={(e) => e.preventDefault()}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SORT_OPTIONS = [
  { value: "rank:asc", label: "Best match first" },
  { value: "rank:desc", label: "Lowest ranked first" },
  { value: "experience:desc", label: "Most relevant experience" },
  { value: "experience:asc", label: "Least relevant experience" },
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "uploaded:asc", label: "Upload order" },
];

export function Shortlist({
  candidates,
  handlers,
  onOpenOrdered,
  onUploadClick,
}: {
  candidates: CandidateSummary[];
  handlers: Omit<RowHandlers, "onOpen">;
  onOpenOrdered: (id: string, orderedIds: string[]) => void;
  onUploadClick: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "rank", dir: "asc" });

  const { ranked, unranked } = useMemo(() => {
    const visible = candidates.filter((c) => matches(c, filters)).sort(comparator(sort.key, sort.dir));
    return { ranked: visible.filter((c) => c.rank !== null), unranked: visible.filter((c) => c.rank === null) };
  }, [candidates, filters, sort]);

  const ordered = [...ranked, ...unranked].map((c) => c.id);
  const rowHandlers: RowHandlers = { ...handlers, onOpen: (id) => onOpenOrdered(id, ordered) };
  const allRanked = candidates.filter((c) => c.rank !== null);

  const groups = ["rec", "review", "processing", "duplicates"] as const;
  const chips = [
    ...(filters.query ? [{ key: "query" as keyof Filters, label: `Search: “${filters.query}”` }] : []),
    ...groups
      .filter((k) => filters[k] !== "all")
      .map((k) => ({
        key: k as keyof Filters,
        label: `${FILTER_GROUP_LABELS[k]}: ${FILTER_OPTIONS[k].find((o) => o.value === filters[k])?.label ?? ""}`,
      })),
  ];
  const clear = (key: keyof Filters) => setFilters({ ...filters, [key]: key === "query" ? "" : "all" });

  if (!candidates.length)
    return (
      <Card>
        <EmptyState
          icon={Inbox}
          title="No resumes in this screening yet"
          description="Upload PDF or DOCX resumes to build the shortlist. Each file is processed independently, so one unreadable file never blocks the rest."
          action={<Button variant="primary" onClick={onUploadClick}>Upload resumes</Button>}
        />
      </Card>
    );

  return (
    <div className="grid gap-4">
      {allRanked.length >= 2 && <ScoreDistribution candidates={allRanked} onOpen={(id) => onOpenOrdered(id, ordered)} />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <SearchField
            value={filters.query}
            onChange={(query) => setFilters({ ...filters, query })}
            placeholder="Search by name or file"
            label="Search candidates by name or file"
            className="md:w-72"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu filters={filters} setFilters={setFilters} />
            <Button
              aria-pressed={filters.review === "needs_review"}
              onClick={() => setFilters({ ...filters, review: filters.review === "needs_review" ? "all" : "needs_review" })}
              className={cn(filters.review === "needs_review" && "border-warning-line bg-warning-soft text-warning-ink hover:bg-warning-soft")}
            >
              <AlertTriangle /> Needs review
            </Button>
          </div>
          <div className="md:ml-auto">
            <Select
              label="Sort candidates"
              value={`${sort.key}:${sort.dir}`}
              onValueChange={(v) => {
                const [key, dir] = v.split(":") as [SortKey, SortDir];
                setSort({ key, dir });
              }}
              options={SORT_OPTIONS}
              triggerClassName="w-full md:w-[220px]"
            />
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 animate-fade-in" aria-label="Active filters">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-accent-line bg-accent-soft pl-2.5 pr-1 text-[12.5px] font-medium text-accent-strong"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={() => clear(chip.key)}
                  aria-label={`Remove filter ${chip.label}`}
                  className="grid size-5 place-items-center rounded hover:bg-surface/70"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Button variant="link" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</Button>
            <span className="tabular type-meta" role="status">
              {ranked.length + unranked.length} of {candidates.length} shown
            </span>
          </div>
        )}
      </div>

      {ranked.length + unranked.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No candidates match these filters"
            description="Try a different search, or clear the filters to see everyone in this screening."
            action={<Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <>
          <section aria-labelledby="ranked-heading">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <h3 id="ranked-heading" className="type-section">
                  Ranked shortlist <span className="tabular font-normal text-muted">{ranked.length}</span>
                </h3>
                <p className="type-meta">Recommendations support your judgement — they are not decisions.</p>
              </div>
              <div className={cn("hidden border-b border-line bg-surface-muted px-5 py-2 text-[11px] font-semibold tracking-[0.06em] text-muted", GRID)}>
                <SortHeader label="#" sortKey="rank" sort={sort} onSort={setSort} defaultDir="asc" />
                <SortHeader label="Candidate" sortKey="name" sort={sort} onSort={setSort} defaultDir="asc" />
                <SortHeader label="Score" sortKey="rank" sort={sort} onSort={setSort} defaultDir="asc" invert />
                <span className="uppercase">Key evidence</span>
                <SortHeader label="Exp." sortKey="experience" sort={sort} onSort={setSort} defaultDir="desc" />
                <span className="uppercase">Recommendation</span>
                <span className="uppercase">Review</span>
                <span />
              </div>
              {ranked.length ? (
                <ul className="stagger divide-y divide-line">
                  {ranked.map((c, i) => <RankedRow key={c.id} c={c} index={i} handlers={rowHandlers} />)}
                </ul>
              ) : (
                <p className="px-5 py-8 text-center text-sm text-muted">
                  {chips.length
                    ? "No ranked candidates match the current filters."
                    : "Nobody has been ranked yet. Evaluate readable resumes to build the shortlist."}
                </p>
              )}
            </Card>
          </section>

          {unranked.length > 0 && (
            <section aria-labelledby="unranked-heading">
              <Card className="overflow-hidden">
                <div className="border-b border-line px-4 py-3 sm:px-5">
                  <h3 id="unranked-heading" className="type-section">
                    Not ranked <span className="tabular font-normal text-muted">{unranked.length}</span>
                  </h3>
                  <p className="type-meta mt-0.5">
                    Unreadable files, failed evaluations, duplicates and thin evidence never receive a ranking score.
                  </p>
                </div>
                <ul className="stagger divide-y divide-line">
                  {unranked.map((c, i) => <UnrankedRow key={c.id} c={c} index={i} handlers={rowHandlers} />)}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
