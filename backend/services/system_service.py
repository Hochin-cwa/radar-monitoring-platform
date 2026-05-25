"""
System status service — queries SystemStatus and DiskStatus databases.
Groups results by Department from SystemIPList.
"""
from __future__ import annotations
import logging
from collections import OrderedDict
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from backend.config import get_config
from backend.database import get_session

logger = logging.getLogger("system_service")

_SYSTEM_SQL = text("""
SELECT cl.IP, cl.Load_1, cl.Load_5, cl.LOAD_15, cl.MemoryUSE,
       sl.EquipmentName, sl.Department
FROM CheckList cl
LEFT JOIN SystemIPList sl ON cl.IP = sl.IP
""")

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


def get_system_status() -> list[dict]:
    timeout = get_config().system.query_timeout_seconds
    try:
        with get_session("system_status") as session:
            rows = session.execute(_SYSTEM_SQL.execution_options(timeout=timeout)).fetchall()
        return [
            {
                "ip": row.IP,
                "equipment_name": row.EquipmentName or row.IP,
                "department": row.Department or "",
                "load_1":     float(row.Load_1)    if row.Load_1    is not None else None,
                "load_5":     float(row.Load_5)    if row.Load_5    is not None else None,
                "load_15":    float(row.LOAD_15)   if row.LOAD_15   is not None else None,
                "memory_use": float(row.MemoryUSE) if row.MemoryUSE is not None else None,
            }
            for row in rows
        ]
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_system_status: DB error: %s", exc)
        return []


def get_disk_status() -> list[dict]:
    timeout = get_config().system.query_timeout_seconds
    try:
        with get_session("disk_status") as session:
            rows = session.execute(_DISK_SQL.execution_options(timeout=timeout)).fetchall()
        # DiskStatus.CheckList 沒有 SystemIPList，需從 system_status 取 Department
        # 先取 IP->Department map
        dept_map = _load_dept_map()
        return [
            {
                "ip": row.IP,
                "file_system": row.FileSystem,
                "used_pct": float(row.Used) if row.Used is not None else None,
                "equipment_name": dept_map.get(row.IP, {}).get("equipment_name", row.IP),
                "department": dept_map.get(row.IP, {}).get("department", ""),
            }
            for row in rows
        ]
    except (OperationalError, SQLAlchemyError) as exc:
        logger.error("get_disk_status: DB error: %s", exc)
        return []


def _load_dept_map() -> dict[str, dict]:
    """Load IP -> {department, equipment_name} from SystemIPList."""
    try:
        with get_session("system_status") as session:
            rows = session.execute(
                text("SELECT IP, EquipmentName, Department FROM SystemIPList")
            ).fetchall()
        return {
            row.IP: {"department": row.Department or "", "equipment_name": row.EquipmentName or row.IP}
            for row in rows
        }
    except Exception as exc:
        logger.warning("_load_dept_map: %s", exc)
        return {}


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
            server_time = row.ServerTime
            system_dict[ip] = {
                "ip": ip,
                "equipment_name": row.EquipmentName or ip,
                "department": row.Department or "",
                "load_1":     float(row.Load_1)    if row.Load_1    is not None else None,
                "load_5":     float(row.Load_5)    if row.Load_5    is not None else None,
                "load_15":    float(row.LOAD_15)   if row.LOAD_15   is not None else None,
                "memory_use": float(row.MemoryUSE) if row.MemoryUSE is not None else None,
                "server_time": server_time.isoformat() if hasattr(server_time, "isoformat") else (str(server_time) if server_time is not None else None),
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
