# Bugfix Requirements Document

## Introduction

設定頁面修改儀器閾值時，前端 `settings.js` 送出 `{ threshold_yellow, threshold_orange, threshold_red }` 格式的 payload 到 `POST /api/v1/instruments/{file_type}/threshold`，但後端 endpoint 的 Pydantic request body model 為 `InstrumentIntervalSetting`（僅接受 `{ interval_minutes }`），導致 Pydantic 驗證失敗回傳 HTTP 422 Unprocessable Content，使用者無法透過設定頁面更新閾值。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 前端設定頁面送出 `{ threshold_yellow: N, threshold_orange: N, threshold_red: N }` 到 `POST /api/v1/instruments/{file_type}/threshold` THEN the system 回傳 HTTP 422 Unprocessable Content（Pydantic 驗證失敗，因 `InstrumentIntervalSetting` 不認得 threshold_yellow/orange/red 欄位且缺少必填的 interval_minutes）

1.2 WHEN 後端收到直接閾值格式的 payload 時 THEN the system 無法將閾值寫入 `config/thresholds.yaml`，設定變更遺失

### Expected Behavior (Correct)

2.1 WHEN 前端設定頁面送出 `{ threshold_yellow: N, threshold_orange: N, threshold_red: N }`（三個值皆 > 0）到 `POST /api/v1/instruments/{file_type}/threshold` THEN the system SHALL 接受該 payload、回傳 HTTP 200 並包含更新後的閾值資訊

2.2 WHEN 後端收到直接閾值格式的 payload 時 THEN the system SHALL 將 threshold_yellow、threshold_orange、threshold_red 三個值直接寫入 `config/thresholds.yaml` 對應儀器的設定區段

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 透過程式內部呼叫 `set_instrument_thresholds(file_type, interval_minutes)` 設定 interval 格式的閾值時 THEN the system SHALL CONTINUE TO 以 interval_minutes 為基礎自動計算三段閾值（yellow = T+5, orange = T+10, red = T+20）並正確寫入 thresholds.yaml

3.2 WHEN 讀取已存在的 interval_minutes 格式閾值設定時 THEN the system SHALL CONTINUE TO 正確計算並回傳對應的 yellow/orange/red 閾值

3.3 WHEN 查詢儀器清單 `GET /api/v1/instruments` 時 THEN the system SHALL CONTINUE TO 回傳每個儀器的 file_type、equipment_name、interval_minutes、threshold_yellow、threshold_orange、threshold_red

3.4 WHEN 閾值 payload 中任一值 ≤ 0 時 THEN the system SHALL CONTINUE TO 回傳驗證錯誤（HTTP 422），拒絕不合法的閾值設定
