/**
 * computers.js — 電腦即時狀況頁面控制器
 * 每台電腦以單一統一卡片呈現，同時顯示系統指標與磁碟資料，依科別分組。
 * 三段燈號門檻：
 *   記憶體：>60% 黃、>70% 橙、>80% 紅
 *   磁碟剩餘：<10% 黃、<5% 橙、<1% 紅
 *   CPU 更新逾時：>3分鐘 黃、>10分鐘 橙、>30分鐘 紅
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;

const DEPT_LABELS = {
  sos:  '衛星作業科',
  dqcs: '品管科',
  rsa:  '應用科',
  wrs:  '氣象雷達科',
  mrs:  '海象雷達科',
};
const DEPT_ORDER = ['wrs', 'mrs', 'sos', 'dqcs', 'rsa'];

// ── 門檻常數 ──────────────────────────────────────────────
const MEM_YELLOW = 60;
const MEM_ORANGE = 70;
const MEM_RED    = 80;

const DISK_FREE_YELLOW = 10;
const DISK_FREE_ORANGE = 5;
const DISK_FREE_RED    = 1;

const CPU_TIMEOUT_YELLOW = 3;
const CPU_TIMEOUT_ORANGE = 10;
const CPU_TIMEOUT_RED    = 30;

// ── 工具函式 ──────────────────────────────────────────────
function _pad(n) { return String(n).padStart(2, '0'); }
function _formatDatetime(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())} ` +
         `${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
function _tickClock() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  document.getElementById('local-time').textContent = _formatDatetime(now);
  document.getElementById('utc-time').textContent   = _formatDatetime(utc);
}
function _showStatus(msg, type = 'error') {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
}
function _clearStatus() {
  document.getElementById('status-bar').className = 'status-bar hidden';
}

function _groupByDept(items) {
  const groups = {};
  for (const item of items) {
    const key = (item.department || '').toLowerCase() || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function _orderedKeys(groups) {
  return [
    ...DEPT_ORDER.filter(k => groups[k]),
    ...Object.keys(groups).filter(k => !DEPT_ORDER.includes(k)),
  ];
}

// ── 燈號判斷 ──────────────────────────────────────────────

/**
 * 記憶體使用率燈號
 * @param {number|null} memPct
 * @returns {'ok'|'yellow'|'orange'|'red'}
 */
function _memLevel(memPct) {
  if (memPct == null) return 'ok';
  if (memPct > MEM_RED)    return 'red';
  if (memPct > MEM_ORANGE) return 'orange';
  if (memPct > MEM_YELLOW) return 'yellow';
  return 'ok';
}

/**
 * 磁碟剩餘空間燈號（API 回傳 used_pct）
 * @param {number|null} usedPct
 * @returns {'ok'|'yellow'|'orange'|'red'}
 */
function _diskLevel(usedPct) {
  if (usedPct == null) return 'ok';
  const free = 100 - usedPct;
  if (free < DISK_FREE_RED)    return 'red';
  if (free < DISK_FREE_ORANGE) return 'orange';
  if (free < DISK_FREE_YELLOW) return 'yellow';
  return 'ok';
}

/**
 * CPU 更新逾時燈號
 * @param {string|null} serverTimeStr  ISO 8601 字串（後端 server_time 欄位）
 * @returns {'ok'|'yellow'|'orange'|'red'}
 */
function _cpuTimeoutLevel(serverTimeStr) {
  if (!serverTimeStr) return 'red';
  const lastUpdate = new Date(serverTimeStr);
  if (isNaN(lastUpdate.getTime())) return 'red';
  const diffMin = (Date.now() - lastUpdate.getTime()) / 60000;
  if (diffMin > CPU_TIMEOUT_RED)    return 'red';
  if (diffMin > CPU_TIMEOUT_ORANGE) return 'orange';
  if (diffMin > CPU_TIMEOUT_YELLOW) return 'yellow';
  return 'ok';
}

/**
 * 取最嚴重燈號（ok < yellow < orange < red）
 */
const LEVEL_RANK = { ok: 0, yellow: 1, orange: 2, red: 3 };
function _worstLevel(...levels) {
  return levels.reduce((a, b) => LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b, 'ok');
}

// ── 統一卡片渲染 ──────────────────────────────────────────

/**
 * 渲染單台電腦的統一卡片 HTML
 * @param {Object} item  ComputerItem 資料
 * @returns {string}  卡片 HTML 字串
 */
function _renderUnifiedCard(item) {
  const mem    = item.memory_use != null ? item.memory_use.toFixed(1) + '%' : 'N/A';
  const load1  = item.load_1  != null ? item.load_1.toFixed(2)  : 'N/A';
  const load5  = item.load_5  != null ? item.load_5.toFixed(2)  : 'N/A';
  const load15 = item.load_15 != null ? item.load_15.toFixed(2) : 'N/A';

  const memLvl  = _memLevel(item.memory_use);
  const cpuLvl  = _cpuTimeoutLevel(item.server_time);
  const diskLevels = (item.disks || []).map(d => _diskLevel(d.used_pct));
  const worst   = _worstLevel(memLvl, ...diskLevels, cpuLvl);

  const diskRows = (item.disks || []).map(d => {
    const usedDisp = d.used_pct != null ? d.used_pct.toFixed(1) + '%' : 'N/A';
    const lvl = _diskLevel(d.used_pct);
    return `
          <div class="metric-row diff-alert-${lvl}">
            <span class="metric-label">${d.file_system}</span>
            <span class="metric-value">${usedDisp}</span>
          </div>`;
  }).join('');

  const cardClass = worst !== 'ok' ? `instrument-card level-alert-${worst}` : 'instrument-card level-ok';

  return `
      <div class="${cardClass}">
        <div class="card-title">${item.ip}</div>
        <div class="card-name">${item.equipment_name || '--'}</div>
        <div class="metric-row">
          <span class="metric-label">記憶體</span>
          <span class="metric-value diff-alert-${memLvl}">${mem}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">負載 1m</span>
          <span class="metric-value">${load1}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">負載 5m</span>
          <span class="metric-value">${load5}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">負載 15m</span>
          <span class="metric-value">${load15}</span>
        </div>
        ${diskRows}
      </div>`;
}

/**
 * 依科別分組渲染所有統一卡片，寫入 #computers-container
 * @param {Array}   items      ComputerItem 陣列
 * @param {boolean} diskError  DiskStatus 資料庫是否無法連線
 */
function _renderUnifiedGrid(items, diskError) {
  const container = document.getElementById('computers-container');

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="loading">目前無電腦資料</p>';
    return;
  }

  const diskBanner = diskError
    ? '<div class="disk-error-banner">⚠ 磁碟資料庫無法連線，磁碟資訊暫時不可用</div>'
    : '';

  const groups = _groupByDept(items);
  const groupsHtml = _orderedKeys(groups).map(key => {
    const label = DEPT_LABELS[key] || key;
    const cards = groups[key].map(item => _renderUnifiedCard(item)).join('');
    return `<div class="instrument-group">
      <div class="group-header">${label}</div>
      <div class="group-cards">${cards}</div>
    </div>`;
  }).join('');

  container.innerHTML = diskBanner + groupsHtml;
}

// ── 資料刷新 ──────────────────────────────────────────────
async function _refreshData() {
  try {
    const data = await fetchComputerStatus();
    _renderUnifiedGrid(data.items, data.disk_error);
    _clearStatus();
    document.getElementById('last-refreshed').textContent = _formatDatetime(new Date());
  } catch (e) {
    _showStatus(
      e.type === 'db_error' ? '資料庫連線失敗，顯示上次資料' : '資料更新失敗，正在重試…',
      e.type === 'db_error' ? 'error' : 'warning'
    );
  }
}

function _resetRefreshTimer() {
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(_refreshData, REFRESH_INTERVAL_MS);
}

async function _init() {
  _tickClock();
  setInterval(_tickClock, 1000);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    _refreshData();
    _resetRefreshTimer();
  });
  await _refreshData();
  _resetRefreshTimer();
}

document.addEventListener('DOMContentLoaded', _init);
