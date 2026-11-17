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

// ── 站碼→中文名稱、科別對照（統一由 /js/labels.js 提供）──
// STATION_NAME_MAP / DEPT_LABELS / DEPT_ORDER 皆定義於 labels.js，
// 需確保 HTML 於本檔之前載入 labels.js。

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
/**
 * 計算首頁某群組卡片點擊後，要連往儀器頁的 URL。
 *   異常時：帶 ?inst=<延遲最嚴重的異常站碼>（精準對應該站台篩選）。
 *   正常時：帶 ?inst=<群組代表站碼>（stations[0]）；
 *           科別型群組（無固定 stations）改帶 ?dept=<科別>。
 * @param {object} g          群組定義（INSTRUMENT_GROUPS 之一）
 * @param {Array}  list       該群組的全部儀器
 * @param {Array}  alertInsts 該群組的異常儀器（_instrumentAlert 為真）
 */
function _instrumentsHref(g, list, alertInsts) {
  const base = '/instruments.html';

  // 異常：帶延遲最嚴重之異常站碼
  if (alertInsts.length > 0) {
    const worst = alertInsts.reduce(
      (a, b) => ((b.diff_time_minutes ?? 0) > (a.diff_time_minutes ?? 0) ? b : a)
    );
    const key = _prefix(worst);
    if (STATION_NAME_MAP[key]) {
      return `${base}?inst=${encodeURIComponent(key)}`;
    }
  }

  // 正常：群組代表站碼（固定站碼群組取第一個）
  if (g.stations && g.stations.length > 0) {
    const key = g.stations[0];
    if (STATION_NAME_MAP[key]) {
      return `${base}?inst=${encodeURIComponent(key)}`;
    }
  }

  // 科別型群組：以任一成員的科別帶 ?dept=
  const dept = list.length > 0 ? _deptOf(list[0]) : '';
  if (dept) {
    return `${base}?dept=${encodeURIComponent(dept)}`;
  }

  return base;
}

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

    const href = _instrumentsHref(g, list, alertInsts);
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
function _renderComputers(items, instruments) {
  const container = document.getElementById('computers-container');
  if (!container) return;

  // 依科別聚合電腦
  const byDept = {};
  for (const k of DEPT_ORDER) byDept[k] = [];
  const extraKeys = [];
  for (const item of items) {
    const dept = (item.department || '').toLowerCase();
    if (!(dept in byDept)) { byDept[dept] = []; extraKeys.push(dept); }
    byDept[dept].push(item);
  }

  // 依科別聚合「逾時」儀器（diff > threshold_red；斷線/NULL 不觸發）。
  // instruments 為 null/undefined（儀器 API 失敗）時此表為空，電腦區僅依硬體判定。
  const alertInstByDept = {};
  for (const inst of (instruments || [])) {
    if (!_instrumentAlert(inst)) continue;
    const dept = (inst.department || '').toLowerCase();
    (alertInstByDept[dept] = alertInstByDept[dept] || []).push(inst);
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

    // 該科逾時儀器站點中文名稱（去重）
    const overdueInsts = alertInstByDept[key] || [];
    const overdueStationNames = [...new Set(overdueInsts.map(_stationChinese))];

    const isAlert = problemComputers.length > 0 || overdueStationNames.length > 0;
    const lightCls = isAlert ? 'status-light-alert-red' : 'status-light-ok';
    const cardCls = isAlert ? 'level-alert-red' : 'level-ok';

    let detail;
    if (isAlert) {
      // B4：硬體問題逐台列出（以 IP 標示）
      const hwLines = problemComputers.map(pc => {
        const ipLabel = _escape(pc.item.ip || '--');
        return `<div class="metric-row diff-alert-red">
                  <span class="metric-label">${ipLabel}</span>
                  <span class="metric-value">${_escape(pc.problems.join('、'))}</span>
                </div>`;
      }).join('');

      // 新增：該科任一儀器逾時 → 列出逾時站點名稱
      let instLine = '';
      if (overdueStationNames.length > 0) {
        instLine = `<div class="metric-row diff-alert-red">
                      <span class="metric-label">儀器逾時</span>
                      <span class="metric-value">${_escape(overdueStationNames.join('、'))}</span>
                    </div>`;
      }
      detail = hwLines + instLine;
    } else {
      detail = `<div class="light-card-diff diff-ok">正常（${list.length} 台）</div>`;
    }

    // 連結規則：
    //   該科有儀器逾時 → 儀器頁並篩選該科（儀器篩選維持「全部」）
    //   其他情況（硬體問題或正常）→ 電腦頁並篩選該科
    // key 為科別代碼（如 wrs / mrs）；extraKeys 的空字串科別則不帶參數。
    let href;
    if (overdueStationNames.length > 0) {
      href = key ? `/instruments.html?dept=${encodeURIComponent(key)}` : '/instruments.html';
    } else {
      href = key ? `/computers.html?dept=${encodeURIComponent(key)}` : '/computers.html';
    }

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

// ── 電腦使用排行榜 TOP 5（CPU / 記憶體 / 磁碟）────────────
// 設計與資料邏輯比照 instruments.js 的電腦資源 TOP 5 面板。

/* 產生單條 bar HTML */
function _renderBar(label, value, maxValue, colors) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  return `
    <div class="bar-item">
      <div class="bar-label">${_escape(label)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}</div>
    </div>`;
}

/* CPU 色階（依使用百分比估色長度） */
function _cpuBarColor(pct) {
  if (pct >= 80) return { bar: '#ef4444', val: '#ef4444' };
  if (pct >= 60) return { bar: '#fb923c', val: '#fb923c' };
  if (pct >= 40) return { bar: '#facc15', val: '#facc15' };
  return { bar: '#4ade80', val: '#4ade80' };
}

function _renderCpuTop5(computers) {
  const container = document.getElementById('top-cpu');
  if (!container) return;
  if (!computers || computers.length === 0) {
    container.innerHTML = '<p class="loading">無資料</p>';
    return;
  }
  const valid = computers.filter(c => c.load_1 != null);
  const sorted = valid.sort((a, b) => b.load_1 - a.load_1).slice(0, 5);
  if (sorted.length === 0) {
    container.innerHTML = '<p class="loading">無 CPU 負載資料</p>';
    return;
  }
  const maxVal = Math.max(sorted[0].load_1, 100);
  container.innerHTML = sorted.map(c => {
    const label = c.ip || c.equipment_name || '--';
    const pct = maxVal > 0 ? Math.min((c.load_1 / maxVal) * 100, 100) : 0;
    return _renderBar(label, c.load_1, maxVal, _cpuBarColor(pct));
  }).join('');
}

function _memBarColor(memPct) {
  if (memPct > 80) return { bar: '#ef4444', val: '#ef4444' };
  if (memPct > 70) return { bar: '#fb923c', val: '#fb923c' };
  if (memPct > 60) return { bar: '#facc15', val: '#facc15' };
  return { bar: '#4ade80', val: '#4ade80' };
}

function _renderMemoryTop5(computers) {
  const container = document.getElementById('top-memory');
  if (!container) return;
  if (!computers || computers.length === 0) {
    container.innerHTML = '<p class="loading">無資料</p>';
    return;
  }
  const valid = computers.filter(c => c.memory_use != null);
  const sorted = valid.sort((a, b) => b.memory_use - a.memory_use).slice(0, 5);
  if (sorted.length === 0) {
    container.innerHTML = '<p class="loading">無記憶體資料</p>';
    return;
  }
  container.innerHTML = sorted.map(c => {
    const label = c.ip || c.equipment_name || '--';
    return _renderBar(label, c.memory_use, 100, _memBarColor(c.memory_use));
  }).join('');
}

function _diskBarColor(usedPct) {
  if (usedPct > 99) return { bar: '#ef4444', val: '#ef4444' };
  if (usedPct > 95) return { bar: '#fb923c', val: '#fb923c' };
  if (usedPct > 90) return { bar: '#facc15', val: '#facc15' };
  return { bar: '#4ade80', val: '#4ade80' };
}

function _renderDiskTop5(computers) {
  const container = document.getElementById('top-disk');
  if (!container) return;
  if (!computers || computers.length === 0) {
    container.innerHTML = '<p class="loading">無資料</p>';
    return;
  }
  const diskItems = [];
  for (const c of computers) {
    if (!c.disks || c.disks.length === 0) continue;
    for (const d of c.disks) {
      if (d.used_pct != null) {
        diskItems.push({ label: `${c.ip} ${d.file_system}`, value: d.used_pct });
      }
    }
  }
  const sorted = diskItems.sort((a, b) => b.value - a.value).slice(0, 5);
  if (sorted.length === 0) {
    container.innerHTML = '<p class="loading">無磁碟資料</p>';
    return;
  }
  container.innerHTML = sorted.map(item =>
    _renderBar(item.label, item.value, 100, _diskBarColor(item.value))
  ).join('');
}

function _renderComputerRanking(items) {
  _renderCpuTop5(items);
  _renderMemoryTop5(items);
  _renderDiskTop5(items);
}

// ── 資料刷新 ──────────────────────────────────────────────
async function _refreshInstruments() {
  try {
    const data = await fetchCurrentStatus();
    const instruments = data.instruments || [];
    _renderInstruments(instruments);
    return { ok: true, instruments };
  } catch (e) {
    _renderDisconnected('instruments-container', '儀器運作狀態');
    return { ok: false, instruments: null };
  }
}

/**
 * @param {Array|null} instruments 儀器清單；null 表示儀器 API 取得失敗，
 *        此時電腦區僅依硬體指標判定（不因缺儀器資料而誤判）。
 */
async function _refreshComputers(instruments) {
  try {
    const data = await fetchComputerStatus();
    _renderComputers(data.items || [], instruments || []);
    _renderComputerRanking(data.items || []);
    if (data.disk_error) {
      _showStatus('⚠ 磁碟資料庫無法連線，磁碟資訊可能不完整', 'warning');
    }
    return true;
  } catch (e) {
    _renderDisconnected('computers-container', '各科電腦與檔案');
    _renderComputerRanking([]);
    return false;
  }
}

async function _refreshData() {
  // 先取得儀器資料，才能供電腦區（依科別）判定「該科任一儀器逾時」。
  const { ok: okI, instruments } = await _refreshInstruments();
  const okC = await _refreshComputers(instruments);
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
