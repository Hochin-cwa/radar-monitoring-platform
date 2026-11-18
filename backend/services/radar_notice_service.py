"""
Radar notice service — 讀取中央氣象署雷達站公告（年度保養 / 維護停止觀測）。

資料來源為 CWA 網頁載入的 /Data/js/Data_News.js 內 `Radar_News.C.title_str`，
每則公告以 <br /> 分隔，例如：
  本署樹林雷達站因年度保養，自2026年11月17日08時30分至2026年11月19日17時00分不定時停止觀測。
該檔是 JavaScript 而非 JSON，因此以正規表示式擷取字串，不執行任何外部程式碼。
"""
from __future__ import annotations

import logging
import re
import threading
import time
import urllib.request
from typing import Dict, List, Optional

from backend.config import get_config

logger = logging.getLogger("services.radar_notice")

_RADAR_NEWS_RE = re.compile(r"var\s+Radar_News\s*=\s*\{\s*'C'\s*:\s*\{(.*?)\}", re.S)
_TITLE_STR_RE = re.compile(r"'title_str'\s*:\s*\"((?:[^\"\\]|\\.)*)\"", re.S)
_BR_RE = re.compile(r"<br\s*/?>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_NOTICE_RE = re.compile(r"本署(?P<station>.+?)雷達站")

_lock = threading.Lock()
_cache: Dict[str, object] = {"at": 0.0, "notices": None}


def parse_radar_notices(js_text: str) -> List[Dict[str, str]]:
    """從 Data_News.js 原文解析出雷達站公告清單 [{station, message}]。"""
    block = _RADAR_NEWS_RE.search(js_text)
    if not block:
        return []
    title = _TITLE_STR_RE.search(block.group(1))
    if not title:
        return []
    raw = title.group(1).replace('\\"', '"').replace("\\\\", "\\")
    notices: List[Dict[str, str]] = []
    for part in _BR_RE.split(raw):
        text = _TAG_RE.sub("", part).strip()
        if not text:
            continue
        m = _NOTICE_RE.search(text)
        # 無法辨識站名的公告仍保留（station 為空），由呼叫端決定是否使用
        notices.append({"station": m.group("station") if m else "", "message": text})
    return notices


def _fetch() -> List[Dict[str, str]]:
    cfg = get_config().radar_notice
    if not cfg.url.startswith("https://"):
        raise ValueError("radar_notice.url must be https")
    req = urllib.request.Request(cfg.url, headers={"User-Agent": "radar-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=cfg.timeout_seconds) as resp:  # noqa: S310
        text = resp.read().decode("utf-8", errors="replace")
    return parse_radar_notices(text)


def get_radar_notices() -> Optional[List[Dict[str, str]]]:
    """回傳公告清單（有快取）。來源無法取得時回傳 None（有舊快取則沿用舊值）。"""
    ttl = get_config().radar_notice.cache_seconds
    now = time.monotonic()
    with _lock:
        cached = _cache["notices"]
        if cached is not None and now - float(_cache["at"]) < ttl:
            return cached  # type: ignore[return-value]
        try:
            notices = _fetch()
        except Exception as exc:  # 網路錯誤不應影響首頁其他功能
            logger.warning("Failed to fetch CWA radar notices: %s", type(exc).__name__)
            return cached  # type: ignore[return-value]
        _cache["notices"] = notices
        _cache["at"] = now
        return notices
