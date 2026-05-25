# Feature: computer-status-unified-card
"""
電腦狀態 API 整合測試 — 使用 FastAPI TestClient 測試 /api/v1/computers/current 端點。
使用 unittest.mock.patch 模擬 get_combined_status()，避免真實資料庫連線。

需求：1.1、1.2
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from backend.main import app

client = TestClient(app)


# ── 共用 helpers ─────────────────────────────────────────────

def _make_computer_item(
    ip="192.168.1.1",
    equipment_name="Server A",
    department="wrs",
    load_1=0.5,
    load_5=0.4,
    load_15=0.3,
    memory_use=60.0,
    server_time="2024-01-15T10:00:00",
    disks=None,
):
    return {
        "ip": ip,
        "equipment_name": equipment_name,
        "department": department,
        "load_1": load_1,
        "load_5": load_5,
        "load_15": load_15,
        "memory_use": memory_use,
        "server_time": server_time,
        "disks": disks if disks is not None else [
            {"file_system": "/", "used_pct": 55.0},
        ],
    }


# ── GET /api/v1/computers/current ────────────────────────────

class TestComputersCurrent:
    """需求 1.1：新端點回傳正確結構"""

    def test_returns_200_with_items_and_disk_error(self):
        """GET /api/v1/computers/current 回傳 200，包含 items 陣列與 disk_error 布林值（需求 1.1）"""
        items = [_make_computer_item()]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert "disk_error" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["disk_error"], bool)

    def test_response_contains_correct_number_of_items(self):
        """回傳的 items 數量與 mock 資料一致"""
        items = [_make_computer_item("192.168.1.1"), _make_computer_item("192.168.1.2")]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 200
        assert len(res.json()["items"]) == 2

    def test_disk_error_false_when_no_disk_error(self):
        """disk_error 為 False 時正確回傳"""
        items = [_make_computer_item()]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.json()["disk_error"] is False

    def test_disk_error_true_when_disk_db_unavailable(self):
        """DiskStatus 資料庫無法連線時 disk_error 為 True（需求 1.6）"""
        items = [_make_computer_item(disks=[])]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, True)):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 200
        assert res.json()["disk_error"] is True

    def test_returns_503_when_system_db_unavailable(self):
        """SystemStatus 資料庫無法連線時回傳 HTTP 503（需求 1.5）"""
        with patch(
            "backend.routers.computers.get_combined_status",
            side_effect=OperationalError("connection failed", None, None),
        ):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 503

    def test_returns_empty_items_list(self):
        """無資料時回傳空 items 陣列"""
        with patch("backend.routers.computers.get_combined_status", return_value=([], False)):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 200
        assert res.json()["items"] == []


class TestComputerItemStructure:
    """需求 1.2：每筆資料包含所有必要欄位"""

    def test_item_has_all_required_fields(self):
        """每筆資料包含 ip、equipment_name、department、load_1、load_5、load_15、memory_use、server_time、disks（需求 1.2）"""
        items = [_make_computer_item()]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        item = res.json()["items"][0]
        for field in ("ip", "equipment_name", "department", "load_1", "load_5",
                      "load_15", "memory_use", "server_time", "disks"):
            assert field in item, f"缺少欄位: {field}"

    def test_item_ip_field_value(self):
        """ip 欄位值正確"""
        items = [_make_computer_item(ip="10.0.0.1")]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.json()["items"][0]["ip"] == "10.0.0.1"

    def test_item_disks_is_list(self):
        """disks 欄位為陣列"""
        items = [_make_computer_item()]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert isinstance(res.json()["items"][0]["disks"], list)

    def test_disk_entry_has_file_system_and_used_pct(self):
        """磁碟項目包含 file_system 與 used_pct 欄位（需求 1.3）"""
        items = [_make_computer_item(disks=[{"file_system": "/data", "used_pct": 42.5}])]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        disk = res.json()["items"][0]["disks"][0]
        assert disk["file_system"] == "/data"
        assert disk["used_pct"] == 42.5

    def test_item_with_empty_disks(self):
        """無磁碟記錄時 disks 為空陣列（需求 1.4）"""
        items = [_make_computer_item(disks=[])]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.json()["items"][0]["disks"] == []

    def test_item_with_null_optional_fields(self):
        """選填欄位為 null 時正確回傳"""
        items = [_make_computer_item(
            equipment_name=None,
            department=None,
            load_1=None,
            load_5=None,
            load_15=None,
            memory_use=None,
            server_time=None,
        )]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert res.status_code == 200
        item = res.json()["items"][0]
        assert item["load_1"] is None
        assert item["memory_use"] is None
        assert item["server_time"] is None

    def test_multiple_disks_per_item(self):
        """單一 IP 可包含多個磁碟項目（需求 1.3）"""
        disks = [
            {"file_system": "/", "used_pct": 30.0},
            {"file_system": "/data", "used_pct": 75.0},
            {"file_system": "/backup", "used_pct": 90.0},
        ]
        items = [_make_computer_item(disks=disks)]
        with patch("backend.routers.computers.get_combined_status", return_value=(items, False)):
            res = client.get("/api/v1/computers/current")
        assert len(res.json()["items"][0]["disks"]) == 3


# ── 向下相容：舊端點仍回傳 HTTP 200 ──────────────────────────

class TestLegacyEndpointsBackwardCompatibility:
    """舊端點向下相容性測試"""

    def test_system_current_returns_200(self):
        """GET /api/v1/system/current 仍回傳 HTTP 200（向下相容）"""
        mock_data = [
            {"ip": "192.168.1.1", "equipment_name": "Server A", "department": "wrs",
             "load_1": 0.5, "load_5": 0.4, "load_15": 0.3, "memory_use": 60.0,
             "cpu_alert": "normal", "memory_alert": "normal"}
        ]
        with patch("backend.routers.system.get_system_status", return_value=mock_data):
            res = client.get("/api/v1/system/current")
        assert res.status_code == 200

    def test_disk_current_returns_200(self):
        """GET /api/v1/disk/current 仍回傳 HTTP 200（向下相容）"""
        mock_data = [
            {"ip": "192.168.1.1", "file_system": "/dev/sda1", "used_pct": 55.0,
             "equipment_name": "Server A", "department": "wrs", "disk_alert": "normal"}
        ]
        with patch("backend.routers.system.get_disk_status", return_value=mock_data):
            res = client.get("/api/v1/disk/current")
        assert res.status_code == 200

    def test_system_current_returns_items_key(self):
        """GET /api/v1/system/current 回應包含 items 鍵"""
        with patch("backend.routers.system.get_system_status", return_value=[]):
            res = client.get("/api/v1/system/current")
        assert "items" in res.json()

    def test_disk_current_returns_items_key(self):
        """GET /api/v1/disk/current 回應包含 items 鍵"""
        with patch("backend.routers.system.get_disk_status", return_value=[]):
            res = client.get("/api/v1/disk/current")
        assert "items" in res.json()
