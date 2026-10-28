"""Error and edge paths of the screening API and the background evaluation worker."""

from __future__ import annotations

import dataclasses
import time

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Candidate
from app.services.evaluation import EvaluationRunner
from app.services.providers.base import ProviderError
from app.services.providers.demo import DemoProvider
from tests.conftest import REQUIREMENTS, auth, login, make_docx, make_pdf, make_settings, upload


def _candidates(client, sid):
    return client.get(f"/api/sessions/{sid}").json()["candidates"]


def _set_status(client, cid: str, status: str) -> None:
    with client.app.state.database.session() as db:
        db.get(Candidate, cid).evaluation_status = status
        db.commit()


class _FailingProvider:
    name, model, is_live, method_label = "failing", None, False, "failing"

    def extract_requirements(self, job_title, job_description):
        raise ProviderError("timeout", "The AI provider did not respond in time.", retryable=True)

    def assess_candidate(self, context):
        raise ProviderError("refused", "Declined.")


def _use(client, provider) -> None:
    state = client.app.state
    state.provider_selection = dataclasses.replace(state.provider_selection, provider=provider)


def test_extraction_failure_is_reported_with_a_manual_fallback(client):
    _use(client, _FailingProvider())
    response = client.post("/api/requirements/extract", json={"job_description": "x" * 40})
    assert response.status_code == 502
    body = response.json()["error"]
    assert body["code"] == "extraction_timeout" and "enter the criteria manually" in body["message"]


def test_update_requirements_edits_metadata_without_new_version(client, session_id):
    response = client.put(f"/api/sessions/{session_id}/requirements", json={
        "job_title": "  Staff   Engineer ", "department": "  ", "job_description": "Updated.",
        "requirements": REQUIREMENTS,
    })
    session = response.json()["session"]
    assert session["job_title"] == "Staff Engineer" and session["department"] is None
    assert session["requirements_version"] == 1  # criteria unchanged, so evaluations stay current
    weights = {"required_skills": 70, "relevant_experience": 10, "projects": 10, "preferred_qualifications": 10}
    reweighted = client.put(f"/api/sessions/{session_id}/requirements",
                            json={"requirements": REQUIREMENTS, "scoring_weights": weights}).json()["session"]
    assert reweighted["requirements_version"] == 2


def test_criteria_edits_and_deletion_wait_for_running_evaluations(client, session_id):
    upload(client, session_id, ("cv.pdf", make_pdf()))
    cid = _candidates(client, session_id)[0]["id"]
    _set_status(client, cid, "running")
    put = client.put(f"/api/sessions/{session_id}/requirements", json={"requirements": REQUIREMENTS})
    assert put.status_code == 409 and put.json()["error"]["code"] == "evaluation_in_progress"
    assert client.delete(f"/api/sessions/{session_id}").status_code == 409
    assert client.post(f"/api/candidates/{cid}/evaluate").status_code == 409
    assert client.post(f"/api/candidates/{cid}/decisions", json={"decision": "hold"}).status_code == 409


def test_too_many_files_in_one_request(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, MAX_FILES_PER_REQUEST=2), inline_evaluation=True)) as client:
        client.headers.update(auth(login(client)))
        sid = client.post("/api/sessions", json={"job_title": "Eng", "requirements": REQUIREMENTS}).json()
        response = upload(client, sid["session"]["id"], *[(f"{i}.pdf", make_pdf()) for i in range(3)])
        assert response.status_code == 413 and response.json()["error"]["code"] == "too_many_files"


def test_storage_failure_affects_only_that_file(client, session_id, monkeypatch):
    import app.api.sessions as sessions_api

    real_store = sessions_api.store_candidate

    def flaky(db, session, name, *args, **kwargs):
        if name == "bad.pdf":
            raise RuntimeError("disk full")
        return real_store(db, session, name, *args, **kwargs)

    monkeypatch.setattr(sessions_api, "store_candidate", flaky)
    response = upload(client, session_id, ("bad.pdf", make_pdf()), ("good.docx", make_docx())).json()
    assert response["accepted"] == 1 and response["failed"] == 1
    assert response["results"][0]["error"]["code"] == "upload_failed"


def test_evaluation_scopes_and_explicit_ids(client, session_id):
    upload(client, session_id, ("a.pdf", make_pdf()), ("b.docx", make_docx(["Robin Sample", "x" * 60])))
    first, second = (c["id"] for c in _candidates(client, session_id))
    only = client.post(f"/api/sessions/{session_id}/evaluate", json={"candidate_ids": [first]}).json()
    assert only["candidate_ids"] == [first]
    assert client.post(f"/api/sessions/{session_id}/evaluate", json={"scope": "failed"}).json()["queued"] == 0
    assert client.post(f"/api/sessions/{session_id}/evaluate", json={"scope": "stale"}).json()["queued"] == 0
    everything = client.post(f"/api/sessions/{session_id}/evaluate", json={"scope": "all"}).json()
    assert set(everything["candidate_ids"]) == {first, second}
    nothing = client.post(f"/api/sessions/{session_id}/evaluate", json={}).json()
    assert nothing["queued"] == 0 and nothing["message"] == "No candidates needed evaluation."

    _use(client, _FailingProvider())
    client.post(f"/api/sessions/{session_id}/evaluate", json={"scope": "all"})
    assert {c["evaluation_status"] for c in _candidates(client, session_id)} == {"failed"}
    _use(client, DemoProvider())
    retried = client.post(f"/api/sessions/{session_id}/evaluate", json={"scope": "failed"}).json()
    assert retried["queued"] == 2


def test_candidate_retry_guards(client, session_id):
    upload(client, session_id, ("cv.pdf", make_pdf()), ("copy.pdf", make_pdf()), ("bad.pdf", b"%PDF-1.4 junk"))
    by_name = {c["original_filename"]: c for c in _candidates(client, session_id)}
    unreadable = client.post(f"/api/candidates/{by_name['bad.pdf']['id']}/evaluate")
    assert unreadable.status_code == 409 and unreadable.json()["error"]["code"] == "not_evaluable"
    duplicate = client.post(f"/api/candidates/{by_name['copy.pdf']['id']}/evaluate")
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "duplicate_excluded"
    unique = client.put(f"/api/candidates/{by_name['cv.pdf']['id']}/duplicate-resolution",
                        json={"resolution": "confirmed_duplicate"})
    assert unique.status_code == 409 and unique.json()["error"]["code"] == "not_a_duplicate"
    assert client.get("/api/candidates/missing").status_code == 404


def test_background_worker_processes_and_survives_failures(tmp_path):
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings)) as client:  # real background thread, not inline
        client.headers.update(auth(login(client)))
        sid = client.post("/api/sessions", json={"job_title": "Eng", "requirements": REQUIREMENTS}).json()
        sid = sid["session"]["id"]
        upload(client, sid, ("cv.pdf", make_pdf()))
        client.post(f"/api/sessions/{sid}/evaluate", json={})
        deadline = time.monotonic() + 10
        while _candidates(client, sid)[0]["evaluation_status"] in ("queued", "running"):
            assert time.monotonic() < deadline
            time.sleep(0.05)
        assert _candidates(client, sid)[0]["evaluation_status"] == "completed"


def test_worker_records_unexpected_errors_as_failures(client, session_id, monkeypatch):
    import app.services.evaluation as evaluation

    upload(client, session_id, ("cv.pdf", make_pdf()))
    cid = _candidates(client, session_id)[0]["id"]
    _set_status(client, cid, "queued")
    def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(evaluation, "evaluate_candidate", explode)
    runner = EvaluationRunner(client.app.state.database, lambda: client.app.state.provider_selection.provider,
                              inline=True)
    runner.submit([cid, "does-not-exist"])
    runner.submit([])
    detail = client.get(f"/api/candidates/{cid}").json()
    assert detail["evaluation_status"] == "failed"
    assert detail["evaluation"]["error_code"] == "internal_error"
