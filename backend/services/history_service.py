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
    """Return the start datetime (UTC) for the given range string.

    Returns a timezone-aware UTC datetime. DB 的 ServerTime / record_time
    以 UTC 儲存，用伺服器本地時間比較會在 UTC+8 主機上整批查不到資料。
    """
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
    # HIMA_* (Himawari) / GK2A_* (GEO-KOMPSAT-2A) are satellite file types
    if ft.startswith("HIMA_") or ft.startswith("GK2A_"):
        return "satelliteStatus"
    if "windprofiler" in ft or "WP" in ft:
        return "windprofilerStatus"
    # RCCL_* / RCDS_* are windprofiler file types (清流/東石風乃計)
    if ft.startswith("RCCL_") or ft.startswith("RCDS_"):
        return "windprofilerStatus"
    return "radarStatus"


def get_instrument_history(file_type: str, ip: str, range: str) -> dict:
    """Query instrument DiffTime history from the appropriate status table."""
    table = _table_for_file_type(file_type)
    start_dt = _parse_range(range)
    start_ts = start_dt.timestamp()

    timeout = get_config().system.query_timeout_seconds
    t_yellow, t_orange, t_red = get_instrument_thresholds(file_type)

    # FileTime 為 Unix timestamp（秒），直接在 SQL 端以 FROM_UNIXTIME 轉成 datetime。
    sql = text(f"""
        SELECT FROM_UNIXTIME(FileTime) AS Time, DiffTime
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
        if row.Time is None:
            continue
        t = row.Time
        if isinstance(t, datetime):
            t_iso = t.replace(tzinfo=timezone.utc).isoformat() if t.tzinfo is None else t.isoformat()
        else:
            t_iso = str(t)
        data.append({
            "time": t_iso,
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


def _server_time_iso(t) -> Optional[str]:
    """Normalise a ServerTime value to an ISO8601 string with UTC offset."""
    if t is None:
        return None
    if isinstance(t, datetime):
        return t.replace(tzinfo=timezone.utc).isoformat() if t.tzinfo is None else t.isoformat()
    if isinstance(t, (int, float)):
        return datetime.fromtimestamp(float(t), tz=timezone.utc).isoformat()
    return str(t)


def get_system_history(ip: str, range: str) -> dict:
    """Query CPU, memory (SystemStatus) and disk (DiskStatus) history for an IP.

    Data source（皆為 Status 歷史表，CheckList 只保留每個 IP 最新一筆，不適合畫趨勢）：
    - CPU (Load_1, Load_5, LOAD_15) 與 Memory: SystemStatus.Status
    - Disk (FileSystem, Used): DiskStatus.Status

    API endpoint: GET /api/v1/history/system?ip=...&range=...
    """
    start_dt = _parse_range(range)
    timeout = get_config().system.query_timeout_seconds

    logger.info(
        "get_system_history: ip=%s, range=%s, start_dt=%s",
        ip, range, start_dt.isoformat(),
    )

    _SYS_SQL = text("""
        SELECT ServerTime, Load_1, Load_5, LOAD_15, MemoryUSE
        FROM Status
        WHERE IP = :ip
          AND ServerTime >= :start_dt
        ORDER BY ServerTime ASC
    """)

    _DISK_SQL = text("""
        SELECT ServerTime, FileSystem, Used
        FROM Status
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
        logger.info("get_system_history (system_status): %d rows for ip=%s", len(rows), ip)

        for row in rows:
            t_iso = _server_time_iso(row.ServerTime)
            if t_iso is None:
                continue
            cpu_data.append({
                "time": t_iso,
                "load_1": float(row.Load_1) if row.Load_1 is not None else None,
                "load_5": float(row.Load_5) if row.Load_5 is not None else None,
                "load_15": float(row.LOAD_15) if row.LOAD_15 is not None else None,
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
        logger.info("get_system_history (disk_status): %d rows for ip=%s", len(rows), ip)

        for row in rows:
            t_iso = _server_time_iso(row.ServerTime)
            if t_iso is None:
                continue
            disk_data.append({
                "time": t_iso,
                "file_system": row.FileSystem,
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
