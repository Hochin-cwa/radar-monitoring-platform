# 實作計畫：環境溫溼度監測

## 概覽

依照設計文件，在雷達監控整合平台新增溫溼度監測功能。

---

## Tasks

- [x] 1. 後端：新增 `get_environment_history()` service 函式
  - 查詢 SystemStatus.EnvironmentStatus 表
  - 回傳 temperature 和 humidity 陣列
  - _需求：3.1、3.2、3.3、3.4_

- [x] 2. 後端：新增 API endpoint
  - `GET /api/v1/history/environment?ip=...&range=...`
  - 掛載到 history router
  - _需求：3.1_

- [x] 3. 前端：新增 `fetchEnvironmentHistory()` API 函式
  - 在 `api.js` 新增封裝
  - _需求：3.1_

- [x] 4. 前端：建立 `environment-history.html`
  - 頁面結構與 history.html 一致
  - 包含溫度圖表和濕度圖表容器
  - _需求：2.1、2.2、2.5_

- [x] 5. 前端：建立 `environment-history.js`
  - Chart.js 折線圖渲染溫度和濕度
  - 時間範圍切換
  - _需求：2.1、2.2、2.3、2.4、2.6_

- [x] 6. 前端：儀器列表整合
  - instruments.js 中溫溼度計卡片點擊導向 environment-history.html
  - _需求：1.1、1.2_
