import { describe, expect, it } from "vitest";

import { DEFAULT_WEIGHTS, EMPTY_REQUIREMENTS, jobSetupSchema, weightsSchema } from "@/features/job-setup/schema";

const valid = {
  job_title: "Senior Backend Engineer",
  department: "Platform",
  job_description: "Build APIs.",
  requirements: { ...EMPTY_REQUIREMENTS, required_skills: ["Python"] },
  weights: DEFAULT_WEIGHTS,
  confirmed: true,
};

const messages = (input: unknown) => {
  const result = jobSetupSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("job setup validation", () => {
  it("accepts a complete, confirmed setup", () => {
    expect(messages(valid)).toEqual([]);
  });

  it("requires explicit confirmation that criteria were reviewed", () => {
    expect(messages({ ...valid, confirmed: false })).toContain("Please confirm you have reviewed the criteria.");
  });

  it("requires at least one required skill and a title", () => {
    expect(messages({ ...valid, requirements: EMPTY_REQUIREMENTS })).toContain("Add at least one required skill.");
    expect(messages({ ...valid, job_title: " x " })).toContain("Enter a job title (at least 2 characters).");
  });

  it("bounds years of experience", () => {
    const years = (n: number) => ({ ...valid, requirements: { ...valid.requirements, min_years_experience: n } });
    expect(messages(years(-1))).toContain("Years can't be negative.");
    expect(messages(years(51))).toContain("Enter 50 years or fewer.");
    expect(messages(years(5))).toEqual([]);
  });

  it("requires weights to total 100%", () => {
    expect(weightsSchema.safeParse(DEFAULT_WEIGHTS).success).toBe(true);
    const off = weightsSchema.safeParse({ ...DEFAULT_WEIGHTS, projects: 30 });
    expect(off.success).toBe(false);
    expect(off.error?.issues[0].message).toBe("Weights must add up to 100%.");
  });

  it("rejects an oversized job description", () => {
    expect(messages({ ...valid, job_description: "x".repeat(20_001) })).toContain(
      "The job description is too long (20,000 characters max).",
    );
  });
});
