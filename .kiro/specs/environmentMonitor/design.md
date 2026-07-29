# 技術設計文件：環境溫溼度監測

## 概覽

在現有雷達監控整合平台中新增環境溫溼度監測模組。後端新增 API 端點查詢 SystemStatus 資料庫中的 EnvironmentStatus 表，前端新增專用歷史頁面顯示溫度與濕度時序折線圖。

---

## 架構

### 資料流

```
溫溼度計 (192.168.178.19)
    → MySQL (SystemStatus.EnvironmentStatus)
    → FastAPI (GET /api/v1/history/environment)
    → 前端 (environment-history.html + Chart.js)
```

### 資料庫表結構（預期）

```sql
-- SystemStatus 資料庫
CREATE TABLE EnvironmentStatus (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  IP CHAR(15) NOT NULL,
  ServerTime DATETIME NOT NULL,
  Temperature FLOAT,
  Humidity FLOAT
);
```

---

## API 設計

### GET /api/v1/history/environment

**參數：**
- `ip` (required): 設備 IP
- `range` (required): 時間範圍 (6h | 1d | 1w | 1m | 3m)

**回應：**
```json
{
  "ip": "192.168.178.19",
  "range": "1d",
  "temperature": [
    {"time": "2026-07-28T10:00:00", "value": 25.3},
    ...
  ],
  "humidity": [
    {"time": "2026-07-28T10:00:00", "value": 62.5},
    ...
  ]
}
```

---

## 前端設計

### 新增檔案
- `frontend/environment-history.html` — 溫溼度歷史頁面
- `frontend/js/environment-history.js` — 頁面控制器

### 頁面結構
與 `history.html` 相同的 header、時間範圍按鈕、圖表容器。
用兩張 Chart.js 折線圖分別呈現溫度和濕度。

### 儀器列表整合
在 `instruments.js` 渲染時，對 IP=192.168.178.19 的卡片導向 `/environment-history.html?ip=192.168.178.19`。

---

## 檔案影響清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `backend/routers/history.py` | 修改 | 新增 environment history endpoint |
| `backend/services/history_service.py` | 修改 | 新增 `get_environment_history()` |
| `frontend/environment-history.html` | 新增 | 溫溼度歷史頁面 |
| `frontend/js/environment-history.js` | 新增 | 頁面 JS 控制器 |
| `frontend/js/api.js` | 修改 | 新增 `fetchEnvironmentHistory()` |
