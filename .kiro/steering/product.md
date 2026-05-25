# Product: 雷達監控整合平台 (Radar Monitoring Platform)

A web-based monitoring dashboard deployed on Linux Rocky 9. It provides operators with real-time visibility into radar data completeness rates and computer system status.

## Core Features
- Real-time display of local time and UTC time (updated every second)
- Radar data completeness rate (%) calculated from MySQL, refreshed every 10 seconds
- Visual alert (red block) when completeness rate drops below a configurable threshold (default: 95%)
- Time-series line chart showing completeness history (default: last 24 hours, customizable range)
- Auto-refresh every 10 seconds without full page reload; manual refresh button available
- Error states: DB connection failure, query timeout, empty result, network error — all surfaced in the UI

## Target Users
Radar operations personnel who need continuous, hands-off monitoring without manual intervention.

## Key Business Rules
- Alert threshold is configurable (0–100%), defaults to 95%
- Radar data expected interval: every 10 minutes (used to calculate expected_count)
- DB access is read-only against three existing MySQL databases: FileStatus, SystemStatus, DiskStatus
- DB connection parameters must never be hardcoded; always loaded from config.yaml
