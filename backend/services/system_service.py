"""
System status service — queries SystemStatus and DiskStatus databases.
Groups results by Department from SystemIPList.
"""
from __future__ import annotations
import logging
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from backend.config import get_config
from backend.database import get_session

logger = logging.getLogger("system_service")


def _server_time_iso(t) -> Optional[str]:
    """Normalise a ServerTime value to an ISO8601 string with UTC offset.

    DB 的 ServerTime 以 UTC（naive datetime）儲存；若不補上 tzinfo 直接
    .isoformat()，前端 new Date() 會把它當成瀏覽器本地時間（UTC+8），導致
    時間早算 8 小時，進而誤判「CPU 更新逾時」。與 history_service 的處理一致。
    """
    if t is None:
        return None
    if isinstance(t, datetime):
        return (t.replace(tzinfo=timezone.utc).isoformat()
                if t.tzinfo is None else t.isoformat())
    if isinstance(t, (int, float)):
        return datetime.fromtimestamp(float(t), tz=timezone.utc).isoformat()
    return str(t)

_COMBINED_SYSTEM_SQL = text("""
SELECT cl.IP, cl.Load_1, cl.Load_5, cl.LOAD_15, cl.MemoryUSE, cl.ServerTime,
       sl.EquipmentName, sl.Department
FROM CheckList cl
LEFT JOIN SystemIPList sl ON cl.IP = sl.IP
""")

_DISK_SQL = text("""
SELECT IP, FileSystem, Used
FROM CheckList
""")


def get_combined_status() -> tuple[list[dict], bool]:
    """
    回傳 (items, disk_error)。
    items：每個唯一 IP 對應一筆資料，包含系統指標與磁碟清單。
    disk_error：若 DiskStatus 資料庫無法連線則為 True。
    若 SystemStatus 資料庫無法連線，則向上拋出 OperationalError（不在此捕捉）。
    """
    timeout = get_config().system.query_timeout_seconds

    # 1. 查詢系統資料列 → 以 IP 為鍵建立插入有序字典
    with get_session("system_status") as session:
        sys_rows = session.execute(
            _COMBINED_SYSTEM_SQL.execution_options(timeout=timeout)
        ).fetchall()

    system_dict: dict[str, dict] = OrderedDict()
    for row in sys_rows:
        ip = row.IP
        if ip not in system_dict:
            system_dict[ip] = {
                "ip": ip,
                "equipment_name": row.EquipmentName or ip,
                "department": row.Department or "",
                "load_1":     float(row.Load_1)    if row.Load_1    is not None else None,
                "load_5":     float(row.Load_5)    if row.Load_5    is not None else None,
                "load_15":    float(row.LOAD_15)   if row.LOAD_15   is not None else None,
                "memory_use": float(row.MemoryUSE) if row.MemoryUSE is not None else None,
                "server_time": _server_time_iso(row.ServerTime),
                "disks": [],
            }

    # 2. 查詢磁碟資料列；若失敗則設 disk_error = True 並跳過磁碟填充
    disk_error = False
    disk_dict: dict[str, list[dict]] = {}
    try:
        with get_session("disk_status") as session:
            disk_rows = session.execute(
                _DISK_SQL.execution_options(timeout=timeout)
            ).fetchall()
        for row in disk_rows:
            entry = {
                "file_system": row.FileSystem,
                "used_pct": float(row.Used) if row.Used is not None else None,
            }
            disk_dict.setdefault(row.IP, []).append(entry)
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_combined_status: DiskStatus DB error: %s", exc)
        disk_error = True

    # 3. 將磁碟資料填入對應 IP；無磁碟資料的 IP 保持 disks: []
    if not disk_error:
        for ip, item in system_dict.items():
            item["disks"] = disk_dict.get(ip, [])

    return list(system_dict.values()), disk_error
