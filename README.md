# 雷達監控整合平台 README

## 項目概述
雷達監控整合平台是一套前後端分離的網頁應用，部署於 Linux Rocky 9。後端使用 Python（FastAPI）提供 REST API，前端以純 HTML/CSS/JavaScript 實現儀器與電腦狀態儀表板，資料來源為唯讀的 MySQL 資料庫。核心功能是即時顯示各儀器資料時間差（依顏色區分嚴重程度）與電腦系統狀態，異常推播由外部系統負責，本平台專注視覺化呈現。

## 系統架構
- **瀏覽器**：Dashboard 前端（HTML/CSS/JS）  
- **應用伺服器**（Rocky 9）：FastAPI 後端、設定檔（config.yaml、thresholds.yaml）  
- **資料庫伺服器**：MySQL 8.0+（外部唯讀）  
- **通訊**：UI 透過 HTTP REST/JSON 與 API 溝通；API 經 SQLAlchemy 連線池存取 DB；API 讀寫本地設定檔。  
- **部署**：作業系統 Rocky 9、Python 3.11+、FastAPI + Uvicorn（ASGI）、前端靜態檔案由 Nginx 或 FastAPI StaticFiles 提供、程序管理透過 systemd service。

## 專案目錄結構
```
radar-monitoring-platform/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── routers/
│   │   ├── completeness.py
│   │   ├── instruments.py
│   │   └── system.py
│   ├── services/
│   │   ├── alert_service.py
│   │   └── system_service.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── instruments.html
│   ├── computers.html
│   ├── settings.html
│   ├── css/style.css
│   └── js/
│       ├── api.js
│       ├── clock.js
│       ├── dashboard.js
│       ├── computers.js
│       └── settings.js
├── config/
│   ├── config.yaml
│   └── thresholds.yaml
├── logs/
└── deploy/
    └── radar-monitor.service
```

## 核心功能
- **後端元件**：資料存取層（SQLAlchemy 連線池）、業務邏輯層（services）、API 層（routers）與設定層（config.py）。提供儀器即時狀態、歷史 DiffTime、電腦負載/記憶體/磁碟、閾值讀寫等 REST API。  
- **前端元件**：  
  - `index.html` + `clock.js`：導覽頁  
  - `instruments.html` + `dashboard.js`：儀器即時狀況（依科別分組，異常直接顯示，正常折疊為綠色摘要）  
  - `computers.html` + `computers.js`：電腦即時狀況  
  - `settings.html` + `settings.js`：儀器閾值設定（寫回 thresholds.yaml）  
  - 此外尚有歷史頁面（history.html）可視化時序圖。

## API 介紹（基礎路徑 `/api/v1`）
- `GET /completeness/current`：取得所有儀器即時狀態（含 diff_time、是否警報）。  
- `GET /instruments`：取得儀器清單與目前閾值。  
- `PUT /instruments/{file_type}/threshold`：更新特定儀器三段閾值。  
- `GET /history/{file_type}`：查詢特定儀器在給定時間範圍（6h/1d/1w/1m/3m）的 DiffTime 歷史。  
- `GET /history/system`：查詢特定 IP 電腦的 CPU、記憶體、磁碟歷史。  
- `GET /system/current`、`GET /disk/current`：取得目前系統負載與磁碟使用率。

## 資料模型
- **FileStatus 資料庫**：各儀器即時快照與歷史記錄（含 IP、FileName、FileType、FileTime、DiffTime）及 FileTypeList 對應設備名稱。  
- **SystemStatus 資料庫**：主機負載、記憶體使用率（CheckList）與主機資訊（SystemIPList）。  
- **DiskStatus 資料庫**：磁碟使用率（CheckList）。  
- **Pydantic 模型**：`InstrumentStatus`（含 file_type、equipment_name、ip、department、latest_file_time、diff_time_minutes、interval_minutes、threshold_yellow/orange/red、is_alert）與 `InstrumentIntervalSetting`。

## 閾值設定
透過 `thresholds.yaml` 設定每個儀器的資料週期 $T$（分鐘），系統自動計算：  
- 黃色 = $T$ + 5  
- 橙色 = $T$ + 10  
- 紅色 = $T$ + 20  
操作人員可經 API 動態修改，重啟後保留。

## 狀態顏色規則
- **儀器狀態**（依 diff 與 $T$ 比較）：  
  - ≤ $T$+5 → 綠色（正常）  
  - $T$+5 < diff ≤ $T$+10 → 黃色（延遲）  
  - $T$+10 < diff ≤ $T$+20 → 橙色（嚴重延遲）  
  - diff > $T$+20 → 紅色（遺失）  
  - diff > 14400 分鐘或 NULL → 灰色（斷線）  
- **電腦狀態三段燈號**（CPU、記憶體、磁碟剩餘空間、CPU 更新逾時）：依連續超時長短分黃/橙/紅三級，例如 CPU >80% 持續 1 分鐘 → 黃燈，5 分鐘 → 橙燈，15 分鐘 → 紅燈。

## 異常判定與告警
- **檔案到位判定**：以資料週期結束時間 $T$ 為基準，同上顏色規則。  
- **硬體警戒門檻**：CPU >80%、記憶體 >60%、磁碟剩餘空間 <10%、CPU 更新逾時 >3 分鐘等。  
- **異常分級**：黄燈（Warning）、橙燈（Critical）、紅燈（Emergency），依影響程度與持續時間區分。  
