"""
Instruments router — /api/v1/instruments/*
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from backend.models import (
    InstrumentIntervalSetting, InstrumentListItem, InstrumentListResponse,
    ThresholdDirectSetting, ThresholdUpdateResponse,
)
from backend.services.alert_service import (
    calculate_thresholds, get_instrument_thresholds,
    list_instruments, set_instrument_thresholds, set_instrument_thresholds_direct,
)

logger = logging.getLogger("routers.instruments")
router = APIRouter(prefix="/api/v1/instruments", tags=["instruments"])


@router.get("", response_model=InstrumentListResponse)
def get_instruments() -> InstrumentListResponse:
    items = list_instruments()
    return InstrumentListResponse(
        instruments=[
            InstrumentListItem(
                file_type=i["file_type"],
                equipment_name=i["equipment_name"],
                interval_minutes=i["interval_minutes"],
                threshold_yellow=i["threshold_yellow"],
                threshold_orange=i["threshold_orange"],
                threshold_red=i["threshold_red"],
            )
            for i in items
        ]
    )


@router.post("/{file_type}/threshold", response_model=ThresholdUpdateResponse)
@router.put("/{file_type}/threshold", response_model=ThresholdUpdateResponse)
def update_threshold(file_type: str, body: ThresholdDirectSetting) -> ThresholdUpdateResponse:
    # 只在 DB 可用時驗證 file_type 是否存在；DB 不可用時直接允許更新
    instruments = list_instruments()
    if instruments:
        known = {i["file_type"] for i in instruments}
        if file_type not in known:
            raise HTTPException(status_code=404, detail=f"找不到儀器: {file_type}")

    set_instrument_thresholds_direct(
        file_type, body.threshold_yellow, body.threshold_orange, body.threshold_red
    )

    return ThresholdUpdateResponse(
        file_type=file_type,
        interval_minutes=body.threshold_yellow,  # 以 yellow 作為近似 interval 參考
        threshold_yellow=body.threshold_yellow,
        threshold_orange=body.threshold_orange,
        threshold_red=body.threshold_red,
        updated_at=datetime.now(timezone.utc),
    )
