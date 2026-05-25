"""
Pydantic data models for radar-monitoring-platform.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class InstrumentStatus(BaseModel):
    file_type: str
    equipment_name: str
    ip: Optional[str] = None
    department: Optional[str] = None
    latest_file_time: Optional[datetime] = None
    diff_time_minutes: Optional[float] = None
    interval_minutes: float          # 資料週期 T
    threshold_yellow: float          # T + 5（自動計算）
    threshold_orange: float          # T + 10（自動計算）
    threshold_red: float             # T + 20（自動計算）
    is_alert: bool


class InstrumentIntervalSetting(BaseModel):
    interval_minutes: float = Field(gt=0.0)  # 資料週期 T，必須大於 0


class CurrentStatusResponse(BaseModel):
    instruments: list[InstrumentStatus]
    calculated_at: datetime
    status: str


class InstrumentListItem(BaseModel):
    file_type: str
    equipment_name: str
    interval_minutes: float
    threshold_yellow: float
    threshold_orange: float
    threshold_red: float


class InstrumentListResponse(BaseModel):
    instruments: list[InstrumentListItem]


class ThresholdUpdateResponse(BaseModel):
    file_type: str
    interval_minutes: float
    threshold_yellow: float
    threshold_orange: float
    threshold_red: float
    updated_at: datetime


# --- computer-status-unified-card models ---

class DiskEntry(BaseModel):
    file_system: str
    used_pct: Optional[float]


class ComputerItem(BaseModel):
    ip: str
    equipment_name: Optional[str] = None
    department: Optional[str] = None
    load_1: Optional[float] = None
    load_5: Optional[float] = None
    load_15: Optional[float] = None
    memory_use: Optional[float] = None
    server_time: Optional[str] = None
    disks: list[DiskEntry] = []


class ComputerStatusResponse(BaseModel):
    items: list[ComputerItem]
    disk_error: bool
