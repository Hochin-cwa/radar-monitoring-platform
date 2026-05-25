"""
History service — queries instrument and system history from MySQL databases.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from backend.config import get_config
from backend.database import get_session
from backend.services.alert_service import get_instrument_thresholds

logger = logging.getLogger("history_service")


def _parse_range(range_str: str) -> datetime:
    """Return the start datetime (UTC) for the given range string."""
    now = datetime.now(tz=timezone.utc)
    mapping = {
        "6h": timedelta(hours=6),
        "1d": timedelta(days=1),
        "1w": timedelta(weeks=1),
        "1m": timedelta(days=30),
        "3m": timedelta(days=90),
    }
    delta = mapping.get(range_str, timedelta(days=1))
    return now - delta


def _table_for_file_type(file_type: str) -> str:
    """Return the history table name for the given file_type."""
    ft = file_type
    if ft.startswith("DS_"):
        return "DSStatus"
    if "HF" in ft or "HFradar" in ft:
        return "HFradarStatus"
    if "satellite" in ft or "SAT" in ft:
        return "satelliteStatus"
    if "windprofiler" in ft or "WP" in ft:
        return "windprofilerStatus"
    return "radarStatus"


def get_instrument_history(file_type: str, ip: str, range: str) -> dict:
    """Query instrument DiffTime history from the appropriate status table."""
    table = _table_for_file_type(file_type)
    start_dt = _parse_range(range)
    start_ts = start_dt.timestamp()

    timeout = get_config().system.query_timeout_seconds
    t_yellow, t_orange, t_red = get_instrument_thresholds(file_type)

    sql = text(f"""
        SELECT FileTime, DiffTime
        FROM {table}
        WHERE IP = :ip
          AND FileType = :file_type
          AND FileTime >= :start_ts
        ORDER BY FileTime ASC
    """)  # nosec — table name is controlled internally, not user input

    try:
        with get_session("file_status") as session:
            rows = session.execute(
                sql.execution_options(timeout=timeout),
                {"ip": ip, "file_type": file_type, "start_ts": start_ts},
            ).fetchall()
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_instrument_history: DB error: %s", exc)
        rows = []

    data = []
    for row in rows:
        if row.FileTime is None:
            continue
        dt = datetime.fromtimestamp(float(row.FileTime), tz=timezone.utc)
        data.append({
            "time": dt.isoformat(),
            # DiffTime 欄位單位為秒，換算成分鐘後回傳
            "diff_time_minutes": float(row.DiffTime) / 60.0 if row.DiffTime is not None else None,
        })

    return {
        "file_type": file_type,
        "ip": ip,
        "range": range,
        "threshold_yellow": t_yellow,
        "threshold_orange": t_orange,
        "threshold_red": t_red,
        "data": data,
    }


def get_system_history(ip: str, range: str) -> dict:
    """Query CPU, memory (SystemStatus) and disk (DiskStatus) history for an IP."""
    start_dt = _parse_range(range)
    timeout = get_config().system.query_timeout_seconds

    _SYS_SQL = text("""
        SELECT ServerTime, Load_1, MemoryUSE
        FROM CheckList
        WHERE IP = :ip
          AND ServerTime >= :start_dt
        ORDER BY ServerTime ASC
    """)

    _DISK_SQL = text("""
        SELECT ServerTime, Used
        FROM CheckList
        WHERE IP = :ip
          AND ServerTime >= :start_dt
        ORDER BY ServerTime ASC
    """)

    cpu_data: list[dict] = []
    memory_data: list[dict] = []
    disk_data: list[dict] = []

    try:
        with get_session("system_status") as session:
            rows = session.execute(
                _SYS_SQL.execution_options(timeout=timeout),
                {"ip": ip, "start_dt": start_dt},
            ).fetchall()
        for row in rows:
            if row.ServerTime is None:
                continue
            t = row.ServerTime
            if isinstance(t, datetime):
                t_iso = t.replace(tzinfo=timezone.utc).isoformat() if t.tzinfo is None else t.isoformat()
            else:
                t_iso = str(t)
            cpu_data.append({
                "time": t_iso,
                "load_1": float(row.Load_1) if row.Load_1 is not None else None,
            })
            memory_data.append({
                "time": t_iso,
                "memory_use": float(row.MemoryUSE) if row.MemoryUSE is not None else None,
            })
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_system_history (system_status): DB error: %s", exc)

    try:
        with get_session("disk_status") as session:
            rows = session.execute(
                _DISK_SQL.execution_options(timeout=timeout),
                {"ip": ip, "start_dt": start_dt},
            ).fetchall()
        for row in rows:
            if row.ServerTime is None:
                continue
            t = row.ServerTime
            if isinstance(t, datetime):
                t_iso = t.replace(tzinfo=timezone.utc).isoformat() if t.tzinfo is None else t.isoformat()
            else:
                t_iso = str(t)
            disk_data.append({
                "time": t_iso,
                "used": float(row.Used) if row.Used is not None else None,
            })
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_system_history (disk_status): DB error: %s", exc)

    return {
        "ip": ip,
        "range": range,
        "cpu": cpu_data,
        "memory": memory_data,
        "disk": disk_data,
    }
