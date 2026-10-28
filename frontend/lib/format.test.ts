import { afterEach, describe, expect, it, vi } from "vitest";

import {
  candidateLabel,
  formatBytes,
  formatPercent,
  formatRelative,
  formatScore,
  formatYears,
  initials,
  providerLabel,
} from "@/lib/format";

afterEach(() => vi.useRealTimers());

describe("number formatting", () => {
  it("shows a dash for missing values", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatYears(null)).toBe("—");
  });

  it("formats scores, percentages, years and sizes", () => {
    expect(formatScore(82.345)).toBe("82.3");
    expect(formatPercent(0.756)).toBe("76%");
    expect(formatPercent(0.756, 1)).toBe("75.6%");
    expect(formatYears(1)).toBe("1 yr");
    expect(formatYears(5)).toBe("5 yrs");
    expect(formatYears(2.5)).toBe("2.5 yrs");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("formatRelative", () => {
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5 min ago"],
    [60 * 60_000, "1 hr ago"],
    [3 * 60 * 60_000, "3 hrs ago"],
    [2 * 24 * 60 * 60_000, "2 days ago"],
  ])("%d ms ago → %s", (ago, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    expect(formatRelative(new Date(Date.now() - ago).toISOString())).toBe(expected);
  });

  it("falls back to a date after a week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    expect(formatRelative("2026-10-01T12:00:00Z")).toBe("Oct 1, 2026");
  });
});

describe("labels", () => {
  it("prefers the extracted name over the filename", () => {
    expect(candidateLabel({ display_name: "Amara Okafor", original_filename: "cv.pdf" })).toBe("Amara Okafor");
    expect(candidateLabel({ display_name: null, original_filename: "cv.pdf" })).toBe("cv.pdf");
  });

  it("derives initials", () => {
    expect(initials("Amara Okafor")).toBe("AO");
    expect(initials("daniel-reyes.docx")).toBe("DR");
    expect(initials("")).toBe("?");
  });

  it("names providers", () => {
    expect(providerLabel("demo", null)).toBe("Rule-based demo");
    expect(providerLabel("anthropic", "claude-opus-5-5")).toBe("Anthropic · claude-opus-5-5");
    expect(providerLabel("anthropic", null)).toBe("Anthropic");
    expect(providerLabel("system", null)).toBe("System");
    expect(providerLabel("other", "m")).toBe("other · m");
    expect(providerLabel("other", null)).toBe("other");
  });
});
