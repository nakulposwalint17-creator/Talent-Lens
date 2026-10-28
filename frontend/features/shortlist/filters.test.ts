import { describe, expect, it } from "vitest";

import { comparator, EMPTY_FILTERS, type Filters, matches } from "@/features/shortlist/filters";
import type { CandidateSummary } from "@/types/api";

function candidate(overrides: Partial<CandidateSummary> & { years?: number | null; rec?: string } = {}): CandidateSummary {
  const { years = 5, rec = "strong_match", ...rest } = overrides;
  return {
    id: "c1",
    session_id: "s1",
    rank: 1,
    display_name: "Amara Okafor",
    original_filename: "amara.pdf",
    detected_format: "pdf",
    file_size: 1000,
    page_count: 1,
    parse_status: "parsed",
    parse_error_code: null,
    parse_error_message: null,
    parse_warnings: [],
    duplicate: { status: "unique", resolution: "unreviewed" },
    evaluation_status: "completed",
    evaluation: { recommendation: rec, relevant_years: years },
    review_flags: [],
    requires_review: false,
    decision: null,
    created_at: "2026-10-01T00:00:00Z",
    ...rest,
  } as unknown as CandidateSummary;
}

const f = (overrides: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...overrides });

describe("matches", () => {
  it("searches names and filenames case-insensitively", () => {
    expect(matches(candidate(), f({ query: "okaf" }))).toBe(true);
    expect(matches(candidate(), f({ query: "AMARA.PDF" }))).toBe(true);
    expect(matches(candidate(), f({ query: "riley" }))).toBe(false);
  });

  it("filters by recommendation, including unable to evaluate", () => {
    expect(matches(candidate(), f({ rec: "strong_match" }))).toBe(true);
    expect(matches(candidate(), f({ rec: "lower_match" }))).toBe(false);
    expect(matches(candidate({ evaluation_status: "failed" }), f({ rec: "unable" }))).toBe(true);
    expect(matches(candidate(), f({ rec: "unable" }))).toBe(false);
    expect(matches(candidate({ evaluation_status: "queued" }), f({ rec: "strong_match" }))).toBe(false);
  });

  it("filters by review status", () => {
    const decided = (decision: string) => candidate({ decision: { decision } as CandidateSummary["decision"] });
    expect(matches(candidate({ requires_review: true }), f({ review: "needs_review" }))).toBe(true);
    expect(matches(candidate(), f({ review: "needs_review" }))).toBe(false);
    expect(matches(candidate(), f({ review: "awaiting" }))).toBe(true);
    expect(matches(decided("needs_review"), f({ review: "awaiting" }))).toBe(true);
    expect(matches(decided("hold"), f({ review: "awaiting" }))).toBe(false);
    expect(matches(decided("hold"), f({ review: "hold" }))).toBe(true);
    expect(matches(decided("advance"), f({ review: "reject" }))).toBe(false);
    expect(matches(decided("needs_review"), f({ review: "marked_review" }))).toBe(true);
    expect(matches(candidate(), f({ review: "marked_review" }))).toBe(false);
  });

  it("filters by processing state", () => {
    expect(matches(candidate(), f({ processing: "evaluated" }))).toBe(true);
    expect(matches(candidate({ evaluation_status: "running" }), f({ processing: "evaluated" }))).toBe(false);
    expect(matches(candidate({ evaluation_status: "not_started" }), f({ processing: "pending" }))).toBe(true);
    expect(matches(candidate(), f({ processing: "pending" }))).toBe(false);
    expect(matches(candidate({ parse_status: "failed" }), f({ processing: "problems" }))).toBe(true);
    expect(matches(candidate(), f({ processing: "problems" }))).toBe(false);
  });

  it("treats dismissed duplicates as unique", () => {
    const dup = candidate({ duplicate: { status: "near_duplicate", resolution: "unreviewed" } as CandidateSummary["duplicate"] });
    const dismissed = candidate({ duplicate: { status: "exact_text", resolution: "not_duplicate" } as CandidateSummary["duplicate"] });
    expect(matches(dup, f({ duplicates: "only" }))).toBe(true);
    expect(matches(dup, f({ duplicates: "hide" }))).toBe(false);
    expect(matches(dismissed, f({ duplicates: "only" }))).toBe(false);
    expect(matches(candidate(), f({ duplicates: "hide" }))).toBe(true);
  });
});

describe("comparator", () => {
  const a = candidate({ id: "a", rank: 2, display_name: "Bea", years: 3, created_at: "2026-10-02T00:00:00Z" });
  const b = candidate({ id: "b", rank: 1, display_name: "Ade", years: 7, created_at: "2026-10-01T00:00:00Z" });
  const unranked = candidate({ id: "u", rank: null, display_name: "Cy", years: null, created_at: "2026-10-03T00:00:00Z" });
  const order = (key: Parameters<typeof comparator>[0], dir: Parameters<typeof comparator>[1]) =>
    [a, unranked, b].sort(comparator(key, dir)).map((c) => c.id);

  it("ranks best first and keeps unranked candidates last in both directions", () => {
    expect(order("rank", "asc")).toEqual(["b", "a", "u"]);
    expect(order("rank", "desc")).toEqual(["a", "b", "u"]);
  });

  it("sorts by experience with missing values last", () => {
    expect(order("experience", "desc")).toEqual(["b", "a", "u"]);
    expect(order("experience", "asc")).toEqual(["a", "b", "u"]);
  });

  it("sorts by name and upload time, breaking ties by name then id", () => {
    expect(order("name", "asc")).toEqual(["b", "a", "u"]);
    expect(order("uploaded", "desc")).toEqual(["u", "a", "b"]);
    const twin = candidate({ id: "z", rank: null, display_name: "Cy", years: null, created_at: unranked.created_at });
    expect([twin, unranked].sort(comparator("experience", "asc")).map((c) => c.id)).toEqual(["u", "z"]);
  });
});
