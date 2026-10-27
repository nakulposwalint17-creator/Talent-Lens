"""Skill-term matching used by the rule-based demo provider and requirement extraction.

Matching is deliberately conservative and explainable:
* ``SYNONYMS`` are true equivalents (bidirectional), e.g. PostgreSQL ⇄ Postgres.
* ``SPECIALISATIONS`` are one-directional: evidence of a specific tool counts as
  evidence of the general skill (GitHub Actions → CI/CD), never the reverse.
"""

from __future__ import annotations

import re
from functools import lru_cache

SYNONYMS: list[list[str]] = [
    ["postgresql", "postgres", "psql"],
    ["javascript", "ecmascript"],
    ["kubernetes", "k8s"],
    ["aws", "amazon web services"],
    ["gcp", "google cloud", "google cloud platform"],
    ["azure", "microsoft azure"],
    ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"],
    ["rest apis", "rest api", "restful", "restful apis", "restful services", "rest services"],
    ["node.js", "nodejs"],
    ["react", "react.js", "reactjs"],
    ["next.js", "nextjs"],
    ["vue", "vue.js", "vuejs"],
    ["machine learning", "ml"],
    ["golang", "go"],
    ["terraform"],
    ["infrastructure as code", "iac"],
    ["microservices", "micro-services", "microservice architecture"],
    ["message queues", "message queue", "message broker", "message brokers"],
    ["mongodb", "mongo"],
    ["scikit-learn", "sklearn"],
    ["distributed systems", "distributed system"],
    ["unit testing", "unit tests"],
    ["c#", "csharp"],
    ["c++", "cpp"],
    ["spring boot", "springboot"],
    ["github actions", "gh actions"],
]

SPECIALISATIONS: dict[str, list[str]] = {
    "ci/cd": ["github actions", "gitlab ci", "jenkins", "circleci", "argo cd", "argocd"],
    "message queues": ["kafka", "rabbitmq", "sqs", "pub/sub", "nats", "celery"],
    "observability": ["prometheus", "grafana", "datadog", "opentelemetry", "new relic"],
    "testing": ["pytest", "unit testing", "unit tests", "integration tests", "jest", "test automation"],
    "automated testing": ["pytest", "unit testing", "unit tests", "integration tests", "jest"],
    "cloud": ["aws", "gcp", "azure", "amazon web services", "google cloud"],
    "cloud platforms": ["aws", "gcp", "azure", "amazon web services", "google cloud"],
    "sql": ["postgresql", "postgres", "mysql", "sqlite", "sql server", "t-sql"],
    "relational databases": ["postgresql", "postgres", "mysql", "sql server", "sqlite"],
    "containerization": ["docker", "kubernetes", "k8s", "containers"],
    "version control": ["git", "github", "gitlab"],
    "infrastructure as code": ["terraform", "pulumi", "cloudformation"],
    "caching": ["redis", "memcached"],
}

# Display names used when proposing skills from a job description.
KNOWN_SKILLS: list[str] = [
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "C++", "C#", "Ruby", "PHP", "Kotlin",
    "Swift", "Scala", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka",
    "RabbitMQ", "FastAPI", "Django", "Flask", "Spring Boot", "Node.js", "Express", "React", "Next.js",
    "Vue", "Angular", "GraphQL", "REST APIs", "gRPC", "Docker", "Kubernetes", "Terraform", "AWS", "GCP",
    "Azure", "CI/CD", "GitHub Actions", "Jenkins", "Linux", "Git", "Microservices", "Distributed systems",
    "System design", "Celery", "Airflow", "Spark", "Pandas", "NumPy", "PyTorch", "TensorFlow",
    "scikit-learn", "Machine learning", "Data modeling", "ETL", "Observability", "Prometheus", "Grafana",
    "OpenTelemetry", "Datadog", "pytest", "Unit testing", "Automated testing", "HTML", "CSS",
    "Tailwind CSS", "Figma", "Tableau", "Power BI", "Snowflake", "dbt", "BigQuery", "OAuth",
    "SQLAlchemy", "Message queues", "Caching", "Infrastructure as code", "Agile", "Scrum",
]

DOMAIN_TERMS: list[str] = [
    "backend", "back-end", "frontend", "front-end", "full-stack", "full stack", "api", "platform engineering",
    "infrastructure", "data engineering", "machine learning", "devops", "site reliability",
    "mobile", "security", "distributed systems", "cloud", "software engineer", "software engineering",
    "developer", "web", "analytics",
]


def _norm(term: str) -> str:
    return " ".join(term.casefold().split())


@lru_cache(maxsize=2048)
def expand_term(term: str) -> tuple[str, ...]:
    """All surface forms that count as evidence for ``term``."""
    key = _norm(term)
    forms: list[str] = [key]
    for group in SYNONYMS:
        if key in group:
            forms.extend(group)
    for general, specifics in SPECIALISATIONS.items():
        if key == general or key in next((g for g in SYNONYMS if general in g), [general]):
            forms.extend(specifics)
    # Singular variant ("message queues" also matches "message queue").
    if key.endswith("s") and len(key) > 4 and not key.endswith("ss"):
        forms.append(key[:-1])
    seen: set[str] = set()
    ordered = []
    for f in forms:
        if f and f not in seen:
            seen.add(f)
            ordered.append(f)
    return tuple(ordered)


@lru_cache(maxsize=4096)
def pattern_for(form: str) -> re.Pattern[str]:
    escaped = re.escape(form).replace(r"\ ", r"[\s\-_]+")
    flags = re.IGNORECASE
    if len(form) <= 2:
        # Very short terms (Go, ML, R) only match when capitalised, to avoid
        # matching ordinary words such as "go".
        variants = sorted({form.upper(), form[:1].upper() + form[1:]})
        escaped = "(?:" + "|".join(re.escape(v) for v in variants) + ")"
        flags = 0
    # Allow a simple plural ("API" matches "APIs") for alphabetic terms.
    plural = "(?:s|es)?" if len(form) >= 3 and form[-1].isalpha() else ""
    return re.compile(rf"(?<![A-Za-z0-9+#]){escaped}{plural}(?![A-Za-z0-9+#])", flags)


def term_in(term: str, text: str) -> bool:
    return any(pattern_for(form).search(text) for form in expand_term(term))


def distinct_term_hits(terms: list[str], text: str) -> int:
    """Number of distinct, non-overlapping places where any of ``terms`` occurs.

    "REST APIs" and "API" matching the same phrase count once, so one phrase can't
    satisfy a "two relevant terms" rule on its own.
    """
    spans: list[tuple[int, int]] = []
    for term in terms:
        for form in expand_term(term):
            match = pattern_for(form).search(text)
            if match:
                spans.append(match.span())
                break
    spans.sort()
    count = 0
    current_end = -1
    for start, end in spans:
        if start >= current_end:
            count += 1
            current_end = end
        else:
            current_end = max(current_end, end)
    return count


def find_known_skills(text: str) -> list[str]:
    """Known skills mentioned in ``text``, in order of first appearance."""
    hits: list[tuple[int, str]] = []
    for skill in KNOWN_SKILLS:
        positions = [m.start() for form in _direct_forms(skill) for m in pattern_for(form).finditer(text)]
        if positions:
            hits.append((min(positions), skill))
    hits.sort()
    found: list[str] = []
    for _, skill in hits:
        if skill not in found:
            found.append(skill)
    return found


def _direct_forms(term: str) -> tuple[str, ...]:
    key = _norm(term)
    for group in SYNONYMS:
        if key in group:
            return tuple(group)
    return (key,)


def find_domain_terms(text: str) -> list[str]:
    found: list[str] = []
    for term in DOMAIN_TERMS:
        if pattern_for(term).search(text):
            canonical = term.replace("back-end", "backend").replace("front-end", "frontend").replace(
                "full stack", "full-stack"
            )
            if canonical not in found:
                found.append(canonical)
    return found
