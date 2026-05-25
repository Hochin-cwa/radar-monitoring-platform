# Tech Stack

## Backend
- Language: Python 3.11+
- Framework: FastAPI + Uvicorn (ASGI)
- ORM / DB: SQLAlchemy (connection pool, read-only access)
- DB: MySQL 8.0+ (three databases: FileStatus, SystemStatus, DiskStatus)
- Config: PyYAML — all settings loaded from `config/config.yaml`, never hardcoded
- Logging: Python `logging` module → `logs/app.log`
- Process management: systemd service

## Frontend
- Pure HTML / CSS / JavaScript (no framework)
- Charting: Chart.js (time-series line chart)
- Communication: `fetch` API against FastAPI REST endpoints

## Testing
- Unit & integration tests: `pytest` + `httpx` + `pytest-mock`
- Property-based tests: `hypothesis` (minimum 100 iterations per property)
- Property test annotation format:
  ```
  # Feature: radar-monitoring-platform, Property {N}: {property_text}
  ```

## Deployment
- OS: Linux Rocky 9
- Static files served by Nginx or FastAPI `StaticFiles`
- Service managed via systemd

## Common Commands

```bash
# Install dependencies
pip install -r backend/requirements.txt

# Run development server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Run all tests
pytest

# Run only property-based tests
pytest -k "property"

# Run only integration tests
pytest -k "integration"
```

## API Base Path
All REST endpoints are prefixed with `/api/v1`.
