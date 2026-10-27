import math

import pytest
from pydantic import ValidationError

from app.schemas.assessment import CriterionAssessment, CriterionKey, EvidenceStatus
from app.schemas.scoring import Recommendation, ScoringConfig
from app.services.scoring import ScoringError, compute_score, recommendation_for, round_half_up

K = CriterionKey
S = EvidenceStatus


def crit(key: CriterionKey, score: float | None, status: EvidenceStatus = S.DEMONSTRATED) -> CriterionAssessment:
    return CriterionAssessment(criterion=key, status=status, score=score, explanation="test")


def all_criteria(r=100.0, e=100.0, p=100.0, q=100.0):
    return [crit(K.REQUIRED_SKILLS, r), crit(K.RELEVANT_EXPERIENCE, e), crit(K.PROJECTS, p),
            crit(K.PREFERRED_QUALIFICATIONS, q)]


def test_exact_weighted_calculation():
    result = compute_score(all_criteria(80, 60, 50, 40), ScoringConfig())
    # 0.40*80 + 0.25*60 + 0.20*50 + 0.15*40 = 32 + 15 + 10 + 6 = 63
    assert result.overall_score == 63.0
    contributions = {c.criterion: c.contribution for c in result.contributions}
    assert contributions == {K.REQUIRED_SKILLS: 32.0, K.RELEVANT_EXPERIENCE: 15.0, K.PROJECTS: 10.0,
                             K.PREFERRED_QUALIFICATIONS: 6.0}
    assert result.evidence_completeness == 1.0
    assert result.recommendation == Recommendation.LOWER_MATCH


def test_minimum_and_maximum_scores():
    assert compute_score(all_criteria(0, 0, 0, 0), ScoringConfig()).overall_score == 0.0
    assert compute_score(all_criteria(100, 100, 100, 100), ScoringConfig()).overall_score == 100.0


@pytest.mark.parametrize("bad", [-1, 100.5, float("nan"), float("inf"), float("-inf")])
def test_invalid_criterion_scores_rejected(bad):
    with pytest.raises(ValidationError):
        crit(K.REQUIRED_SKILLS, bad)


def test_scored_status_requires_score_and_not_found_must_be_zero():
    with pytest.raises(ValidationError):
        CriterionAssessment(criterion=K.PROJECTS, status=S.DEMONSTRATED, score=None, explanation="x")
    with pytest.raises(ValidationError):
        CriterionAssessment(criterion=K.PROJECTS, status=S.NOT_FOUND, score=40, explanation="x")
    # Ambiguous criteria never carry a score, even if one is supplied.
    assert CriterionAssessment(criterion=K.PROJECTS, status=S.AMBIGUOUS, score=70, explanation="x").score is None


def test_default_weights_sum_to_100():
    config = ScoringConfig()
    assert math.isclose(sum(config.weights.values()), 100.0)
    assert config.weights[K.REQUIRED_SKILLS] == 40


@pytest.mark.parametrize("weights", [
    {K.REQUIRED_SKILLS: 50, K.RELEVANT_EXPERIENCE: 25, K.PROJECTS: 20, K.PREFERRED_QUALIFICATIONS: 15},  # 110
    {K.REQUIRED_SKILLS: 40, K.RELEVANT_EXPERIENCE: 25, K.PROJECTS: 35},  # missing key
    {K.REQUIRED_SKILLS: -10, K.RELEVANT_EXPERIENCE: 55, K.PROJECTS: 40, K.PREFERRED_QUALIFICATIONS: 15},
    {K.REQUIRED_SKILLS: float("nan"), K.RELEVANT_EXPERIENCE: 25, K.PROJECTS: 20, K.PREFERRED_QUALIFICATIONS: 15},
])
def test_invalid_weights_rejected(weights):
    with pytest.raises(ValidationError):
        ScoringConfig(weights=weights)


def test_custom_weights_are_applied():
    config = ScoringConfig(weights={K.REQUIRED_SKILLS: 70, K.RELEVANT_EXPERIENCE: 10, K.PROJECTS: 10,
                                    K.PREFERRED_QUALIFICATIONS: 10})
    assert compute_score(all_criteria(100, 0, 0, 0), config).overall_score == 70.0


@pytest.mark.parametrize("score,expected", [
    (100, Recommendation.STRONG_MATCH), (80, Recommendation.STRONG_MATCH),
    (79.99, Recommendation.POTENTIAL_MATCH), (65, Recommendation.POTENTIAL_MATCH),
    (64.99, Recommendation.LOWER_MATCH), (0, Recommendation.LOWER_MATCH),
])
def test_recommendation_thresholds(score, expected):
    assert recommendation_for(score, 1.0, ScoringConfig()) == expected


def test_threshold_uses_rounded_score_consistently():
    # 79.96 rounds to 80.0 for display, so it must also be banded as strong.
    result = compute_score(all_criteria(79.96, 79.96, 79.96, 79.96), ScoringConfig())
    assert result.overall_score == 80.0
    assert result.recommendation == Recommendation.STRONG_MATCH


def test_ambiguous_criterion_excluded_and_weights_renormalised():
    criteria = all_criteria(100, 0, 50, 50)
    criteria[1] = crit(K.RELEVANT_EXPERIENCE, None, S.AMBIGUOUS)
    result = compute_score(criteria, ScoringConfig())
    # Remaining weights 40/20/15 = 75 → (40*100 + 20*50 + 15*50) / 75
    assert result.overall_score == round_half_up((4000 + 1000 + 750) / 75, 1)
    assert result.evidence_completeness == 0.75
    excluded = next(c for c in result.contributions if c.criterion == K.RELEVANT_EXPERIENCE)
    assert excluded.included is False and excluded.contribution is None
    assert any("could not be assessed" in n for n in result.notes)


def test_not_found_is_scored_not_excluded():
    criteria = all_criteria(100, 100, 100, 100)
    criteria[2] = crit(K.PROJECTS, 0, S.NOT_FOUND)
    result = compute_score(criteria, ScoringConfig())
    assert result.evidence_completeness == 1.0
    assert result.overall_score == 80.0


def test_low_completeness_yields_insufficient_evidence():
    criteria = [crit(K.REQUIRED_SKILLS, None, S.AMBIGUOUS), crit(K.RELEVANT_EXPERIENCE, None, S.AMBIGUOUS),
                crit(K.PROJECTS, 100), crit(K.PREFERRED_QUALIFICATIONS, 100)]
    result = compute_score(criteria, ScoringConfig())
    assert result.evidence_completeness == 0.35
    assert result.recommendation == Recommendation.INSUFFICIENT_EVIDENCE


def test_no_assessable_criteria_gives_no_score():
    criteria = [crit(k, None, S.NOT_ASSESSABLE) for k in K]
    result = compute_score(criteria, ScoringConfig())
    assert result.overall_score is None
    assert result.recommendation == Recommendation.INSUFFICIENT_EVIDENCE


def test_criteria_not_used_by_job_do_not_reduce_completeness():
    criteria = all_criteria(80, 80, 80, 0)
    criteria[3] = crit(K.PREFERRED_QUALIFICATIONS, None, S.NOT_ASSESSABLE)
    result = compute_score(criteria, ScoringConfig(), not_applicable={K.PREFERRED_QUALIFICATIONS})
    assert result.evidence_completeness == 1.0
    assert result.overall_score == 80.0


def test_deterministic_repeated_calculation():
    criteria = all_criteria(73.3, 41.7, 88.8, 12.5)
    results = {compute_score(criteria, ScoringConfig()).model_dump_json() for _ in range(20)}
    assert len(results) == 1


def test_malformed_inputs_raise():
    with pytest.raises(ScoringError):
        compute_score(all_criteria()[:3], ScoringConfig())  # missing criterion
    with pytest.raises(ScoringError):
        compute_score([*all_criteria(), crit(K.PROJECTS, 10)], ScoringConfig())  # duplicate
    with pytest.raises(ScoringError):
        compute_score([{"criterion": "projects"}], ScoringConfig())  # type: ignore[list-item]


def test_round_half_up():
    assert round_half_up(64.95, 1) == 65.0
    assert round_half_up(64.94, 1) == 64.9
