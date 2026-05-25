"""
Alert service for radar-monitoring-platform.
Queries all FileCheck tables for each instrument's latest snapshot,
calculates diff_time_minutes, and compares against per-instrument thresholds.
Thresholds are persisted in config/thresholds.yaml using interval_minutes (T).
Auto-calculated: yellow = T+5, orange = T+10, red = T+20.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Tuple

import yaml
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from backend.database import get_session
from backend.models import InstrumentStatus

logger = logging.getLogger("alert_service")

_THRESHOLDS_PATH = Path(__file__).parent.parent.parent / "config" / "thresholds.yaml"
_thresholds_lock = threading.Lock()
# Cache maps file_type -> interval_minutes (float)
_thresholds_cache: dict[str, float] | None = None
_default_interval: float | None = None

_DEFAULT_INTERVAL_MINUTES = 7.0

_INSTRUMENT_STATUS_SQL = text("""
SELECT
    ftl.FileType,
    ftl.EquipmentName,
    fc.IP,
    fc.FileTime,
    TIMESTAMPDIFF(SECOND, FROM_UNIXTIME(fc.FileTime), NOW()) / 60.0 AS diff_time_minutes
FROM FileTypeList ftl
LEFT JOIN (
    SELECT IP, FileType, FileTime FROM radarFileCheck
    UNION ALL
    SELECT IP, FileType, FileTime FROM HFradarFileCheck
    UNION ALL
    SELECT IP, FileType, FileTime FROM satelliteFileCheck
    UNION ALL
    SELECT IP, FileType, FileTime FROM windprofilerFileCheck
    UNION ALL
    SELECT IP, FileType, FileTime FROM DSFileCheck
) fc ON ftl.FileType = fc.FileType
""")

_SYSTEM_IP_DEPT_SQL = text("SELECT IP, Department FROM SystemIPList")

# ── 儀器狀態快取 ─────────────────────────────────────────────
_STATUS_CACHE_TTL = 60  # 秒
_status_cache: list[InstrumentStatus] | None = None
_status_cache_time: float = 0.0
_status_cache_lock = threading.Lock()


def calculate_thresholds(interval_minutes: float) -> Tuple[float, float, float]:
    """Auto-calculate three alert thresholds from interval T.

    Returns (yellow, orange, red) = (T+5, T+10, T+20).
    """
    return (
        interval_minutes + 5.0,
        interval_minutes + 10.0,
        interval_minutes + 20.0,
    )


def _load_thresholds_file() -> Tuple[float, dict[str, float]]:
    """Load thresholds.yaml.

    Returns (default_interval, {file_type: interval_minutes}).
    Falls back to _DEFAULT_INTERVAL_MINUTES if file is missing or malformed.
    """
    if not _THRESHOLDS_PATH.exists():
        return _DEFAULT_INTERVAL_MINUTES, {}
    try:
        with _THRESHOLDS_PATH.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        file_defaults = raw.get("defaults", {})
        default_interval = float(
            file_defaults.get("interval_minutes", _DEFAULT_INTERVAL_MINUTES)
        )
        result: dict[str, float] = {}
        for ft, val in (raw.get("instruments") or {}).items():
            if val is None:
                continue
            result[ft] = float(val.get("interval_minutes", default_interval))
        return default_interval, result
    except Exception as exc:
        logger.warning("Failed to load thresholds.yaml: %s", exc)
        return _DEFAULT_INTERVAL_MINUTES, {}


def _save_thresholds_file(
    default_interval: float, instruments: dict[str, float]
) -> None:
    """Persist interval_minutes settings to thresholds.yaml."""
    instruments_section = {
        ft: {"interval_minutes": t} for ft, t in instruments.items()
    }
    data = {
        "defaults": {"interval_minutes": default_interval},
        "instruments": instruments_section,
    }
    try:
        with _THRESHOLDS_PATH.open("w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        logger.info("thresholds.yaml saved (%d instruments)", len(instruments_section))
    except Exception as exc:
        logger.error("Failed to save thresholds.yaml: %s", exc)


def _ensure_loaded() -> None:
    """Ensure thresholds cache is populated (call within _thresholds_lock)."""
    global _thresholds_cache, _default_interval
    if _thresholds_cache is None:
        _default_interval, _thresholds_cache = _load_thresholds_file()
        logger.info(
            "Thresholds loaded: default_interval=%.1f, %d custom entries",
            _default_interval,
            len(_thresholds_cache),
        )


def _get_interval(file_type: str) -> float:
    """Return interval_minutes for a given file_type, falling back to defaults."""
    with _thresholds_lock:
        _ensure_loaded()
        return _thresholds_cache.get(file_type, _default_interval)  # type: ignore[return-value]


def _load_ip_department_map() -> dict[str, str]:
    try:
        with get_session("system_status") as session:
            rows = session.execute(_SYSTEM_IP_DEPT_SQL).fetchall()
        return {row.IP: (row.Department or "") for row in rows}
    except Exception as exc:
        logger.warning("Failed to load IP->Department map: %s", exc)
        return {}


def get_all_instrument_statuses() -> list[InstrumentStatus]:
    global _status_cache, _status_cache_time
    now = time.time()

    with _status_cache_lock:
        if _status_cache is not None and now - _status_cache_time < _STATUS_CACHE_TTL:
            return _status_cache

    from backend.config import get_config
    timeout = get_config().system.query_timeout_seconds
    ip_dept = _load_ip_department_map()

    try:
        with get_session("file_status") as session:
            rows = session.execute(
                _INSTRUMENT_STATUS_SQL.execution_options(timeout=timeout)
            ).fetchall()
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_all_instrument_statuses: DB error: %s", exc)
        with _status_cache_lock:
            return _status_cache or []

    statuses: list[InstrumentStatus] = []
    for row in rows:
        file_type: str = row.FileType
        interval = _get_interval(file_type)
        t_yellow, t_orange, t_red = calculate_thresholds(interval)
        department = ip_dept.get(row.IP or "", "") or None

        # 找不到對應科別的儀器不顯示
        if not department:
            continue

        if row.FileTime is None or row.diff_time_minutes is None:
            statuses.append(InstrumentStatus(
                file_type=file_type,
                equipment_name=row.EquipmentName or "",
                ip=row.IP or None,
                department=department,
                latest_file_time=None,
                diff_time_minutes=None,
                interval_minutes=interval,
                threshold_yellow=t_yellow,
                threshold_orange=t_orange,
                threshold_red=t_red,
                is_alert=True,
            ))
            continue

        diff = max(0.0, float(row.diff_time_minutes))
        latest_file_time = datetime.fromtimestamp(float(row.FileTime), tz=timezone.utc)

        statuses.append(InstrumentStatus(
            file_type=file_type,
            equipment_name=row.EquipmentName or "",
            ip=row.IP or None,
            department=department,
            latest_file_time=latest_file_time,
            diff_time_minutes=diff,
            interval_minutes=interval,
            threshold_yellow=t_yellow,
            threshold_orange=t_orange,
            threshold_red=t_red,
            is_alert=diff > t_yellow,
        ))

    logger.info("get_all_instrument_statuses: %d instruments queried", len(statuses))
    with _status_cache_lock:
        _status_cache = statuses
        _status_cache_time = time.time()
    return statuses


def get_instrument_thresholds(file_type: str) -> Tuple[float, float, float]:
    """Return (yellow, orange, red) thresholds for a file_type."""
    return calculate_thresholds(_get_interval(file_type))


def set_instrument_thresholds(file_type: str, interval_minutes: float) -> None:
    """Persist interval_minutes for a specific instrument."""
    if interval_minutes <= 0:
        raise ValueError("interval_minutes must be > 0")
    with _thresholds_lock:
        _ensure_loaded()
        _thresholds_cache[file_type] = interval_minutes  # type: ignore[index]
        _save_thresholds_file(_default_interval, _thresholds_cache)  # type: ignore[arg-type]
    t_yellow, t_orange, t_red = calculate_thresholds(interval_minutes)
    logger.info(
        "Thresholds updated: %s -> T=%.1f (yellow=%.1f orange=%.1f red=%.1f)",
        file_type, interval_minutes, t_yellow, t_orange, t_red,
    )


def list_instruments() -> list[dict]:
    from backend.config import get_config
    timeout = get_config().system.query_timeout_seconds

    try:
        with get_session("file_status") as session:
            rows = session.execute(
                text("SELECT FileType, EquipmentName FROM FileTypeList").execution_options(timeout=timeout)
            ).fetchall()
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("list_instruments: DB error: %s", exc)
        return []

    return [
        {
            "file_type": row.FileType,
            "equipment_name": row.EquipmentName or "",
            "interval_minutes": _get_interval(row.FileType),
            **dict(zip(
                ("threshold_yellow", "threshold_orange", "threshold_red"),
                calculate_thresholds(_get_interval(row.FileType)),
            )),
        }
        for row in rows
    ]
