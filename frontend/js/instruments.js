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

/* ── 站碼→中文名稱對照表 ── */
const STATION_NAME_MAP = {
  // 雷達站
  RCHL: '花蓮',
  RCKT: '七股',
  RCLY: '林園',
  RCSL: '五分山',
  RCNT: '南屯',
  RCCK: '清泉崗（空軍）',
  RCGR: '桃園（空軍）',
  RCCG: '成功（空軍）',
  RCWF: '五分山（另）',
  RCMD: '墾丁（radman）',
  // 空軍基地站
  RCAY: '岡山（空軍）',
  RCKU: '嘉義（空軍）',
  RCNN: '台南（空軍）',
  RCPO: '新竹（空軍）',
  RCQS: '台東（空軍）',
  RCYU: '花蓮（空軍）',
  // 剖風儀雷達站
  RCCL: '剖風儀 CL',
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
  GK2A: '千里眼2A',
};

/**
 * 從 file_type 提取站碼並回傳中文名稱（若有對應）
 * 優先以完整 file_type 匹配，再以 _ 前綴匹配
 */
function _getStationChinese(fileType) {
  if (!fileType) return '';
  // 完整匹配（如 HFradar_dt00）
  if (STATION_NAME_MAP[fileType]) return STATION_NAME_MAP[fileType];
  // 前綴匹配（如 RCNT_rb5 → RCNT）
  const prefix = fileType.split('_')[0];
  return STATION_NAME_MAP[prefix] || '';
}

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

  // 延遲時間文字
  let diffText;
  if (isDisconnected) {
    diffText = '斷線';
  } else {
    diffText = diff != null ? diff.toFixed(1) + ' 分鐘' : 'N/A';
  }

  const fileType = inst.file_type || '';
  const ip = inst.ip || '';
  const equipmentName = inst.equipment_name || '';
  const chineseName = _getStationChinese(fileType);

  const historyUrl = '/history.html?file_type=' + encodeURIComponent(fileType) +
    '&ip=' + encodeURIComponent(ip) +
    '&name=' + encodeURIComponent(equipmentName);

  // 中文站名（若有對應）
  const displayName = chineseName || (equipmentName || '--');

  return `
    <div class="instrument-card level-${level}"
         style="cursor:pointer"
         data-file-type="${fileType}"
         data-ip="${ip}"
         data-equipment-name="${equipmentName}"
         onclick="window.location.href='${historyUrl}'">
      <div class="light-card-row">
        <span class="status-light status-light-${level}"></span>
        <div class="light-card-body">
          <div class="card-station">${displayName}</div>
          <div class="card-title">${fileType || '--'}</div>
          <div class="light-card-diff diff-${level}">${diffText}</div>
        </div>
      </div>
    </div>`;
}

function _isNormal(inst) {
  const diff = inst.diff_time_minutes;
  return diff != null && diff <= (inst.threshold_yellow ?? 10) && diff <= DISCONNECT_THRESHOLD_MIN;
}

function _isDisconnected(inst) {
  const diff = inst.diff_time_minutes;
  return diff == null || diff > DISCONNECT_THRESHOLD_MIN;
}

function _isAbnormal(inst) {
  return !_isNormal(inst) && !_isDisconnected(inst);
}

/**
 * 相同中文名稱的異常儀器只保留延遲時間最大的一筆。
 * 無對應中文名稱者以 file_type + ip 作為唯一 key，不會被合併。
 */
function _dedupeByChineseName(instruments) {
  const sorted = [...instruments].sort(
    (a, b) => (b.diff_time_minutes ?? 0) - (a.diff_time_minutes ?? 0)
  );
  const seen = new Set();
  const result = [];
  for (const inst of sorted) {
    const chineseName = _getStationChinese(inst.file_type || '');
    const key = chineseName || `${inst.file_type || ''}_${inst.ip || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(inst);
    }
  }
  return result;
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

  // 過濾掉 Server Room（環境監控）的儀器，已移至獨立頁面
  const filtered_source = source.filter(i => (i.department || '').toLowerCase() !== 'server room');

  const filtered = _activeDept === 'all'
    ? filtered_source
    : filtered_source.filter(i => (i.department || '').toLowerCase() === _activeDept.toLowerCase());

  if (filtered.length === 0) {
    container.innerHTML = '<p class="loading">此科別目前無儀器資料</p>';
    return;
  }

  const groups = {};
  for (const inst of filtered) {
    const key = inst.department || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(inst);
  }

  const orderedKeys = DEPT_ORDER.filter(k => groups[k]);

  container.innerHTML = orderedKeys.map(key => {
    const label = DEPT_LABELS[key] || key;
    const groupInsts = groups[key];
    const total = groupInsts.length;

    const normalInsts       = groupInsts.filter(_isNormal);
    const abnormalInstsRaw  = groupInsts.filter(_isAbnormal);
    const disconnectedInsts = groupInsts.filter(_isDisconnected);

    // 異常儀器：相同中文名稱只保留延遲最大的一筆
    const abnormalInsts     = _dedupeByChineseName(abnormalInstsRaw);

    const normalCount       = normalInsts.length;
    const abnormalCount     = abnormalInsts.length;
    const disconnectedCount = disconnectedInsts.length;

    const allCards          = groupInsts.map(_makeCard).join('');
    const normalCards       = normalInsts.map(_makeCard).join('');
    const abnormalCards     = abnormalInsts.map(_makeCard).join('');
    const disconnectedCards = disconnectedInsts.map(_makeCard).join('');

    return `
      <div class="instrument-group" data-dept-key="${key}">
        <div class="group-header">
          <span>${label}</span>
          <div class="group-badges">
            <button class="badge-btn badge-total" data-filter="all" data-group="${key}">${total} 總量</button>
            <button class="badge-btn badge-normal" data-filter="normal" data-group="${key}">${normalCount} 正常</button>
            <button class="badge-btn badge-abnormal active" data-filter="abnormal" data-group="${key}">${abnormalCount} 異常</button>
            <button class="badge-btn badge-disconnected-btn" data-filter="disconnected" data-group="${key}">${disconnectedCount} 離線</button>
          </div>
        </div>
        <div class="group-cards-container">
          <div class="group-cards filter-all" style="display:none">${allCards || '<p class="loading">無資料</p>'}</div>
          <div class="group-cards filter-normal" style="display:none">${normalCards || '<p class="loading">無正常儀器</p>'}</div>
          <div class="group-cards filter-abnormal">${abnormalCards || '<p class="loading">無異常儀器</p>'}</div>
          <div class="group-cards filter-disconnected" style="display:none">${disconnectedCards || '<p class="loading">無離線儀器</p>'}</div>
        </div>
      </div>`;
  }).join('');

  // Wire up badge filter buttons
  container.querySelectorAll('.badge-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupKey = btn.dataset.group;
      const filter = btn.dataset.filter;
      const group = container.querySelector(`.instrument-group[data-dept-key="${groupKey}"]`);
      if (!group) return;

      // Update active badge
      group.querySelectorAll('.badge-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide card sections
      group.querySelectorAll('.group-cards').forEach(section => {
        section.style.display = 'none';
      });
      const target = group.querySelector(`.filter-${filter}`);
      if (target) target.style.display = '';
    });
  });
}

/* ── 電腦資源 TOP 5 面板（CPU / 記憶體 / 磁碟）── */

/* 產生單條 bar HTML */
function _renderBar(label, value, maxValue, colors) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}</div>
    </div>`;
}

/* CPU 色階（load 值，非百分比，統一綠色系呈現長度） */
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

async function _refreshComputerPanels() {
  try {
    const computerData = await fetchComputerStatus();
    _renderCpuTop5(computerData.items);
    _renderMemoryTop5(computerData.items);
    _renderDiskTop5(computerData.items);
  } catch (e) {
    console.error('[instruments] computer panels refresh error', e);
  }
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
  await _refreshComputerPanels();
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
