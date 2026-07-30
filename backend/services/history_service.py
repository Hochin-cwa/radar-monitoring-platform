"""
History service — queries instrument and system history from MySQL databases.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from backend.config import get_config
from backend.database import get_session
from backend.services.alert_service import get_instrument_thresholds

logger = logging.getLogger("history_service")


def _extract_time_from_filename(filename: str) -> Optional[datetime]:
    """Extract the data timestamp embedded in a FileName string.

    Supports common patterns found in radar monitoring file names:
    - YYYYMMDDHHmmss (14 digits, e.g., 2026062406214300RhoHV.vol)
    - YYYYMMDD_HHmmss (with underscore, e.g., RCWF_20260624_061700_VOL.029.gz)
    - w2026-06-24-19-00 (windprofiler style)

    Returns a naive local-time datetime, or None if parsing fails.
    """
    if not filename:
        return None

    # Pattern 1: windprofiler style w2026-06-24-19-00
    m = re.search(r'w(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})', filename)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                            int(m.group(4)), int(m.group(5)), 0)
        except ValueError:
            pass

    # Pattern 2: YYYYMMDD_HHMMSS (with underscore separator)
    m = re.search(r'(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})', filename)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                            int(m.group(4)), int(m.group(5)), int(m.group(6)))
        except ValueError:
            pass

    # Pattern 3: 14 consecutive digits YYYYMMDDHHmmss (most common for eclass etc.)
    m = re.search(r'(\d{4})(0[1-9]|1[0-2])([0-2]\d|3[01])(\d{2})(\d{2})(\d{2})', filename)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                            int(m.group(4)), int(m.group(5)), int(m.group(6)))
        except ValueError:
            pass

    return None


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

    X axis: FileTime（UNIX timestamp）以 UTC 轉為 ISO8601（帶 +00:00 時區）
    Y axis: DiffTime / 60 — DB 原始 DiffTime（秒）轉分鐘

    回傳 DB 查到的每一筆記錄，不做任何合併或去重。

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
        # X 軸：FileTime（UNIX timestamp）以 UTC 轉換
        dt = datetime.fromtimestamp(float(row.FileTime), tz=timezone.utc)
        # Y 軸：DB DiffTime（秒）÷ 60 = 分鐘
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
    """Query CPU, memory (SystemStatus) and disk (DiskStatus) history for an IP.

    Data source:
    - CPU (Load_1, Load_5, Load_15) and Memory: SystemStatus database
    - Disk (Used per FileSystem): DiskStatus database

    Tries 'Status' table first (historical), falls back to 'CheckList' if no data.
    Supports both DATETIME and UNIX_TIMESTAMP comparison for ServerTime.

    API endpoint: GET /api/v1/history/system?ip=...&range=...
    """
    start_dt = _parse_range(range)
    start_ts = int(start_dt.timestamp())
    # 格式化為 MySQL DATETIME 字串，確保比較不會因型別問題失敗
    start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    timeout = get_config().system.query_timeout_seconds

    logger.info(
        "get_system_history: ip=%s, range=%s, start_str=%s",
        ip, range, start_str,
    )

    load_1_data: list[dict] = []
    load_5_data: list[dict] = []
    load_15_data: list[dict] = []
    memory_data: list[dict] = []

    # SystemStatus: query Status table, fallback to CheckList
    _SYS_QUERIES = [
        text("""
            SELECT ServerTime, Load_1, Load_5, LOAD_15, MemoryUSE
            FROM Status
            WHERE IP = :ip AND ServerTime >= :start_str
            ORDER BY ServerTime ASC
        """),
        text("""
            SELECT ServerTime, Load_1, Load_5, LOAD_15, MemoryUSE
            FROM CheckList
            WHERE IP = :ip AND ServerTime >= :start_str
            ORDER BY ServerTime ASC
        """),
    ]

    try:
        rows = []
        for i, sql in enumerate(_SYS_QUERIES):
            try:
                with get_session("system_status") as session:
                    rows = session.execute(
                        sql.execution_options(timeout=timeout),
                        {"ip": ip, "start_str": start_str},
                    ).fetchall()
                if rows:
                    logger.info("get_system_history (system_status): query #%d got %d rows for ip=%s", i+1, len(rows), ip)
                    break
            except (OperationalError, SQLAlchemyError) as exc:
                logger.warning("get_system_history (system_status): query #%d failed: %s", i+1, exc)
                continue

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
            load_1_data.append({"time": t_iso, "value": float(row.Load_1) if row.Load_1 is not None else None})
            load_5_data.append({"time": t_iso, "value": float(row.Load_5) if row.Load_5 is not None else None})
            load_15_data.append({"time": t_iso, "value": float(row.LOAD_15) if row.LOAD_15 is not None else None})
            memory_data.append({"time": t_iso, "value": float(row.MemoryUSE) if row.MemoryUSE is not None else None})
    except Exception as exc:
        logger.error("get_system_history (system_status): unexpected error: %s", exc)

    # Disk: group by FileSystem path
    disk_by_fs: dict[str, list[dict]] = {}

    _DISK_QUERIES = [
        text("""
            SELECT ServerTime, FileSystem, Used
            FROM Status
            WHERE IP = :ip AND ServerTime >= :start_str
            ORDER BY ServerTime ASC
        """),
        text("""
            SELECT ServerTime, FileSystem, Used
            FROM CheckList
            WHERE IP = :ip AND ServerTime >= :start_str
            ORDER BY ServerTime ASC
        """),
    ]

    try:
        rows = []
        for i, sql in enumerate(_DISK_QUERIES):
            try:
                with get_session("disk_status") as session:
                    rows = session.execute(
                        sql.execution_options(timeout=timeout),
                        {"ip": ip, "start_str": start_str},
                    ).fetchall()
                if rows:
                    logger.info("get_system_history (disk_status): query #%d got %d rows for ip=%s", i+1, len(rows), ip)
                    break
            except (OperationalError, SQLAlchemyError) as exc:
                logger.warning("get_system_history (disk_status): query #%d failed: %s", i+1, exc)
                continue

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
            fs = row.FileSystem or "unknown"
            disk_by_fs.setdefault(fs, []).append({
                "time": t_iso,
                "used": float(row.Used) if row.Used is not None else None,
            })
    except Exception as exc:
        logger.error("get_system_history (disk_status): unexpected error: %s", exc)

    return {
        "ip": ip,
        "range": range,
        "cpu": {
            "load_1": load_1_data,
            "load_5": load_5_data,
            "load_15": load_15_data,
        },
        "memory": memory_data,
        "disk": disk_by_fs,
    }


def get_environment_history(ip: str, range: str) -> dict:
    """Query temperature and humidity history for an environment monitor.

    Data source: SystemStatus database, enviromentMonitor table.
    Table columns: id, device_ip, record_time, temperature, humidity.

    API endpoint: GET /api/v1/history/environment?ip=...&range=...
    """
    start_dt = _parse_range(range)
    start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    timeout = get_config().system.query_timeout_seconds

    logger.info(
        "get_environment_history: ip=%s, range=%s, start_str=%s",
        ip, range, start_str,
    )

    temperature_data: list[dict] = []
    humidity_data: list[dict] = []

    sql = text("""
        SELECT record_time, temperature, humidity
        FROM enviromentMonitor
        WHERE device_ip = :ip AND record_time >= :start_str
        ORDER BY record_time ASC
    """)

    try:
        with get_session("system_status") as session:
            rows = session.execute(
                sql.execution_options(timeout=timeout),
                {"ip": ip, "start_str": start_str},
            ).fetchall()

        logger.info(
            "get_environment_history: got %d rows for ip=%s", len(rows), ip,
        )

        for row in rows:
            if row.record_time is None:
                continue
            t = row.record_time
            if isinstance(t, datetime):
                t_iso = t.isoformat()
            elif isinstance(t, (int, float)):
                t_iso = datetime.fromtimestamp(float(t)).isoformat()
            else:
                t_iso = str(t)

            temperature_data.append({
                "time": t_iso,
                "value": float(row.temperature) if row.temperature is not None else None,
            })
            humidity_data.append({
                "time": t_iso,
                "value": float(row.humidity) if row.humidity is not None else None,
            })
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_environment_history: DB error: %s", exc)
    except Exception as exc:
        logger.error("get_environment_history: unexpected error: %s", exc)

    return {
        "ip": ip,
        "range": range,
        "temperature": temperature_data,
        "humidity": humidity_data,
    }
