# 實作計畫：雷達監控整合平台

## 概覽

依照設計文件，以 Python（FastAPI）後端 + 純 HTML/CSS/JS 前端的前後端分離架構實作。

---

## Tasks

- [x] 1. 專案基礎建設
  - 建立目錄結構、requirements.txt、config.yaml、systemd service 檔案
  - 建立 `config/thresholds.yaml`（儀器閾值持久化檔案）
  - _需求：4.1、5.3_

- [x] 2. 設定管理與資料庫連線池
  - `config.py`：從 config.yaml 載入 DB 連線參數與系統設定
  - `database.py`：SQLAlchemy 連線池，支援三個資料庫，自動重試最多 3 次
  - _需求：4.1、4.2、4.5、4.6_

- [x] 3. Pydantic 資料模型（models.py）
  - `InstrumentStatus`（含 `interval_minutes`、`threshold_yellow/orange/red` 自動計算欄位）
  - `InstrumentIntervalSetting`（`interval_minutes: float = Field(gt=0.0)`，取代舊的單一閾值模型）
  - `CurrentStatusResponse` 等
  - _需求：2、5_

- [x] 4. 儀器狀態服務（alert_service.py）
  - 查詢所有 FileCheck 資料表（radar/HFradar/satellite/windprofiler/DS）
  - 計算 diff_time_minutes，依 IP 查詢 SystemIPList 取得 Department
  - 無 Department 的儀器不回傳
  - 閾值從 thresholds.yaml 讀取 `interval_minutes`，自動計算三段閾值（yellow = T+5, orange = T+10, red = T+20）
  - `set_instrument_thresholds(file_type, interval_minutes)` 接受 `interval_minutes`，計算後寫回 thresholds.yaml
  - 60 秒記憶體快取，DB 失敗時回傳上次快取
  - _需求：2.1–2.8、4.4、5.1–5.5_

- [x] 5. 電腦系統狀態服務（system_service.py）
  - 查詢 SystemStatus.CheckList JOIN SystemIPList 取得負載/記憶體/Department
  - 查詢 DiskStatus.CheckList，透過 SystemIPList 取得 Department
  - CPU 使用率三段燈號：Load_1 > 80% → 黃、Load_5 > 80% → 橙、Load_15 > 80% → 紅
  - CPU 更新逾時三段燈號：ServerTime > 3 分鐘未更新 → 黃、> 10 分鐘 → 橙、> 30 分鐘 → 紅
  - _需求：6.1–6.5_

- [x] 6. API 路由
  - `completeness.py`：GET /api/v1/completeness/current
  - `instruments.py`：GET /api/v1/instruments、PUT /api/v1/instruments/{file_type}/threshold
  - `system.py`：GET /api/v1/system/current、GET /api/v1/disk/current
  - _需求：2、4.3、5、6_

- [x] 7. FastAPI 主程式（main.py）
  - 掛載三個 router，設定 logging，提供前端靜態檔案
  - _需求：4.1、4.6_

- [x] 8. 閾值持久化（thresholds.yaml）
  - 啟動時載入，修改後寫回，重啟後保留
  - 預設 `interval_minutes: 7`（對應 design.md defaults），三段閾值自動計算為 yellow=12, orange=17, red=27
  - _需求：5.3_

- [x] 9. 前端基礎架構
  - `index.html`：首頁，三個導覽入口
  - `style.css`：深色主題，儀器卡片顏色樣式（綠/黃/橙/紅/灰）
  - `api.js`：封裝所有 fetch 呼叫，統一錯誤處理
  - `clock.js`：共用時鐘，每秒更新
  - _需求：1、3.4、3.5_

- [x] 10. 儀器即時狀況頁面（instruments.html + dashboard.js）
  - 依 Department 分組顯示儀器卡片
  - 卡片顯示 IP、FileType、EquipmentName、時間差、顏色狀態
  - 超過 14400 分鐘顯示「斷線」（灰色）
  - 缺資料警示時顯示最新資料時間
  - 每 60 秒自動刷新，手動刷新按鈕
  - _需求：1、2、3_

- [x] 10.1 各科別分組改為折疊/展開互動邏輯（需求 2.8 更新）
  - 正常儀器（綠色）不單獨顯示，以一個綠色摘要方框呈現「共 N 台，正常 M 台」
  - 點擊綠色摘要方框後展開，顯示各別正常儀器卡片
  - 異常儀器（黃/橙/紅/灰）直接顯示在分組內，不需點擊展開
  - 移除舊的「總數 / 正常數」純文字統計摘要，改為可互動的折疊元件
  - _需求：2.8_

- [x] 10.2 儀器狀態頁面科別篩選列（需求 2.9–2.11）
  - `instruments.html`：在 status-bar 下方新增 `.dept-filter-bar`，包含「全部」及五個科別按鈕
  - `dashboard.js`：維護 `_activeDept` 狀態，點擊按鈕時更新 active 樣式並重新渲染
  - 篩選為純前端操作，不重新打 API，直接從 `_lastInstruments` 快取重新渲染
  - 自動刷新後保持目前選取的篩選狀態
  - `style.css`：新增 `.dept-filter-bar`、`.dept-btn`、`.dept-btn.active` 樣式
  - _需求：2.9、2.10、2.11_

- [x] 11. 電腦即時狀況頁面（computers.html + computers.js）— 需更新警示門檻
  - 依 Department 分組顯示系統負載/記憶體卡片
  - 依 Department 分組顯示磁碟使用率（%）卡片
  - 依硬體警戒門檻顯示三段燈號（黃/橙/紅）：
    - 記憶體：>60% 黃、>70% 橙、>80% 紅
    - 磁碟剩餘：<10% 黃、<5% 橙、<1% 紅
    - CPU 更新逾時：>3分鐘 黃、>10分鐘 橙、>30分鐘 紅
  - 每 60 秒自動刷新
  - _需求：3、6_

- [x] 12. 儀器閾值設定頁面（settings.html + settings.js）
  - 列出所有儀器，顯示三段閾值（黃/橙/紅）
  - 修改後呼叫 API 寫回 thresholds.yaml
  - 負數輸入顯示驗證錯誤
  - _需求：5_

- [x] 13. 確認 thresholds.yaml 預設值符合檔案到位判定標準
  - 驗證 `defaults.interval_minutes: 7` 已正確寫入，自動計算結果為 yellow=12, orange=17, red=27
  - 確認各儀器若無個別設定則 fallback 至 defaults
  - _需求：5_

- [x] 14. 整合測試
  - API 端點正常回應測試
  - DB 連線失敗時回傳快取結果
  - PUT 負數 interval_minutes 回傳 422
  - PUT 不存在 file_type 回傳 404
  - _需求：4.4、4.5、5.5_

- [x] 15. Nginx 設定
  - 確認 `/api/` proxy_pass 到 backend:8000，支援 POST/PUT 方法
  - 前端靜態檔案正確提供
  - _需求：4.1_

- [x] 16. 儀器歷史資料 API（history router）
  - `backend/routers/history.py`：GET /api/v1/history/{file_type}（query: ip, range）
  - `backend/services/history_service.py`：查詢 radarStatus/HFradarStatus/satelliteStatus/windprofilerStatus/DSStatus，依 range 參數過濾時間範圍（6h/1d/1w/1m/3m）
  - GET /api/v1/history/system（query: ip, range）：查詢 SystemStatus.CheckList（CPU/記憶體）與 DiskStatus.CheckList（磁碟）
  - 回傳含 threshold_yellow/orange/red 的 JSON，供前端畫閾值線
  - _需求：7.1–7.9_

- [x] 17. 儀器歷史資料頁面（history.html + history.js）
  - `frontend/history.html`：歷史資料頁面，從 URL query string 取得 file_type、ip、equipment_name
  - `frontend/js/history.js`：使用 Chart.js 繪製 DiffTime 時序折線圖，Y 軸疊加三條閾值水平線（黃/橙/紅）
  - 時間範圍選擇器：6h / 1d / 1w / 1m / 3m 按鈕，切換後重新打 API 更新圖表
  - 同頁面另繪 CPU（Load_1）、記憶體（MemoryUSE）、磁碟（Used）三張時序圖，時間範圍與主圖同步
  - 無資料時顯示「此時間範圍內無資料」提示
  - `frontend/js/api.js`：新增 `fetchInstrumentHistory(fileType, ip, range)` 與 `fetchSystemHistory(ip, range)`
  - _需求：7.1–7.9_

- [x] 18. 儀器卡片點擊開啟歷史頁面（dashboard.js 更新）
  - `_makeCard` 加上 `data-file-type`、`data-ip`、`data-equipment-name` 屬性
  - 點擊卡片時以 `window.open('/history.html?file_type=...&ip=...&name=...', '_blank')` 開啟新分頁
  - _需求：7.1_

- **任務 11**：電腦頁面的警示門檻需依新的硬體警戒門檻更新（目前使用舊的固定值）
- **任務 13**：確認 thresholds.yaml 預設 interval_minutes=7，fallback 邏輯正確
- **任務 14**：整合測試需更新以反映最新 API 結構（PUT 方法、interval_minutes 參數）
- **任務 15**：Nginx proxy 設定需在部署環境手動確認
