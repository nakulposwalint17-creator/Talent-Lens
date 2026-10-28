"""SQLAlchemy engine/session management and database initialisation."""

from __future__ import annotations

import logging
from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


# (table, column, SQL type) added after the first release. Static strings only.
_ADDED_COLUMNS = [
    ("screening_sessions", "owner_id", "VARCHAR(32)"),
    ("recruiter_reviews", "recorded_by", "VARCHAR(254)"),
    ("audit_events", "actor", "VARCHAR(254)"),
]


class Database:
    """Owns the engine and session factory so tests can create isolated instances."""

    def __init__(self, url: str) -> None:
        if url.startswith("sqlite"):
            self.engine: Engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)
            event.listen(self.engine, "connect", _sqlite_pragmas)
        else:
            # Hosted Postgres drops idle connections; check before use and recycle periodically.
            self.engine = create_engine(url, pool_pre_ping=True, pool_recycle=300, future=True)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False, future=True)

    def init_schema(self) -> None:
        # Import models so they register with the metadata before create_all.
        from app import models  # noqa: F401

        Base.metadata.create_all(self.engine)
        self._add_missing_columns()

    def _add_missing_columns(self) -> None:
        """Additive migrations for databases created by earlier versions (create_all never alters tables)."""
        existing = inspect(self.engine)
        with self.engine.begin() as conn:
            for table, column, ddl in _ADDED_COLUMNS:
                if existing.has_table(table) and column not in {c["name"] for c in existing.get_columns(table)}:
                    logger.info("Migrating: adding %s.%s", table, column)
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

    def session(self) -> Session:
        return self.session_factory()

    def session_scope(self) -> Iterator[Session]:
        db = self.session_factory()
        try:
            yield db
        finally:
            db.close()


def _sqlite_pragmas(dbapi_connection, _record) -> None:  # pragma: no cover - driver hook
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()
