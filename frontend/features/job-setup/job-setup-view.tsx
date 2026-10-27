"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  FileText,
  PenLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useBackendStatus } from "@/components/layout/backend-status";
import { PageHeader } from "@/components/shared/page-header";
import { InlineNotice } from "@/components/shared/states";
import { Checkbox } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/primitives";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExtractResponse } from "@/types/api";

import { CriteriaEditor, type RequirementField } from "./criteria-editor";
import { SAMPLE_JOB } from "./sample-job";
import { DEFAULT_WEIGHTS, EMPTY_REQUIREMENTS, jobSetupSchema, type JobSetupValues } from "./schema";
import { WeightsEditor } from "./weights-editor";

type Stage = "details" | "criteria";

function Steps({ stage }: { stage: Stage }) {
  const steps = [
    { key: "details", label: "Job details" },
    { key: "criteria", label: "Review criteria" },
    { key: "upload", label: "Upload resumes" },
  ];
  const current = stage === "details" ? 0 : 1;
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-[13px]" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2">
          <span
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1 font-medium",
              i < current && "border-success-line bg-success-soft text-success",
              i === current && "border-accent-line bg-accent-soft text-accent-strong",
              i > current && "border-line bg-surface text-muted",
            )}
          >
            <span className="tabular grid size-4 place-items-center rounded-full text-[11px]">
              {i < current ? <Check className="size-3.5" /> : i + 1}
            </span>
            {step.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-5 bg-line-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function JobSetupView() {
  const router = useRouter();
  const { health } = useBackendStatus();
  const [stage, setStage] = useState<Stage>("details");
  const [extraction, setExtraction] = useState<ExtractResponse | null>(null);
  const [extracted, setExtracted] = useState<Set<RequirementField>>(new Set());
  const [resetKey, setResetKey] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState(false);

  const form = useForm<JobSetupValues>({
    resolver: zodResolver(jobSetupSchema),
    defaultValues: {
      job_title: "",
      department: "",
      job_description: "",
      requirements: EMPTY_REQUIREMENTS,
      weights: DEFAULT_WEIGHTS,
      confirmed: false,
    },
    mode: "onTouched",
  });
  const { register, control, handleSubmit, formState, setValue, getValues, trigger } = form;
  const errors = formState.errors;
  const description = useWatch({ control, name: "job_description" });
  const weights = useWatch({ control, name: "weights" });

  const loadSample = () => {
    setValue("job_title", SAMPLE_JOB.title, { shouldValidate: true });
    setValue("department", SAMPLE_JOB.department);
    setValue("job_description", SAMPLE_JOB.description, { shouldValidate: true });
    toast.message("Sample job description loaded", { description: "A fictional posting for demonstration." });
  };

  const goManual = async () => {
    if (!(await trigger(["job_title", "department"]))) return;
    setExtraction(null);
    setExtracted(new Set());
    setStage("criteria");
  };

  const extract = async () => {
    if (!(await trigger(["job_title", "department"]))) return;
    const { job_title, job_description } = getValues();
    if (job_description.trim().length < 30) {
      form.setError("job_description", { message: "Paste a job description (at least 30 characters) to extract criteria." });
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await api.extractRequirements(job_title, job_description);
      setValue("requirements", result.requirements, { shouldValidate: false });
      setExtraction(result);
      const fields = (Object.keys(result.requirements) as RequirementField[]).filter((k) => {
        const v = result.requirements[k];
        return Array.isArray(v) ? v.length > 0 : v !== null;
      });
      setExtracted(new Set(fields));
      setResetKey((k) => k + 1);
      setStage("criteria");
      toast.success("Criteria extracted", { description: "Review and edit each field before confirming." });
    } catch (error) {
      setExtractError(errorMessage(error));
      toast.error("Couldn't extract criteria", { description: "Your job description is preserved. You can retry or enter criteria manually." });
    } finally {
      setExtracting(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const workspace = await api.createSession({
        job_title: values.job_title,
        department: values.department || null,
        job_description: values.job_description,
        requirements: values.requirements,
        requirements_source: extraction ? "extracted" : "manual",
        extraction_meta: extraction
          ? { provider: extraction.provider, model: extraction.model, method: extraction.method, notes: extraction.notes }
          : null,
        scoring_weights: values.weights,
      });
      toast.success("Screening created", { description: "Criteria confirmed. Upload resumes to begin." });
      router.push(`/screenings/${workspace.session.id}?tab=upload`);
    } catch (error) {
      toast.error("Couldn't create the screening", {
        description: error instanceof ApiError && error.status === 422 ? error.message : errorMessage(error),
      });
    }
  });

  const markEdited = (field: RequirementField) =>
    setExtracted((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  const provider = health?.provider;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Overview
          </Link>
        }
        title="New screening"
        description="Define the role and confirm the job-related criteria every candidate will be assessed against. Nothing is scored until you confirm."
      />
      <Steps stage={stage} />

      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <Card>
            <CardHeader>
              <div>
                <p className="type-eyebrow">Step 1</p>
                <CardTitle className="mt-1 flex items-center gap-2">
                  <FileText className="size-4 text-muted" aria-hidden /> Define the role
                </CardTitle>
                <CardDescription>Paste the posting to extract requirements, or enter them yourself.</CardDescription>
              </div>
              {stage === "details" && (
                <Button type="button" variant="ghost" size="sm" onClick={loadSample}>
                  <ClipboardList /> Use sample job
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="job_title">Job title</Label>
                  <Input id="job_title" placeholder="The title candidates applied for, e.g. Senior Backend Engineer" aria-invalid={!!errors.job_title || undefined} {...register("job_title")} />
                  <FieldError>{errors.job_title?.message}</FieldError>
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="department">Department</Label>
                    <span className="text-xs text-subtle">Optional</span>
                  </div>
                  <Input id="department" placeholder="e.g. Platform Engineering" {...register("department")} />
                  <FieldError>{errors.department?.message}</FieldError>
                </div>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="job_description">Job description</Label>
                  <span className="tabular text-xs text-subtle">{description.length.toLocaleString()} / 20,000</span>
                </div>
                <Textarea
                  id="job_description"
                  rows={stage === "details" ? 12 : 5}
                  placeholder="Paste the full posting — responsibilities, requirements and nice-to-haves. Headings like “Requirements” and “Nice to have” help extraction."
                  aria-invalid={!!errors.job_description || undefined}
                  {...register("job_description")}
                />
                <FieldError>{errors.job_description?.message}</FieldError>
                <FieldHint>Extraction proposes criteria only; you review and confirm every field.</FieldHint>
              </div>

              {extracting && (
                <div className="rounded-lg border border-accent-line bg-accent-soft/60 px-4 py-3 animate-fade-in" role="status">
                  <p className="text-[13px] font-medium text-accent-strong">Reading the job description and proposing requirements…</p>
                  <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-surface/80">
                    <div className="absolute inset-y-0 w-1/3 rounded-full bg-accent animate-indeterminate" />
                  </div>
                </div>
              )}
              {extractError && !extracting && (
                <InlineNotice tone="danger" icon={AlertTriangle} title="Couldn't extract requirements"
                  action={
                    <>
                      <Button type="button" size="sm" onClick={extract}>Retry extraction</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={goManual}>Enter manually</Button>
                    </>
                  }>
                  {extractError} Your job description has been kept.
                </InlineNotice>
              )}
              {stage === "details" ? (
                <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row">
                  <Button type="button" variant="primary" size="lg" onClick={extract} loading={extracting} disabled={!description.trim()}>
                    <Wand2 /> Extract requirements
                  </Button>
                  <Button type="button" size="lg" onClick={goManual}>
                    <PenLine /> Enter manually
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button type="button" variant="ghost" size="sm" onClick={extract} loading={extracting} disabled={!description.trim()}>
                    <Wand2 /> Re-extract
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {stage === "criteria" && (
            <>
              <Card className="animate-fade-in">
                <CardHeader>
                  <div>
                    <p className="type-eyebrow">Step 2</p>
                    <CardTitle className="mt-1 flex items-center gap-2">
                      <ShieldCheck className="size-4 text-muted" aria-hidden /> Confirm requirements
                    </CardTitle>
                    <CardDescription>
                      Only job-related requirements. Avoid criteria about age, gender, ethnicity, religion, disability,
                      family status or other personal characteristics.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {extraction && extracted.size > 0 && (
                    <InlineNotice tone="warning" icon={Sparkles} className="mb-5"
                      title={`${extracted.size} field${extracted.size === 1 ? "" : "s"} extracted automatically — not yet reviewed`}>
                      {extraction.method}. Extracted values are suggestions, not authoritative requirements.
                    </InlineNotice>
                  )}
                  <CriteriaEditor control={control} errors={errors.requirements} extracted={extracted}
                    onFieldEdited={markEdited} resetKey={resetKey} />
                </CardContent>
              </Card>

              <Card className="animate-fade-in">
                <CardHeader>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <SlidersHorizontal className="size-4 text-muted" /> Scoring weights
                    </CardTitle>
                    <CardDescription>
                      Product defaults are 40 / 25 / 20 / 15. Different roles may warrant different weights.
                    </CardDescription>
                  </div>
                  <Button type="button" variant="ghost" size="sm" aria-expanded={showWeights} onClick={() => setShowWeights((s) => !s)}>
                    {showWeights ? "Hide" : "Customize"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {showWeights ? (
                    <Controller
                      control={control}
                      name="weights"
                      render={({ field }) => <WeightsEditor value={field.value} onChange={field.onChange} />}
                    />
                  ) : (
                    <p className="tabular text-[13px] text-muted">
                      Required skills {weights.required_skills}% · Experience {weights.relevant_experience}% ·
                      Projects {weights.projects}% · Preferred {weights.preferred_qualifications}%
                    </p>
                  )}
                  <FieldError>{errors.weights?.root?.message ?? errors.weights?.message}</FieldError>
                </CardContent>
              </Card>

              <Card className="animate-fade-in">
                <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Checkbox
                      {...register("confirmed")}
                      label="I have reviewed these criteria and confirm they are job-related."
                      description="Candidates are only assessed once you confirm."
                    />
                    <div className="pl-7">
                      <FieldError>{errors.confirmed?.message}</FieldError>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => setStage("details")}>
                      Back
                    </Button>
                    <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
                      Confirm & create screening <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <aside className="grid content-start gap-4 lg:sticky lg:top-8 lg:self-start">
          {extraction && extraction.notes.length > 0 && stage === "criteria" && (
            <Card className="animate-fade-in">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">Extraction notes</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <ul className="space-y-3">
                  {extraction.notes.map((note, i) => (
                    <li key={i} className="text-[13px] leading-5 text-ink-soft">
                      <span className="font-medium text-ink">{note.field.replace(/_/g, " ")}:</span> {note.note}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                  Source: {extraction.provider === "demo" ? "rule-based demo extractor (no AI model)" : `${extraction.provider} · ${extraction.model}`}
                </p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">What happens next</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <ol className="space-y-2.5 text-[13px] leading-5 text-ink-soft">
                <li><span className="font-medium text-ink">1.</span> Upload PDF or DOCX resumes; each file is processed independently.</li>
                <li><span className="font-medium text-ink">2.</span> Duplicates are detected by file hash, text hash and similarity.</li>
                <li><span className="font-medium text-ink">3.</span> Candidates are assessed against these criteria with verified evidence.</li>
                <li><span className="font-medium text-ink">4.</span> You review the ranked shortlist and record decisions.</li>
              </ol>
            </CardContent>
          </Card>
          {provider && (
            <InlineNotice tone={provider.mode === "live" ? "accent" : "warning"} icon={provider.mode === "live" ? Sparkles : ShieldCheck}
              title={provider.mode === "live" ? "Live AI mode" : "Demo mode"}>
              {provider.mode === "live"
                ? `Extraction and evaluation use the Anthropic API (${provider.model}).`
                : "Extraction and evaluation use transparent rules, not an AI model."}
            </InlineNotice>
          )}
        </aside>
      </form>
    </>
  );
}
