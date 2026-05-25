# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**雷達監控整合平台 (Radar Monitoring Platform)** — A web-based monitoring dashboard deployed on Linux Rocky 9. It provides real-time visibility into radar data completeness rates and computer system status for radar operations personnel.

## Common Commands

```bash
# Install dependencies
pip install -r backend/requirements.txt

# Run development server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Run all tests
pytest

# Run a specific test type
pytest -k "property"     # property-based tests only
pytest -k "integration"  # integration tests only

# Run a single test file
pytest tests/unit/test_database.py
```

## Architecture

### Backend (FastAPI + Python 3.11+)

- **`backend/main.py`** — App entry point; registers routers, mounts frontend static files, configures rotating log handler (`logs/app.log`, 10MB max, 5 backups)
- **`backend/config.py`** — Singleton config loader from `config/config.yaml`; never hardcode DB params, thresholds, or intervals
- **`backend/database.py`** — SQLAlchemy connection pool for three MySQL databases (FileStatus, SystemStatus, DiskStatus); all DB access must go through here
- **`backend/routers/`** — Thin routers that validate input and delegate to services; no business logic here
- **`backend/services/`** — All business logic lives here (completeness calculations, alert threshold management, system status queries)
- **`backend/models.py`** — Pydantic models for all API request/response shapes

All REST endpoints are prefixed with `/api/v1`.

### Frontend (Vanilla HTML/CSS/JS)

No framework. JS is split by concern:
- **`api.js`** — All HTTP fetch calls with 8-second timeout and unified error handling
- **`chart.js`** — Chart.js time-series visualization
- **`dashboard.js`** — Main orchestration, auto-refresh every 10 seconds
- **`clock.js`** — Local + UTC time updated every 100ms
- **`instruments.js`** / **`computers.js`** — Page-specific monitoring logic

### Data Flow

1. Frontend pages call REST endpoints
2. Routers delegate to services
3. Services query MySQL via `database.py` connection pools (read-only access)
4. Results returned as Pydantic models

**Key databases:**
- `FileStatus` — Radar file completeness data (`radarStatus`, `radarFileCheck`, `FileTypeList` tables)
- `SystemStatus` — CPU load and memory metrics (`CheckList`, `SystemIPList`)
- `DiskStatus` — Disk usage by IP (`CheckList`)

### Deployment

- Nginx serves frontend static files on port 80, proxies `/api/v1/*` to FastAPI on port 8000
- Backend runs as systemd service (`deploy/radar-monitor.service`) as user `radar` from `/opt/radar-monitoring-platform`

## Key Conventions

- Business logic in `services/`, not in routers
- All DB access through `database.py`; never open raw connections elsewhere
- All config read via `config.py`; nothing hardcoded
- Pydantic models for all API shapes
- Log format: `%(asctime)s [%(levelname)s] %(name)s: %(message)s`
- Property-based tests annotated with: `# Feature: radar-monitoring-platform, Property {N}: {property_text}` and use minimum 100 hypothesis iterations

## Business Rules

- Alert threshold configurable 0–100%, default 95%
- Radar data expected every 10 minutes (used to calculate `expected_count`)
- All DB access is read-only
