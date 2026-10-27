# Synthetic sample data

Everything here is **invented** for demonstration and testing. The people, companies, email addresses (`@example.com`) and phone numbers (`555-01xx`) are fictional, and every resume ends with a line stating it is synthetic. Do not add real candidate data to this repository.

Regenerate all files (deterministic content) from the repository root:

```bash
backend/.venv/bin/python samples/generate_samples.py
```

## `job-description-senior-backend-engineer.txt`

A fictional posting with *Requirements* and *Nice to have* sections, used by **New screening → Use sample job**.

## `resumes/`

| File | What it demonstrates |
|---|---|
| `amara-okafor.pdf` | Strong match: 7+ years of backend work with quantified outcomes |
| `amara-okafor-copy.docx` | Same text as the PDF in a different format → **exact-text duplicate** |
| `daniel-reyes.docx` | Potential match: Django/Flask rather than FastAPI; economics degree → qualification flagged for verification |
| `daniel-reyes-updated.pdf` | Edited copy of Daniel (new email/phone, one bullet reworded) → **near duplicate** (~0.86 similarity) |
| `mei-lin-chen.pdf` | Career changer: analyst years not counted as backend experience; strong projects |
| `sam-patel.docx` | Freelancer with no dates → experience *ambiguous*, excluded; 75% evidence completeness |
| `riley-morgan.pdf` | Contains an instruction aimed at the screening system → flagged, ignored, not used as evidence |
| `jonas-weber.docx` | Frontend profile (lower match) with an impossible date range → *potential inconsistency requiring verification* |

## `edge-cases/`

| File | Expected result |
|---|---|
| `corrupted-resume.pdf` | Unreadable file — damaged PDF |
| `scanned-image-only.pdf` | Needs OCR / manual review (image only, no text layer) |
| `password-protected.pdf` | Unreadable — password-protected (password `secret`, for testing only) |
| `empty-resume.docx` | Empty document |
| `legacy-format.doc` | Unsupported legacy Word format |
| `notes.txt` | Rejected by the browser before upload (unsupported type); rejected by the API if sent directly |
| `pdf-with-docx-extension.docx` | Valid PDF with the wrong extension → processed as PDF with a warning; very little text → *Insufficient evidence* |
