/**
 * dashboard.js — 首頁儀表板控制器
 * 顯示 Top 5 延遲儀器、Top 5 CPU、Top 5 記憶體、Top 5 磁碟
 * 以水平長條圖風格呈現。
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;

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
  RCAY: '空軍基地站',
  RCKU: '空軍基地站',
  RCNN: '空軍基地站',
  RCPO: '空軍基地站',
  RCQS: '空軍基地站',
  RCYU: '空軍基地站',
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
 * 從 file_type 提取站碼前綴並回傳中文名稱（若有對應）
 */
function _getStationChinese(fileType) {
  if (!fileType) return '';
  const prefix = fileType.split('_')[0];
  return STATION_NAME_MAP[prefix] || '';
}

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
    const chineseName = _getStationChinese(fileType);
    const label = chineseName
      ? `${chineseName} ${fileType}`
      : (ip ? `${fileType} (${ip})` : fileType);
    return _renderDelayBar(label, inst.diff_time_minutes, maxVal, inst);
  }).join('');
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

  // CPU load 1 通常可能超過 100（多核），取 top 的值當做 max
  const maxVal = Math.max(sorted[0].load_1, 100);
  container.innerHTML = sorted.map(c => {
    const label = c.ip || c.equipment_name || '--';
    return _renderBar(label, c.load_1, maxVal);
  }).join('');
}

/* ── 渲染記憶體 Top 5 ── */
function _memBarColor(memPct) {
  if (memPct > 80) return { bar: '#ef4444', val: '#ef4444' };
  if (memPct > 70) return { bar: '#fb923c', val: '#fb923c' };
  if (memPct > 60) return { bar: '#facc15', val: '#facc15' };
  return { bar: '#4ade80', val: '#4ade80' };
}

function _renderMemBar(label, value, maxValue) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  const colors = _memBarColor(value);
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}</div>
    </div>`;
}

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
    return _renderMemBar(label, c.memory_use, 100);
  }).join('');
}

/* ── 渲染磁碟 Top 5 ── */
function _diskBarColor(usedPct) {
  // 剩餘空間 = 100 - usedPct
  // < 1% 剩餘 (used > 99%) → 紅
  // < 5% 剩餘 (used > 95%) → 橘
  // < 10% 剩餘 (used > 90%) → 黃
  // 其餘 → 綠
  if (usedPct > 99) return { bar: '#ef4444', val: '#ef4444' };
  if (usedPct > 95) return { bar: '#fb923c', val: '#fb923c' };
  if (usedPct > 90) return { bar: '#facc15', val: '#facc15' };
  return { bar: '#4ade80', val: '#4ade80' };
}

function _renderDiskBar(label, value, maxValue) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const displayVal = typeof value === 'number' ? value.toFixed(1) : '--';
  const colors = _diskBarColor(value);
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${colors.bar}"></div>
      </div>
      <div class="bar-value" style="color:${colors.val}">${displayVal}</div>
    </div>`;
}

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
    return _renderDiskBar(item.label, item.value, 100);
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
