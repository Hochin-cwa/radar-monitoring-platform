"""
FastAPI application entry point for radar-monitoring-platform.
"""

from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend.routers.completeness import router as completeness_router
from backend.routers.computers import router as computers_router
from backend.routers.history import router as history_router
from backend.routers.instruments import router as instruments_router

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.handlers.RotatingFileHandler(
            _LOG_DIR / "app.log",
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        ),
        logging.StreamHandler(),
    ],
)

logger = logging.getLogger("main")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="雷達監控整合平台",
    description="Radar Monitoring Platform API",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Security headers middleware (defense-in-depth)
#
# nginx (前端 edge) 已負責設定安全性標頭；此中介層確保即使後端被直接存取
# （未經 nginx 代理）時，API 回應仍帶有相同的安全性標頭，並移除洩漏版本
# 資訊的 Server 標頭。修正 ZAP 掃描之 CSP / Clickjacking / MIME-sniffing /
# Server version 洩漏弱點。
# ---------------------------------------------------------------------------

_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'self'"
)


class SecurityHeadersMiddleware:
    """純 ASGI 中介層：於最外層注入安全性標頭。

    以 ASGI 層級攔截 http.response.start 事件，確保連錯誤回應（含未處理
    例外產生的 500）都會帶有安全性標頭，並移除洩漏版本資訊的 Server 標頭。
    """

    _EXTRA_HEADERS = [
        (b"content-security-policy", _CSP_POLICY.encode("latin-1")),
        (b"x-frame-options", b"SAMEORIGIN"),
        (b"x-content-type-options", b"nosniff"),
    ]
    _DROP = {
        b"content-security-policy",
        b"x-frame-options",
        b"x-content-type-options",
        b"server",
    }

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_with_headers(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                headers = [
                    (k, v)
                    for (k, v) in message.get("headers", [])
                    if k.lower() not in self._DROP
                ]
                headers.extend(self._EXTRA_HEADERS)
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            # 若下游尚未送出任何回應即拋出例外，仍回傳帶有安全性標頭的 500，
            # 確保錯誤頁同樣受保護（對齊 nginx always 行為），再將例外向上拋出
            # 交由 uvicorn 記錄。
            if not response_started:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-type", b"text/plain; charset=utf-8"),
                            *self._EXTRA_HEADERS,
                        ],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": b"Internal Server Error",
                    }
                )
            raise


app.add_middleware(SecurityHeadersMiddleware)

app.include_router(completeness_router)
app.include_router(computers_router)
app.include_router(instruments_router)
app.include_router(history_router)

# Redirect root URL to the instruments page
@app.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/instruments.html")


# Serve frontend static files
_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")

logger.info("Radar monitoring platform started")
