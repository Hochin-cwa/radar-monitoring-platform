/**
 * dashboard.js — 首頁儀表板控制器
 * 顯示 Top 5 延遲儀器、Top 5 CPU、Top 5 記憶體、Top 5 磁碟
 * 以水平長條圖風格呈現。
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;

/* ── 色階工具 ── */
function _barColor(pct) {
  // 0~50 綠→黃，50~80 黃→橘，80~100 橘→紅粉
  if (pct <= 50) return `hsl(${120 - pct * 1.2}, 85%, 50%)`;
  if (pct <= 80) return `hsl(${60 - (pct - 50) * 2}, 90%, 50%)`;
  return `hsl(${0 + (100 - pct) * 1.5}, 90%, 65%)`;
}

function _valueColor(pct) {
  if (pct >= 80) return '#ef4444';
  if (pct >= 60) return '#fb923c';
  if (pct >= 40) return '#facc15';
  return '#4ade80';
}

/* ── 產生單條 bar HTML ── */
function _renderBar(label, value, maxValue, unit = '') {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  const color = _barColor(pct);
  const valColor = _valueColor(pct);
  const unitHtml = unit ? `<span class="bar-unit">${unit}</span>` : '';
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="bar-value" style="color:${valColor}">${displayVal}${unitHtml}</div>
    </div>`;
}

/* ── 延遲儀器專用 bar（依閾值等級上色） ── */
function _delayBarColor(diff, inst) {
  const red    = inst.threshold_red    ?? 30;
  const orange = inst.threshold_orange ?? 20;
  const yellow = inst.threshold_yellow ?? 10;
  if (diff > red)    return { bar: '#ef4444', val: '#ef4444' };   // 紅
  if (diff > orange) return { bar: '#fb923c', val: '#fb923c' };   // 橘
  if (diff > yellow) return { bar: '#facc15', val: '#facc15' };   // 黃
  return { bar: '#4ade80', val: '#4ade80' };                       // 綠（不應出現）
}

function _renderDelayBar(label, value, maxValue, inst) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  const colors = _delayBarColor(value, inst);
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}<span class="bar-unit">分鐘</span></div>
    </div>`;
}

/* ── 渲染延遲時間異常儀器（全部） ── */
function _renderDelayAll(instruments) {
  const container = document.getElementById('top-delay');
  if (!instruments || instruments.length === 0) {
    container.innerHTML = '<p class="loading">無資料</p>';
    return;
  }

  // 過濾掉斷線（diff_time_minutes 為 null 或極大值 ≥14400）
  // 只顯示超過 threshold_yellow 的異常儀器
  const abnormal = instruments.filter(i => {
    if (i.diff_time_minutes == null || i.diff_time_minutes >= 14400) return false;
    const threshold = i.threshold_yellow ?? 10;
    return i.diff_time_minutes > threshold;
  });
  const sorted = abnormal.sort((a, b) => b.diff_time_minutes - a.diff_time_minutes);

  if (sorted.length === 0) {
    container.innerHTML = '<p class="loading">所有儀器正常</p>';
    return;
  }

  const maxVal = sorted[0].diff_time_minutes || 1;
  container.innerHTML = sorted.map(inst => {
    const ip = inst.ip || '';
    const fileType = inst.file_type || '--';
    const label = ip ? `${fileType} (${ip})` : fileType;
    return _renderDelayBar(label, inst.diff_time_minutes, maxVal, inst);
  }).join('');
}

/* ── CPU 負載專用 bar（依閾值等級上色） ── */
function _cpuBarColor(computer) {
  // 紅燈：load_15 > 80（連續 15 分鐘 > 80%）
  // 橙燈：load_5 > 80（連續 5 分鐘 > 80%）
  // 黃燈：load_1 > 80（連續 1 分鐘 > 80%）
  const load1  = computer.load_1  ?? 0;
  const load5  = computer.load_5  ?? 0;
  const load15 = computer.load_15 ?? 0;

  if (load15 > 80) return { bar: '#ef4444', val: '#ef4444' };   // 紅
  if (load5 > 80)  return { bar: '#fb923c', val: '#fb923c' };   // 橘
  if (load1 > 80)  return { bar: '#facc15', val: '#facc15' };   // 黃
  return { bar: '#4ade80', val: '#4ade80' };                     // 綠
}

function _renderCpuBar(label, value, maxValue, computer) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  const colors = _cpuBarColor(computer);
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}</div>
    </div>`;
}

/* ── 渲染 CPU Top 5 ── */
function _renderCpuTop5(computers) {
  const container = document.getElementById('top-cpu');
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
    return _renderCpuBar(label, c.load_1, maxVal, c);
  }).join('');
}

/* ── 渲染記憶體 Top 5 ── */
function _renderMemoryTop5(computers) {
  const container = document.getElementById('top-memory');
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
    return _renderBar(label, c.memory_use, 100);
  }).join('');
}

/* ── 渲染磁碟 Top 5 ── */
function _renderDiskTop5(computers) {
  const container = document.getElementById('top-disk');
  if (!computers || computers.length === 0) {
    container.innerHTML = '<p class="loading">無資料</p>';
    return;
  }

  // 攤平所有磁碟項目，取最高使用率
  const diskItems = [];
  for (const c of computers) {
    if (!c.disks || c.disks.length === 0) continue;
    for (const d of c.disks) {
      if (d.used_pct != null) {
        diskItems.push({
          label: `${c.ip} ${d.file_system}`,
          value: d.used_pct,
        });
      }
    }
  }

  const sorted = diskItems.sort((a, b) => b.value - a.value).slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = '<p class="loading">無磁碟資料</p>';
    return;
  }

  container.innerHTML = sorted.map(item => {
    return _renderBar(item.label, item.value, 100);
  }).join('');
}

/* ── 主更新 ── */
async function _refreshDashboard() {
  try {
    const [statusData, computerData] = await Promise.all([
      fetchCurrentStatus(),
      fetchComputerStatus(),
    ]);
    _renderDelayAll(statusData.instruments);
    _renderCpuTop5(computerData.items);
    _renderMemoryTop5(computerData.items);
    _renderDiskTop5(computerData.items);
  } catch (e) {
    // 個別面板的錯誤不阻斷整體
    console.error('[dashboard] refresh error', e);
  }
}

function _init() {
  _refreshDashboard();
  _refreshTimer = setInterval(_refreshDashboard, REFRESH_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', _init);
