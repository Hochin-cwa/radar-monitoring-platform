# 需求文件

## 簡介

雷達監控整合平台是一套網頁應用系統，部署於 Linux（Rocky 9）環境，以 MySQL 作為資料來源，提供操作人員即時監控各儀器資料時間差與電腦系統狀態的能力。系統透過 Dashboard 集中呈現關鍵指標，並以自動刷新機制確保資訊即時性。資料異常的主動推播通知由外部系統負責，本平台僅負責視覺化呈現。

---

## 詞彙表

- **平台（Platform）**：本雷達監控整合平台網頁應用系統的總稱。
- **Dashboard**：平台的主要監控畫面，集中顯示所有即時指標。
- **儀器（Instrument）**：對應 FileType，代表一種雷達資料類型或設備，每個儀器有各自獨立的閾值設定。
- **資料庫（Database）**：儲存雷達資料的 MySQL 資料庫。
- **刷新週期（Refresh_Interval）**：Dashboard 自動向後端重新取得最新資料的時間間隔，固定為 60 秒。
- **本地時間（Local_Time）**：伺服器或瀏覽器所在時區的當前時間。
- **UTC 時間（UTC_Time）**：協調世界時（Coordinated Universal Time）的當前時間。
- **$T$**：資料週期結束時間，用於計算檔案到位時間差，通常指的是兩筆資料的時間間隔。

---

## 需求

### 需求 1：即時時間顯示

**使用者故事：** 身為操作人員，我希望在 Dashboard 上同時看到本地時間與 UTC 時間，以便在跨時區協作時能快速對齊時間基準。

#### 驗收標準

1. THE Dashboard SHALL 在頁面頂部同時顯示 Local_Time 與 UTC_Time。
2. WHEN 頁面載入完成，THE Dashboard SHALL 立即顯示當前的 Local_Time 與 UTC_Time。
3. THE Dashboard SHALL 以每秒一次的頻率更新 Local_Time 與 UTC_Time 的顯示值。
4. THE Dashboard SHALL 以 `YYYY-MM-DD HH:mm:ss` 格式顯示 Local_Time 與 UTC_Time。

---

### 需求 2：儀器資料時間差視覺顯示

**使用者故事：** 身為操作人員，我希望在 Dashboard 上看到每個儀器的最新資料時間差，並以顏色區分嚴重程度，以便快速判斷哪些儀器需要關注。

> **注意：** 主動推播通知（email、SMS、webhook 等）由另一個專案負責，本平台僅負責視覺化呈現。

#### 檔案到位判定標準

以資料週期結束時間 $T$ 為基準：

| 狀態 | 條件 | 燈號 |
|------|------|------|
| 正常（Normal） | diff ≤ $T$ + 5 分鐘 | 🟢 綠色 |
| 延遲（Delayed） | $T$ + 5 < diff ≤ $T$ + 10 分鐘 | 🟡 黃色 |
| 嚴重延遲（Critical Delay） | $T$ + 10 < diff ≤ $T$ + 20 分鐘 | 🟠 橙色 |
| 遺失（Missing） | diff > $T$ + 20 分鐘 | 🔴 紅色 |
| 斷線 | diff > 14400 分鐘或無資料 | ⬜ 灰色 |

#### 驗收標準

1. WHEN 某 Instrument 的 DiffTime 在 $T$ + 5 分鐘以內，THE Dashboard SHALL 以綠色顯示。
2. WHEN 某 Instrument 的 DiffTime 超過 $T$ + 5 分鐘（延遲），THE Dashboard SHALL 以黃色顯示。
3. WHEN 某 Instrument 的 DiffTime 超過 $T$ + 10 分鐘（嚴重延遲），THE Dashboard SHALL 以橙色顯示。
4. WHEN 某 Instrument 的 DiffTime 超過 $T$ + 20 分鐘（遺失），THE Dashboard SHALL 以紅色顯示。
5. WHEN 某 Instrument 的 DiffTime 超過 14400 分鐘或無資料，THE Dashboard SHALL 以灰色顯示「斷線」。
6. THE Dashboard SHALL 為每個 Instrument 各自顯示獨立的狀態區塊，包含 IP、FileType、EquipmentName 與時間差數值。
7. THE Platform SHALL 從各 FileCheck 資料表取得每個 Instrument 的最新一筆快照，以判斷即時狀態。
8. THE Dashboard SHALL 依科別（Department）分組顯示儀器狀態，所有正常的就不單獨顯示出來，用一個綠色方框顯示總共有多少個機器，正常的有多少，滑鼠點一下才會展開來各別顯示。
9. THE Dashboard SHALL 在儀器狀態頁面頂部提供科別篩選列，包含「全部」及各科別按鈕（氣象雷達科、海象雷達科、衛星作業科、品管科、應用科），WHEN 操作人員點擊某科別按鈕，THE Dashboard SHALL 僅顯示該科別的儀器分組，其餘科別隱藏。
10. WHEN 操作人員點擊「全部」按鈕，THE Dashboard SHALL 顯示所有科別的儀器分組。
11. WHEN 資料自動刷新後，THE Dashboard SHALL 保持目前選取的科別篩選狀態不變。

---

### 需求 3：自動刷新機制

**使用者故事：** 身為操作人員，我希望 Dashboard 能自動定期刷新資料，以便在不手動操作的情況下持續掌握最新狀態。

#### 驗收標準

1. THE Dashboard SHALL 以 Refresh_Interval（60 秒）為週期，自動向後端重新取得最新資料並更新所有顯示元件。
2. WHEN 自動刷新觸發，THE Dashboard SHALL 在不重新載入整個頁面的情況下更新儀器狀態與電腦系統狀態。
3. THE Dashboard SHALL 顯示上一次成功刷新的時間戳記。
4. IF 自動刷新期間發生網路錯誤，THEN THE Platform SHALL 在 Dashboard 上顯示「資料更新失敗，正在重試」的提示，並於下一個 Refresh_Interval 重新嘗試。
5. THE Dashboard SHALL 提供手動刷新按鈕，WHEN 操作人員點擊手動刷新按鈕，THE Dashboard SHALL 立即執行一次資料更新並重置自動刷新計時器。

---

### 需求 4：資料庫資料存取

**使用者故事：** 身為系統，我希望能穩定地從 MySQL 資料庫取得資料，以便提供給 Dashboard 顯示。

#### 驗收標準

1. THE Platform SHALL 透過設定檔管理 Database 的連線參數（主機、埠號、資料庫名稱、帳號、密碼），不得將連線參數硬編碼於程式碼中。
2. THE Platform SHALL 維護 Database 連線池，以支援 Dashboard 的並發查詢需求。
3. THE Platform SHALL 在 5 秒內回傳查詢結果。
4. THE Platform SHALL 使用 60 秒記憶體快取，DB 連線失敗時回傳上次快取結果。
5. IF Database 連線中斷，THEN THE Platform SHALL 自動嘗試重新連線，重試間隔為 10 秒，最多重試 3 次。
6. IF 連續 3 次重連均失敗，THEN THE Platform SHALL 記錄錯誤日誌並在 Dashboard 顯示持續性的連線失敗警示。

---

### 需求 5：儀器時間差閾值管理

**使用者故事：** 身為操作人員，我希望只需設定每個儀器的資料週期 $T$，系統自動計算三段警示門檻，以便根據各儀器的資料特性調整警示靈敏度。

#### 閾值計算規則

操作人員只需設定每個儀器的資料週期 $T$（分鐘），系統自動計算：

| 閾值 | 計算方式 | 對應狀態 |
|------|---------|---------|
| 黃色閾值 | $T$ + 5 分鐘 | 延遲（Delayed） |
| 橙色閾值 | $T$ + 10 分鐘 | 嚴重延遲（Critical Delay） |
| 紅色閾值 | $T$ + 20 分鐘 | 遺失（Missing） |

預設 $T$ = 7 分鐘，預設門檻為黃色 12 分鐘、橙色 17 分鐘、紅色 27 分鐘。

#### 驗收標準

1. THE Platform SHALL 從 FileTypeList 資料表取得所有 Instrument 清單，作為閾值設定的儀器來源。
2. THE Dashboard SHALL 提供設定介面，讓操作人員查看所有 Instrument 及其目前的 $T$ 值（單位：分鐘）。
3. WHEN 操作人員修改 $T$ 值，THE Platform SHALL 儲存該設定至 thresholds.yaml 並立即套用至後續的狀態判斷。
4. THE Platform SHALL 允許操作人員為每個 Instrument 個別設定 $T$ 值，不同 Instrument 的設定互相獨立。
5. IF 操作人員輸入的 $T$ 值為負數或零，THEN THE Platform SHALL 拒絕該輸入並顯示驗證錯誤訊息。

---

### 需求 6：電腦系統狀態顯示

**使用者故事：** 身為操作人員，我希望在 Dashboard 上看到各電腦的系統負載、記憶體與磁碟使用率，並以三段燈號顯示嚴重程度。

#### 硬體警戒門檻

| 指標 | 黃燈 | 橙燈 | 紅燈 |
|------|------|------|------|
| CPU 使用率 | 連續 1 分鐘 > 80% | 連續 5 分鐘 > 80% | 連續 15 分鐘 > 80% |
| CPU 更新逾時 | > 3 分鐘未更新 | > 10 分鐘未更新 | > 30 分鐘未更新 |
| 記憶體負載 | > 60% | > 70% | > 80% |
| 磁碟剩餘空間 | < 10% | < 5% | < 1% |

#### 驗收標準

1. THE Dashboard SHALL 顯示各電腦的 CPU 負載（1 分鐘）、記憶體使用率（%）與磁碟使用率（%）。
2. THE Dashboard SHALL 依科別（Department）分組顯示電腦狀態。
3. THE Dashboard SHALL 依硬體警戒門檻以黃/橙/紅三段燈號顯示各電腦的警示狀態。
4. WHEN CPU 使用率超過 3 分鐘未更新，THE Dashboard SHALL 以黃燈顯示（表示電腦可能關機或網路不通）。
5. WHEN CPU 使用率超過 30 分鐘未更新，THE Dashboard SHALL 以紅燈顯示。

---

### 需求 7：儀器歷史資料時序圖

**使用者故事：** 身為操作人員，我希望點擊某個儀器卡片後，能在新分頁看到該儀器的資料時間差歷史趨勢圖，以及同一台電腦的 CPU、記憶體、磁碟使用率時序圖，以便判斷異常是偶發還是持續性問題。

#### 驗收標準

1. WHEN 操作人員點擊儀器狀態頁面上的某個儀器卡片，THE Platform SHALL 在新分頁開啟該儀器的歷史資料頁面。
2. THE 歷史資料頁面 SHALL 顯示該儀器（FileType + IP）的資料時間差（DiffTime，單位：分鐘）時序折線圖。
3. THE 歷史資料頁面 SHALL 提供時間範圍選擇器，選項為：過去 6 小時、1 天、1 週、1 個月、3 個月。
4. WHEN 操作人員切換時間範圍，THE 歷史資料頁面 SHALL 重新向後端取得對應區間的資料並更新圖表。
5. THE 時序圖 SHALL 在 Y 軸疊加顯示黃色、橙色、紅色三條閾值水平線，對應該儀器目前的 threshold_yellow、threshold_orange、threshold_red 設定值。
6. THE 歷史資料頁面 SHALL 在同一頁面另外顯示與該儀器同一 IP 電腦的 CPU 負載（Load_1）、記憶體使用率（MemoryUSE）、磁碟使用率（Used）三張時序折線圖，時間範圍與儀器圖表同步。
7. THE Platform SHALL 從 `radarStatus`、`HFradarStatus`、`satelliteStatus`、`windprofilerStatus`、`DSStatus` 等歷史資料表取得儀器 DiffTime 歷史記錄。
8. THE Platform SHALL 從 `SystemStatus.CheckList` 取得 CPU 與記憶體歷史記錄，從 `DiskStatus.CheckList` 取得磁碟使用率歷史記錄。
9. IF 指定時間範圍內無歷史資料，THE 歷史資料頁面 SHALL 顯示「此時間範圍內無資料」提示。
