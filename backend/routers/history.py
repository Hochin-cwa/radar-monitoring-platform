"""
History router — /api/v1/history/*
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from backend.services.history_service import get_instrument_history, get_system_history, get_environment_history
from backend.services.log_safe import is_safe_ip, is_safe_file_type

logger = logging.getLogger("routers.history")
router = APIRouter(tags=["history"])

_VALID_RANGES = {"6h", "1d", "1w", "1m", "3m"}


def _validate_ip(ip: str) -> str:
    """Whitelist check (letters, digits, . : _ -, max 64) - rejects CR/LF and other control chars."""
    ip = (ip or "").strip()
    if not is_safe_ip(ip):
        raise HTTPException(status_code=422, detail="Invalid ip")
    return ip


def _validate_file_type(file_type: str) -> str:
    if not is_safe_file_type(file_type):
        raise HTTPException(status_code=422, detail="Invalid file_type")
    return file_type


@router.get("/api/v1/history/environment")
def environment_history(
    ip: str = Query(..., description="溫溼度計 IP"),
    range: str = Query("1d", description="時間範圍：6h, 1d, 1w, 1m, 3m"),
):
    """取得指定 IP 溫溼度計的溫度與濕度歷史記錄。"""
    if range not in _VALID_RANGES:
        raise HTTPException(status_code=422, detail=f"Invalid range '{range}'. Must be one of {sorted(_VALID_RANGES)}")
    ip = _validate_ip(ip)
    return get_environment_history(ip=ip, range=range)


@router.get("/api/v1/history/system")
def system_history(
    ip: str = Query(..., description="電腦 IP"),
    range: str = Query("1d", description="時間範圍：6h, 1d, 1w, 1m, 3m"),
):
    """取得指定 IP 電腦的 CPU、記憶體、磁碟歷史記錄。"""
    if range not in _VALID_RANGES:
        raise HTTPException(status_code=422, detail=f"Invalid range '{range}'. Must be one of {sorted(_VALID_RANGES)}")
    ip = _validate_ip(ip)
    return get_system_history(ip=ip, range=range)


@router.get("/api/v1/history/{file_type}")
def instrument_history(
    file_type: str,
    ip: str = Query(..., description="儀器 IP"),
    range: str = Query("1d", description="時間範圍：6h, 1d, 1w, 1m, 3m"),
):
    """取得指定儀器（FileType + IP）的 DiffTime 歷史記錄。"""
    if range not in _VALID_RANGES:
        raise HTTPException(status_code=422, detail=f"Invalid range '{range}'. Must be one of {sorted(_VALID_RANGES)}")
    file_type = _validate_file_type(file_type)
    ip = _validate_ip(ip)
    result = get_instrument_history(file_type=file_type, ip=ip, range=range)
    if result is None:
        raise HTTPException(status_code=404, detail=f"file_type '{file_type}' not found")
    return result
