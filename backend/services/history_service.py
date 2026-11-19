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
from backend.services.log_safe import sanitize_log

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

    # FileTime 為 Unix timestamp（秒）。以 FROM_UNIXTIME 在 DB session 時區
    # （本平台部署於台灣，UTC+8）轉成「牆上時間」，讓圖表上的時間與運維人員
    # 直接查資料庫看到的 FROM_UNIXTIME 值完全一致（例如最新一筆 11:48:16）。
    #
    # 關鍵：回傳時「不可」再標記成 UTC（+00:00）。若標記為 UTC，瀏覽器（UTC+8）
    # 會再加 8 小時而超出現在時間；反之若直接送 UTC epoch 再靠瀏覽器 +8，
    # 又會依觀看者時區而異、在非 UTC+8 環境少 8 小時。
    # 因此一律輸出「無時區後綴的本地牆上時間字串」，瀏覽器 new Date() 以自身
    # 本地時區解讀，顯示出的時分與 DB 一致。
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
        logger.error("get_instrument_history: DB error: %s", sanitize_log(exc))
        rows = []

    data = []
    for row in rows:
        if row.Time is None:
            continue
        t = row.Time
        # FROM_UNIXTIME 回傳的是 DB session 時區（UTC+8）的牆上時間，且為 naive
        # （不帶 tzinfo）。輸出無時區後綴的 ISO 字串，讓前端以本地時區解讀，
        # 顯示的時分與 DB 直查一致，且不會被再次加上 8 小時。
        if isinstance(t, datetime):
            t_iso = t.replace(tzinfo=None).isoformat()
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


# ── 雷達 rb5 / nexrad 歷史（依檔名還原檔案時間與變數） ─────────────────────

# rb5 檔名：<YYYYMMDDHHmmss><2 位數序號><變數>.vol，例如 2026111807361200dBZv.vol
# （偶有 .vol.gz 後綴）。變數名稱可含大小寫字母與數字（dBuZ、uPhiDP、Wv…）。
_RB5_VAR_RE = re.compile(r'(\d{14})\d{2}([A-Za-z][A-Za-z0-9_]*)\.vol(?:\.gz)*$')

# 部分 nexrad 檔名只有分鐘精度，例如 20261118_0741_RCWF_VOL.450
_NEXRAD_HHMM_RE = re.compile(r'(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_')


def radar_format_for_file_type(file_type: str) -> Optional[str]:
    """Return 'rb5' / 'nexrad' for radar file types that get the dual-chart view, else None."""
    ft = (file_type or "").lower()
    if "rb5" in ft:
        return "rb5"
    if "nexrad" in ft:
        return "nexrad"
    return None


def _parse_rb5_filename(filename: str) -> Optional[tuple[datetime, str]]:
    """Return (file time, variable name) for an rb5 file name, or None."""
    base = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    m = _RB5_VAR_RE.search(base)
    if not m:
        return None
    t = _extract_time_from_filename(m.group(1))
    if t is None:
        return None
    return t, m.group(2)


def _parse_nexrad_filename(filename: str) -> Optional[datetime]:
    base = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    t = _extract_time_from_filename(base)
    if t is not None:
        return t
    m = _NEXRAD_HHMM_RE.search(base)
    if m:
        try:
            return datetime(*(int(g) for g in m.groups()))
        except ValueError:
            return None
    return None


def get_radar_history(file_type: str, ip: str, range: str) -> Optional[dict]:
    """DiffTime history for rb5 / nexrad radar data, split per variable.

    rb5: one series per variable parsed from the file name (dBZ, ZDR, ...).
    nexrad: one file per time, a single series.

    File times come from the file name (UTC), not from the FileTime column:
    that column is a float32 and only resolves to ~2 minutes. Times are
    returned as ISO strings with a 'Z' suffix so the browser renders them in
    its local zone, the same zone as "now" on the chart's right edge.

    API endpoint: GET /api/v1/history/{file_type}/radar?ip=...&range=...
    Returns None when file_type is not an rb5 / nexrad type.
    """
    fmt = radar_format_for_file_type(file_type)
    if fmt is None:
        return None

    start_ts = _parse_range(range).timestamp()
    timeout = get_config().system.query_timeout_seconds
    t_yellow, t_orange, t_red = get_instrument_thresholds(file_type)

    sql = text("""
        SELECT FileName, DiffTime
        FROM radarStatus
        WHERE IP = :ip
          AND FileType = :file_type
          AND FileTime >= :start_ts
    """)

    try:
        with get_session("file_status") as session:
            rows = session.execute(
                sql.execution_options(timeout=timeout),
                {"ip": ip, "file_type": file_type, "start_ts": start_ts},
            ).fetchall()
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_radar_history: DB error: %s", sanitize_log(exc))
        rows = []

    # 同一個檔案可能因多個目錄（/data、/home/data、含/不含日期資料夾）重複記錄，
    # 以 (時間, 變數) 去重並取最小 DiffTime（最早到位）。
    best: dict[tuple[datetime, str], float] = {}
    for row in rows:
        if row.DiffTime is None:
            continue
        if fmt == "rb5":
            parsed = _parse_rb5_filename(row.FileName)
            if parsed is None:
                continue
            t, var = parsed
        else:
            t = _parse_nexrad_filename(row.FileName)
            if t is None:
                continue
            var = file_type
        key = (t, var)
        diff_min = float(row.DiffTime) / 60.0
        if key not in best or diff_min < best[key]:
            best[key] = diff_min

    variables: list[str] = []
    seen: set[str] = set()
    data = []
    for (t, var), diff_min in sorted(best.items()):
        if var not in seen:
            seen.add(var)
            variables.append(var)
        data.append({
            "time": t.isoformat() + "Z",
            "variable": var,
            "diff_time_minutes": diff_min,
        })
    # 變數順序固定（依名稱排序），讓 y=1,2,3… 與顏色在不同時間範圍下一致
    variables.sort(key=str.lower)

    return {
        "file_type": file_type,
        "ip": ip,
        "range": range,
        "format": fmt,
        "variables": variables,
        "threshold_yellow": t_yellow,
        "threshold_orange": t_orange,
        "threshold_red": t_red,
        "data": data,
    }


# ── 衛星資料表（最近 N 筆） ──────────────────────────────────────────────

# file_type → FileStatus 資料庫中的資料表。表名只來自此白名單，不接受使用者輸入。
_SATELLITE_TABLES = {
    "HIMA_TP": "satelliteHima_TP",
    "HIMA_TN": "satelliteHima_TN",
    "GK2A_XW": "satelliteGK2A_XW",
}
_SATELLITE_RECENT_ROWS = 10


def satellite_table_for_file_type(file_type: str) -> Optional[str]:
    return _SATELLITE_TABLES.get(file_type)


def get_satellite_recent(file_type: str) -> Optional[dict]:
    """Latest rows of the per-product satellite table (columns: Date, Time, one per band).

    API endpoint: GET /api/v1/history/{file_type}/satellite
    Returns None when file_type has no dedicated satellite table.
    """
    table = satellite_table_for_file_type(file_type)
    if table is None:
        return None

    timeout = get_config().system.query_timeout_seconds
    sql = text(f"""
        SELECT *
        FROM {table}
        ORDER BY `Date` DESC, `Time` DESC
        LIMIT :n
    """)  # nosec — table name comes from the internal whitelist above

    columns: list[str] = []
    out_rows: list[dict] = []
    try:
        with get_session("file_status") as session:
            result = session.execute(
                sql.execution_options(timeout=timeout), {"n": _SATELLITE_RECENT_ROWS},
            )
            columns = list(result.keys())
            fetched = result.fetchall()
        for r in fetched:
            rec = {}
            for col, val in zip(columns, r):
                if isinstance(val, timedelta):
                    secs = int(val.total_seconds())
                    val = f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}"
                elif hasattr(val, "isoformat"):
                    val = val.isoformat()
                rec[col] = val
            out_rows.append(rec)
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_satellite_recent: DB error: %s", sanitize_log(exc))

    return {"file_type": file_type, "table": table, "columns": columns, "rows": out_rows}


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
        sanitize_log(ip), sanitize_log(range), start_dt.isoformat(),
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
        logger.info("get_system_history (system_status): %d rows for ip=%s", len(rows), sanitize_log(ip))

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
        logger.error("get_system_history (system_status): DB error: %s", sanitize_log(exc))

    try:
        with get_session("disk_status") as session:
            rows = session.execute(
                _DISK_SQL.execution_options(timeout=timeout),
                {"ip": ip, "start_dt": start_dt},
            ).fetchall()
        logger.info("get_system_history (disk_status): %d rows for ip=%s", len(rows), sanitize_log(ip))

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
        logger.error("get_system_history (disk_status): DB error: %s", sanitize_log(exc))

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
        sanitize_log(ip), sanitize_log(range), start_str,
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
            "get_environment_history: got %d rows for ip=%s", len(rows), sanitize_log(ip),
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
        logger.error("get_environment_history: DB error: %s", sanitize_log(exc))
    except Exception as exc:
        logger.error("get_environment_history: unexpected error: %s", sanitize_log(exc))

    return {
        "ip": ip,
        "range": range,
        "temperature": temperature_data,
        "humidity": humidity_data,
    }
