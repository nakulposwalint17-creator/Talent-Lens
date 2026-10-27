import { z } from "zod";

import type { CriterionKey } from "@/types/api";

const term = z.string().trim().min(1).max(80);
const sentence = z.string().trim().min(1).max(300);

export const requirementsSchema = z.object({
  required_skills: z.array(term).min(1, "Add at least one required skill.").max(30, "At most 30 required skills."),
  preferred_skills: z.array(term).max(30, "At most 30 preferred skills."),
  min_years_experience: z
    .number({ error: "Enter a number of years." })
    .min(0, "Years can't be negative.")
    .max(50, "Enter 50 years or fewer.")
    .nullable(),
  experience_focus: z.array(term).max(15, "At most 15 focus areas."),
  qualifications: z.array(sentence).max(15, "At most 15 qualifications."),
  additional_criteria: z.array(sentence).max(15, "At most 15 additional criteria."),
});

export const weightsSchema = z
  .object({
    required_skills: z.number().min(0).max(100),
    relevant_experience: z.number().min(0).max(100),
    projects: z.number().min(0).max(100),
    preferred_qualifications: z.number().min(0).max(100),
  })
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-6, {
    message: "Weights must add up to 100%.",
  });

export const jobSetupSchema = z.object({
  job_title: z.string().trim().min(2, "Enter a job title (at least 2 characters).").max(200),
  department: z.string().trim().max(120, "Keep the department under 120 characters."),
  job_description: z.string().max(20000, "The job description is too long (20,000 characters max)."),
  requirements: requirementsSchema,
  weights: weightsSchema,
  confirmed: z.boolean().refine((v) => v, "Please confirm you have reviewed the criteria."),
});

export type JobSetupValues = z.infer<typeof jobSetupSchema>;
export type Weights = Record<CriterionKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  required_skills: 40,
  relevant_experience: 25,
  projects: 20,
  preferred_qualifications: 15,
};

export const EMPTY_REQUIREMENTS: JobSetupValues["requirements"] = {
  required_skills: [],
  preferred_skills: [],
  min_years_experience: null,
  experience_focus: [],
  qualifications: [],
  additional_criteria: [],
};
