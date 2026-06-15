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
    """Return the start datetime for the given range string.

    Returns a naive (no timezone) datetime using the local server time,
    to match MySQL datetime columns that store local time without timezone info.
    """
    now = datetime.now()
    mapping = {
        "6h": timedelta(hours=6),
        "1d": timedelta(days=1),
        "1w": timedelta(weeks=1),
        "1m": timedelta(days=30),
        "3m": timedelta(days=90),
    }
    delta = mapping.get(range_str, timedelta(days=1))
    return now - delta


_STATUS_TABLES = [
    "radarStatus",
    "windprofilerStatus",
    "HFradarStatus",
    "satelliteStatus",
    "DSStatus",
]


def _table_for_file_type(file_type: str) -> str:
    """Return the best-guess history table name for the given file_type.

    Used as a priority hint — the actual query will fall through all tables
    if the guessed table returns no data.
    """
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
    """Query instrument DiffTime history from status tables.

    Tries the best-guess table first; if no data is found, queries remaining
    tables until data is found. If no data found with the given IP, retries
    without the IP filter to find data under any IP for that FileType.
    """
    start_dt = _parse_range(range)
    start_ts = int(start_dt.timestamp())

    timeout = get_config().system.query_timeout_seconds
    t_yellow, t_orange, t_red = get_instrument_thresholds(file_type)

    # Order tables: best guess first, then the rest
    guessed = _table_for_file_type(file_type)
    tables_to_try = [guessed] + [t for t in _STATUS_TABLES if t != guessed]

    logger.info(
        "get_instrument_history: file_type=%s, ip=%s, range=%s, start_ts=%d, tables=%s",
        file_type, ip, range, start_ts, tables_to_try,
    )

    # First pass: query with both IP and FileType
    rows = _query_instrument_tables(tables_to_try, ip, file_type, start_ts, timeout)

    # Second pass: if no data with given IP, try without IP filter
    actual_ip = ip
    if not rows:
        logger.info(
            "get_instrument_history: no data for ip=%s, retrying without IP filter", ip
        )
        rows, actual_ip = _query_instrument_tables_any_ip(
            tables_to_try, file_type, start_ts, timeout
        )

    data = []
    for row in rows:
        if row.FileTime is None:
            continue
        dt = datetime.fromtimestamp(float(row.FileTime))
        data.append({
            "time": dt.isoformat(),
            "diff_time_minutes": float(row.DiffTime) / 60.0 if row.DiffTime is not None else None,
        })

    return {
        "file_type": file_type,
        "ip": actual_ip,
        "range": range,
        "threshold_yellow": t_yellow,
        "threshold_orange": t_orange,
        "threshold_red": t_red,
        "data": data,
    }


def _query_instrument_tables(tables, ip, file_type, start_ts, timeout):
    """Query all tables with IP + FileType filter. Return first non-empty result."""
    for table in tables:
        sql = text(f"""
            SELECT FileTime, DiffTime
            FROM {table}
            WHERE IP = :ip
              AND FileType = :file_type
              AND FileTime >= :start_ts
            ORDER BY FileTime ASC
        """)
        try:
            with get_session("file_status") as session:
                rows = session.execute(
                    sql.execution_options(timeout=timeout),
                    {"ip": ip, "file_type": file_type, "start_ts": start_ts},
                ).fetchall()
        except (OperationalError, SQLAlchemyError) as exc:
            logger.warning("get_instrument_history: table '%s' query error: %s", table, exc)
            rows = []

        if rows:
            logger.info(
                "get_instrument_history: found %d rows in table '%s' for %s/%s",
                len(rows), table, file_type, ip,
            )
            return rows
        else:
            logger.info("get_instrument_history: no rows in table '%s' for %s/%s", table, file_type, ip)
    return []


def _query_instrument_tables_any_ip(tables, file_type, start_ts, timeout):
    """Query all tables with only FileType filter (no IP). Return rows and found IP."""
    for table in tables:
        sql = text(f"""
            SELECT IP, FileTime, DiffTime
            FROM {table}
            WHERE FileType = :file_type
              AND FileTime >= :start_ts
            ORDER BY FileTime ASC
        """)
        try:
            with get_session("file_status") as session:
                rows = session.execute(
                    sql.execution_options(timeout=timeout),
                    {"file_type": file_type, "start_ts": start_ts},
                ).fetchall()
        except (OperationalError, SQLAlchemyError) as exc:
            logger.warning("get_instrument_history: table '%s' (any IP) query error: %s", table, exc)
            rows = []

        if rows:
            found_ip = rows[0].IP if rows[0].IP else ""
            logger.info(
                "get_instrument_history: found %d rows in table '%s' for %s (any IP, actual=%s)",
                len(rows), table, file_type, found_ip,
            )
            return rows, found_ip
    return [], ""


def get_system_history(ip: str, range: str) -> dict:
    """Query CPU, memory (SystemStatus) and disk (DiskStatus) history for an IP."""
    start_dt = _parse_range(range)
    start_ts = int(start_dt.timestamp())
    timeout = get_config().system.query_timeout_seconds

    logger.info(
        "get_system_history: ip=%s, range=%s, start_dt=%s, start_ts=%d",
        ip, range, start_dt.isoformat(), start_ts,
    )

    # Try both: datetime comparison and unix timestamp comparison
    # Some tables store ServerTime as DATETIME, others as INT (unix timestamp)
    _SYS_SQL_DATETIME = text("""
        SELECT ServerTime, Load_1, MemoryUSE
        FROM CheckList
        WHERE IP = :ip
          AND ServerTime >= :start_dt
        ORDER BY ServerTime ASC
    """)

    _DISK_SQL_DATETIME = text("""
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
                _SYS_SQL_DATETIME.execution_options(timeout=timeout),
                {"ip": ip, "start_dt": start_dt},
            ).fetchall()
        logger.info("get_system_history (system_status): got %d rows for ip=%s", len(rows), ip)
        for row in rows:
            if row.ServerTime is None:
                continue
            t = row.ServerTime
            if isinstance(t, datetime):
                t_iso = t.isoformat()
            elif isinstance(t, (int, float)):
                t_iso = datetime.fromtimestamp(float(t)).isoformat()
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
                _DISK_SQL_DATETIME.execution_options(timeout=timeout),
                {"ip": ip, "start_dt": start_dt},
            ).fetchall()
        logger.info("get_system_history (disk_status): got %d rows for ip=%s", len(rows), ip)
        for row in rows:
            if row.ServerTime is None:
                continue
            t = row.ServerTime
            if isinstance(t, datetime):
                t_iso = t.isoformat()
            elif isinstance(t, (int, float)):
                t_iso = datetime.fromtimestamp(float(t)).isoformat()
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
