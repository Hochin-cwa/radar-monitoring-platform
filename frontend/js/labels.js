/**
 * labels.js — 共用文字對照表（single source of truth）
 *
 * 所有頁面共用的「對照文字」集中於此，其他 JS 一律從這裡讀取，
 * 不要再各自定義重複的對照表，以免不一致。
 *
 * 載入方式：在各 HTML 中，於其他業務 JS（mainpage.js / instruments.js /
 * computers.js / history.js ...）之前載入本檔：
 *   <script src="/js/labels.js"></script>
 *
 * 提供（掛在全域 window 上）：
 *   - STATION_NAME_MAP  站碼 → 中文名稱
 *   - DEPT_LABELS       科別代碼 → 中文名稱
 *   - DEPT_ORDER        科別顯示順序
 *   - getStationChinese(fileType)  由 file_type 取站碼中文（完整→前綴匹配）
 */

/* ── 站碼→中文名稱對照表 ── */
const STATION_NAME_MAP = {
  // 雷達站
  RCHL: '花蓮',
  RCKT: '墾丁',
  RCLY: '林園',
  RCSL: '樹林',
  RCNT: '南屯',
  RCCG: '七股',
  RCWF: '五分山',
  RCMD: '五分山（MD）',
  // 空軍基地站
  RCCK: '清泉崗（空軍）',
  RCGR: '綠島（空軍）',
  RCAY: '岡山（空軍）',
  RCKU: '嘉義（空軍）',
  RCNN: '台南（空軍）',
  RCPO: '新竹（空軍）',
  RCQS: '台東（空軍）',
  RCYU: '花蓮（空軍）',
  // 剖風儀雷達站
  RCCL: '剖風儀（中壢）',
  RCDS: '剖風儀 東沙',
  // 高頻雷達
  DS: '東沙',
  HFradar_dt00: '大潭',
  HFradar_ya01: '永安1',
  HFradar_ya00: '永安',
  HFradar_bg00: '北港',
  HFradar_sl00: '沙崙',
  HFradar_dj00: '東莒',
  HFradar_gy00: '觀音',
  // 衛星
  HIMA: '向日葵9號',
  GK2A: 'GK2A',
};

/* ── 科別代碼→中文名稱 ── */
const DEPT_LABELS = {
  wrs:  '氣象雷達科',
  mrs:  '海象雷達科',
  sos:  '衛星作業科',
  dqcs: '品管科',
  rsa:  '應用科',
};

/* ── 科別顯示順序 ── */
const DEPT_ORDER = ['wrs', 'mrs', 'sos', 'dqcs', 'rsa'];

/* ── 儀器分類（左側「儀器篩選」用）──
 * 將 STATION_NAME_MAP 的站碼依類別分組；每個分類列出所屬站碼 key。
 * 未列入任一分類者，於 instruments.js 中自動歸入「其他」。
 */
const INSTRUMENT_CATEGORIES = [
  {
    key: 'weather_radar',
    label: '氣象雷達',
    stations: ['RCHL', 'RCKT', 'RCLY', 'RCSL', 'RCNT', 'RCCG', 'RCWF', 'RCMD',
               'RCCK', 'RCGR', 'RCAY', 'RCKU', 'RCNN', 'RCPO', 'RCQS', 'RCYU'],
  },
  {
    key: 'ocean_radar',
    label: '海象雷達',
    stations: ['DS', 'HFradar_dt00', 'HFradar_ya01', 'HFradar_ya00',
               'HFradar_bg00', 'HFradar_sl00', 'HFradar_dj00', 'HFradar_gy00'],
  },
  {
    key: 'satellite',
    label: '氣象衛星',
    stations: ['HIMA', 'GK2A'],
  },
  {
    key: 'profiler',
    label: '剖風儀',
    stations: ['RCCL', 'RCDS'],
  },
];

/**
 * 從 file_type 提取站碼並回傳中文名稱（若有對應）。
 * 優先以完整 file_type 匹配，再以 _ 前綴匹配。
 * @param {string} fileType
 * @returns {string} 對應中文名稱；查無則回傳空字串
 */
function getStationChinese(fileType) {
  if (!fileType) return '';
  if (STATION_NAME_MAP[fileType]) return STATION_NAME_MAP[fileType]; // 完整匹配
  const prefix = fileType.split('_')[0];                            // 前綴匹配
  return STATION_NAME_MAP[prefix] || '';
}

// 掛上全域，供以 <script src> 載入的其他 JS 使用。
window.STATION_NAME_MAP = STATION_NAME_MAP;
window.DEPT_LABELS = DEPT_LABELS;
window.DEPT_ORDER = DEPT_ORDER;
window.INSTRUMENT_CATEGORIES = INSTRUMENT_CATEGORIES;
window.getStationChinese = getStationChinese;
