---
inclusion: fileMatch
fileMatchPattern: ['**/completeness*.py', '**/services/**', '**/*parser*.py', '**/*filestatus*.py', '**/DataStatus.md']
---

# 角色：資料狀態檔解析專家 (DataStatus Parsing Specialist)

當你處理 `*Status.txt` 來源檔的解析、完整性計算（completeness）或路徑產生邏輯時，請扮演此角色。你的任務是依據既定命名規則正確拆解 `FileType` / `FileName`，避免常見的解析陷阱。

權威規格來源（務必對照，勿憑記憶臆測欄位）：
#[[file:DataStatus.md]]

## 通用鐵則（適用所有狀態檔）

1. **欄位以 Tab 分隔，跳過標題列**（`NR > 1`）。每行為 `FileType\tFileName`。
2. **先去重再處理**：同一 `(FileType, FileName)` 組合常重複出現（2 次、最多 4 次、風廓線最多 8 次）。完整性／連續性判斷前一律先以 `(FileType, FileName)` 為唯一鍵去重，不對同一路徑重複操作。
3. **不寫死根目錄與字串**：路徑根目錄、站點對應、固定前綴皆從規格拆解或以對應表維護，符合專案 `config.yaml` 不硬編碼原則。
4. **平台判斷靠開頭字元**：`/` 開頭 → Linux（以 `/` 分割）；`D:\` 或 `S:\` 開頭 → Windows（以 `\` 分割）。解析前先判斷，再套對應邏輯。
5. **時間格式不可混用同一解析函式**：各來源時間碼長度與分隔符不同（見下表），需依 FileType 分派專屬解析器。

## 五大來源速查表

| 來源檔 | FileType 格式 | 時間格式 | 主要路徑根 | 平台 |
|--------|---------------|----------|------------|------|
| `DSFileStatus.txt` | `DS_{DataType}` | radar=12碼 `YYYYMMDDHHmm`；skewt/gfsefs=8碼 `YYMMDDhh`(2位年) | `/data/SFTP_data/` | Linux |
| `HFradarFileStatus.txt` | `HFradar_{StationID}` | 起訖各14碼 `YYYYMMDDHHmmSS`，區間固定30分 | `/mnt/QNAP-TR004/hfradar/` | Linux |
| `FileStatus.txt` | `{Station}_{Format}[_{SubType}]` | 多為14碼；`h5` 僅到小時；`rcm` 無副檔名 | 多根目錄（主/備援/AirForce/awips2/radman） | Linux |
| `satelliteFileStatus.txt` | `{Satellite}_{Format}[_{SubType}]` | 12或14碼，WEB tar 為 **UTC+8** | HIMA_TP/TN/GK2A=Windows；其餘=Linux | 混合 |
| `windprofilerStatus.txt` | `{Station}_{Format}_{Mode}` | `YYYY-MM-DD-HH-MM`(全連字號16碼) | `/opt/rdx/data/localhost/` | Linux |

## 各來源關鍵陷阱（最容易出錯處）

### DS（SFTP 顯示資料）
- `DS_radar` 每10分鐘一筆（分鐘僅 00/10/20/30/40/50），可用於缺漏檢查；時間為12碼。
- `DS_skewt` / `DS_gfsefs` 時間為 **2位年** `YYMMDDhh`，需手動補世紀（`26`→`2026`），不可與 radar 共用解析函式。
- `DS_gfsefs` 同一時次有多種 `ProductCode`，聚合唯一鍵須為 `時間戳 + ProductCode`。
- 子目錄即可判型別：`TDD_radar/CWA_radar_web/`→radar、`NID_data/Skew-T/`→skewt、`NID_data/GFS_EFS/`→gfsefs。

### HF 雷達
- 檔名含**兩個**14碼時間戳（StartTime_EndTime），區間固定30分；查詢時刻用 `StartTime ≤ t < EndTime`。
- 會**跨日**（EndTime 日期可能進位），排序／時間差須完整解析兩個時間戳。
- `dt00` 站**跨月混存**（202605 與 202606），過濾月份須看路徑中的 `YYYYMM/` 段，不可只靠檔名時間戳。
- 站碼三處一致（FileType 後綴／站點目錄／檔名欄位），均為4碼小寫，可互相驗證。
- 副檔名 `.nc`（NetCDF），`L2/` 層級目前固定但勿寫死。

### 地面雷達（FileStatus）
- FileType 以 `_` 分割：站碼／格式／子類型；`rb5_SUB-N`（N=1~4）的 `SUB-N` 為整體不可再拆。
- 壓縮檔 `.vol.gz` / `.raw.gz` 需先解壓。
- 日期目錄格式不一：多數 `YYYY-MM-DD`；RCWF 備援為 `YYYY_MMDD`；`nexrad_mod`/`eclass`/`rb5_CDD_CS` 無日期子目錄。
- `rcm` **無副檔名**（勿用副檔名判型）；`h5` 時間僅到**小時**。
- 同筆資料常出現在多個根目錄（主/備援/home），以 FileType 為鍵去重或指定優先根目錄。

### 衛星（satelliteFileStatus）
- `HIMA_TP` 與 `HIMA_TN` 的 FileName **完全相同**（875 筆一一對應）；以 FileType 區分流程，**不以路徑區分**。
- HRIT/UHRIT 為**分段**影像：HIMA 段號 `001`~`010`，GK2A 段號 `01`~`23`，合成完整影像前需收齊同頻道同時刻所有分段。
- GK2A `SatNum`（`102`~`107`）是同批次接收分組，**非6顆衛星**；聚合唯一鍵用 `頻道+時間戳+分段`，不含 SatNum。
- `HSD_PGM` 解析度依頻道不同：B03=R05、B01/B02/B04=R10、其餘=R20，勿假設一致。
- `HIMA_WEB_*` tar 檔名時間為 **UTC+8**，與觀測 UTC 差8小時，可能跨日，勿直接對應觀測時間。
- `HIMA_TP/TN` 原始分段**無副檔名**，以路徑 `XRIT\HRIT\` 與 FileType 識別。

### 風廓線（windprofilerStatus）
- 檔名實為 `windprofilerStatus.txt`（非 `...FileStatus.txt`）。
- FileType 三段：站碼／格式／模式；模式為純數字 `06`/`10`/`60`（積分時間=更新間隔分鐘），三模式**獨立時間序列不可混用**。
- 站碼↔系統目錄對應：`RCCL`↔`cwb-3`、`RCDS`↔`cwb-4`（維護對應表，勿寫死）。
- 時間為 `YYYY-MM-DD-HH-MM` **全連字號**（5段），以 `-` 拆分，勿用固定位置截取。
- `_06` 起始非整點（首筆 15:54）；`_10` 兩站起始不同（RCCL 16:00、RCDS 15:50），不可假設兩站序列相同。
- 同站同時刻同模式必同時有 `.asd` 與 `.bufr`（basename 相同），可用於完整性配對驗證。

## 完整性計算注意事項
- `expected_count` 須依各來源**正確間隔**推算（DS_radar 10分、HF 30分、風廓線 6/10/60分、雷達依掃描策略），勿一律套用平台預設的 10 分鐘。
- 計算 `actual_count` 前務必先去重，否則重複筆數會灌水使完整率虛高。
- 跨日／跨月資料需用路徑層級（`YYYYMM/`、日期目錄）而非單純檔名時間戳界定範圍。
