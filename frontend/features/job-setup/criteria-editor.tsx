"use client";

import { Info, Sparkles } from "lucide-react";
import { Controller, type Control, type FieldErrors } from "react-hook-form";

import { LineListInput, TagInput } from "@/components/shared/tag-input";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge, FieldError, FieldHint, Input, Label } from "@/components/ui/primitives";
import type { JobRequirements } from "@/types/api";

type RequirementsForm = { requirements: JobRequirements };
export type RequirementField = keyof JobRequirements;

function FieldLabel({
  htmlFor,
  children,
  extracted,
  optional,
  tip,
}: {
  htmlFor: string;
  children: React.ReactNode;
  extracted?: boolean;
  optional?: boolean;
  tip?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      {optional && <span className="text-xs text-subtle">Optional</span>}
      {tip && (
        <Tooltip content={tip}>
          <button type="button" className="text-subtle hover:text-muted" aria-label={`About ${String(children)}`}>
            <Info className="size-3.5" />
          </button>
        </Tooltip>
      )}
      {extracted && (
        <Badge tone="warning" className="ml-auto">
          <Sparkles /> Extracted · review
        </Badge>
      )}
    </div>
  );
}

/**
 * Editable structured criteria. Works with any react-hook-form form whose values
 * contain a `requirements` object. `extracted` marks fields still unreviewed
 * after automatic extraction; `onFieldEdited` clears that marker.
 */
export function CriteriaEditor<T extends RequirementsForm>({
  control,
  errors,
  extracted,
  onFieldEdited,
  resetKey,
}: {
  control: Control<T>;
  errors?: FieldErrors<RequirementsForm>["requirements"];
  extracted?: Set<RequirementField>;
  onFieldEdited?: (field: RequirementField) => void;
  resetKey?: number;
}) {
  const c = control as unknown as Control<RequirementsForm>;
  const edited = (field: RequirementField) => onFieldEdited?.(field);
  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-5">
      <legend className="type-eyebrow mb-4">Skills</legend>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="required_skills" extracted={extracted?.has("required_skills")}
          tip="Scored under 'Required skills' (40% by default). A skill shown in described work counts fully; one only listed counts as half.">
          Required skills
        </FieldLabel>
        <Controller
          control={c}
          name="requirements.required_skills"
          render={({ field }) => (
            <TagInput id="required_skills" value={field.value} invalid={!!errors?.required_skills}
              describedBy="required_skills-hint"
              onChange={(v) => { field.onChange(v); edited("required_skills"); }}
              placeholder="e.g. Python, FastAPI, PostgreSQL — press Enter to add" />
          )}
        />
        <FieldError>{errors?.required_skills?.message}</FieldError>
        <FieldHint id="required_skills-hint">Concrete, job-related skills a candidate must demonstrate.</FieldHint>
      </div>

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="preferred_skills" optional extracted={extracted?.has("preferred_skills")}
          tip="Scored under 'Preferred qualifications'. If empty, that criterion is not used and its weight is redistributed.">
          Preferred skills
        </FieldLabel>
        <Controller
          control={c}
          name="requirements.preferred_skills"
          render={({ field }) => (
            <TagInput id="preferred_skills" value={field.value} tone="neutral" invalid={!!errors?.preferred_skills}
              onChange={(v) => { field.onChange(v); edited("preferred_skills"); }}
              placeholder="e.g. Kubernetes, AWS" />
          )}
        />
        <FieldError>{errors?.preferred_skills?.message}</FieldError>
      </div>
      </fieldset>

      <fieldset className="grid gap-5 border-t border-line pt-6">
      <legend className="type-eyebrow float-left mb-4 w-full">Relevant experience</legend>

      <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="grid content-start gap-1.5">
          <FieldLabel htmlFor="min_years" optional extracted={extracted?.has("min_years_experience")}>
            Minimum years
          </FieldLabel>
          <Controller
            control={c}
            name="requirements.min_years_experience"
            render={({ field }) => (
              <Input
                id="min_years"
                type="number"
                inputMode="decimal"
                min={0}
                max={50}
                step={0.5}
                value={field.value ?? ""}
                aria-invalid={!!errors?.min_years_experience || undefined}
                onChange={(event) => {
                  const raw = event.target.value;
                  field.onChange(raw === "" ? null : Number(raw));
                  edited("min_years_experience");
                }}
                placeholder="e.g. 5"
              />
            )}
          />
          <FieldError>{errors?.min_years_experience?.message}</FieldError>
        </div>
        <div className="grid content-start gap-1.5">
          <FieldLabel htmlFor="experience_focus" optional extracted={extracted?.has("experience_focus")}
            tip="A dated role counts as relevant experience when its title names one of these (or a required skill), or its description mentions at least two.">
            Relevant experience focus
          </FieldLabel>
          <Controller
            control={c}
            name="requirements.experience_focus"
            render={({ field }) => (
              <TagInput id="experience_focus" value={field.value} tone="neutral"
                onChange={(v) => { field.onChange(v); edited("experience_focus"); }}
                placeholder="e.g. backend, API" />
            )}
          />
          <FieldError>{errors?.experience_focus?.message}</FieldError>
        </div>
      </div>

      </fieldset>

      <fieldset className="grid gap-5 border-t border-line pt-6">
      <legend className="type-eyebrow float-left mb-4 w-full">Qualifications & other criteria</legend>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="qualifications" optional extracted={extracted?.has("qualifications")}
          tip="Shown as verification checks with evidence. They do not change the score; a qualification not established by the resume is flagged for human review.">
          Required qualifications
        </FieldLabel>
        <Controller
          control={c}
          name="requirements.qualifications"
          render={({ field }) => (
            <LineListInput key={`q-${resetKey}`} id="qualifications" defaultValue={field.value}
              onChange={(v) => { field.onChange(v); edited("qualifications"); }}
              placeholder={"One per line, e.g.\nBachelor's degree in Computer Science or equivalent practical experience"} />
          )}
        />
        <FieldError>{errors?.qualifications?.message}</FieldError>
      </div>

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="additional_criteria" optional extracted={extracted?.has("additional_criteria")}
          tip="Other job-specific requirements, surfaced for human verification. Never include personal characteristics.">
          Additional job-specific criteria
        </FieldLabel>
        <Controller
          control={c}
          name="requirements.additional_criteria"
          render={({ field }) => (
            <LineListInput key={`a-${resetKey}`} id="additional_criteria" defaultValue={field.value}
              onChange={(v) => { field.onChange(v); edited("additional_criteria"); }}
              placeholder="One per line, e.g. Experience operating production services on call" />
          )}
        />
        <FieldError>{errors?.additional_criteria?.message}</FieldError>
      </div>
      </fieldset>
    </div>
  );
}
