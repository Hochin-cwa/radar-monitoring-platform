# Implementation Plan: 雷達監控整合平台

## Overview

依照設計文件架構，以 Python（FastAPI）後端 + 純 HTML/CSS/JS 前端的前後端分離架構實作雷達監控整合平台。實作順序依循設計文件的元件分層：資料存取層 → 業務邏輯層 → API 層 → 前端頁面 → 歷史資料功能 → 部署設定。

## Tasks

- [x] 1. 專案基礎建設與設定管理
  - [x] 1.1 建立專案目錄結構與基礎設定檔
    - 建立 `backend/`、`frontend/`、`config/`、`deploy/`、`tests/` 目錄結構
    - 建立 `backend/requirements.txt`（FastAPI, uvicorn, SQLAlchemy, PyMySQL, PyYAML, httpx, pytest, hypothesis）
    - 建立 `config/thresholds.yaml` 預設值（`defaults.interval_minutes: 7`）
    - 建立 `pytest.ini` 與 `conftest.py`
    - _Requirements: 4.1, 5.3_

  - [x] 1.2 實作設定檔載入模組（backend/config.py）
    - 從 `config/config.yaml` 載入 DB 連線參數（host, port, db_name, user, password）
    - 載入系統設定（refresh_interval, cache_ttl）
    - 不得將任何連線參數硬編碼於程式碼中
    - _Requirements: 4.1_

  - [x] 1.3 實作資料庫連線池管理（backend/database.py）
    - 使用 SQLAlchemy 建立連線池，管理三個資料庫（file_status, system_status, disk_status）
    - 實作 `get_engine(db_name)`、`get_session(db_name)`、`check_connection(db_name)`
    - 實作自動重連機制：失敗後等待 10 秒重試，最多 3 次
    - 連續 3 次失敗後記錄 ERROR 日誌
    - _Requirements: 4.2, 4.5, 4.6_

- [x] 2. Pydantic 資料模型（backend/models.py）
  - [x] 2.1 定義所有 API 請求/回應資料模型
    - `InstrumentStatus`：含 file_type, equipment_name, ip, department, latest_file_time, diff_time_minutes, interval_minutes, threshold_yellow/orange/red, is_alert
    - `InstrumentIntervalSetting`：`interval_minutes: float = Field(gt=0.0)`
    - `ThresholdDirectSetting`：`threshold_yellow/orange/red: float = Field(gt=0.0)`
    - `ComputerItem`：含 ip, equipment_name, department, load_1/5/15, memory_use, server_time, disks
    - `DiskEntry`：含 file_system, used_pct
    - `CurrentStatusResponse`、`ComputerStatusResponse` 等回應包裝模型
    - _Requirements: 2, 5, 6.1_

- [x] 3. 儀器狀態業務邏輯（backend/services/alert_service.py）
  - [x] 3.1 實作儀器狀態查詢核心邏輯
    - `get_all_instrument_statuses()`：查詢所有 FileCheck 資料表（radar/HFradar/satellite/windprofiler/DS）
    - 計算 diff_time_minutes，依 IP 查詢 SystemIPList 取得 department
    - 無 department 的儀器不回傳
    - 實作 60 秒記憶體快取，DB 失敗時回傳上次快取結果
    - _Requirements: 2.7, 4.4_

  - [x] 3.2 實作閾值計算與管理邏輯
    - `calculate_thresholds(T)`：回傳 `(T+5, T+10, T+20)`
    - `get_instrument_thresholds(file_type)`：從 thresholds.yaml 讀取閾值
    - `set_instrument_thresholds(file_type, interval_minutes)`：以 T 為基礎計算後寫入 yaml
    - `set_instrument_thresholds_direct(file_type, yellow, orange, red)`：直接設定三段閾值
    - `list_instruments()`：從 FileTypeList 取得儀器清單
    - 啟動時從檔案載入，修改後立即寫回，重啟後保留
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x]* 3.3 撰寫閾值計算屬性測試
    - **Property 3: 閾值自動計算**
    - 生成隨機正數 T，驗證 calculate_thresholds(T) == (T+5, T+10, T+20)
    - **Validates: Requirements 5.3**

  - [ ]* 3.4 撰寫無效閾值拒絕屬性測試
    - **Property 5: 無效閾值拒絕**
    - 生成隨機非正數（≤ 0），驗證系統拒絕並拋出 ValueError
    - **Validates: Requirements 5.6, 5.7**

  - [ ]* 3.5 撰寫儀器狀態顏色分類屬性測試
    - **Property 2: 儀器狀態顏色分類**
    - 生成隨機 T(>0) 和 diff(≥0 或 None)，驗證顏色分類正確
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [ ]* 3.6 撰寫閾值獨立性屬性測試
    - **Property 4: 閾值設定獨立性**
    - 生成兩組隨機儀器與 T，修改一個驗證另一個不變
    - **Validates: Requirements 5.5**

- [x] 4. 電腦系統狀態業務邏輯（backend/services/system_service.py）
  - [x] 4.1 實作電腦系統狀態查詢
    - `get_system_status()`：查詢 SystemStatus.CheckList JOIN SystemIPList 取得負載/記憶體/department
    - `get_disk_status()`：查詢 DiskStatus.CheckList，透過 SystemIPList 取得 department
    - `get_combined_status()`：合併系統狀態與磁碟資料，回傳 (items, disk_error)
    - 相同 IP 的磁碟項目填入 disks 陣列
    - DiskStatus DB 失敗時回傳空 disks 陣列並設 disk_error=true
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 4.2 撰寫電腦警示等級屬性測試
    - **Property 6: 電腦警示等級分類**
    - 生成隨機 CPU 逾時分鐘、記憶體%、磁碟%，驗證燈號分類正確
    - CPU 逾時：>3 分鐘黃、>10 分鐘橙、>30 分鐘紅
    - 記憶體：>60% 黃、>70% 橙、>80% 紅
    - 磁碟使用率：>90% 黃、>95% 橙、>99% 紅
    - **Validates: Requirements 6.18–6.27**

- [x] 5. 歷史資料業務邏輯（backend/services/history_service.py）
  - [x] 5.1 實作儀器歷史資料查詢
    - `get_instrument_history(file_type, ip, range)`：依 file_type 選擇正確資料表
    - 資料表選擇邏輯：DS_ 開頭→DSStatus、含 HF→HFradarStatus、含 satellite/SAT→satelliteStatus、含 windprofiler/WP→windprofilerStatus、其餘→radarStatus
    - 依 range 參數過濾時間範圍（6h/1d/1w/1m/3m）
    - 回傳包含 threshold_yellow/orange/red 的結果
    - _Requirements: 7.2, 7.3, 7.7_

  - [x] 5.2 實作電腦系統歷史資料查詢
    - `get_system_history(ip, range)`：查詢 SystemStatus.CheckList（CPU/記憶體）與 DiskStatus.CheckList（磁碟）
    - 回傳 cpu、memory、disk 三組時序資料
    - _Requirements: 7.6, 7.8, 8.4, 8.7_

  - [ ]* 5.3 撰寫歷史資料表對應屬性測試
    - **Property 7: 歷史資料表對應**
    - 生成含特定前綴/關鍵字的 file_type 字串，驗證表名選擇正確
    - **Validates: Requirements 7.7**

- [x] 6. Checkpoint - 確認後端業務邏輯
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. API 路由層
  - [x] 7.1 實作儀器狀態 API（backend/routers/completeness.py）
    - `GET /api/v1/completeness/current`：回傳所有儀器即時狀態
    - DB 失敗時回傳快取或 503
    - _Requirements: 2.7, 4.3, 4.4_

  - [x] 7.2 實作儀器閾值管理 API（backend/routers/instruments.py）
    - `GET /api/v1/instruments`：回傳儀器清單與閾值（file_type, equipment_name, interval_minutes, threshold_yellow/orange/red）
    - `PUT /api/v1/instruments/{file_type}/threshold`：更新閾值（直接設定模式），回傳 200/404/422
    - `POST /api/v1/instruments/{file_type}/threshold`：接受 `{ threshold_yellow, threshold_orange, threshold_red }` payload
    - _Requirements: 5.4, 5.7, 5.8, 5.9, 5.10_

  - [x] 7.3 實作電腦狀態 API（backend/routers/computers.py + system.py）
    - `GET /api/v1/computers/current`：回傳合併後的電腦綜合狀態（含 disks 陣列）
    - `GET /api/v1/system/current`：回傳系統負載（相容舊端點）
    - `GET /api/v1/disk/current`：回傳磁碟使用率（相容舊端點）
    - SystemStatus DB 失敗回傳 503，DiskStatus DB 失敗設 disk_error=true
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.4 實作歷史資料 API（backend/routers/history.py）
    - `GET /api/v1/history/{file_type}`：query params: ip(必填), range(預設 1d)
    - `GET /api/v1/history/system`：query params: ip(必填), range(預設 1d)
    - 回傳含閾值線資訊的 JSON
    - _Requirements: 7.2, 7.3, 7.4, 8.2, 8.3_

  - [x] 7.5 實作 FastAPI 主程式（backend/main.py）
    - 掛載所有 router，設定 logging
    - 設定 StaticFiles 提供前端靜態檔案
    - CORS 設定
    - _Requirements: 4.1_

- [x] 8. Checkpoint - 確認 API 端點
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. 前端基礎架構
  - [x] 9.1 實作前端共用模組
    - `frontend/js/api.js`：封裝所有 fetch 呼叫，統一錯誤處理（網路錯誤、5xx、逾時）
    - `frontend/js/clock.js`：共用即時時鐘，每秒更新 Local_Time 與 UTC_Time，格式 `YYYY-MM-DD HH:mm:ss`
    - `frontend/css/style.css`：深色主題，卡片顏色樣式（綠/黃/橙/紅/灰）、科別篩選列樣式
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.4_

  - [x] 9.2 實作首頁（frontend/index.html）
    - 導覽入口：儀器即時狀況、電腦即時狀況、儀器閾值設定
    - 頂部顯示 Local_Time 與 UTC_Time
    - _Requirements: 1.1_

- [x] 10. 儀器即時狀況頁面
  - [x] 10.1 實作儀器即時狀況頁面框架（frontend/instruments.html + dashboard.js）
    - 依科別（wrs/mrs/sos/dqcs/rsa）分組顯示儀器卡片
    - 卡片顯示 IP、FileType、EquipmentName、時間差、顏色狀態
    - 超過 14400 分鐘或無資料顯示「斷線」（灰色）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 10.2 實作科別篩選列與正常儀器折疊邏輯
    - 頂部科別篩選列：「全部」及五個科別按鈕（氣象雷達科/海象雷達科/衛星作業科/品管科/應用科）
    - 正常儀器（綠色）以摘要方框呈現「共 N 台，正常 M 台」，點擊展開
    - 異常儀器（黃/橙/紅/灰）直接顯示
    - 篩選為純前端操作，不重新打 API
    - 自動刷新後保持篩選狀態
    - _Requirements: 2.8, 2.9, 2.10, 2.11_

  - [x] 10.3 實作自動刷新與手動刷新機制
    - 每 60 秒自動刷新，不重新載入頁面
    - 顯示上次成功刷新時間戳記
    - 手動刷新按鈕，點擊後立即更新並重置計時器
    - 網路錯誤時顯示「資料更新失敗，正在重試」，保持手動刷新可用
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 11. 電腦即時狀況頁面
  - [x] 11.1 實作電腦即時狀況頁面（frontend/computers.html + computers.js）
    - 依科別分組顯示統一卡片（每台電腦一張）
    - 卡片標題顯示 IP，下方顯示儀器名稱
    - 顯示記憶體使用率（一位小數）、CPU 負載 1m/5m/15m（兩位小數）
    - 顯示所有磁碟項目（file_system + 一位小數 used_pct）
    - 指標值 null 時顯示 N/A
    - 顯示上次更新時間
    - _Requirements: 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13_

  - [x] 11.2 實作電腦頁面警示燈號邏輯
    - 記憶體：>60% 黃、>70% 橙、>80% 紅
    - 磁碟剩餘（100−used_pct）：<10% 黃、<5% 橙、<1% 紅
    - CPU 逾時：>3 分鐘黃、>10 分鐘橙、>30 分鐘紅
    - 卡片邊框顏色套用所有指標中最嚴重的警示等級
    - _Requirements: 6.18, 6.19, 6.20, 6.21, 6.22, 6.23, 6.24, 6.25, 6.26, 6.27_

  - [x] 11.3 實作電腦頁面科別篩選與自動刷新
    - 科別篩選列（與儀器頁面相同設計風格）
    - 每 60 秒自動刷新，手動刷新按鈕
    - 網路/伺服器錯誤時顯示警告，不清除已渲染卡片
    - _Requirements: 6.14, 6.15, 6.16, 6.17, 6.28, 6.29, 6.30, 6.31, 6.32_

  - [x] 11.4 移除舊版雙區塊版面
    - 使用單一 `<section id="computers-container">` 取代舊 `system-container` 與 `disk-container`
    - 前端不再直接呼叫 `/api/v1/system/current` 或 `/api/v1/disk/current`
    - _Requirements: 6.33, 6.34_

- [x] 12. 儀器閾值設定頁面
  - [x] 12.1 實作閾值設定頁面（frontend/settings.html + settings.js）
    - 列出所有儀器與目前閾值（三段：黃/橙/紅）
    - 支援兩種設定模式：設定資料週期 T（自動計算）或直接設定三段閾值
    - 修改後呼叫 API 寫回 thresholds.yaml 並立即套用
    - 負數或零輸入顯示驗證錯誤訊息
    - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.7, 5.8_

- [x] 13. Checkpoint - 確認前端頁面功能
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. 歷史資料功能
  - [x] 14.1 實作儀器歷史資料頁面（frontend/history.html + history.js）
    - 從 URL query string 取得 file_type、ip、equipment_name
    - 使用 Chart.js 繪製 DiffTime 時序折線圖
    - Y 軸疊加三條閾值水平線（黃/橙/紅）
    - 時間範圍選擇器：6h / 1d / 1w / 1m / 3m
    - 切換範圍後重新打 API 更新圖表
    - 無資料時顯示「此時間範圍內無資料」
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.9_

  - [x] 14.2 實作同 IP 電腦指標時序圖
    - 在歷史頁面另繪 CPU（Load_1）、記憶體（MemoryUSE）、磁碟（Used）三張時序圖
    - 時間範圍與儀器主圖同步
    - `api.js` 新增 `fetchInstrumentHistory()` 與 `fetchSystemHistory()`
    - _Requirements: 7.6, 7.8_

  - [x] 14.3 實作儀器卡片點擊開啟歷史頁面
    - 儀器卡片加上 data-file-type、data-ip、data-equipment-name 屬性
    - 點擊時以 `window.open('/history.html?...', '_blank')` 開啟新分頁
    - _Requirements: 7.1_

  - [x] 14.4 實作電腦卡片點擊開啟歷史頁面
    - 電腦統一卡片點擊後在新分頁開啟該電腦歷史頁面
    - 顯示 CPU、記憶體、磁碟時序圖，Y 軸疊加硬體警戒閾值線
    - 以卡片列出該 IP 所有相關儀器即時狀態
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8_

- [x] 15. 整合測試
  - [x]* 15.1 撰寫 API 端點整合測試
    - 各 API 端點正常回應結構驗證
    - DB 連線失敗時回傳快取或 503
    - 閾值 API 的 404/422 錯誤回應
    - PUT 負數值回傳 422
    - PUT 不存在 file_type 回傳 404
    - _Requirements: 4.3, 4.4, 4.5, 5.7, 5.8_

  - [ ]* 15.2 撰寫快取行為屬性測試
    - **Property 8: 快取 TTL 行為**
    - 模擬快取寫入後在 TTL(60s) 內查詢，驗證結果一致且不觸發 DB 查詢
    - **Validates: Requirements 4.4**

- [x] 16. 部署設定
  - [x] 16.1 建立部署相關檔案
    - `deploy/radar-monitor.service`：systemd 服務設定
    - `deploy/nginx.conf`：Nginx 反向代理設定（/api/ proxy_pass 到 backend:8000）
    - `deploy/docker-compose.yaml`：容器化部署設定
    - 確認前端靜態檔案正確提供
    - _Requirements: 4.1_

- [x] 17. Final Checkpoint - 確認所有功能完整
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in design.md
- Unit tests validate specific examples and edge cases
- 本專案使用 Python（FastAPI）後端，前端為純 HTML/CSS/JS
- 屬性測試使用 hypothesis 框架，每個 property 最少 100 次迭代
- 資料庫為唯讀存取，閾值設定存於 thresholds.yaml

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "4.1", "5.1", "5.2"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.6", "4.2", "5.3"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 5, "tasks": ["9.1", "9.2"] },
    { "id": 6, "tasks": ["10.1", "11.1", "12.1"] },
    { "id": 7, "tasks": ["10.2", "10.3", "11.2", "11.3", "11.4"] },
    { "id": 8, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 9, "tasks": ["15.1", "15.2"] },
    { "id": 10, "tasks": ["16.1"] }
  ]
}
```
