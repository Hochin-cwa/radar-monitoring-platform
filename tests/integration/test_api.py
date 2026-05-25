# Feature: radar-monitoring-platform
"""
API 整合測試 — 使用 FastAPI TestClient 測試各端點。
使用 unittest.mock.patch 模擬 DB 連線失敗與服務層回應。

需求：4.4、4.5、5.5
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import InstrumentStatus

client = TestClient(app)


# ── 共用 helpers ─────────────────────────────────────────────

def _make_instrument(file_type="RADAR_A", is_alert=False, diff=5.0, dept="wrs"):
    return InstrumentStatus(
        file_type=file_type,
        equipment_name=f"站台 {file_type}",
        ip="192.168.1.1",
        department=dept,
        latest_file_time=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
        diff_time_minutes=diff,
        interval_minutes=7.0,
        threshold_yellow=12.0,
        threshold_orange=17.0,
        threshold_red=27.0,
        is_alert=is_alert,
    )


def _make_instrument_dict(file_type="RADAR_A"):
    return {
        "file_type": file_type,
        "equipment_name": f"站台 {file_type}",
        "interval_minutes": 7.0,
        "threshold_yellow": 12.0,
        "threshold_orange": 17.0,
        "threshold_red": 27.0,
    }


# ── GET /api/v1/completeness/current ────────────────────────

class TestCurrentStatus:
    """需求 4.4：DB 連線失敗時回傳快取結果"""

    def test_returns_200_with_valid_json_structure(self):
        """GET /api/v1/completeness/current 回傳 200 與正確 JSON 結構（mock DB）"""
        instruments = [_make_instrument("RADAR_A"), _make_instrument("RADAR_B")]
        with patch("backend.routers.completeness.get_all_instrument_statuses",
                   return_value=instruments):
            res = client.get("/api/v1/completeness/current")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "instruments" in data
        assert "calculated_at" in data
        assert len(data["instruments"]) == 2

    def test_instrument_has_required_fields(self):
        """回傳的儀器物件包含所有必要欄位"""
        instruments = [_make_instrument("RADAR_A")]
        with patch("backend.routers.completeness.get_all_instrument_statuses",
                   return_value=instruments):
            res = client.get("/api/v1/completeness/current")
        inst = res.json()["instruments"][0]
        for field in ("file_type", "equipment_name", "threshold_yellow",
                      "threshold_orange", "threshold_red", "interval_minutes", "is_alert"):
            assert field in inst, f"缺少欄位: {field}"

    def test_returns_503_when_db_unavailable(self):
        """DB 連線失敗且無快取時回傳 503（需求 4.4）"""
        with patch("backend.routers.completeness.get_all_instrument_statuses",
                   return_value=[]):
            res = client.get("/api/v1/completeness/current")
        assert res.status_code == 503

    def test_returns_cached_result_on_db_failure(self):
        """DB 連線失敗時，服務層回傳快取資料，端點回傳 200（需求 4.4）"""
        cached = [_make_instrument("RADAR_CACHED")]
        # 模擬 DB 失敗但有快取：服務回傳非空列表
        with patch("backend.routers.completeness.get_all_instrument_statuses",
                   return_value=cached):
            res = client.get("/api/v1/completeness/current")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["instruments"][0]["file_type"] == "RADAR_CACHED"


# ── GET /api/v1/instruments ──────────────────────────────────

class TestGetInstruments:
    """需求 5.1：從 FileTypeList 取得所有儀器清單"""

    def test_returns_200_with_instruments_list(self):
        """GET /api/v1/instruments 回傳 200 與儀器清單（mock DB）"""
        instruments = [_make_instrument_dict("RADAR_A"), _make_instrument_dict("RADAR_B")]
        with patch("backend.routers.instruments.list_instruments", return_value=instruments):
            res = client.get("/api/v1/instruments")
        assert res.status_code == 200
        data = res.json()
        assert "instruments" in data
        assert len(data["instruments"]) == 2

    def test_instrument_list_has_interval_and_threshold_fields(self):
        """儀器清單包含 interval_minutes 與三段閾值欄位"""
        instruments = [_make_instrument_dict("RADAR_A")]
        with patch("backend.routers.instruments.list_instruments", return_value=instruments):
            res = client.get("/api/v1/instruments")
        item = res.json()["instruments"][0]
        assert item["interval_minutes"] == 7.0
        assert item["threshold_yellow"] == 12.0
        assert item["threshold_orange"] == 17.0
        assert item["threshold_red"] == 27.0

    def test_returns_empty_list_when_db_unavailable(self):
        """DB 不可用時回傳空清單（不回傳 503）"""
        with patch("backend.routers.instruments.list_instruments", return_value=[]):
            res = client.get("/api/v1/instruments")
        assert res.status_code == 200
        assert res.json()["instruments"] == []


# ── PUT /api/v1/instruments/{file_type}/threshold ───────────

class TestUpdateThreshold:
    """需求 5.5：interval_minutes 驗證與儀器存在性檢查"""

    def test_returns_422_for_negative_interval_minutes(self):
        """PUT 負數 interval_minutes 回傳 422（需求 5.5）"""
        res = client.put(
            "/api/v1/instruments/RADAR_A/threshold",
            json={"interval_minutes": -1.0},
        )
        assert res.status_code == 422

    def test_returns_422_for_zero_interval_minutes(self):
        """PUT interval_minutes=0 回傳 422（需求 5.5，gt=0.0）"""
        res = client.put(
            "/api/v1/instruments/RADAR_A/threshold",
            json={"interval_minutes": 0.0},
        )
        assert res.status_code == 422

    def test_returns_404_for_nonexistent_file_type(self):
        """PUT 不存在的 file_type 且 DB 回傳非空清單時回傳 404（需求 5.5）"""
        known_instruments = [_make_instrument_dict("RADAR_A")]
        with patch("backend.routers.instruments.list_instruments",
                   return_value=known_instruments):
            res = client.put(
                "/api/v1/instruments/NONEXISTENT_TYPE/threshold",
                json={"interval_minutes": 10.0},
            )
        assert res.status_code == 404

    def test_returns_200_for_valid_interval_minutes(self):
        """PUT 有效 interval_minutes 回傳 200 與計算後的閾值"""
        instruments = [_make_instrument_dict("RADAR_A")]
        with patch("backend.routers.instruments.list_instruments",
                   return_value=instruments), \
             patch("backend.routers.instruments.set_instrument_thresholds") as mock_set:
            res = client.put(
                "/api/v1/instruments/RADAR_A/threshold",
                json={"interval_minutes": 10.0},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["file_type"] == "RADAR_A"
        assert data["interval_minutes"] == 10.0
        assert data["threshold_yellow"] == 15.0   # T + 5
        assert data["threshold_orange"] == 20.0   # T + 10
        assert data["threshold_red"] == 30.0      # T + 20
        mock_set.assert_called_once_with("RADAR_A", 10.0)

    def test_allows_update_when_db_unavailable(self):
        """DB 不可用（list_instruments 回傳空）時允許更新任意 file_type（不回傳 404）"""
        with patch("backend.routers.instruments.list_instruments", return_value=[]), \
             patch("backend.routers.instruments.set_instrument_thresholds"):
            res = client.put(
                "/api/v1/instruments/ANY_TYPE/threshold",
                json={"interval_minutes": 5.0},
            )
        assert res.status_code == 200


# ── GET /api/v1/system/current ──────────────────────────────

class TestSystemStatus:
    """需求 6：電腦系統狀態端點"""

    def test_returns_200_with_items(self):
        """GET /api/v1/system/current 回傳 200（mock DB）"""
        mock_data = [
            {"ip": "192.168.1.1", "equipment_name": "Server A", "department": "wrs",
             "load_1": 0.5, "load_5": 0.4, "load_15": 0.3, "memory_use": 60.0,
             "cpu_alert": "normal", "memory_alert": "warning"}
        ]
        with patch("backend.routers.system.get_system_status", return_value=mock_data):
            res = client.get("/api/v1/system/current")
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert len(data["items"]) == 1

    def test_returns_200_with_empty_list_on_db_failure(self):
        """DB 不可用時回傳 200 與空清單（不回傳 503）"""
        with patch("backend.routers.system.get_system_status", return_value=[]):
            res = client.get("/api/v1/system/current")
        assert res.status_code == 200
        assert res.json()["items"] == []


# ── GET /api/v1/disk/current ────────────────────────────────

class TestDiskStatus:
    """需求 6：磁碟狀態端點"""

    def test_returns_200_with_items(self):
        """GET /api/v1/disk/current 回傳 200（mock DB）"""
        mock_data = [
            {"ip": "192.168.1.1", "file_system": "/dev/sda1", "used_pct": 55.0,
             "equipment_name": "Server A", "department": "wrs", "disk_alert": "normal"}
        ]
        with patch("backend.routers.system.get_disk_status", return_value=mock_data):
            res = client.get("/api/v1/disk/current")
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert len(data["items"]) == 1

    def test_returns_200_with_empty_list_on_db_failure(self):
        """DB 不可用時回傳 200 與空清單"""
        with patch("backend.routers.system.get_disk_status", return_value=[]):
            res = client.get("/api/v1/disk/current")
        assert res.status_code == 200
        assert res.json()["items"] == []


# ── GET /api/v1/history/{file_type} ─────────────────────────

class TestInstrumentHistory:
    """需求 7.1–7.9：儀器歷史資料端點"""

    def _mock_result(self, file_type="RADAR_A", ip="192.168.1.1", range="1d"):
        return {
            "file_type": file_type,
            "ip": ip,
            "range": range,
            "threshold_yellow": 12.0,
            "threshold_orange": 17.0,
            "threshold_red": 27.0,
            "data": [
                {"time": "2026-04-14T10:00:00+00:00", "diff_time_minutes": 8.5},
                {"time": "2026-04-14T11:00:00+00:00", "diff_time_minutes": 6.2},
            ],
        }

    def test_returns_200_with_valid_params(self):
        """GET /api/v1/history/{file_type} 回傳 200 與正確 JSON 結構"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_instrument_history", return_value=mock_result):
            res = client.get("/api/v1/history/RADAR_A?ip=192.168.1.1&range=1d")
        assert res.status_code == 200
        data = res.json()
        assert data["file_type"] == "RADAR_A"
        assert data["ip"] == "192.168.1.1"
        assert data["range"] == "1d"
        assert "threshold_yellow" in data
        assert "threshold_orange" in data
        assert "threshold_red" in data
        assert isinstance(data["data"], list)

    def test_data_points_have_time_and_diff(self):
        """回傳的資料點包含 time 與 diff_time_minutes 欄位"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_instrument_history", return_value=mock_result):
            res = client.get("/api/v1/history/RADAR_A?ip=192.168.1.1&range=1d")
        point = res.json()["data"][0]
        assert "time" in point
        assert "diff_time_minutes" in point

    def test_returns_empty_data_when_no_records(self):
        """無歷史資料時回傳空 data 陣列（需求 7.9）"""
        mock_result = self._mock_result()
        mock_result["data"] = []
        with patch("backend.routers.history.get_instrument_history", return_value=mock_result):
            res = client.get("/api/v1/history/RADAR_A?ip=192.168.1.1&range=6h")
        assert res.status_code == 200
        assert res.json()["data"] == []

    def test_returns_422_for_invalid_range(self):
        """無效 range 參數回傳 422"""
        res = client.get("/api/v1/history/RADAR_A?ip=192.168.1.1&range=invalid")
        assert res.status_code == 422

    def test_all_valid_ranges_accepted(self):
        """所有合法 range 值（6h/1d/1w/1m/3m）均被接受"""
        for r in ("6h", "1d", "1w", "1m", "3m"):
            mock_result = self._mock_result(range=r)
            mock_result["data"] = []
            with patch("backend.routers.history.get_instrument_history", return_value=mock_result):
                res = client.get(f"/api/v1/history/RADAR_A?ip=192.168.1.1&range={r}")
            assert res.status_code == 200, f"range={r} should be accepted"

    def test_thresholds_included_in_response(self):
        """回傳結果包含 threshold_yellow/orange/red 供前端畫閾值線（需求 7.5）"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_instrument_history", return_value=mock_result):
            res = client.get("/api/v1/history/RADAR_A?ip=192.168.1.1&range=1d")
        data = res.json()
        assert data["threshold_yellow"] == 12.0
        assert data["threshold_orange"] == 17.0
        assert data["threshold_red"] == 27.0


# ── GET /api/v1/history/system ──────────────────────────────

class TestSystemHistory:
    """需求 7.6–7.8：電腦系統歷史資料端點"""

    def _mock_result(self, ip="192.168.1.1", range="1d"):
        return {
            "ip": ip,
            "range": range,
            "cpu": [{"time": "2026-04-14T10:00:00+00:00", "load_1": 12.3}],
            "memory": [{"time": "2026-04-14T10:00:00+00:00", "memory_use": 55.2}],
            "disk": [{"time": "2026-04-14T10:00:00+00:00", "used": 42.1}],
        }

    def test_returns_200_with_valid_params(self):
        """GET /api/v1/history/system 回傳 200 與正確 JSON 結構"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_system_history", return_value=mock_result):
            res = client.get("/api/v1/history/system?ip=192.168.1.1&range=1d")
        assert res.status_code == 200
        data = res.json()
        assert data["ip"] == "192.168.1.1"
        assert data["range"] == "1d"
        assert "cpu" in data
        assert "memory" in data
        assert "disk" in data

    def test_cpu_memory_disk_are_lists(self):
        """cpu、memory、disk 欄位均為陣列（需求 7.6）"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_system_history", return_value=mock_result):
            res = client.get("/api/v1/history/system?ip=192.168.1.1&range=1d")
        data = res.json()
        assert isinstance(data["cpu"], list)
        assert isinstance(data["memory"], list)
        assert isinstance(data["disk"], list)

    def test_cpu_data_point_has_load_1(self):
        """CPU 資料點包含 load_1 欄位（需求 7.6）"""
        mock_result = self._mock_result()
        with patch("backend.routers.history.get_system_history", return_value=mock_result):
            res = client.get("/api/v1/history/system?ip=192.168.1.1&range=1d")
        assert "load_1" in res.json()["cpu"][0]

    def test_returns_422_for_invalid_range(self):
        """無效 range 參數回傳 422"""
        res = client.get("/api/v1/history/system?ip=192.168.1.1&range=bad")
        assert res.status_code == 422

    def test_returns_empty_lists_when_no_data(self):
        """無歷史資料時回傳空陣列（需求 7.9）"""
        mock_result = {"ip": "192.168.1.1", "range": "3m", "cpu": [], "memory": [], "disk": []}
        with patch("backend.routers.history.get_system_history", return_value=mock_result):
            res = client.get("/api/v1/history/system?ip=192.168.1.1&range=3m")
        assert res.status_code == 200
        data = res.json()
        assert data["cpu"] == []
        assert data["memory"] == []
        assert data["disk"] == []

    def test_all_valid_ranges_accepted(self):
        """所有合法 range 值均被接受"""
        for r in ("6h", "1d", "1w", "1m", "3m"):
            mock_result = self._mock_result(range=r)
            with patch("backend.routers.history.get_system_history", return_value=mock_result):
                res = client.get(f"/api/v1/history/system?ip=192.168.1.1&range={r}")
            assert res.status_code == 200, f"range={r} should be accepted"
