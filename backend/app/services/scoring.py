"""Deterministic, provider-independent scoring engine.

Overall score = Σ(criterion score × normalised weight) over *assessable* criteria.

Missing-evidence policy
-----------------------
* ``demonstrated`` / ``partial`` / ``not_found`` criteria are assessable and scored
  0–100 from resume evidence. ``not_found`` means "not established by the resume",
  never "the candidate lacks this".
* ``ambiguous`` / ``not_assessable`` criteria are excluded and the remaining
  weights are renormalised. Evidence completeness = assessed weight ÷ applicable
  weight. Below ``min_evidence_completeness`` the recommendation is
  ``insufficient_evidence`` regardless of the numeric score.
* Criteria the *job* does not use (e.g. no preferred skills defined) are not
  applicable and do not reduce evidence completeness.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from app.schemas.assessment import (
    CRITERION_LABELS,
    SCORED_STATUSES,
    CriterionAssessment,
    CriterionKey,
)
from app.schemas.scoring import CriterionContribution, Recommendation, ScoringConfig, ScoringResult


class ScoringError(ValueError):
    """Raised when inputs to the scoring engine are malformed."""


def round_half_up(value: float, places: int = 1) -> float:
    quant = Decimal(1).scaleb(-places)
    return float(Decimal(str(value)).quantize(quant, rounding=ROUND_HALF_UP))


def recommendation_for(score: float, completeness: float, config: ScoringConfig) -> Recommendation:
    if completeness < config.min_evidence_completeness:
        return Recommendation.INSUFFICIENT_EVIDENCE
    if score >= config.strong_threshold:
        return Recommendation.STRONG_MATCH
    if score >= config.potential_threshold:
        return Recommendation.POTENTIAL_MATCH
    return Recommendation.LOWER_MATCH


def compute_score(
    criteria: Iterable[CriterionAssessment],
    config: ScoringConfig,
    not_applicable: Iterable[CriterionKey] = (),
) -> ScoringResult:
    by_key: dict[CriterionKey, CriterionAssessment] = {}
    for item in criteria:
        if not isinstance(item, CriterionAssessment):
            raise ScoringError("criteria must be CriterionAssessment instances")
        if item.criterion in by_key:
            raise ScoringError(f"duplicate criterion: {item.criterion}")
        by_key[item.criterion] = item

    missing = set(CriterionKey) - set(by_key)
    if missing:
        raise ScoringError(f"missing criteria: {', '.join(sorted(missing))}")

    excluded_for_job = set(not_applicable)
    applicable_weight = 0.0
    assessed_weight = 0.0
    for key in CriterionKey:
        weight = config.weights[key]
        if key in excluded_for_job or weight <= 0:
            continue
        applicable_weight += weight
        if by_key[key].status in SCORED_STATUSES:
            score = by_key[key].score
            if score is None or not math.isfinite(score) or not 0 <= score <= 100:
                raise ScoringError(f"invalid score for {key}: {score!r}")
            assessed_weight += weight

    notes: list[str] = []
    contributions: list[CriterionContribution] = []
    raw_total = 0.0
    for key in CriterionKey:
        item = by_key[key]
        weight = config.weights[key]
        included = (
            key not in excluded_for_job and weight > 0 and item.status in SCORED_STATUSES and assessed_weight > 0
        )
        effective = weight / assessed_weight if included else 0.0
        contribution = (item.score or 0.0) * effective if included else None
        if included:
            raw_total += contribution or 0.0
        elif key in excluded_for_job:
            notes.append(f"{CRITERION_LABELS[key]} is not used by this job's criteria; its weight was redistributed.")
        elif weight > 0:
            notes.append(
                f"{CRITERION_LABELS[key]} could not be assessed ({item.status.value.replace('_', ' ')}); "
                "it was excluded and the remaining weights were renormalised."
            )
        contributions.append(
            CriterionContribution(
                criterion=key,
                label=CRITERION_LABELS[key],
                weight=weight,
                effective_weight=round(effective * 100, 2),
                status=item.status,
                score=round_half_up(item.score, 1) if item.score is not None else None,
                contribution=round_half_up(contribution, 2) if contribution is not None else None,
                included=included,
                explanation=item.explanation,
            )
        )

    completeness = (assessed_weight / applicable_weight) if applicable_weight > 0 else 0.0
    completeness = round(completeness, 4)

    if assessed_weight <= 0:
        notes.append("No criterion could be assessed from the available evidence.")
        return ScoringResult(
            overall_score=None,
            recommendation=Recommendation.INSUFFICIENT_EVIDENCE,
            evidence_completeness=completeness,
            assessed_weight=0.0,
            contributions=contributions,
            notes=notes,
        )

    overall = round_half_up(min(100.0, max(0.0, raw_total)), 1)
    recommendation = recommendation_for(overall, completeness, config)
    if recommendation == Recommendation.INSUFFICIENT_EVIDENCE:
        notes.append(
            f"Only {completeness:.0%} of the criteria weight could be assessed "
            f"(minimum {config.min_evidence_completeness:.0%}); the score is shown for reference only."
        )
    return ScoringResult(
        overall_score=overall,
        recommendation=recommendation,
        evidence_completeness=completeness,
        assessed_weight=round(assessed_weight, 4),
        contributions=contributions,
        notes=notes,
    )
