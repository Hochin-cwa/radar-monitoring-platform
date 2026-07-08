/**
 * instruments.js — 儀器即時狀況頁面控制器
 * 依 Department 分組顯示儀器警示狀態，無趨勢圖。
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;
let _activeDept = 'all';
let _lastInstruments = null;

const DEPT_LABELS = {
  sos:  '衛星作業科',
  dqcs: '品管科',
  rsa:  '應用科',
  wrs:  '氣象雷達科',
  mrs:  '海象雷達科',
};
const DEPT_ORDER = ['wrs', 'mrs', 'sos', 'dqcs', 'rsa'];

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

const DISCONNECT_THRESHOLD_MIN = 14400;

function _alertClass(diff, inst) {
  if (diff == null || diff > DISCONNECT_THRESHOLD_MIN) return 'disconnected';
  const red    = inst.threshold_red    ?? 20;
  const orange = inst.threshold_orange ?? 15;
  const yellow = inst.threshold_yellow ?? 10;
  if (diff > red)    return 'alert-red';
  if (diff > orange) return 'alert-orange';
  if (diff > yellow) return 'alert-yellow';
  return 'ok';
}

function _makeCard(inst) {
  const diff = inst.diff_time_minutes;
  const level = _alertClass(diff, inst);
  const isDisconnected = level === 'disconnected';
  const isAlert = level !== 'ok' && !isDisconnected;

  let diffDisplay, statusBadge;
  if (isDisconnected) {
    diffDisplay = '<span class="diff-disconnected">斷線</span>';
    statusBadge = '<span class="badge-disconnected">⚠ 斷線</span>';
  } else {
    const diffText = diff != null ? diff.toFixed(1) + ' 分鐘' : 'N/A';
    diffDisplay = `<span class="diff-time diff-${level}">${diffText}</span>`;
    if (isAlert) {
      statusBadge = `<span class="badge-${level}">⚠ 缺資料警示</span>`;
    } else {
      statusBadge = '<span class="ok-label">✓ 正常</span>';
    }
  }

  const triggeredAt = (!isDisconnected && isAlert && inst.latest_file_time)
    ? `<div class="triggered-at">最新資料：${new Date(inst.latest_file_time).toLocaleString('zh-TW')}</div>`
    : '';

  const fileType = inst.file_type || '';
  const ip = inst.ip || '';
  const equipmentName = inst.equipment_name || '';
  const historyUrl = '/history.html?file_type=' + encodeURIComponent(fileType) +
                     '&ip=' + encodeURIComponent(ip) +
                     '&name=' + encodeURIComponent(equipmentName);

  return `
    <div class="instrument-card level-${level}"
         style="cursor:pointer"
         data-file-type="${fileType}"
         data-ip="${ip}"
         data-equipment-name="${equipmentName}"
         onclick="window.open('${historyUrl}', '_blank')">
      <div class="card-meta">${inst.ip || '--'}</div>
      <div class="card-title">${inst.file_type}</div>
      <div class="card-name">${inst.equipment_name || '--'}</div>
      <div style="margin:6px 0">${diffDisplay}</div>
      ${statusBadge}
      ${triggeredAt}
    </div>`;
}

function _isNormal(inst) {
  const diff = inst.diff_time_minutes;
  return diff != null && diff <= (inst.threshold_yellow ?? 10);
}

function _renderInstruments(instruments) {
  if (instruments !== null) {
    _lastInstruments = instruments;
  }
  const source = _lastInstruments;

  const container = document.getElementById('instruments-container');
  if (!source || source.length === 0) {
    container.innerHTML = '<p class="loading">目前無儀器資料</p>';
    return;
  }

  const filtered = _activeDept === 'all'
    ? source
    : source.filter(i => (i.department || '').toLowerCase() === _activeDept);

  if (filtered.length === 0) {
    container.innerHTML = '<p class="loading">此科別目前無儀器資料</p>';
    return;
  }

  const groups = {};
  for (const inst of filtered) {
    const key = (inst.department || '').toLowerCase() || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(inst);
  }

  const orderedKeys = DEPT_ORDER.filter(k => groups[k]);

  container.innerHTML = orderedKeys.map(key => {
    const label = DEPT_LABELS[key] || key;
    const groupInsts = groups[key];
    const total = groupInsts.length;

    const normalInsts   = groupInsts.filter(_isNormal);
    const abnormalInsts = groupInsts.filter(inst => !_isNormal(inst));
    const normalCount   = normalInsts.length;
    const abnormalCount = abnormalInsts.length;

    const abnormalCards = abnormalInsts.map(_makeCard).join('');
    const normalCards   = normalInsts.map(_makeCard).join('');

    const abnormalSection = abnormalCards
      ? `<div class="group-cards">${abnormalCards}</div>`
      : '';

    const normalSummaryId = `normal-cards-${key}`;
    const normalSection = normalCount > 0 ? `
      <div class="normal-cards-collapse" id="${normalSummaryId}">
        ${normalCards}
      </div>` : '';

    return `
      <div class="instrument-group">
        <div class="group-header">
          <span>${label}</span>
          <div class="group-badges">
            <span class="badge-total">${total} 總量</span>
            <span class="badge-normal">${normalCount} 正常</span>
            <span class="badge-abnormal">${abnormalCount} 異常</span>
          </div>
        </div>
        ${abnormalSection}
        ${normalSection}
      </div>`;
  }).join('');

  // 正常卡片預設隱藏，點擊 group-header 的 badges 區域可展開
  container.querySelectorAll('.group-header').forEach(header => {
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const group = header.closest('.instrument-group');
      const collapse = group.querySelector('.normal-cards-collapse');
      if (collapse) {
        const isOpen = collapse.classList.contains('open');
        collapse.classList.toggle('open', !isOpen);
      }
    });
  });
}

async function _refreshData() {
  try {
    const data = await fetchCurrentStatus();
    _renderInstruments(data.instruments);
    _clearStatus();
  } catch (e) {
    _showStatus(
      e.type === 'db_error' ? '資料庫連線失敗，顯示上次資料' : '資料更新失敗，正在重試…',
      e.type === 'db_error' ? 'error' : 'warning'
    );
  }
  document.getElementById('last-refreshed').textContent = _formatDatetime(new Date());
}

function _resetRefreshTimer() {
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(_refreshData, REFRESH_INTERVAL_MS);
}

async function _init() {
  _tickClock();
  setInterval(_tickClock, 1000);

  document.querySelectorAll('.dept-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dept-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeDept = btn.dataset.dept;
      _renderInstruments(null);
    });
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    _refreshData();
    _resetRefreshTimer();
  });
  await _refreshData();
  _resetRefreshTimer();
}

document.addEventListener('DOMContentLoaded', _init);
