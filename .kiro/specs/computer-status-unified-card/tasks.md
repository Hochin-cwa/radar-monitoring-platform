# 實作計畫：computer-status-unified-card

## 概述

將「電腦即時狀況」的雙區塊版面合併為每台電腦一張統一卡片。工作順序由底層往上：後端服務 → Pydantic 模型 → 路由 → main.py 註冊 → 前端 api.js → computers.html → computers.js → 測試。

## 任務

- [x] 1. 在 `backend/services/system_service.py` 新增 `get_combined_status()`
  - 新增 `_COMBINED_SYSTEM_SQL` 查詢，從 `CheckList cl LEFT JOIN SystemIPList sl ON cl.IP = sl.IP` 選取 `cl.IP, cl.Load_1, cl.Load_5, cl.LOAD_15, cl.MemoryUSE, cl.ServerTime, sl.EquipmentName, sl.Department`
  - 以 IP 為鍵從系統資料列建立插入有序字典，每個值包含所有必要欄位及空的 `disks` 清單
  - 查詢 DiskStatus 資料庫取得 `IP, FileSystem, Used`；若發生 `OperationalError`/`SQLAlchemyError` 則設 `disk_error = True` 並跳過磁碟填充
  - 將符合各 IP 的磁碟資料列填入對應的 `disks` 清單；無磁碟資料的 IP 保持 `disks: []`
  - 回傳 `(list(system_dict.values()), disk_error)` — 當 SystemStatus 資料庫無法連線時向上拋出 `OperationalError`（不在此捕捉）
  - _需求：1.2、1.3、1.4、1.5、1.6_

  - [ ]* 1.1 為 `get_combined_status()` 合併邏輯撰寫單元測試
    - 模擬兩個資料庫的 `get_session`；測試情境：單一 IP 含多個磁碟、IP 無磁碟、磁碟資料庫無法連線時設 `disk_error=True`、系統資料庫錯誤向上傳遞
    - _需求：1.2、1.3、1.4、1.5、1.6_

- [x] 2. 在 `backend/models.py` 新增 Pydantic 模型
  - 新增 `DiskEntry(BaseModel)`，欄位為 `file_system: str` 與 `used_pct: Optional[float]`
  - 新增 `ComputerItem(BaseModel)`，欄位為 `ip`、`equipment_name`、`department`、`load_1`、`load_5`、`load_15`、`memory_use`、`server_time`（除 `ip` 外均為 `Optional`）及 `disks: list[DiskEntry]`
  - 新增 `ComputerStatusResponse(BaseModel)`，欄位為 `items: list[ComputerItem]` 與 `disk_error: bool`
  - _需求：1.1、1.2、1.3_

- [x] 3. 建立 `backend/routers/computers.py`
  - 定義 `router = APIRouter(tags=["computers"])`
  - 實作 `GET /api/v1/computers/current` 處理器，呼叫 `get_combined_status()`
  - 捕捉服務層拋出的 `OperationalError`/`SQLAlchemyError`，回傳附有描述性訊息的 `HTTPException(status_code=503)`
  - 成功時回傳 `ComputerStatusResponse(items=items, disk_error=disk_error)`
  - _需求：1.1、1.5、1.6_

  - [ ]* 3.1 為電腦路由撰寫單元測試
    - 測試 HTTP 200 回應結構（items 陣列、disk_error 欄位）；測試服務拋出例外時的 HTTP 503；測試 `disk_error=True` 正確傳遞
    - _需求：1.1、1.5、1.6_

- [x] 4. 在 `backend/main.py` 註冊電腦路由
  - 從 `backend.routers.computers` 匯入 `router as computers_router`
  - 在現有路由註冊旁新增 `app.include_router(computers_router)`
  - _需求：1.1_

- [x] 5. 檢查點 — 驗證後端端點端對端運作正常
  - 確認所有後端測試通過，如有疑問請詢問使用者。

- [x] 6. 在 `frontend/js/api.js` 新增 `fetchComputerStatus()`
  - 在現有 `fetchDiskStatus` 函式之後新增 `async function fetchComputerStatus() { return apiFetch('/computers/current'); }`
  - _需求：6.2_

- [x] 7. 替換 `frontend/computers.html` 的雙區塊版面
  - 移除含有 `<div id="system-container">` 的 `<section>` 與含有 `<div id="disk-container">` 的 `<section>`
  - 以單一 `<section class="section"><h2>電腦即時狀況</h2><div id="computers-container"><p class="loading">載入中…</p></div></section>` 取代兩者
  - _需求：2.1、6.1_

- [x] 8. 改寫 `frontend/js/computers.js` 為統一卡片渲染
  - [x] 8.1 實作警示等級輔助函式
    - 保留現有的 `_memLevel(pct)`、`_diskLevel(usedPct)`、`_cpuTimeoutLevel(serverTimeStr)`、`_worstLevel(...levels)` — 更新 `_cpuTimeoutLevel` 以使用統一資料項目的 `server_time` 欄位
    - _需求：4.1–4.10_

  - [x] 8.2 實作 `_renderUnifiedCard(item)`
    - 渲染卡片 HTML，包含：IP 為標題、`equipment_name` 在下方、記憶體使用率（一位小數 + `%`，或 `N/A`）、load_1/load_5/load_15（各兩位小數，或 `N/A`）、所有磁碟項目各顯示 `file_system` 與 `used_pct`（一位小數 + `%`，或 `N/A`）
    - 對記憶體值套用 `diff-alert-{level}` class；對每個磁碟列套用對應的警示 class
    - 從 `_worstLevel(memLevel, ...diskLevels, cpuLevel)` 計算卡片邊框 class
    - _需求：2.2–2.7、4.1–4.10_

  - [x] 8.3 實作 `_renderUnifiedGrid(items, diskError)`
    - 使用 `_groupByDept` 與 `_orderedKeys` 依科別分組（順序：`wrs → mrs → sos → dqcs → rsa`）
    - 為每個群組渲染中文科別標題，並對每個項目呼叫 `_renderUnifiedCard`
    - 將輸出寫入 `document.getElementById('computers-container')`
    - 若 `diskError` 為 true，顯示磁碟資料不可用的提示橫幅
    - _需求：2.1、3.1、3.2、3.3_

  - [x] 8.4 改寫 `_refreshData()` 以使用統一端點
    - 以 `fetchComputerStatus()` 取代 `fetchSystemStatus()` + `fetchDiskStatus()`
    - 將 `data.items` 與 `data.disk_error` 傳入 `_renderUnifiedGrid()`
    - 保留現有錯誤處理：`db_error` 類型 → 錯誤訊息、網路/逾時 → 警告訊息、失敗時保留現有卡片
    - 成功時更新「上次更新」時間戳記
    - _需求：5.1–5.5、6.2_

- [x] 9. 檢查點 — 驗證前端渲染正確
  - 確認所有測試通過且頁面依科別分組渲染統一卡片，如有疑問請詢問使用者。

- [ ] 10. 在 `tests/property/test_computer_status.py` 撰寫屬性測試
  - [ ]* 10.1 撰寫屬性 1 的屬性測試：每個唯一 IP 對應一筆資料
    - **屬性 1：每個唯一 IP 對應一筆資料**
    - 使用 `hypothesis` 產生 IP 分布任意的系統資料列清單；斷言 `len(result) == len({r["ip"] for r in system_rows})` 且每筆資料包含所有必要欄位
    - **驗證：需求 1.2**

  - [ ]* 10.2 撰寫屬性 2 的屬性測試：磁碟項目依 IP 正確分組
    - **屬性 2：磁碟項目依 IP 正確分組**
    - 產生任意系統資料列與磁碟資料列；斷言 IP X 的所有磁碟資料列出現在 `items[X]["disks"]` 且不出現在其他 IP 下；斷言無磁碟資料的 IP 其 `disks == []`
    - **驗證：需求 1.3、1.4**

  - [ ]* 10.3 撰寫屬性 3 的屬性測試：記憶體等級單調遞增
    - **屬性 3：記憶體警示等級與使用率單調遞增**
    - 產生 [0, 100] 範圍的浮點數；斷言 `_memLevel` 依門檻回傳正確等級，且等級排名隨使用率增加而單調不遞減
    - **驗證：需求 4.1、4.2、4.3**

  - [ ]* 10.4 撰寫屬性 4 的屬性測試：磁碟等級單調遞增
    - **屬性 4：磁碟警示等級與剩餘空間單調遞增**
    - 對 `used_pct` 產生 [0, 100] 範圍的浮點數；斷言 `_diskLevel` 依剩餘空間門檻回傳正確等級，且等級排名隨剩餘空間減少而單調不遞減
    - **驗證：需求 4.4、4.5、4.6**

  - [ ]* 10.5 撰寫屬性 5 的屬性測試：CPU 逾時等級單調遞增
    - **屬性 5：CPU 逾時警示等級與過期時間單調遞增**
    - 產生 ≥ 0 的經過分鐘數；建構偏移該分鐘數的 ISO 時間戳記；斷言 `_cpuTimeoutLevel` 回傳正確等級；斷言 `None` 或無法解析的輸入回傳 `'red'`
    - **驗證：需求 4.7、4.8、4.9**

  - [ ]* 10.6 撰寫屬性 6 的屬性測試：最嚴重等級為最高嚴重度
    - **屬性 6：最嚴重等級為最高嚴重度**
    - 從 `{'ok','yellow','orange','red'}` 產生非空等級清單；斷言 `_worstLevel(*levels)` 等於 `LEVEL_RANK` 值最高的元素，且大於或等於所有輸入等級
    - **驗證：需求 4.10**

- [x] 11. 在 `tests/unit/test_computer_status.py` 撰寫單元測試
  - 測試 `_renderUnifiedCard()` 在欄位為 null 時對每個指標渲染 `N/A`
  - 測試科別標籤對應為所有五個科別的正確中文字串
  - 測試 `computers.html` 包含且僅包含一個 `id="computers-container"` 的元素，且不含 `system-container` / `disk-container`
  - 測試 `computers.js` 原始碼不參照 `/system/current` 或 `/disk/current`
  - _需求：2.7、3.3、6.1、6.2_

- [x] 12. 在 `tests/integration/test_computers_api.py` 撰寫整合測試
  - 測試 `GET /api/v1/computers/current` 回傳 HTTP 200，包含 `items` 陣列與 `disk_error` 布林值
  - 測試回應結構：每筆資料包含 `ip`、`equipment_name`、`department`、`load_1`、`load_5`、`load_15`、`memory_use`、`server_time`、`disks`
  - 測試舊端點 `GET /api/v1/system/current` 與 `GET /api/v1/disk/current` 仍回傳 HTTP 200（向下相容）
  - _需求：1.1、1.2_

- [x] 13. 最終檢查點 — 所有測試通過
  - 確認所有單元、屬性與整合測試通過，如有疑問請詢問使用者。

## 備註

- 標有 `*` 的任務為選填，可視需求跳過以加快 MVP 進度
- 屬性測試（10.1–10.6）測試 Python 後端邏輯；設計文件中的 JS 渲染屬性（7、8、9）由任務 11 的範例單元測試涵蓋
- 現有的 `/api/v1/system/current` 與 `/api/v1/disk/current` 端點不予移除，保持向下相容
- `get_combined_status()` 不得捕捉來自 SystemStatus 資料庫的 `OperationalError`；由路由層捕捉並回傳 503
