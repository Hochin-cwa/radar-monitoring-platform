/**
 * mainpage.js — 首頁（index.html）控制器
 *
 * 單欄版面，複用兩支現有 API：
 *   上區「儀器運作狀態」：GET /api/v1/completeness/current
 *   下區「各科電腦與檔案」：GET /api/v1/computers/current
 *
 * 燈號規則（依規格確認清單）：
 *   儀器：該組任一儀器 diff > threshold_red → 紅燈；否則綠燈。
 *        斷線 / NULL（diff > 14400 或無資料）視為正常（綠燈）。(A3 / A4)
 *   電腦：該科任一電腦 記憶體>80% / 磁碟使用率>99% / CPU LOAD_15>10 / 更新逾時>10分
 *        → 紅燈，並列出有問題的項目與數值；否則綠燈。(B2 / B3 / B4 / B5)
 *   資料拿不到（API 503 / disk_error）→ 整組灰燈 + 提示。(C3)
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;

// ── 儀器群組定義（A1 / A2）─────────────────────────────────
// 每組對應的站碼（file_type 完整或前綴）。DS 歸「其他」。
const INSTRUMENT_GROUPS = [
  { key: 'wfs',      label: '五分山',   stations: ['RCWF', 'RCMD'] },
  { key: 'hl',       label: '花蓮',     stations: ['RCHL'] },
  { key: 'cg',       label: '七股',     stations: ['RCCG'] },
  { key: 'kt',       label: '墾丁',     stations: ['RCKT'] },
  { key: 'sl',       label: '樹林',     stations: ['RCSL'] },
  { key: 'nt',       label: '南屯',     stations: ['RCNT'] },
  { key: 'ly',       label: '林園',     stations: ['RCLY'] },
  { key: 'airforce', label: '空軍雷達', stations: ['RCCK', 'RCGR', 'RCAY', 'RCKU', 'RCNN', 'RCPO', 'RCQS', 'RCYU'] },
  { key: 'profiler', label: '剖風儀',   stations: ['RCCL', 'RCDS'] },
  { key: 'hfradar',  label: '海象雷達', match: (inst) => _deptOf(inst) === 'mrs' && _prefix(inst) !== 'DS' },
  { key: 'satellite', label: '衛星',    match: (inst) => _deptOf(inst) === 'sos' },
  { key: 'other',    label: '其他',     match: null },  // fallback
];

// ── 站碼→中文名稱（複用 instruments.js 的對照概念，供 A5 列出異常站點）──
const STATION_NAME_MAP = {
  RCHL: '花蓮', RCKT: '墾丁', RCLY: '林園', RCSL: '樹林', RCNT: '南屯',
  RCCK: '清泉崗（空軍）', RCGR: '桃園（空軍）', RCCG: '七股',
  RCWF: '五分山', RCMD: '五分山（另）',
  RCAY: '岡山（空軍）', RCKU: '嘉義（空軍）', RCNN: '台南（空軍）',
  RCPO: '新竹（空軍）', RCQS: '台東（空軍）', RCYU: '花蓮（空軍）',
  RCCL: '剖風儀 中壢', RCDS: '剖風儀 東沙',
  DS: '東沙',
  HFradar_dt00: '大潭', HFradar_ya01: '永安1', HFradar_ya00: '永安',
  HFradar_bg00: '北港', HFradar_sl00: '沙崙', HFradar_dj00: '東莒', HFradar_gy00: '觀音',
  HIMA: '向日葵9號', GK2A: 'GK2A',
};

// ── 電腦科別（B1）─────────────────────────────────────────
const DEPT_LABELS = {
  wrs:  '氣象雷達科',
  mrs:  '海象雷達科',
  sos:  '衛星作業科',
  dqcs: '品管科',
  rsa:  '應用科',
};
const DEPT_ORDER = ['wrs', 'mrs', 'sos', 'dqcs', 'rsa'];

// ── 電腦門檻（紅燈級距，B2 / B3）──────────────────────────
const MEM_RED = 80;            // 記憶體使用率 > 80%
const DISK_USED_RED = 99;      // 磁碟使用率 > 99%（剩餘 < 1%）
const CPU_LOAD15_RED = 10;     // LOAD_15 > 10
const CPU_TIMEOUT_RED_MIN = 10; // CPU 更新逾時 > 10 分鐘

const DISCONNECT_THRESHOLD_MIN = 14400;

// ── 工具函式 ──────────────────────────────────────────────
function _pad(n) { return String(n).padStart(2, '0'); }
function _formatDatetime(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())} ` +
         `${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
function _tickClock() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const lt = document.getElementById('local-time');
  const ut = document.getElementById('utc-time');
  if (lt) lt.textContent = _formatDatetime(now);
  if (ut) ut.textContent = _formatDatetime(utc);
}
function _showStatus(msg, type = 'error') {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
}
function _clearStatus() {
  const bar = document.getElementById('status-bar');
  if (bar) bar.className = 'status-bar hidden';
}
function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _prefix(inst) {
  const ft = inst.file_type || '';
  if (STATION_NAME_MAP[ft]) return ft;        // 完整匹配（如 HFradar_dt00, DS）
  return ft.split('_')[0];                     // 前綴（如 RCNT_rb5 → RCNT）
}
function _deptOf(inst) {
  return (inst.department || '').toLowerCase();
}
function _stationChinese(inst) {
  const ft = inst.file_type || '';
  if (STATION_NAME_MAP[ft]) return STATION_NAME_MAP[ft];
  return STATION_NAME_MAP[_prefix(inst)] || ft || inst.ip || '--';
}

// ── 儀器：歸組 ────────────────────────────────────────────
/**
 * 將單一儀器歸入某個群組 key。
 * 先比對站碼清單，再比對 match 函式，最後落入 'other'。
 */
function _groupKeyForInstrument(inst) {
  const prefix = _prefix(inst);
  const ft = inst.file_type || '';
  for (const g of INSTRUMENT_GROUPS) {
    if (g.stations && (g.stations.includes(prefix) || g.stations.includes(ft))) {
      return g.key;
    }
  }
  for (const g of INSTRUMENT_GROUPS) {
    if (typeof g.match === 'function' && g.match(inst)) {
      return g.key;
    }
  }
  return 'other';
}

/**
 * 儀器是否「警示」= diff > threshold_red（A3）。
 * 斷線 / NULL（diff 為 null 或 > 14400）視為正常（A4），回傳 false。
 */
function _instrumentAlert(inst) {
  const diff = inst.diff_time_minutes;
  if (diff == null || diff > DISCONNECT_THRESHOLD_MIN) return false;  // 斷線當綠燈
  const red = inst.threshold_red ?? 20;
  return diff > red;
}

// ── 儀器：渲染 ────────────────────────────────────────────
function _renderInstruments(instruments) {
  const container = document.getElementById('instruments-container');
  if (!container) return;

  // 依群組聚合
  const byGroup = {};
  for (const g of INSTRUMENT_GROUPS) byGroup[g.key] = [];
  for (const inst of instruments) {
    byGroup[_groupKeyForInstrument(inst)].push(inst);
  }

  container.innerHTML = INSTRUMENT_GROUPS.map(g => {
    const list = byGroup[g.key];
    const alertInsts = list.filter(_instrumentAlert);
    const isAlert = alertInsts.length > 0;
    const lightCls = isAlert ? 'status-light-alert-red' : 'status-light-ok';
    const cardCls = isAlert ? 'level-alert-red' : 'level-ok';

    // A5：紅燈時列出異常站點名稱
    let detail = '';
    if (isAlert) {
      const names = [...new Set(alertInsts.map(_stationChinese))];
      detail = `<div class="light-card-diff diff-alert-red">異常：${_escape(names.join('、'))}</div>`;
    } else {
      detail = `<div class="light-card-diff diff-ok">正常（${list.length} 項）</div>`;
    }

    const href = '/instruments.html';
    return `
      <div class="instrument-card ${cardCls}" style="cursor:pointer"
           onclick="window.location.href='${href}'">
        <div class="light-card-row">
          <span class="status-light ${lightCls}"></span>
          <div class="light-card-body">
            <div class="card-station">${_escape(g.label)}</div>
            ${detail}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── 電腦：單台問題項目計算 ────────────────────────────────
/**
 * 回傳該電腦所有達到紅燈級距的問題項目（含數值字串）。
 * @returns {string[]}
 */
function _computerProblems(item) {
  const problems = [];

  // 記憶體使用率 > 80%
  if (item.memory_use != null && item.memory_use > MEM_RED) {
    problems.push(`記憶體 ${item.memory_use.toFixed(1)}%`);
  }

  // CPU：LOAD_15 > 10 或 更新逾時 > 10 分（B2，任一即警示）
  const cpuIssues = [];
  if (item.load_15 != null && item.load_15 > CPU_LOAD15_RED) {
    cpuIssues.push(`負載15m ${item.load_15.toFixed(2)}`);
  }
  const timeoutMin = _cpuTimeoutMinutes(item.server_time);
  if (timeoutMin == null) {
    cpuIssues.push('更新逾時（無時間）');
  } else if (timeoutMin > CPU_TIMEOUT_RED_MIN) {
    cpuIssues.push(`更新逾時 ${timeoutMin.toFixed(0)} 分`);
  }
  if (cpuIssues.length > 0) {
    problems.push(`CPU（${cpuIssues.join('、')}）`);
  }

  // 磁碟使用率 > 99%（B5 顯示使用率）
  for (const d of (item.disks || [])) {
    if (d.used_pct != null && d.used_pct > DISK_USED_RED) {
      problems.push(`磁碟 ${d.file_system} ${d.used_pct.toFixed(1)}%`);
    }
  }

  return problems;
}

function _cpuTimeoutMinutes(serverTimeStr) {
  if (!serverTimeStr) return null;
  const last = new Date(serverTimeStr);
  if (isNaN(last.getTime())) return null;
  return (Date.now() - last.getTime()) / 60000;
}

// ── 電腦：渲染 ────────────────────────────────────────────
function _renderComputers(items) {
  const container = document.getElementById('computers-container');
  if (!container) return;

  // 依科別聚合
  const byDept = {};
  for (const k of DEPT_ORDER) byDept[k] = [];
  const extraKeys = [];
  for (const item of items) {
    const dept = (item.department || '').toLowerCase();
    if (!(dept in byDept)) { byDept[dept] = []; extraKeys.push(dept); }
    byDept[dept].push(item);
  }

  const orderedKeys = [...DEPT_ORDER.filter(k => byDept[k] && byDept[k].length > 0),
                       ...extraKeys.filter(k => k)];

  if (orderedKeys.length === 0) {
    container.innerHTML = '<p class="loading">目前無電腦資料</p>';
    return;
  }

  container.innerHTML = orderedKeys.map(key => {
    const list = byDept[key];
    const label = DEPT_LABELS[key] || key || '其他';

    // 聚合該科所有問題電腦
    const problemComputers = [];
    for (const item of list) {
      const problems = _computerProblems(item);
      if (problems.length > 0) {
        problemComputers.push({ item, problems });
      }
    }
    const isAlert = problemComputers.length > 0;
    const lightCls = isAlert ? 'status-light-alert-red' : 'status-light-ok';
    const cardCls = isAlert ? 'level-alert-red' : 'level-ok';

    let detail;
    if (isAlert) {
      // B4：列項目 + 數值，依電腦分行（以 IP 標示異常電腦）
      const lines = problemComputers.map(pc => {
        const ipLabel = _escape(pc.item.ip || '--');
        return `<div class="metric-row diff-alert-red">
                  <span class="metric-label">${ipLabel}</span>
                  <span class="metric-value">${_escape(pc.problems.join('、'))}</span>
                </div>`;
      }).join('');
      detail = lines;
    } else {
      detail = `<div class="light-card-diff diff-ok">正常（${list.length} 台）</div>`;
    }

    // C2：點某科電腦 → 跳 computers.html 對應科別
    const href = '/computers.html';

    return `
      <div class="instrument-card ${cardCls}" style="cursor:pointer"
           onclick="window.location.href='${href}'">
        <div class="light-card-row">
          <span class="status-light ${lightCls}"></span>
          <div class="light-card-body">
            <div class="card-station">${_escape(label)}</div>
            ${detail}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── 錯誤態：整組灰燈 + 提示（C3）──────────────────────────
function _renderDisconnected(containerId, label) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="instrument-card level-disconnected">
      <div class="light-card-row">
        <span class="status-light status-light-disconnected"></span>
        <div class="light-card-body">
          <div class="card-station">${_escape(label)}</div>
          <div class="light-card-diff diff-disconnected">資料來源無法連線</div>
        </div>
      </div>
    </div>`;
}

// ── 資料刷新 ──────────────────────────────────────────────
async function _refreshInstruments() {
  try {
    const data = await fetchCurrentStatus();
    _renderInstruments(data.instruments || []);
    return true;
  } catch (e) {
    _renderDisconnected('instruments-container', '儀器運作狀態');
    return false;
  }
}

async function _refreshComputers() {
  try {
    const data = await fetchComputerStatus();
    _renderComputers(data.items || []);
    if (data.disk_error) {
      _showStatus('⚠ 磁碟資料庫無法連線，磁碟資訊可能不完整', 'warning');
    }
    return true;
  } catch (e) {
    _renderDisconnected('computers-container', '各科電腦與檔案');
    return false;
  }
}

async function _refreshData() {
  const [okI, okC] = await Promise.all([_refreshInstruments(), _refreshComputers()]);
  if (okI && okC) {
    _clearStatus();
  } else if (!okI || !okC) {
    _showStatus('部分資料來源連線失敗，受影響區塊顯示為灰燈', 'error');
  }
  const lr = document.getElementById('last-refreshed');
  if (lr) lr.textContent = _formatDatetime(new Date());
}

function _resetRefreshTimer() {
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(_refreshData, REFRESH_INTERVAL_MS);
}

async function _init() {
  _tickClock();
  setInterval(_tickClock, 1000);

  const btn = document.getElementById('btn-refresh');
  if (btn) {
    btn.addEventListener('click', () => {
      _refreshData();
      _resetRefreshTimer();
    });
  }

  await _refreshData();
  _resetRefreshTimer();
}

document.addEventListener('DOMContentLoaded', _init);
