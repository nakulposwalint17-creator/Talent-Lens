"""TalentLens API application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import candidates, sessions, system
from app.api.errors import install_error_handlers
from app.core.config import APP_VERSION, Settings, get_settings
from app.core.database import Database
from app.services.evaluation import EvaluationRunner, recover_interrupted
from app.services.providers.factory import build_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("talentlens")


def create_app(settings: Settings | None = None, *, inline_evaluation: bool = False) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.resolved_database_url.startswith("sqlite:///"):
            settings.data_dir.mkdir(parents=True, exist_ok=True)
        database = Database(settings.resolved_database_url)
        try:
            database.init_schema()
        except Exception:
            logger.exception("Database initialisation failed (%s)", settings.data_dir)
            raise
        selection = build_provider(settings)
        app.state.settings = settings
        app.state.database = database
        app.state.provider_selection = selection
        app.state.runner = EvaluationRunner(database, lambda: app.state.provider_selection.provider,
                                            inline=inline_evaluation)
        with database.session() as db:
            recovered = recover_interrupted(db)
        if recovered:
            logger.warning("Marked %d interrupted evaluation(s) as failed; they can be retried.", recovered)
        mode = "LIVE (Anthropic, model %s)" % selection.provider.model if selection.provider.is_live else "DEMO"
        logger.info("TalentLens API %s ready — provider mode: %s", APP_VERSION, mode)
        if selection.warning:
            logger.warning(selection.warning)
        yield
        app.state.runner.shutdown()
        database.engine.dispose()

    app = FastAPI(
        title="TalentLens API",
        version=APP_VERSION,
        description=(
            "AI-assisted, evidence-backed resume screening. Decision support only: every score is explainable, "
            "every quote is verified against the resume, and recruiter decisions never overwrite the original "
            "assessment."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition"],
    )
    install_error_handlers(app)
    app.include_router(system.router)
    app.include_router(sessions.router)
    app.include_router(candidates.router)
    return app


app = create_app()
