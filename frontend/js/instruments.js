/**
 * instruments.js — 儀器即時狀況頁面控制器
 * 依 Department 分組顯示儀器警示狀態，無趨勢圖。
 */

const REFRESH_INTERVAL_MS = 60_000;
let _refreshTimer = null;
let _activeDept = 'all';
let _activeInstrument = 'all';
let _lastInstruments = null;

// DEPT_LABELS / DEPT_ORDER / STATION_NAME_MAP 統一由 /js/labels.js 提供。

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

/**
 * 解析 file_type 對應的站碼 key（即 STATION_NAME_MAP 的 key）。
 * 先以完整 file_type 匹配，再以 _ 前綴匹配；查無回傳空字串。
 */
function _getStationKey(fileType) {
  if (!fileType) return '';
  if (STATION_NAME_MAP[fileType]) return fileType;        // 完整匹配
  const prefix = fileType.split('_')[0];                  // 前綴匹配
  return STATION_NAME_MAP[prefix] ? prefix : '';
}

/** 判斷儀器是否屬於指定站碼 key。 */
function _matchesInstrument(inst, stationKey) {
  return _getStationKey(inst.file_type || '') === stationKey;
}

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

function _makeCard(inst, opts = {}) {
  const allDown = opts.allDown === true;
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

  // 「全部中斷」模式：隱藏 FileType 與 IP，改顯示中文字樣
  const detailRows = allDown
    ? `<div class="card-meta card-alldown">全部中斷</div>`
    : `<div class="card-title">${fileType || '--'}</div>
          <div class="card-meta">${ip || '--'}</div>`;

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
          ${detailRows}
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
 * 群組內中文站名的合併 key；無對應中文名稱者以 file_type + ip 作為唯一 key。
 */
function _stationGroupKey(inst) {
  const chineseName = _getStationChinese(inst.file_type || '');
  return chineseName || `${inst.file_type || ''}_${inst.ip || ''}`;
}

/**
 * 依「科別群組內」統計，產生異常區要顯示的卡片 HTML。
 *
 * 規則：
 *   以中文站名（無中文名者以 file_type+ip）為單位，統計同群組內：
 *     - 正常數 = 0 且 異常數 > 0（離線數不計）→ 視為「全部中斷」，
 *       合併成一張卡片（取延遲最大者），且隱藏 FileType / IP，顯示「全部中斷」。
 *     - 否則（該站名有 ≥1 筆正常）→ 異常儀器各自照常顯示。
 *   最終依延遲時間由大到小排序。
 *
 * @param {Array} groupInsts 該科別群組內的全部儀器（含正常/異常/離線）
 * @returns {{html:string, count:number}} 異常區卡片 HTML 與卡片數量
 */
function _buildAbnormalCards(groupInsts) {
  // 依站名 key 統計每一站的正常/異常清單
  const stats = new Map(); // key -> { normal:number, abnormal: inst[] }
  for (const inst of groupInsts) {
    const key = _stationGroupKey(inst);
    if (!stats.has(key)) stats.set(key, { normal: 0, abnormal: [] });
    const s = stats.get(key);
    if (_isNormal(inst)) s.normal += 1;
    else if (_isAbnormal(inst)) s.abnormal.push(inst);
    // 離線不計
  }

  // 組出要顯示的卡片項目（inst + 是否為全部中斷）
  const items = []; // { inst, allDown, diff }
  for (const { normal, abnormal } of stats.values()) {
    if (abnormal.length === 0) continue; // 此站無異常，不進異常區

    if (normal === 0) {
      // 全部中斷：合併為延遲最大的一筆
      const top = abnormal.reduce(
        (a, b) => ((b.diff_time_minutes ?? 0) > (a.diff_time_minutes ?? 0) ? b : a)
      );
      items.push({ inst: top, allDown: true, diff: top.diff_time_minutes ?? 0 });
    } else {
      // 非全部異常：異常儀器各自顯示
      for (const inst of abnormal) {
        items.push({ inst, allDown: false, diff: inst.diff_time_minutes ?? 0 });
      }
    }
  }

  items.sort((a, b) => b.diff - a.diff);
  return {
    html: items.map(it => _makeCard(it.inst, { allDown: it.allDown })).join(''),
    count: items.length,
  };
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

  // 科別篩選
  let filtered = _activeDept === 'all'
    ? filtered_source
    : filtered_source.filter(i => (i.department || '').toLowerCase() === _activeDept.toLowerCase());

  // 儀器篩選：選到特定儀器時，只保留 file_type 對應該站碼者
  if (_activeInstrument !== 'all') {
    filtered = filtered.filter(i => _matchesInstrument(i, _activeInstrument));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="loading">此條件目前無儀器資料</p>';
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
    const disconnectedInsts = groupInsts.filter(_isDisconnected);

    // 異常區：群組內同中文站名「全部中斷」時合併為一筆（取延遲最大者），
    // 否則異常儀器各自顯示。詳見 _buildAbnormalCards。
    const abnormal          = _buildAbnormalCards(groupInsts);

    const normalCount       = normalInsts.length;
    const abnormalCount     = abnormal.count;
    const disconnectedCount = disconnectedInsts.length;

    const allCards          = groupInsts.map(_makeCard).join('');
    const normalCards       = normalInsts.map(_makeCard).join('');
    const abnormalCards     = abnormal.html;
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

/**
 * 依 labels.js 的 INSTRUMENT_CATEGORIES 產生「可展開分類」的儀器篩選。
 * 第一顆為「全部」；其下為各分類（氣象雷達 / 海象雷達 / 氣象衛星 /
 * 剖風儀 / 其他），點選分類標題展開/收合，分類下列出各站台按鈕。
 */
function _buildInstrumentFilter() {
  const container = document.getElementById('instrument-filter');
  if (!container) return;

  // 已被明確歸類的站碼
  const categorized = new Set();
  for (const cat of INSTRUMENT_CATEGORIES) {
    for (const s of cat.stations) categorized.add(s);
  }
  // 未歸類者 → 其他
  const otherStations = Object.keys(STATION_NAME_MAP).filter(k => !categorized.has(k));

  const categories = [...INSTRUMENT_CATEGORIES];
  if (otherStations.length > 0) {
    categories.push({ key: 'other', label: '其他', stations: otherStations });
  }

  let html = '<button class="inst-btn inst-all active" data-inst="all">全部</button>';

  for (const cat of categories) {
    // 只列出實際存在於 STATION_NAME_MAP 的站碼
    const stations = cat.stations.filter(s => STATION_NAME_MAP[s]);
    if (stations.length === 0) continue;

    html += `
      <div class="inst-cat" data-cat="${cat.key}">
        <button class="inst-cat-header" data-cat-toggle="${cat.key}">
          <span class="inst-cat-arrow">▸</span>
          <span class="inst-cat-label">${cat.label}</span>
        </button>
        <div class="inst-cat-body" style="display:none">
          ${stations.map(s =>
            `<button class="inst-btn" data-inst="${s}">${STATION_NAME_MAP[s]}</button>`
          ).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // 分類標題：展開 / 收合
  container.querySelectorAll('.inst-cat-header').forEach(header => {
    header.addEventListener('click', () => {
      const cat = header.closest('.inst-cat');
      const body = cat.querySelector('.inst-cat-body');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      header.classList.toggle('expanded', !open);
    });
  });

  // 站台按鈕 + 全部：設定目前篩選
  container.querySelectorAll('.inst-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.inst-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeInstrument = btn.dataset.inst;
      _renderInstruments(null);
    });
  });
}

/**
 * 讀取 URL 查詢參數，套用初始篩選並同步左側導覽列 UI。
 * 支援：
 *   ?inst=<站碼>   指定「儀器篩選」到特定站台（如 RCWF、RCMD）；
 *                  會自動展開該站台所屬分類並標記為 active。
 *   ?dept=<科別>   指定「科別篩選」到特定科別（如 mrs、sos）。
 * 由首頁（mainpage.js）卡片點擊時帶入。
 */
function _applyUrlFilter() {
  const params = new URLSearchParams(window.location.search);
  const inst = params.get('inst');
  const dept = params.get('dept');

  // 科別篩選同步
  if (dept) {
    const deptKey = dept.toLowerCase();
    const deptBtn = document.querySelector(`.dept-btn[data-dept="${deptKey}"]`);
    if (deptBtn) {
      document.querySelectorAll('.dept-btn').forEach(b => b.classList.remove('active'));
      deptBtn.classList.add('active');
      _activeDept = deptKey;
    }
  }

  // 儀器（站台）篩選同步
  if (inst && STATION_NAME_MAP[inst]) {
    const filterContainer = document.getElementById('instrument-filter');
    if (filterContainer) {
      const instBtn = filterContainer.querySelector(`.inst-btn[data-inst="${inst}"]`);
      if (instBtn) {
        filterContainer.querySelectorAll('.inst-btn').forEach(b => b.classList.remove('active'));
        instBtn.classList.add('active');
        _activeInstrument = inst;

        // 展開該站台所屬分類
        const cat = instBtn.closest('.inst-cat');
        if (cat) {
          const body = cat.querySelector('.inst-cat-body');
          const header = cat.querySelector('.inst-cat-header');
          if (body) body.style.display = '';
          if (header) header.classList.add('expanded');
        }
      }
    }
  }
}

async function _init() {
  _tickClock();
  setInterval(_tickClock, 1000);

  _buildInstrumentFilter();
  _applyUrlFilter();

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
