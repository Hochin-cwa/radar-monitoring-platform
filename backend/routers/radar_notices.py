"""
Radar notices router — /api/v1/radar-notices
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.radar_notice_service import get_radar_notices

router = APIRouter(prefix="/api/v1/radar-notices", tags=["radar-notices"])


class RadarNotice(BaseModel):
    station: str
    message: str


class RadarNoticeResponse(BaseModel):
    available: bool
    notices: List[RadarNotice]


@router.get("", response_model=RadarNoticeResponse)
def get_notices() -> RadarNoticeResponse:
    notices = get_radar_notices()
    if notices is None:
        return RadarNoticeResponse(available=False, notices=[])
    return RadarNoticeResponse(available=True, notices=[RadarNotice(**n) for n in notices])
