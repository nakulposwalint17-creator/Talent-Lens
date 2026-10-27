"""Rule-based demo provider.

This is *not* an AI model. It produces a structured assessment using transparent
keyword, section and date heuristics over the actual extracted resume text, so the
complete workflow can be exercised without API credentials. Every quote it cites
is a verbatim excerpt of the resume and is still passed through evidence
verification like any other provider's output.
"""

from __future__ import annotations

import re

from app.schemas.assessment import (
    CandidateAssessment,
    CheckAssessment,
    Concern,
    CriterionAssessment,
    CriterionKey,
    EvidenceItem,
    EvidenceStatus,
    ExperienceAssessment,
    RoleEntry,
    SkillAssessment,
)
from app.schemas.requirements import ExtractionNote, JobRequirements, RequirementsExtraction
from app.services.providers.base import AssessmentContext
from app.services.resume_analysis import Line, ResumeAnalysis, merged_months
from app.services.skills import distinct_term_hits, find_domain_terms, find_known_skills, pattern_for, term_in

ACTION_RE = re.compile(
    r"\b(?:built|build|designed|implemented|led|launched|migrated|reduced|improved|developed|architected|"
    r"shipped|automated|optimi[sz]ed|created|deployed|delivered|scaled|refactored|integrated|maintained|"
    r"owned|wrote|introduced|contributed|published|engineered|rebuilt|modernised|modernized|cut|increased)\b",
    re.IGNORECASE,
)
QUANT_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|x\b|ms\b|k\b|m\b|million|thousand|users|requests|customers|hours|minutes|"
    r"seconds|services|teams|engineers|rps|qps|tb|gb)|\$\s?\d",
    re.IGNORECASE,
)
PROJECT_EVIDENCE_TARGET = 5.0  # points for a full projects score (1 per relevant line, +0.5 if quantified)
MAX_EXCERPT = 300

STOPWORDS = {
    "or", "and", "the", "a", "an", "in", "of", "with", "to", "for", "equivalent", "experience", "practical",
    "related", "field", "degree", "years", "year", "ability", "strong", "good", "excellent", "demonstrated",
    "proven", "knowledge", "understanding", "similar", "relevant", "etc", "plus", "must", "have", "be",
    "able", "work", "working", "including", "such", "as", "on", "at", "least", "minimum", "preferred",
    "required", "is", "are", "other", "any", "comfortable", "skills", "skill", "familiarity", "experienced",
}
QUALIFICATION_SYNONYMS = {
    "bachelor": ["bachelor", "bachelors", "bachelor's", "b.s.", "bs", "bsc", "b.sc", "ba", "b.a.", "b.eng",
                 "beng", "b.tech", "btech", "undergraduate"],
    "master": ["master", "masters", "master's", "m.s.", "msc", "m.sc", "m.eng", "meng", "mba"],
    "phd": ["phd", "ph.d", "doctorate", "doctoral"],
    "certified": ["certified", "certification", "certificate"],
}


def excerpt(line: Line, term: str | None = None) -> str:
    """A verbatim excerpt of ``line`` no longer than MAX_EXCERPT characters."""
    text = line.clean
    if len(text) <= MAX_EXCERPT:
        return text
    position = 0
    if term:
        for form_match in (pattern_for(term).search(text),):
            if form_match:
                position = form_match.start()
    sentences = list(re.finditer(r"[^.;!?]+[.;!?]?", text))
    for sentence in sentences:
        if sentence.start() <= position < sentence.end() and len(sentence.group().strip()) >= 20:
            return sentence.group().strip()[:MAX_EXCERPT]
    start = max(0, position - 80)
    return text[start : start + MAX_EXCERPT].strip()


def _quote(line: Line, term: str | None = None, note: str | None = None) -> EvidenceItem:
    return EvidenceItem(quote=excerpt(line, term), kind="exact_quote", note=note)


class DemoProvider:
    name = "demo"
    model = None
    is_live = False
    method_label = "Rule-based demo evaluation (no AI model)"

    # ------------------------------------------------------------------ JD extraction
    def extract_requirements(self, job_title: str, job_description: str) -> RequirementsExtraction:
        lines = [ln.strip() for ln in job_description.splitlines()]
        section = "general"
        buckets: dict[str, list[str]] = {"required": [], "preferred": [], "general": [], "responsibilities": []}
        for line in lines:
            if not line:
                continue
            low = line.lower().rstrip(":")
            if len(low) <= 60 and re.search(r"nice[- ]to[- ]have|preferred|bonus|desirable|good to have|\bplus\b", low) and not re.search(r"\d", low):
                section = "preferred"
                continue
            if len(low) <= 60 and re.search(r"requirement|required|must[- ]have|what you('ll)? (need|bring)|qualifications|you have|about you|who you are", low):
                section = "required"
                continue
            if len(low) <= 60 and re.search(r"responsibilit|what you('ll)? do|the role|about the role|day to day", low):
                section = "responsibilities"
                continue
            buckets[section].append(line)

        notes: list[ExtractionNote] = []
        required_text = "\n".join(buckets["required"])
        preferred_text = "\n".join(buckets["preferred"])
        has_sections = bool(buckets["required"] or buckets["preferred"])
        if has_sections:
            required = find_known_skills(required_text)
            preferred = [s for s in find_known_skills(preferred_text) if s not in required]
        else:
            required = find_known_skills(job_description)
            preferred = []
            notes.append(ExtractionNote(
                field="required_skills",
                note="No 'Requirements' or 'Nice to have' headings were found, so every recognised skill was "
                "proposed as required. Move optional skills to preferred.",
            ))
        if not required:
            notes.append(ExtractionNote(
                field="required_skills",
                note="No skills from the built-in vocabulary were recognised. Add the required skills manually.",
            ))
        notes.append(ExtractionNote(
            field="required_skills",
            note="Skills are matched against a built-in vocabulary of common technical skills; skills outside "
            "it are not detected.",
        ))

        years = None
        for source in (required_text, job_description):
            match = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)\b", source, re.IGNORECASE)
            if match:
                years = float(match.group(1))
                notes.append(ExtractionNote(
                    field="min_years_experience",
                    note=f"Taken from the phrase “{match.group(0)}”. Confirm this is a minimum, not a range or preference.",
                ))
                break

        qualifications = [
            ln.lstrip("•-* ").strip() for ln in buckets["required"]
            if re.search(r"degree|bachelor|master|phd|certif|licen[cs]e", ln, re.IGNORECASE)
        ][:5]
        additional = [
            ln.lstrip("•-* ").strip() for ln in buckets["required"]
            if not find_known_skills(ln)
            and not re.search(r"degree|bachelor|master|phd|certif|licen[cs]e|\d+\s*\+?\s*years?", ln, re.IGNORECASE)
            and 12 <= len(ln) <= 200
        ][:5]
        if additional:
            notes.append(ExtractionNote(
                field="additional_criteria",
                note="Requirement lines without a recognised skill were kept as additional criteria. They are "
                "surfaced for human verification and do not change the score.",
            ))

        focus_source = f"{job_title}\n" + "\n".join(buckets["responsibilities"][:8] or lines[:8])
        focus = [t for t in find_domain_terms(focus_source) if t not in ("developer", "web")][:6]

        title_guess = None
        if not job_title.strip():
            first = next((ln for ln in lines if ln), "")
            title_guess = first[:120] if len(first) <= 80 else None

        return RequirementsExtraction(
            requirements=JobRequirements(
                required_skills=required[:20],
                preferred_skills=preferred[:20],
                min_years_experience=years,
                experience_focus=focus,
                qualifications=qualifications,
                additional_criteria=additional,
            ),
            suggested_title=title_guess,
            notes=notes,
            provider=self.name,
            model=None,
            method="Rule-based extraction (headings, keyword vocabulary, year patterns)",
        )

    # ------------------------------------------------------------------ candidate assessment
    def assess_candidate(self, context: AssessmentContext) -> CandidateAssessment:
        analysis = context.analysis
        req = context.requirements

        skills = [self._assess_skill(analysis, s, "required") for s in req.required_skills]
        skills += [self._assess_skill(analysis, s, "preferred") for s in req.preferred_skills]
        required = [s for s in skills if s.kind == "required"]
        preferred = [s for s in skills if s.kind == "preferred"]

        experience, exp_criterion = self._assess_experience(context)
        criteria = [
            self._skill_criterion(CriterionKey.REQUIRED_SKILLS, required, "required"),
            exp_criterion,
            self._projects_criterion(context),
            self._skill_criterion(CriterionKey.PREFERRED_QUALIFICATIONS, preferred, "preferred"),
        ]
        checks = [self._assess_check(analysis, q, "qualification") for q in req.qualifications]
        checks += [self._assess_check(analysis, q, "additional") for q in req.additional_criteria]

        return CandidateAssessment(
            candidate_name=analysis.name,
            summary=self._summary(required, preferred, experience, criteria),
            criteria=criteria,
            skills=skills,
            experience=experience,
            checks=checks,
            concerns=self._concerns(analysis),
        )

    def _assess_skill(self, analysis: ResumeAnalysis, skill: str, kind: str) -> SkillAssessment:
        applied = analysis.applied_lines()
        applied_idx = {ln.index for ln in applied}
        headers = {r.header.index for r in analysis.roles}
        # Prefer descriptive bullet lines over role header lines as evidence.
        applied_hits = sorted((ln for ln in applied if term_in(skill, ln.text)), key=lambda ln: ln.index in headers)
        other_hits = [
            ln for ln in analysis.content_lines if ln.index not in applied_idx and term_in(skill, ln.text)
        ]
        if applied_hits:
            return SkillAssessment(
                skill=skill, kind=kind, status=EvidenceStatus.DEMONSTRATED,
                evidence=[_quote(ln, skill) for ln in applied_hits[:2]],
                note="Mentioned in described work (experience or projects).",
            )
        if other_hits:
            return SkillAssessment(
                skill=skill, kind=kind, status=EvidenceStatus.PARTIAL,
                evidence=[_quote(other_hits[0], skill)],
                note=f"Listed in the {other_hits[0].section if other_hits[0].section != 'unknown' else 'resume'} "
                "section but not shown in described work.",
            )
        return SkillAssessment(
            skill=skill, kind=kind, status=EvidenceStatus.NOT_FOUND,
            note="Not established by the resume text. This does not mean the candidate lacks the skill.",
        )

    def _skill_criterion(self, key: CriterionKey, skills: list[SkillAssessment], kind: str) -> CriterionAssessment:
        if not skills:
            return CriterionAssessment(
                criterion=key, status=EvidenceStatus.NOT_ASSESSABLE,
                explanation=f"The job defines no {kind} skills, so this criterion is not used.",
            )
        demonstrated = [s for s in skills if s.status == EvidenceStatus.DEMONSTRATED]
        partial = [s for s in skills if s.status == EvidenceStatus.PARTIAL]
        missing = [s for s in skills if s.status == EvidenceStatus.NOT_FOUND]
        score = 100.0 * (len(demonstrated) + 0.5 * len(partial)) / len(skills)
        if not demonstrated and not partial:
            status = EvidenceStatus.NOT_FOUND
        elif score >= 75:
            status = EvidenceStatus.DEMONSTRATED
        else:
            status = EvidenceStatus.PARTIAL
        parts = [f"{len(demonstrated)} of {len(skills)} {kind} skills appear in described work"]
        if demonstrated:
            parts[0] += f" ({', '.join(s.skill for s in demonstrated)})"
        if partial:
            parts.append(f"{len(partial)} only listed without supporting work ({', '.join(s.skill for s in partial)}), counted as half")
        if missing:
            parts.append(f"not established by the resume: {', '.join(s.skill for s in missing)}")
        evidence: list[EvidenceItem] = []
        for s in demonstrated + partial:
            if s.evidence and all(e.quote != s.evidence[0].quote for e in evidence):
                evidence.append(s.evidence[0])
        evidence = evidence[:6]
        return CriterionAssessment(
            criterion=key, status=status, score=round(score, 2),
            explanation="; ".join(parts) + ".",
            evidence=evidence,
            uncertainty="Keyword-based matching may miss skills described with different wording." if missing else None,
        )

    def _assess_experience(self, context: AssessmentContext) -> tuple[ExperienceAssessment, CriterionAssessment]:
        analysis = context.analysis
        req = context.requirements
        roles = analysis.roles
        key = CriterionKey.RELEVANT_EXPERIENCE
        method = (
            "Employment date ranges parsed from the experience section; overlapping periods are counted once; "
            "year-only dates are counted conservatively. A role is relevant when its title names one of the job's "
            "focus areas or required skills, or its description mentions at least two of them."
        )
        if not roles:
            experience = ExperienceAssessment(
                method=method, notes=["No parseable employment date ranges were found."]
            )
            return experience, CriterionAssessment(
                criterion=key, status=EvidenceStatus.AMBIGUOUS,
                explanation="No employment dates could be parsed, so relevant experience was not measured. "
                "This is not evidence of a lack of experience; verify manually.",
                uncertainty="Experience could not be quantified from the resume text.",
            )

        relevance_terms = req.experience_focus + req.required_skills
        entries: list[RoleEntry] = []
        relevant_spans = []
        for role in roles:
            # Relevant when the role title names a focus area or required skill, or the
            # role's description shows at least two distinct relevant terms.
            in_title = any(term_in(t, role.title) for t in relevance_terms)
            in_block = distinct_term_hits(relevance_terms, role.block_text)
            relevant = in_title or in_block >= 2
            if relevant:
                relevant_spans.append(role.span)
            entries.append(RoleEntry(
                title=role.title[:300], start=role.span.label("start"), end=role.span.label("end"),
                months=role.span.months, relevant=relevant, quote=excerpt(role.header),
            ))
        total_months, overlap = merged_months([r.span for r in roles])
        relevant_months, _ = merged_months(relevant_spans)
        total_years = round(total_months / 12, 1)
        relevant_years = round(relevant_months / 12, 1)

        notes = []
        if overlap:
            notes.append("Overlapping roles were detected; overlapping periods were counted once.")
        if any(not r.span.month_precision for r in roles):
            notes.append("Some dates are year-only and were counted conservatively.")
        experience = ExperienceAssessment(
            total_years=total_years, relevant_years=relevant_years, method=method, roles=entries, notes=notes
        )

        target = req.min_years_experience or context.scoring_config.experience_reference_years
        target_label = (
            f"the job's minimum of {req.min_years_experience:g} years" if req.min_years_experience
            else f"a reference of {target:g} years (the job sets no minimum)"
        )
        if relevant_months == 0:
            return experience, CriterionAssessment(
                criterion=key, status=EvidenceStatus.NOT_FOUND, score=0.0,
                explanation=f"{len(roles)} dated role(s) totalling {total_years:g} years were found, but none "
                "mention the job's experience focus or required skills.",
                evidence=[_quote(r.header) for r in roles[:3]],
                uncertainty="Relevance is keyword-based; a recruiter may judge transferable experience differently.",
            )
        score = min(1.0, relevant_years / target) * 100 if target else 100.0
        status = EvidenceStatus.DEMONSTRATED if score >= 100 else EvidenceStatus.PARTIAL
        relevant_roles = [r for r, e in zip(roles, entries, strict=True) if e.relevant]
        return experience, CriterionAssessment(
            criterion=key, status=status, score=round(score, 2),
            explanation=f"About {relevant_years:g} years of relevant dated experience across "
            f"{len(relevant_roles)} role(s) (total dated experience {total_years:g} years), compared with "
            f"{target_label}.",
            evidence=[_quote(r.header) for r in relevant_roles[:4]],
            uncertainty="; ".join(notes) or None,
        )

    def _projects_criterion(self, context: AssessmentContext) -> CriterionAssessment:
        analysis = context.analysis
        req = context.requirements
        terms = req.required_skills + req.preferred_skills + req.experience_focus
        role_headers = {r.header.index for r in analysis.roles}
        applied = [ln for ln in analysis.applied_lines() if ln.index not in role_headers]
        key = CriterionKey.PROJECTS
        if not applied:
            return CriterionAssessment(
                criterion=key, status=EvidenceStatus.NOT_FOUND, score=0.0,
                explanation="No experience or project descriptions were found in the resume text.",
                uncertainty="The resume may describe work in a format the parser did not recognise.",
            )
        scored: list[tuple[float, Line, list[str]]] = []
        for line in applied:
            matched = [t for t in terms if term_in(t, line.text)]
            if not matched or not ACTION_RE.search(line.text):
                continue
            points = 1.0 + (0.5 if QUANT_RE.search(line.text) else 0.0)
            scored.append((points, line, matched))
        if not scored:
            return CriterionAssessment(
                criterion=key, status=EvidenceStatus.NOT_FOUND, score=0.0,
                explanation=f"{len(applied)} work/project line(s) were found, but none describe hands-on work "
                "with the job's skills or focus areas.",
            )
        total = sum(p for p, _, _ in scored)
        quantified = sum(1 for p, _, _ in scored if p > 1)
        score = min(1.0, total / PROJECT_EVIDENCE_TARGET) * 100
        scored.sort(key=lambda item: (-item[0], item[1].index))
        return CriterionAssessment(
            criterion=key,
            status=EvidenceStatus.DEMONSTRATED if score >= 100 else EvidenceStatus.PARTIAL,
            score=round(score, 2),
            explanation=f"{len(scored)} line(s) describe hands-on work using job-relevant skills"
            f" ({quantified} with measurable outcomes). Full marks need {PROJECT_EVIDENCE_TARGET:g} evidence "
            "points (1 per relevant line, +0.5 when quantified).",
            evidence=[_quote(line, matched[0]) for _, line, matched in scored[:5]],
        )

    def _assess_check(self, analysis: ResumeAnalysis, item: str, kind: str) -> CheckAssessment:
        words = [w for w in re.findall(r"[A-Za-z][A-Za-z.'+#]*", item) if w.lower().strip(".") not in STOPWORDS and len(w) >= 2]
        words = list(dict.fromkeys(w.lower().strip(".") for w in words))
        if not words:
            return CheckAssessment(item=item, kind=kind, status=EvidenceStatus.NOT_ASSESSABLE,
                                   note="No checkable terms in this criterion; verify manually.")

        def word_in(word: str, text: str) -> bool:
            forms = QUALIFICATION_SYNONYMS.get(word.rstrip("s'"), [word])
            return any(pattern_for(f).search(text) for f in forms) or term_in(word, text)

        best: tuple[float, Line | None] = (0.0, None)
        for line in analysis.content_lines:
            coverage = sum(1 for w in words if word_in(w, line.text)) / len(words)
            if coverage > best[0]:
                best = (coverage, line)
        coverage, line = best
        if line is None or coverage < 0.5:
            return CheckAssessment(
                item=item, kind=kind, status=EvidenceStatus.NOT_FOUND,
                note="Not established by the resume text; verify with the candidate.",
            )
        status = EvidenceStatus.DEMONSTRATED if coverage >= 0.75 else EvidenceStatus.PARTIAL
        return CheckAssessment(
            item=item, kind=kind, status=status, evidence=[_quote(line)],
            note=f"{coverage:.0%} of the key terms appear in this line; confirm it satisfies the requirement.",
        )

    def _concerns(self, analysis: ResumeAnalysis) -> list[Concern]:
        concerns: list[Concern] = []
        for line in analysis.injection_lines[:3]:
            concerns.append(Concern(
                category="embedded_instructions",
                description="The resume contains text that resembles instructions to an automated screening "
                "system. It was treated as untrusted data, ignored, and did not affect scoring.",
                evidence=[_quote(line)],
            ))
        for issue in analysis.date_issues[:4]:
            concerns.append(Concern(
                category="potential_inconsistency",
                description=f"Potential inconsistency requiring verification: {issue.message}",
                evidence=[_quote(issue.line)],
            ))
        content_chars = sum(len(ln.clean) for ln in analysis.content_lines)
        if content_chars < 400:
            concerns.append(Concern(
                category="missing_information",
                description=f"Only about {content_chars} characters of resume text were extracted; the "
                "assessment may be incomplete.",
            ))
        return concerns

    @staticmethod
    def _summary(required, preferred, experience: ExperienceAssessment, criteria) -> str:
        dem = sum(1 for s in required if s.status == EvidenceStatus.DEMONSTRATED)
        parts = [f"Rule-based demo assessment: {dem} of {len(required)} required skills shown in described work"]
        if preferred:
            pdem = sum(1 for s in preferred if s.status in (EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL))
            parts.append(f"{pdem} of {len(preferred)} preferred skills mentioned")
        if experience.relevant_years is not None:
            parts.append(f"about {experience.relevant_years:g} years of relevant dated experience")
        else:
            parts.append("experience duration could not be measured")
        projects = next(c for c in criteria if c.criterion == CriterionKey.PROJECTS)
        if projects.status in (EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL):
            parts.append("hands-on work with job-relevant skills is described")
        return "; ".join(parts) + "."
