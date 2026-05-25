"""
System router — /api/v1/system/* and /api/v1/disk/*
"""
from __future__ import annotations
import logging
from fastapi import APIRouter
from backend.services.system_service import get_system_status, get_disk_status

logger = logging.getLogger("routers.system")
router = APIRouter(tags=["system"])


@router.get("/api/v1/system/current")
def current_system_status():
    return {"items": get_system_status()}


@router.get("/api/v1/disk/current")
def current_disk_status():
    return {"items": get_disk_status()}
