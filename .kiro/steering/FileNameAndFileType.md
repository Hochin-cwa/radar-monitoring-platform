# 各重資料命名原則與內容
# DSFileStatus.txt — FileType 與 FileName 規則說明

本文件說明 `DSFileStatus.txt` 中兩個欄位的命名規則，供程式開發時作為解析與產生路徑的參考原則。

---

## 欄位格式

```
FileType  FileName
```

- 欄位以 **Tab** 分隔
- 第一行為標題列，程式讀取時應跳過（`NR > 1`）

---

## FileType 規則

格式：`DS_{DataType}`

前綴 `DS_` 代表是要送給東沙島的資料。

共有 3 種 FileType：

| FileType     | 記錄數 | 說明                              |
|--------------|--------|-----------------------------------|
| `DS_radar`   | 288    | CWA 雷達網合成回波圖（PNG 影像）   |
| `DS_skewt`   | 10     | 高空探空 Skew-T 圖（GIF 影像）     |
| `DS_gfsefs`  | 4      | GFS 系集預報（EFS）產品圖（GIF 影像）|

---

### DS_radar

CWA（中央氣象署）雷達網合成回波圖，每 10 分鐘一筆，以 PNG 影像格式儲存。

### DS_skewt

高空探空站的 Skew-T log-P 圖，來源為 NID（National Integrated Data）系統，時間精度到小時，以 GIF 影像格式儲存。

### DS_gfsefs

GFS 系集預報系統（EFS，Ensemble Forecast System）輸出產品圖，來源為 NID 系統，以 GIF 影像格式儲存，包含多種產品代碼。

---

## FileName 規則

所有路徑皆為 Linux 路徑（`/` 分隔），根目錄統一為：

```
/data/SFTP_data/
```

---

### DS_radar

```
/data/SFTP_data/TDD_radar/CWA_radar_web/CV1_1000_{YYYYMMDDHHmm}.png
```

- **根目錄**：`/data/SFTP_data/TDD_radar/CWA_radar_web/`
- **前綴**：`CV1_1000_`（固定）
  - `CV1`：Coverage View 1，台灣全島雷達合成圖
  - `1000`：圖像範圍或解析度代碼（固定值）
- **時間格式**：12 碼 `YYYYMMDDHHmm`（精度到分鐘）
- **時間間隔**：10 分鐘，涵蓋全天 00:00～23:50（共 144 個時刻）
- **副檔名**：`.png`
- **重複筆數**：每個 FileName 在檔案中出現 **2 次**

範例：
```
/data/SFTP_data/TDD_radar/CWA_radar_web/CV1_1000_202606100000.png
/data/SFTP_data/TDD_radar/CWA_radar_web/CV1_1000_202606101630.png
/data/SFTP_data/TDD_radar/CWA_radar_web/CV1_1000_202606102350.png
```

---

### DS_skewt

```
/data/SFTP_data/NID_data/Skew-T/SKW___000_{YYMMDDhh}_{StationID}.gif
```

- **根目錄**：`/data/SFTP_data/NID_data/Skew-T/`
- **前綴**：`SKW___000_`（固定，`SKW` 為 Skew-T 縮寫，`___000` 為固定補位）
- **時間格式**：8 碼 `YYMMDDhh`（2 位西元年尾 + 月 + 日 + 時，精度到小時）
  - 例：`26060912` = 2026-06-09 12 時（UTC）
  - 例：`26061000` = 2026-06-10 00 時（UTC）
- **探空站代碼**（`StationID`）：5 碼數字
  - `46810`：本檔案唯一出現的站碼（台灣探空站）
- **副檔名**：`.gif`
- **重複筆數**：每個 FileName 在檔案中出現 **多次**（最多 4 次）

範例：
```
/data/SFTP_data/NID_data/Skew-T/SKW___000_26060912_46810.gif
/data/SFTP_data/NID_data/Skew-T/SKW___000_26061000_46810.gif
```

---

### DS_gfsefs

```
/data/SFTP_data/NID_data/GFS_EFS/WWW_EFS_D1_000_{YYMMDDhh}_{ProductCode}.gif
```

- **根目錄**：`/data/SFTP_data/NID_data/GFS_EFS/`
- **前綴**：`WWW_EFS_D1_000_`（固定）
  - `WWW`：Web/圖形輸出
  - `EFS`：Ensemble Forecast System（系集預報）
  - `D1`：第一天（Day 1）預報
  - `000`：預報起始時次（00Z）
- **時間格式**：8 碼 `YYMMDDhh`（與 DS_skewt 相同，2 位西元年尾）
  - 例：`26060912` = 2026-06-09 12 時（UTC）
- **產品代碼**（`ProductCode`）：

  | 代碼       | 說明                                    |
  |------------|----------------------------------------|
  | `D51D2S`   | Day 5 至 Day 2 降水系集展示圖           |
  | `DR2`      | 降水系集預報第 2 日產品                  |

- **副檔名**：`.gif`
- **重複筆數**：每個 FileName 在檔案中出現 **2 次**

範例：
```
/data/SFTP_data/NID_data/GFS_EFS/WWW_EFS_D1_000_26060912_D51D2S.gif
/data/SFTP_data/NID_data/GFS_EFS/WWW_EFS_D1_000_26060912_DR2.gif
```

---

## 程式解析建議

1. **全部為 Linux 路徑**：所有 FileName 均以 `/data/SFTP_data/` 開頭，無需判斷平台，統一以 `/` 分割。

2. **重複筆數**：每個 FileName 在本檔案中固定出現 2 次（DS_radar、DS_gfsefs）或多次（DS_skewt 最多 4 次），代表同一筆資料被多個流程引用。程式處理時應先去重，不應對同一路徑重複操作。

3. **DS_skewt / DS_gfsefs 時間格式為 2 位年**：時間欄位為 `YYMMDDhh`（非 4 位年），解析時需手動補全世紀（`26` → `2026`）。與 DS_radar 的 12 碼 `YYYYMMDDHHmm` 格式**不同**，兩者不可混用同一解析函式。

4. **DS_radar 時間間隔固定 10 分鐘**：時間欄位為 `YYYYMMDDHHmm`，分鐘只出現 `00`、`10`、`20`、`30`、`40`、`50`，程式若需判斷資料完整性，可以此為基礎做缺漏檢查。

5. **子目錄對應 FileType**：三種 FileType 對應三個不同子目錄，可直接由路徑識別資料類型：
   - `TDD_radar/CWA_radar_web/` → `DS_radar`
   - `NID_data/Skew-T/` → `DS_skewt`
   - `NID_data/GFS_EFS/` → `DS_gfsefs`

6. **DS_gfsefs 產品代碼為識別鍵**：同一時次下有多種 `ProductCode`，程式聚合時應以 `時間戳 + ProductCode` 為唯一鍵，不可只用時間戳。
# HFradarFileStatus.txt — FileType 與 FileName 規則說明

本文件說明 `HFradarFileStatus.txt` 中兩個欄位的命名規則，供程式開發時作為解析與產生路徑的參考原則。

---

## 欄位格式

```
FileType  FileName
```

- 欄位以 **Tab** 分隔
- 第一行為標題列，程式讀取時應跳過（`NR > 1`）

---

## FileType 規則

格式：`HFradar_{StationID}`

前綴 `HFradar_` 代表高頻雷達（HF Radar）海流觀測資料。後接 4 碼站點代碼，由 **2 碼英文字母縮寫** + **2 碼數字序號** 組成。

共有 7 種 FileType：

| FileType        | 站點代碼 | 記錄數 | 唯一檔案數 | 資料月份            |
|-----------------|----------|--------|------------|---------------------|
| `HFradar_dt00`  | dt00     | 255    | 154        | 202605、202606（跨月）|
| `HFradar_ya01`  | ya01     | 79     | 48         | 202606              |
| `HFradar_ya00`  | ya00     | 78     | 48         | 202606              |
| `HFradar_bg00`  | bg00     | 69     | 48         | 202606              |
| `HFradar_sl00`  | sl00     | 68     | 48         | 202606              |
| `HFradar_dj00`  | dj00     | 50     | 48         | 202606              |
| `HFradar_gy00`  | gy00     | 48     | 48         | 202606              |

> **注意**：`HFradar_dt00` 是唯一跨越兩個月份（202605 與 202606）的站點，且記錄數明顯多於其他站點，代表該站在本檔案中同時涵蓋了補填的歷史資料（202605 月份）與當日資料（202606 月份）。

---

## FileName 規則

所有路徑皆為 Linux 掛載路徑，根目錄統一為：

```
/mnt/QNAP-TR004/hfradar/
```

完整路徑格式：

```
/mnt/QNAP-TR004/hfradar/{station}/{YYYY}/{YYYYMM}/L2/L2_{station}_{StartTime}_{EndTime}.nc
```

### 路徑各層說明

| 層級         | 範例            | 說明                                 |
|--------------|-----------------|--------------------------------------|
| 根目錄       | `/mnt/QNAP-TR004/hfradar/` | NAS（QNAP-TR004）掛載點，固定       |
| 站點目錄     | `dt00/`         | 與 FileType 後綴相同，4 碼小寫       |
| 年份目錄     | `2026/`         | 4 碼西元年                           |
| 年月目錄     | `202606/`       | 6 碼年月（`YYYYMM`）                 |
| 資料層級目錄 | `L2/`           | 固定為 `L2`（Level 2 處理資料）      |
| 檔案名稱     | 見下方說明      |                                      |

### 檔案名稱格式

```
L2_{station}_{StartTime}_{EndTime}.nc
```

| 欄位          | 範例                 | 說明                              |
|---------------|----------------------|-----------------------------------|
| `L2_`         | 固定前綴             | Level 2 資料標記                  |
| `{station}`   | `dt00`               | 站點代碼，與目錄及 FileType 相同  |
| `{StartTime}` | `20260609153000`     | 觀測開始時間，14 碼（`YYYYMMDDHHmmSS`） |
| `{EndTime}`   | `20260609160000`     | 觀測結束時間，14 碼（`YYYYMMDDHHmmSS`） |
| `.nc`         | 副檔名               | NetCDF 格式                       |

### 時間區間規則

- **區間長度固定 30 分鐘**（1800 秒），所有站點一致
- 時間序列以 30 分鐘為單位連續遞增，跨日時結束時間日期自然進位
- 開始與結束時間的秒數固定為 `00`（不含秒觀測）

時間遞增範例（`dt00` 站，202606 月份）：
```
20260609153000_20260609160000
20260609160000_20260609163000
20260609163000_20260609170000
...
20260609233000_20260610000000   ← 跨日，結束時間日期進為 20260610
20260610000000_20260610003000
```

---

## 重複筆數規則

各 FileType 的每個 FileName **在檔案中出現 1～3 次**，無固定倍率，程式處理前應先去重。

各站典型重複情況：
- `HFradar_gy00`：幾乎不重複（1 次）
- `HFradar_dj00`、`HFradar_sl00`、`HFradar_bg00`：多數重複 1～2 次
- `HFradar_ya00`、`HFradar_ya01`：多數重複 2 次
- `HFradar_dt00`：每筆重複 1～2 次，且同時混有 202605 與 202606 的資料

---

## 程式解析建議

1. **站點代碼一致性**：FileType 的後綴、路徑中的站點目錄名稱、以及檔名中的站點欄位三者完全相同，均為 4 碼小寫（如 `dt00`）。解析時可從任意一處提取站點代碼，三者互相驗證。

2. **時間區間為開始時間 + 結束時間**：檔名含兩個 14 碼時間戳，以底線分隔。解析時應將兩者都提取，不可只取第一個。查詢特定時刻的資料時，應以「StartTime ≤ 目標時刻 < EndTime」為條件。

3. **跨日時間處理**：`EndTime` 的日期可能與 `StartTime` 不同（例如 `20260609233000_20260610000000`），程式計算時間差或排序時，須完整解析兩個時間戳，不可只比較時間部分。

4. **`dt00` 跨月資料混存**：`HFradar_dt00` 同時包含 `202605`（2026-05-01 至 2026-05-03）與 `202606`（2026-06-09 至 2026-06-10）兩段資料，路徑中的年月目錄（`202605/` 或 `202606/`）是區分月份的唯一依據，程式過濾特定月份時須檢查路徑中的 `YYYYMM/` 段，不可只依賴檔名時間戳。

5. **副檔名固定為 `.nc`（NetCDF）**：所有 HF 雷達資料均為 NetCDF 格式，讀取時應使用對應的 NetCDF 函式庫（如 Python 的 `netCDF4` 或 `xarray`）。

6. **資料層級固定為 `L2`**：路徑中 `L2/` 層級固定，目前無 `L1`、`L3` 等其他層級出現；若未來引入多層級，解析時應將 `L2` 視為可變欄位而非寫死字串。

7. **去重後才計算時間連續性**：由於同一筆 FileName 可能重複出現多次，在檢查資料是否有缺漏時段前，應先去重取唯一路徑清單，再依 StartTime 排序後逐筆確認相鄰區間是否連續（即前一筆的 EndTime 應等於下一筆的 StartTime）。
# FileStatus.txt — FileType 與 FileName 規則說明

本文件說明 `FileStatus.txt` 中兩個欄位的命名規則，供程式開發時作為解析與產生路徑的參考原則。

---

## 欄位格式

```
FileType  FileName
```

- 欄位以 **Tab** 分隔
- 第一行為標題列，程式讀取時應跳過（`NR > 1`）

---

## FileType 規則

格式：`{Station}_{Format}[_{SubType}]`

### 1. Station（雷達站代碼）

固定 4 碼大寫英文，皆以 `RC` 開頭，代表台灣各雷達站：

| 代碼   | 說明         |
|--------|-------------|
| RCHL   | 花蓮         |
| RCKT   | 七股         |
| RCLY   | 林園         |
| RCSL   | 五分山       |
| RCNT   | 南屯         |
| RCCK   | 清泉崗（空軍）|
| RCGR   | 桃園（空軍）  |
| RCCG   | 成功（空軍）  |
| RCWF   | 五分山（另）  |
| RCMD   | 墾丁（radman）|
| RCAY / RCKU / RCNN / RCPO / RCQS / RCYU | 空軍基地站 |

### 2. Format（資料格式）

| Format       | 說明                                      |
|--------------|-------------------------------------------|
| `rb5`        | Rainbow5 原始體掃（2A 掃描策略）            |
| `rb5_CDD`    | Rainbow5 + CDD（Clutter Doppler Detection）處理 |
| `rb5_CS`     | Rainbow5 + CS（ROCAF 客製掃描策略）         |
| `rb5_CWB`    | Rainbow5 + CWB 掃描策略（5A_S3_CWB）       |
| `rb5_SUB-N`  | Rainbow5 子掃描，N = 1～4                  |
| `rb5_DPATC`  | Rainbow5 + ROCAF DPATC 掃描策略            |
| `rb5_CDD_CS` | Rainbow5 + CDD + CS 合併，由 radman 輸出   |
| `nexrad`     | NEXRAD（WSR-88D）格式原始資料               |
| `nexrad_mod` | NEXRAD 改版格式（RCCG 特有，輸出為 `.raw`）  |
| `rcm`        | AWIPS2 RCM 格式（Z 場反射率回波）            |
| `h5`         | AWIPS2 HDF5 格式                           |
| `eclass`     | radman ECLASS 輸出格式                     |

---

## FileName 規則

依據 FileType 的 Format，路徑與檔名格式不同，以下逐一說明。

### 共用目錄根

同一筆資料可能出現在多個根目錄，代表不同掛載點或備份路徑：

| 根目錄前綴                | 說明                   |
|--------------------------|------------------------|
| `/data/{station}data/`    | 主要資料目錄            |
| `/data/data/rb5s_{station}data/` 或 `/data/data/rb5_{station}data/` | 備援資料目錄 |
| `/home/data/rb5s_{station}data/` 或 `/home/data/rb5_{station}data/` | 本機 home 掛載        |
| `/data/AirForce/{STATION}_data_{format}/` | 空軍站專用           |
| `/awips2/edex/data/hdf5/` | AWIPS2 HDF5 儲存路徑   |
| `/data/awips2Data/radar/` | AWIPS2 RCM 儲存路徑    |
| `/usr/local/radman/data/` | radman 系統輸出路徑     |

> **程式設計原則**：解析時不應寫死根目錄，應從完整路徑中依格式規則拆解。

---

### rb5（Rainbow5 2A）

```
{base}/rainbow5_2A.vol/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol[.gz]
```

- `{base}` 範例：`/data/rchldata/`、`/data/rcktdata/`
- 日期目錄：`YYYY-MM-DD`（含連字號）
- 檔名：14 碼時間戳（`YYYYMMDDHHmmSS`）+ 雷達產品名稱 + `.vol`
- 部分檔案有 `.vol.gz`（壓縮版），與 `.vol` 同時存在

### rb5_CDD

```
{base}/2A_CDD.vol/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol
```

- `{base}` 範例：`/data/data/rb5s_rchldata/`、`/home/data/rb5s_rchldata/`

### rb5_CWB

```
{base}/5A_S3_CWB.vol/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol
```

- `{base}` 範例：`/data/rclydata/rainbow5_5A_S3_CWB.vol/`（注意此處目錄結構稍有不同）  
  或：`/data/data/rb5s_rclydata/`

### rb5_SUB-N（N = 1～4）

```
{base}/5A_S3_SUB-{N}.vol/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol
```

- `{base}` 範例：`/data/data/rb5s_rclydata/`、`/home/data/rb5_rcntdata/`

### rb5_CS

```
{base}/ROCAF_CS.vol/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol
```

- `{base}` 範例：`/home/data/rb5_rcgrdata/`、`/data/data/rb5_rcckdata/`

### rb5_DPATC

```
/data/{station}data/rainbow5_ROCAF_DPATC/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}{Product}.vol
```

### rb5_CDD_CS（radman 輸出）

```
/usr/local/radman/data/{station}data/{YYYYMMDDHHmmSS}{Product}.vol
```

- 路徑無日期子目錄，直接放在站別資料夾下

### nexrad（空軍站）

```
/data/AirForce/{STATION}_data_nexrad/{YYYY-MM-DD}/{STATION}_{YYYYMMDD}_{HHmmSS}.msg31.gz
```

RCWF 另有獨立路徑格式：
```
/data/rcwfdata/nexrad/{YYYY-MM-DD}/{STATION}_{YYYYMMDD}_{HHmmSS}_VOL.{num}.gz
/home/data/rcwfdata/{YYYY_MMDD}/{YYYYMMDD}_{HHmm}_{STATION}_VOL.{num}
```

> **注意**：RCWF 的備援路徑日期目錄格式為 `YYYY_MMDD`（底線分隔），與其他路徑的 `YYYY-MM-DD` 不同。

### nexrad_mod（RCCG 特有）

```
/data/rccgdata/nexrad_mod/{YYYY-MM-DD}/{YYYYMMDDHHmmSS}.raw[.gz]
/home/data/rccgdata/{YYYYMMDDHHmmSS}.raw
/data/rccgdata/{YYYYMMDDHHmmSS}.raw   （無子目錄版本）
```

- 副檔名為 `.raw`，部分有 `.raw.gz` 壓縮版

### rcm（AWIPS2 RCM）

```
/data/awips2Data/radar/{STATION}/Z/elev{elev}/res{res}/az{az}/level256/{STATION}.{num}.{YYYYMMDD}_{HHmm}
```

- `{STATION}` 為大寫站碼
- `elev0_5` / `elev0_9`：仰角（0.5° 或 0.9°）
- `res0_25`：解析度 0.25 km
- `az0_5`：方位角解析度 0.5°
- `level256`：資料層級
- 檔名**無副檔名**，以 `{STATION}.{julian_day}.{YYYYMMDD}_{HHmm}` 命名

### h5（AWIPS2 HDF5）

```
/awips2/edex/data/hdf5/radar/{station}/{elev}/radar-{station}-{YYYY-MM-DD}-{HH}.h5
```

- `{station}` 為小寫站碼
- `{elev}` 範例：`0.5`
- 時間粒度到**小時**（`{HH}`），非掃描時刻

### eclass（radman）

```
/usr/local/radman/data/{STATION}_OP/ECLASS_5A_S3.eclass/{YYYYMMDDHHmmSS}{Product}.vol
```

- `{STATION}` 大寫
- 路徑無日期子目錄

---

## 雷達產品名稱（Product）

出現於 `.vol` 檔名末尾（時間戳之後、`.vol` 之前）：

| 產品名稱    | 說明                               |
|------------|-----------------------------------|
| `dBZ`      | 反射率（水平，濾波後）              |
| `dBuZ`     | 反射率（未濾波）                   |
| `dBZv`     | 反射率（垂直偏極）                  |
| `dBuZv`    | 反射率（垂直，未濾波）              |
| `V`        | 都卜勒徑向風速（水平）              |
| `Vv`       | 都卜勒徑向風速（垂直）              |
| `W`        | 頻譜寬度（水平）                   |
| `Wv`       | 頻譜寬度（垂直）                   |
| `ZDR`      | 差分反射率                         |
| `PhiDP`    | 差分相位（濾波後）                  |
| `uPhiDP`   | 差分相位（未濾波）                  |
| `KDP`      | 比差分相位                         |
| `uKDP`     | 比差分相位（未濾波）                |
| `RhoHV`    | 相關係數                           |
| `SNR`      | 信噪比                             |
| `SQI`      | 信號品質指標                       |
| `CCOR`     | 雜波訂正                           |
| `ET`       | 回波頂高                           |
| `MDQI`     | 氣象資料品質指標                   |

---

## 程式解析建議

1. **分割 FileType**：以底線 `_` 分割，第一段固定為站碼，第二段為格式，第三段（若存在）為子類型。
2. **判斷 `rb5_SUB-N`**：子類型包含連字號，分割時需注意 `SUB-1`～`SUB-4` 為一整體，不再拆分。
3. **判斷壓縮檔**：FileName 結尾為 `.vol.gz` 或 `.raw.gz` 時，需先解壓才能讀取。
4. **日期目錄格式差異**：大多數路徑使用 `YYYY-MM-DD`；RCWF 備援路徑使用 `YYYY_MMDD`；部分路徑（`nexrad_mod`、`eclass`、`rb5_CDD_CS`）無日期子目錄。
5. **重複路徑**：同一筆資料常出現在 `/data/data/`、`/home/data/` 等多個根目錄，程式應以 FileType 為鍵做去重，或明確指定優先根目錄。
6. **rcm 無副檔名**：`rcm` 格式檔名無 `.` 副檔名，讀檔時以路徑最後一段整體作為檔名，勿以副檔名判斷格式。
7. **h5 時間粒度**：`h5` 格式的時間戳精度為小時，不含分秒，與其他格式的 14 碼時間戳不同。
# satelliteFileStatus.txt — FileType 與 FileName 規則說明

本文件說明 `satelliteFileStatus.txt` 中兩個欄位的命名規則，供程式開發時作為解析與產生路徑的參考原則。

---

## 欄位格式

```
FileType  FileName
```

- 欄位以 **Tab** 分隔
- 第一行為標題列，程式讀取時應跳過（`NR > 1`）

---

## FileType 規則

格式：`{Satellite}_{Format}[_{SubType}]`

共有 8 種 FileType，來自兩顆衛星：

| FileType          | 衛星        | 記錄數 |
|-------------------|------------|--------|
| `GK2A_XW`         | GK-2A      | 2208   |
| `HIMA_TP`         | Himawari-9 | 875    |
| `HIMA_TN`         | Himawari-9 | 875    |
| `HIMA_HSD_PGM`    | Himawari-9 | 96     |
| `HIMA_HRIT_PGM`   | Himawari-9 | 90     |
| `HIMA_WEB_VIS`    | Himawari-9 | 6      |
| `HIMA_WEB_TRGB`   | Himawari-9 | 6      |
| `HIMA_WEB_IR1`    | Himawari-9 | 6      |

---

### Satellite（衛星代碼）

| 代碼   | 衛星                         | 說明                         |
|--------|------------------------------|------------------------------|
| `HIMA` | Himawari-9（向日葵9號）       | JAXA / JMA 地球靜止氣象衛星  |
| `GK2A` | GEO-KOMPSAT-2A（千里眼2A）   | KMA 韓國地球靜止氣象衛星      |

---

### Format / SubType（資料格式與子類型）

#### HIMA 系列

| FileType          | Format   | 說明                                                      |
|-------------------|----------|-----------------------------------------------------------|
| `HIMA_TP`         | `TP`     | HRIT 原始分段資料（Tile Positive），Windows 接收端路徑    |
| `HIMA_TN`         | `TN`     | HRIT 原始分段資料（Tile Negative），與 `TP` 共用相同檔案路徑 |
| `HIMA_HRIT_PGM`   | `HRIT_PGM` | 由 HRIT 原始資料轉換後的 PGM 影像（Linux 路徑）         |
| `HIMA_HSD_PGM`    | `HSD_PGM`  | 由 HSD（Himawari Standard Data）轉換後的 PGM 影像        |
| `HIMA_WEB_IR1`    | `WEB_IR1`  | Web 發布用紅外線影像 tar 封裝                            |
| `HIMA_WEB_VIS`    | `WEB_VIS`  | Web 發布用可見光影像 tar 封裝                            |
| `HIMA_WEB_TRGB`   | `WEB_TRGB` | Web 發布用真彩色合成影像 tar 封裝                        |

> **注意**：`HIMA_TP` 與 `HIMA_TN` 的 FileName 完全相同（875 筆一一對應），代表同一批 HRIT 原始檔案同時被兩個流程引用，解析時以 FileType 區分處理目的，不以路徑區分。

#### GK2A 系列

| FileType   | Format | 說明                                              |
|------------|--------|---------------------------------------------------|
| `GK2A_XW`  | `XW`   | GK-2A UHRIT 原始分段資料，Windows 接收端路徑（S:\\）|

---

## FileName 規則

### 路徑平台

| FileType                                    | 作業系統    | 路徑分隔符 |
|---------------------------------------------|------------|-----------|
| `HIMA_TP`、`HIMA_TN`                        | Windows    | `\\`      |
| `GK2A_XW`                                   | Windows    | `\\`      |
| `HIMA_HRIT_PGM`、`HIMA_HSD_PGM`、`HIMA_WEB_*` | Linux   | `/`       |

> **程式設計原則**：解析 FileName 前須先判斷開頭字元（`D:\` 或 `S:\` → Windows；`/` → Linux），再套用對應的路徑分割邏輯。

---

### HIMA_TP / HIMA_TN（HRIT 原始分段）

```
D:\\Dartcom\\Data\\XRIT\\HRIT\\IMG_{Channel}_{YYYYMMDDHHmm}_{Segment}
```

- **根目錄固定**：`D:\\Dartcom\\Data\\XRIT\\HRIT\\`
- **檔名無副檔名**
- 組成：`IMG_` + 頻道代碼 + `_` + 12 碼時間戳（`YYYYMMDDHHmm`）+ `_` + 3 碼分段序號

範例：
```
IMG_DK01IR1_202606091650_009
IMG_DK01VIS_202606091700_010
```

**頻道代碼（DK01 系列）**：

| 代碼        | 波段類型       | 說明             |
|-------------|---------------|-----------------|
| `DK01VIS`   | 可見光         | 0.64 µm         |
| `DK01IR1`   | 紅外線         | 10.4 µm         |
| `DK01IR2`   | 紅外線         | 12.4 µm         |
| `DK01IR3`   | 紅外線         | 6.2 µm（水氣）  |
| `DK01IR4`   | 紅外線         | 7.3 µm          |
| `DK01B04`   | 近紅外線       | 0.86 µm         |
| `DK01B05`   | 近紅外線       | 1.6 µm          |
| `DK01B06`   | 近紅外線       | 2.3 µm          |
| `DK01B07`   | 中紅外線       | 3.9 µm          |
| `DK01B09`   | 水氣           | 6.9 µm          |
| `DK01B10`   | 水氣           | 7.3 µm          |
| `DK01B11`   | 紅外線         | 8.6 µm          |
| `DK01B12`   | 紅外線         | 9.6 µm          |
| `DK01B14`   | 紅外線         | 11.2 µm         |
| `DK01B16`   | 紅外線         | 13.3 µm         |

**分段序號**（`Segment`）：3 碼補零整數，本檔案出現 `001`～`010`，實際 HRIT 規格依頻道可達更多段。

---

### HIMA_HRIT_PGM（HRIT 轉換 PGM 影像）

```
/data1/PGM/{Channel}/HRIT_Image_{DK01Channel}_{YYYY-MM-DD}_{HHmm}.pgm
```

- **根目錄**：`/data1/PGM/`
- **頻道子目錄**：`{Channel}/`，對應頻道名稱（`B04`～`B16`、`IR1`～`IR4`、`VIS`），與 HRIT 原始資料的 `DK01{Channel}` 去掉前綴後相同
- **時間格式**：`YYYY-MM-DD_HHmm`（含連字號與底線，精度到分鐘）
- **副檔名**：`.pgm`

範例：
```
/data1/PGM/IR1/HRIT_Image_DK01IR1_2026-06-09_1650.pgm
/data1/PGM/B07/HRIT_Image_DK01B07_2026-06-09_1700.pgm
```

---

### HIMA_HSD_PGM（HSD 轉換 PGM 影像）

```
/data3/PGM/{Channel}/HS_H09_{YYYYMMDD}_{HHmm}_{Channel}_FLDK_{Resolution}.pgm
```

- **根目錄**：`/data3/PGM/`（與 HRIT_PGM 的 `/data1/PGM/` 不同）
- **衛星代碼**：`H09`（Himawari-9）
- **時間格式**：`YYYYMMDD_HHmm`（無分隔符，精度到分鐘）
- **掃描模式**：`FLDK`（Full Disk，全圓盤掃描）
- **解析度代碼**（`Resolution`）：

| 代碼  | 解析度  | 適用頻道                   |
|-------|---------|---------------------------|
| `R05` | 0.5 km  | B03（可見光高解析）         |
| `R10` | 1.0 km  | B01、B02、B04             |
| `R20` | 2.0 km  | B05～B16（多數頻道）        |

- **頻道涵蓋**：B01～B16（共 16 個頻道，較 HRIT_PGM 多 B01、B02、B03、B08、B13、B15）
- **副檔名**：`.pgm`

範例：
```
/data3/PGM/B03/HS_H09_20260609_1650_B03_FLDK_R05.pgm
/data3/PGM/B01/HS_H09_20260609_1650_B01_FLDK_R10.pgm
/data3/PGM/B07/HS_H09_20260609_1650_B07_FLDK_R20.pgm
```

---

### HIMA_WEB_IR1 / HIMA_WEB_VIS / HIMA_WEB_TRGB（Web 發布 tar）

```
{BaseDir}/{DateTimeUTC+8}.{Type}.tar
```

| FileType        | 根目錄              | 副檔名        | 內容            |
|-----------------|---------------------|---------------|----------------|
| `HIMA_WEB_IR1`  | `/data2/hima/PG007/` | `.ir1.tar`   | 紅外線影像      |
| `HIMA_WEB_VIS`  | `/data2/hima/PG007/` | `.vis.tar`   | 可見光影像      |
| `HIMA_WEB_TRGB` | `/data4/hsd/PG500/`  | `.trgbnew.tar` | 真彩色合成影像 |

- **時間格式**：`YYYY-MM-DD_HHMM`（UTC+8，精度到分鐘）
- `PG007`：低解析度（7 km）產品目錄；`PG500`：高解析度（500 m）產品目錄

> **注意**：Web tar 的日期可能跨日（如衛星資料為 2026-06-09 UTC，轉換後 tar 檔名為 2026-06-10 UTC+8），解析時不應直接以檔名日期對應原始觀測時間。

範例：
```
/data2/hima/PG007/2026-06-10_0050.ir1.tar
/data2/hima/PG007/2026-06-10_0050.vis.tar
/data4/hsd/PG500/2026-06-10_0040.trgbnew.tar
```

---

### GK2A_XW（GK-2A UHRIT 原始分段）

```
S:\\Archived\\Image\\Image\\{YYYY-MM-DD}\\{HH-MM}\\IMG_FD_{SatNum}_{Channel}_{YYYYMMDDHHmmSS}_{Segment}.uhrit
```

- **根目錄**：`S:\\Archived\\Image\\Image\\`（Windows，S: 磁碟）
- **日期目錄**：`{YYYY-MM-DD}\\`（含連字號）
- **時間目錄**：`{HH-MM}\\`（小時-分鐘，10 分鐘間隔，對應觀測批次起始時間）
- **掃描型別**：`FD`（Full Disk，全圓盤）
- **衛星序號**（`SatNum`）：`102`～`107`，代表同一批次中不同接收序號或分組（1 次觀測多段接收）
- **時間戳**：14 碼（`YYYYMMDDHHmmSS`，含秒）
- **分段序號**（`Segment`）：2 碼補零，`01`～`23`（GK-2A 全圓盤掃描每頻道 23 段）
- **副檔名**：`.uhrit`

範例：
```
S:\\Archived\\Image\\Image\\2026-06-09\\17-07\\IMG_FD_102_IR105_20260609_170736_01.uhrit
S:\\Archived\\Image\\Image\\2026-06-09\\17-07\\IMG_FD_106_WV063_20260609_170736_15.uhrit
```

**頻道代碼（GK-2A AMI）**：

| 代碼     | 波段類型   | 中心波長  | 說明             |
|----------|-----------|----------|-----------------|
| `VI004`  | 可見光     | 0.47 µm  | 藍色可見光       |
| `VI005`  | 可見光     | 0.51 µm  | 綠色可見光       |
| `VI006`  | 可見光     | 0.64 µm  | 紅色可見光       |
| `VI008`  | 近紅外線   | 0.86 µm  | 植被/近紅外      |
| `NR013`  | 近紅外線   | 1.37 µm  | 卷雲偵測         |
| `NR016`  | 近紅外線   | 1.6 µm   | 冰雪判識         |
| `SW038`  | 中紅外線   | 3.8 µm   | 火點偵測         |
| `WV063`  | 水氣       | 6.3 µm   | 上層水氣         |
| `WV069`  | 水氣       | 6.9 µm   | 中層水氣         |
| `WV073`  | 水氣       | 7.3 µm   | 下層水氣         |
| `IR087`  | 紅外線     | 8.7 µm   | 大氣窗區         |
| `IR096`  | 紅外線     | 9.6 µm   | 臭氧             |
| `IR105`  | 紅外線     | 10.5 µm  | 主要紅外窗區     |
| `IR112`  | 紅外線     | 11.2 µm  | 紅外窗區         |
| `IR123`  | 紅外線     | 12.3 µm  | 分裂窗           |
| `IR133`  | 紅外線     | 13.3 µm  | CO₂ 吸收帶      |

---

## 程式解析建議

1. **判斷平台**：FileName 以 `D:\` 或 `S:\` 開頭 → Windows 路徑（用 `\\` 分割）；以 `/` 開頭 → Linux 路徑（用 `/` 分割）。

2. **HIMA_TP 與 HIMA_TN 共用路徑**：兩者 FileName 完全相同，不應以路徑區分；應以 FileType 欄位判斷後續處理流程。

3. **HRIT 分段合併**：`HIMA_TP`/`HIMA_TN` 的單一頻道影像由多個分段（`Segment`，本資料集出現 `001`～`010`）組成，讀取完整影像前須收集該頻道、該時刻的所有分段。`GK2A_XW` 同理，每頻道最多 23 段（`01`～`23`）。

4. **GK2A 衛星序號（`SatNum`）**：檔名中的 `102`～`107` 為同一觀測批次的不同接收分組，不是 6 顆衛星，程式聚合時應以頻道代碼 + 時間戳 + 分段序號為唯一鍵，不含 `SatNum`。

5. **GK2A 時間目錄（`HH-MM`）**：目錄名稱代表觀測批次起始時間（10 分鐘間隔），與檔名中的精確時間戳（含秒）不同，查找特定時間的資料時應以檔名時間戳為準。

6. **HSD_PGM 解析度差異**：B03 為 `R05`（0.5 km），B01/B02/B04 為 `R10`（1.0 km），其餘均為 `R20`（2.0 km）；程式讀取時不可假設所有頻道解析度相同。

7. **HRIT_PGM 與 HSD_PGM 頻道差異**：`HIMA_HRIT_PGM` 只有 15 個頻道（B04～B16、IR1～IR4、VIS，無 B01、B02、B03、B08、B13、B15），`HIMA_HSD_PGM` 有完整 16 個頻道（B01～B16）。

8. **HIMA_WEB tar 時間為 UTC+8**：tar 檔名的時間是 UTC+8（台灣當地時間），與原始衛星觀測時間（UTC）相差 8 小時，程式轉換時需加以扣除。

9. **無副檔名檔案**：`HIMA_TP`/`HIMA_TN` 的 HRIT 原始分段檔案無副檔名（如 `IMG_DK01IR1_202606091650_009`），不可用副檔名判斷格式，應以 FileType 欄位與路徑中的 `XRIT\\HRIT\\` 識別。
# windprofilerStatus.txt — FileType 與 FileName 規則說明

本文件說明 `windprofilerStatus.txt` 中兩個欄位的命名規則，供程式開發時作為解析與產生路徑的參考原則。

> **注意**：實際檔案名稱為 `windprofilerStatus.txt`（非 `windprofilerFileStatus.txt`）。

---

## 欄位格式

```
FileType  FileName
```

- 欄位以 **Tab** 分隔
- 第一行為標題列，程式讀取時應跳過（`NR > 1`）

---

## FileType 規則

格式：`{Station}_{Format}_{Mode}`

共有 **12 種** FileType，由 2 個站點 × 2 種格式 × 3 種掃描模式組合而成：

| FileType        | 記錄數 | 唯一檔案數 |
|-----------------|--------|------------|
| `RCDS_bufr_06`  | 915    | 234        |
| `RCDS_asd_06`   | 909    | 238        |
| `RCCL_bufr_06`  | 880    | 194        |
| `RCCL_asd_06`   | 876    | 194        |
| `RCDS_asd_10`   | 282    | 142        |
| `RCDS_bufr_10`  | 263    | 136        |
| `RCCL_asd_10`   | 236    | 115        |
| `RCCL_bufr_10`  | 231    | 115        |
| `RCDS_asd_60`   | 75     | 23         |
| `RCCL_asd_60`   | 74     | 20         |
| `RCDS_bufr_60`  | 73     | 22         |
| `RCCL_bufr_60`  | 72     | 20         |

---

### Station（站點代碼）

| 代碼   | 系統目錄  | 說明           |
|--------|-----------|----------------|
| `RCCL` | `cwb-3`   | 風廓線雷達站 CL |
| `RCDS` | `cwb-4`   | 風廓線雷達站 DS |

FileType 中的站點代碼與路徑中的系統目錄名稱一一對應（`RCCL` ↔ `cwb-3`，`RCDS` ↔ `cwb-4`），兩者可互相驗證。

---

### Format（資料格式）

| 代碼   | 副檔名  | 說明                                                |
|--------|---------|-----------------------------------------------------|
| `asd`  | `.asd`  | ASD（ASCII Sounding Data）純文字觀測資料            |
| `bufr` | `.bufr` | BUFR（Binary Universal Form for Representation）二進位氣象編碼 |

同一站點、同一時刻、同一模式的 `asd` 與 `bufr` 檔案共用相同的基底檔名（basename），只有副檔名不同。例如：
```
w2026-06-09-16-00_06.asd
w2026-06-09-16-00_06.bufr   ← 完全相同的基底名
```

---

### Mode（掃描模式 / 積分時間）

檔名末尾的 2 位數字代表該筆資料的積分時間（分鐘），同時決定更新間隔：

| 代碼 | 積分時間 | 更新間隔 | 說明                       |
|------|----------|----------|----------------------------|
| `06` | 6 分鐘   | 每 6 分鐘 | 高時間解析度模式（最頻繁）  |
| `10` | 10 分鐘  | 每 10 分鐘| 中時間解析度模式            |
| `60` | 60 分鐘  | 每小時    | 低時間解析度模式（整點輸出）|

三種模式**獨立運作**，時間序列互不干擾，程式讀取時應分開處理。

---

## FileName 規則

所有路徑皆為 Linux 路徑，根目錄統一為：

```
/opt/rdx/data/localhost/
```

完整路徑格式：

```
/opt/rdx/data/localhost/{SystemDir}/{Format}/w{YYYY-MM-DD-HH-MM}_{Mode}.{ext}
```

### 路徑各層說明

| 層級         | 範例        | 說明                                           |
|--------------|-------------|------------------------------------------------|
| 根目錄       | `/opt/rdx/data/localhost/` | 固定                                |
| 系統目錄     | `cwb-3/`    | 對應站點：`cwb-3` = RCCL，`cwb-4` = RCDS      |
| 格式目錄     | `asd/`      | 與 FileType 中的格式代碼相同（`asd` 或 `bufr`）|
| 檔案名稱     | 見下方說明  |                                                |

### 檔案名稱格式

```
w{YYYY-MM-DD-HH-MM}_{Mode}.{ext}
```

| 欄位        | 範例                     | 說明                                      |
|-------------|--------------------------|-------------------------------------------|
| `w`         | 固定前綴                 | 代表 wind profiler（風廓線）              |
| `{YYYY-MM-DD-HH-MM}` | `2026-06-09-16-00` | 觀測時間，格式為 **全連字號分隔**（年-月-日-時-分），精度到分鐘 |
| `_{Mode}`   | `_06`                    | 底線 + 2 碼積分時間（`06`、`10`、`60`）  |
| `.{ext}`    | `.asd` 或 `.bufr`        | 副檔名與 FileType 中的格式代碼對應        |

---

## 時間序列規則

三種模式的時間序列各自獨立，間隔與起始分鐘不同：

### `_06`（6 分鐘模式）

- **更新間隔**：每 6 分鐘（分鐘值為 `00, 06, 12, 18, 24, 30, 36, 42, 48, 54`）
- **資料時間範圍**：2026-06-09 15:54 至 2026-06-10 11:12（RCCL）；2026-06-09 15:54 至 2026-06-10 11:12（RCDS）
- **起始時刻**：首筆出現於 `15-54`（非整點），之後規律以 6 分鐘遞增

### `_10`（10 分鐘模式）

- **更新間隔**：每 10 分鐘（分鐘值為 `00, 10, 20, 30, 40, 50`）
- **RCCL 資料範圍**：2026-06-09 16:00 至 2026-06-10 11:10（共 115 個時刻）
- **RCDS 資料範圍**：2026-06-09 15:50 至 2026-06-10 11:10（共 142 個時刻，比 RCCL 多 27 筆，起始較早）

### `_60`（60 分鐘模式）

- **更新間隔**：每小時（分鐘值固定為 `00`）
- **資料時間範圍**：2026-06-09 16:00 至 2026-06-10 11:00
- **RCCL**：共 20 個時刻；**RCDS**：共 22～23 個時刻（略多）

---

## 重複筆數說明

同一 `FileType + FileName` 組合在本檔案中**可出現多次**，且重複次數不固定（1～8 次，最常見為 4 次）。程式處理前應先去重，不可對同一路徑重複操作。

---

## 程式解析建議

1. **FileType 三段結構**：以底線 `_` 分割，第一段為站點代碼，第二段為格式，第三段為模式（積分時間數字）。第三段為純數字，可直接轉為 `int` 使用。

2. **站點代碼與系統目錄互相對應**：`RCCL` ↔ `cwb-3`，`RCDS` ↔ `cwb-4`。程式中建議維護此對應表，不應寫死字串，以備未來新增站點時僅需更新對應表。

3. **時間格式全連字號**：檔名中的時間為 `YYYY-MM-DD-HH-MM`（5 段連字號，共 16 碼），與其他系統常見的 `YYYYMMDDHHMM`（無分隔符）不同，解析時應以 `-` 為分隔符拆分，不可用固定位置截取。

4. **`_06` 起始時間非整點**：本資料集中 `_06` 模式的第一筆出現於 `15:54`，非整點對齊時刻。若程式依「分鐘能被 6 整除」來驗證合法性，`54` 符合此規則；但若依「整點起始」假設則會出錯。

5. **`_10` 兩站起始時間不同**：RCCL 的 `_10` 從 `16:00` 開始，RCDS 從 `15:50` 開始，兩站資料量因此不同（115 vs 142）。不可假設兩站的時間序列完全相同。

6. **三種模式獨立，不可混用**：`_06`、`_10`、`_60` 各自有不同的時間間隔與資料量，程式查詢特定時刻的資料時，須先確定要查詢哪種模式，再在該模式的時間序列中搜尋，不可跨模式合併排序後搜尋。

7. **asd 與 bufr 配對**：同一站點、同一時刻、同一模式必然同時存在 `.asd` 與 `.bufr` 兩個檔案，basename 完全相同。若需驗證資料完整性，可檢查兩者是否都存在。

8. **重複筆數去重後再處理**：本檔案同一筆記錄最多重複 8 次，最常見為 4 次。程式應以 `(FileType, FileName)` 為唯一鍵去重後再進行後續操作。
