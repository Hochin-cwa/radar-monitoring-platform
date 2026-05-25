"""
FastAPI application entry point for radar-monitoring-platform.
"""

from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.routers.completeness import router as completeness_router
from backend.routers.computers import router as computers_router
from backend.routers.history import router as history_router
from backend.routers.instruments import router as instruments_router
from backend.routers.system import router as system_router

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.handlers.RotatingFileHandler(
            _LOG_DIR / "app.log",
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        ),
        logging.StreamHandler(),
    ],
)

logger = logging.getLogger("main")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="雷達監控整合平台",
    description="Radar Monitoring Platform API",
    version="1.0.0",
)

app.include_router(completeness_router)
app.include_router(computers_router)
app.include_router(instruments_router)
app.include_router(system_router)
app.include_router(history_router)

# Serve frontend static files
_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")

logger.info("Radar monitoring platform started")
