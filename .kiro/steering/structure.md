/. # Project Structure

```
radar-monitoring-platform/
├── backend/
│   ├── main.py                      # FastAPI app entry point
│   ├── config.py                    # Loads config/config.yaml
│   ├── database.py                  # SQLAlchemy connection pool management
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── completeness.py          # /api/v1/completeness/* endpoints
│   │   └── settings.py              # /api/v1/settings/* endpoints
│   ├── services/
│   │   ├── __init__.py
│   │   └── completeness_service.py  # Completeness rate calculation logic
│   └── requirements.txt
├── frontend/
│   ├── index.html                   # Dashboard main page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── dashboard.js             # Time display, auto-refresh, completeness display
│       ├── chart.js                 # Chart.js time-series chart
│       └── api.js                   # fetch wrapper, unified error handling
├── config/
│   └── config.yaml                  # DB connection params + system settings
├── logs/                            # Runtime log output (app.log)
├── deploy/
│   └── radar-monitor.service        # systemd unit file
└── tests/
    ├── unit/
    ├── integration/
    └── property/                    # Hypothesis property-based tests
```

## Key Conventions

- Business logic lives in `services/`, not in routers
- Routers are thin — they validate input and delegate to services
- All DB access goes through `database.py` (connection pool); never open raw connections elsewhere
- Config values are always read via `config.py`; no hardcoded strings for DB params, thresholds, or intervals
- Frontend JS is split by concern: `api.js` handles all HTTP, `chart.js` owns the chart, `dashboard.js` orchestrates everything
- Pydantic models are used for all API request/response shapes
- Logs go to `logs/app.log` using the standard `logging` module with format: `%(asctime)s [%(levelname)s] %(name)s: %(message)s`
