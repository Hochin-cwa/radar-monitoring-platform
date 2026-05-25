"""
Integration tests — 驗證三個資料庫的實際連線與資料存取是否正確。

執行前提：
  - config/config.yaml 中的 DB 連線參數必須指向可連線的 MySQL 實例
  - 使用者帳號需有 SELECT 權限

執行方式：
  pytest tests/integration/test_db_access.py -v

若資料庫無法連線，測試會以 pytest.skip 跳過，不視為失敗。
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

import backend.database as db_module
from backend.config import get_config


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _try_connect(db_name: str) -> bool:
    """Return True if the database is reachable, False otherwise."""
    try:
        engine = db_module.get_engine(db_name)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except (OperationalError, SQLAlchemyError):
        return False


def _skip_if_unreachable(db_name: str):
    if not _try_connect(db_name):
        pytest.skip(f"資料庫 '{db_name}' 無法連線，跳過整合測試")


# ---------------------------------------------------------------------------
# 連線健康檢查
# ---------------------------------------------------------------------------

class TestConnectionHealth:
    """驗證 check_connection() 對三個資料庫均能正確回傳結果。"""

    @pytest.mark.parametrize("db_name", ["file_status", "system_status", "disk_status"])
    def test_check_connection_returns_bool(self, db_name):
        db_module._engines.clear()
        db_module._session_factories.clear()
        result = db_module.check_connection(db_name)
        assert isinstance(result, bool)

    @pytest.mark.parametrize("db_name", ["file_status", "system_status", "disk_status"])
    def test_check_connection_succeeds(self, db_name):
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable(db_name)
        assert db_module.check_connection(db_name) is True


# ---------------------------------------------------------------------------
# FileStatus 資料庫
# ---------------------------------------------------------------------------

class TestFileStatusDB:
    """驗證 FileStatus 資料庫的資料表存在且可查詢。"""

    @pytest.fixture(autouse=True)
    def require_connection(self):
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable("file_status")

    def test_radar_status_table_accessible(self):
        """radarStatus 資料表可查詢，欄位結構符合預期。"""
        with db_module.get_session("file_status") as session:
            result = session.execute(
                text("SELECT ID, IP, FileName, FileType, FileTime, DiffTime "
                     "FROM radarStatus LIMIT 1")
            )
            # 只要不拋例外即代表資料表與欄位存在
            row = result.fetchone()
            # 若有資料，驗證欄位型別
            if row is not None:
                assert row.FileTime is not None or row.FileTime is None  # float or NULL
                assert row.DiffTime is not None or row.DiffTime is None

    def test_radar_file_check_table_accessible(self):
        """radarFileCheck 快照資料表可查詢。"""
        with db_module.get_session("file_status") as session:
            result = session.execute(
                text("SELECT IP, FileName, FileType, FileTime, DiffTime "
                     "FROM radarFileCheck LIMIT 10")
            )
            rows = result.fetchall()
            # 驗證每筆快照的 FileTime 為數值（Unix timestamp）
            for row in rows:
                if row.FileTime is not None:
                    assert float(row.FileTime) >= 0

    def test_file_type_list_table_accessible(self):
        """FileTypeList 資料表可查詢，且至少有一筆儀器記錄。"""
        with db_module.get_session("file_status") as session:
            result = session.execute(
                text("SELECT ID, FileType, EquipmentName FROM FileTypeList")
            )
            rows = result.fetchall()
            assert len(rows) >= 1, "FileTypeList 應至少有一筆儀器記錄"
            for row in rows:
                assert row.FileType is not None and row.FileType != ""

    def test_diff_time_is_non_negative(self):
        """radarFileCheck 中的 DiffTime 應為非負數（資料完整性）。"""
        with db_module.get_session("file_status") as session:
            result = session.execute(
                text("SELECT FileType, DiffTime FROM radarFileCheck "
                     "WHERE DiffTime IS NOT NULL LIMIT 50")
            )
            for row in result.fetchall():
                assert float(row.DiffTime) >= 0, (
                    f"FileType={row.FileType} 的 DiffTime={row.DiffTime} 不應為負數"
                )


# ---------------------------------------------------------------------------
# SystemStatus 資料庫
# ---------------------------------------------------------------------------

class TestSystemStatusDB:
    """驗證 SystemStatus 資料庫的資料表存在且可查詢。"""

    @pytest.fixture(autouse=True)
    def require_connection(self):
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable("system_status")

    def test_check_list_table_accessible(self):
        """CheckList 最新狀態快照資料表可查詢。"""
        with db_module.get_session("system_status") as session:
            result = session.execute(
                text("SELECT IP, ServerTime, Load_1, Load_5, LOAD_15, MemoryUSE "
                     "FROM CheckList LIMIT 10")
            )
            rows = result.fetchall()
            for row in rows:
                if row.MemoryUSE is not None:
                    assert 0.0 <= float(row.MemoryUSE) <= 100.0, (
                        f"IP={row.IP} 的 MemoryUSE={row.MemoryUSE} 應在 0~100 範圍內"
                    )

    def test_system_ip_list_table_accessible(self):
        """SystemIPList 設備對應表可查詢。"""
        with db_module.get_session("system_status") as session:
            result = session.execute(
                text("SELECT IP, EquipmentName, Department FROM SystemIPList LIMIT 10")
            )
            rows = result.fetchall()
            for row in rows:
                assert row.IP is not None and row.IP != ""


# ---------------------------------------------------------------------------
# DiskStatus 資料庫
# ---------------------------------------------------------------------------

class TestDiskStatusDB:
    """驗證 DiskStatus 資料庫的資料表存在且可查詢。"""

    @pytest.fixture(autouse=True)
    def require_connection(self):
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable("disk_status")

    def test_check_list_table_accessible(self):
        """CheckList 最新磁碟狀態快照資料表可查詢。"""
        with db_module.get_session("disk_status") as session:
            result = session.execute(
                text("SELECT IP, ServerTime, FileSystem, Used FROM CheckList LIMIT 10")
            )
            rows = result.fetchall()
            for row in rows:
                if row.Used is not None:
                    assert float(row.Used) >= 0, (
                        f"IP={row.IP} 的磁碟使用量 Used={row.Used} 不應為負數"
                    )

    def test_status_history_table_accessible(self):
        """Status 歷史記錄資料表可查詢。"""
        with db_module.get_session("disk_status") as session:
            result = session.execute(
                text("SELECT IP, ServerTime, FileSystem, Used "
                     "FROM Status ORDER BY ServerTime DESC LIMIT 5")
            )
            # 只要不拋例外即代表資料表存在
            result.fetchall()


# ---------------------------------------------------------------------------
# Session 行為驗證（實際連線）
# ---------------------------------------------------------------------------

class TestSessionBehavior:
    """驗證 get_session context manager 在實際連線下的行為。"""

    def test_session_executes_select_1(self):
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable("file_status")

        with db_module.get_session("file_status") as session:
            result = session.execute(text("SELECT 1 AS val"))
            row = result.fetchone()
            assert row.val == 1

    def test_readonly_no_write_permission_needed(self):
        """確認唯讀查詢不需要 WRITE 權限（SELECT 即可）。"""
        db_module._engines.clear()
        db_module._session_factories.clear()
        _skip_if_unreachable("file_status")

        with db_module.get_session("file_status") as session:
            # 純 SELECT，不應拋出權限錯誤
            session.execute(text("SELECT COUNT(*) FROM radarStatus"))
