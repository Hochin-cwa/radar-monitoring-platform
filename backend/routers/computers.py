"""
Computers router — /api/v1/computers/*
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from backend.services.system_service import get_combined_status
from backend.models import ComputerStatusResponse

logger = logging.getLogger("routers.computers")
router = APIRouter(tags=["computers"])


@router.get("/api/v1/computers/current", response_model=ComputerStatusResponse)
def current_computer_status():
    try:
        items, disk_error = get_combined_status()
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("current_computer_status: SystemStatus DB unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="無法連線至系統狀態資料庫，請稍後再試。",
        )
    return ComputerStatusResponse(items=items, disk_error=disk_error)
