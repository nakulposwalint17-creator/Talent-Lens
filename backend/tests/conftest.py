from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest
from docx import Document
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SAMPLES = Path(__file__).resolve().parents[2] / "samples"

REQUIREMENTS = {
    "required_skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "CI/CD"],
    "preferred_skills": ["Kubernetes", "AWS", "Terraform", "Redis"],
    "min_years_experience": 5,
    "experience_focus": ["backend", "API"],
    "qualifications": ["Bachelor's degree in Computer Science or equivalent practical experience"],
    "additional_criteria": [],
}

RESUME_LINES = [
    "Jordan Example",
    "jordan@example.com | +1 555 0110",
    "",
    "EXPERIENCE",
    "Backend Engineer, Example Corp | Jan 2019 - Present",
    "• Built FastAPI services on PostgreSQL serving 5k requests per second.",
    "• Automated CI/CD pipelines with GitHub Actions and Docker, cutting deploy time by 50%.",
    "",
    "SKILLS",
    "Python, FastAPI, PostgreSQL, Docker, Kubernetes",
    "",
    "EDUCATION",
    "B.S. Computer Science, Example University, 2018",
]


def make_pdf(lines: list[str] | None = None, *, password: str | None = None) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    y = 50
    for line in lines if lines is not None else RESUME_LINES:
        page.insert_text((50, y), line, fontsize=10)
        y += 14
    buf = io.BytesIO()
    if password:
        doc.save(buf, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password + "-owner")
    else:
        doc.save(buf)
    doc.close()
    return buf.getvalue()


def make_image_only_pdf() -> bytes:
    src = pymupdf.open()
    page = src.new_page()
    page.insert_text((50, 50), "Scanned resume text that is only an image", fontsize=12)
    png = page.get_pixmap(dpi=50).tobytes("png")
    out = pymupdf.open()
    out.new_page().insert_image(pymupdf.Rect(0, 0, 595, 842), stream=png)
    data = out.tobytes()
    out.close()
    src.close()
    return data


def make_docx(lines: list[str] | None = None) -> bytes:
    document = Document()
    for line in lines if lines is not None else RESUME_LINES:
        document.add_paragraph(line)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _isolate_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Tests never use a real API key or the developer's local configuration.
    for name in ("ANTHROPIC_API_KEY", "AI_PROVIDER", "DATABASE_URL", "DATA_DIR", "ANTHROPIC_MODEL"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(DATA_DIR=str(tmp_path), AI_PROVIDER="demo", MAX_UPLOAD_MB=1, _env_file=None)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings, inline_evaluation=True)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def session_id(client: TestClient) -> str:
    response = client.post("/api/sessions", json={
        "job_title": "Senior Backend Engineer",
        "job_description": "Build Python APIs.",
        "requirements": REQUIREMENTS,
    })
    assert response.status_code == 201, response.text
    return response.json()["session"]["id"]


def upload(client: TestClient, session_id: str, *files: tuple[str, bytes]):
    payload = [("files", (name, data, "application/octet-stream")) for name, data in files]
    return client.post(f"/api/sessions/{session_id}/resumes", files=payload)
