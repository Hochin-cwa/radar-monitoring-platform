"""
Completeness router — /api/v1/completeness/*
只保留 current 端點（儀器即時狀態），移除時間序列完整率端點。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.models import CurrentStatusResponse
from backend.services.alert_service import get_all_instrument_statuses

logger = logging.getLogger("routers.completeness")
router = APIRouter(prefix="/api/v1/completeness", tags=["completeness"])


@router.get("/current", response_model=CurrentStatusResponse)
def get_current_status() -> CurrentStatusResponse:
    """Return the latest status for all instruments. Returns 503 on DB error."""
    instruments = get_all_instrument_statuses()
    if not instruments:
        raise HTTPException(
            status_code=503,
            detail={"status": "db_error", "message": "資料庫連線失敗或無儀器資料"},
        )
    return CurrentStatusResponse(
        instruments=instruments,
        calculated_at=datetime.now(timezone.utc),
        status="ok",
    )
