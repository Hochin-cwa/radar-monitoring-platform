/**
 * history.js — 歷史資料頁面控制器
 *
 * 支援兩種模式（依 URL query string 判斷）：
 *   1. 儀器模式（預設，有 file_type）：
 *      - 繪製 DiffTime 時序折線圖（含三條閾值水平線）
 *      - 繪製同 IP 電腦的 CPU / 記憶體 / 磁碟三張時序圖
 *   2. 電腦模式（mode=computer，或無 file_type 但有 ip）：
 *      - 隱藏 DiffTime 圖
 *      - 繪製 CPU（Load_1）/ 記憶體（MemoryUSE）/ 磁碟（Used）三張時序圖，
 *        記憶體與磁碟圖 Y 軸疊加硬體警戒閾值線
 *      - 以卡片列出該 IP 所有相關儀器即時狀態
 *
 * 支援 6h / 1d / 1w / 1m / 3m 時間範圍切換。
 */

(function () {
  'use strict';

  // ── URL 參數與模式判斷 ────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const FILE_TYPE = params.get('file_type') || '';
  const IP = params.get('ip') || '';
  const EQUIPMENT_NAME = params.get('name') || FILE_TYPE;
  const COMPUTER_MODE = params.get('mode') === 'computer' || (!FILE_TYPE && !!IP);

  // ── 硬體警戒閾值（電腦模式系統圖疊加用） ──────────────────
  // 記憶體：>60% 黃、>70% 橙、>80% 紅
  const MEM_THRESHOLDS = [
    { value: 60, color: '#facc15', label: '黃色 60%' },
    { value: 70, color: '#fb923c', label: '橙色 70%' },
    { value: 80, color: '#ef4444', label: '紅色 80%' },
  ];
  // 磁碟剩餘空間 <10/5/1% → 使用率 >90/95/99%
  const DISK_THRESHOLDS = [
    { value: 90, color: '#facc15', label: '黃色 90%' },
    { value: 95, color: '#fb923c', label: '橙色 95%' },
    { value: 99, color: '#ef4444', label: '紅色 99%' },
  ];

  const DISCONNECT_THRESHOLD_MIN = 14400;

  // ── 頁面標題與表頭 ────────────────────────────────────────
  if (COMPUTER_MODE) {
    const name = EQUIPMENT_NAME || IP;
    document.title = `${name}（${IP}）— 電腦歷史資料`;
    document.getElementById('page-title').textContent = `${name} 電腦歷史資料`;
    document.getElementById('header-ip').textContent = IP || '--';
    // 電腦模式無 FileType，隱藏該欄位
    const ftWrap = document.getElementById('header-filetype-wrap');
    if (ftWrap) ftWrap.style.display = 'none';
    // 返回電腦即時狀況頁
    const back = document.getElementById('back-link');
    if (back) { back.href = '/computers.html'; back.textContent = '← 電腦即時狀況'; }
    // 隱藏 DiffTime 圖，顯示相關儀器區塊
    const diffSection = document.getElementById('diff-section');
    if (diffSection) diffSection.classList.add('hidden');
    const relatedSection = document.getElementById('related-section');
    if (relatedSection) relatedSection.classList.remove('hidden');
  } else {
    document.title = `${EQUIPMENT_NAME}（${IP}）— 歷史資料`;
    document.getElementById('page-title').textContent = `${EQUIPMENT_NAME} 歷史資料`;
    document.getElementById('header-ip').textContent = IP || '--';
    document.getElementById('header-filetype').textContent = FILE_TYPE || '--';
  }

  // ── 狀態 ──────────────────────────────────────────────────
  let _currentRange = '1d';

  // ── Chart 實例 ────────────────────────────────────────────
  let _diffChart = null;
  const _cpuRef = {};
  const _memRef = {};
  const _diskRef = {};

  // ── 共用 Chart.js 時間軸選項 ──────────────────────────────
  function timeScaleOptions() {
    return {
      type: 'time',
      time: { tooltipFormat: 'yyyy-MM-dd HH:mm', displayFormats: { hour: 'MM/dd HH:mm', day: 'MM/dd', week: 'MM/dd', month: 'yyyy/MM' } },
      ticks: { color: '#94a3b8', maxTicksLimit: 8 },
      grid: { color: '#1e2235' },
    };
  }

  function yScaleOptions(label) {
    return {
      title: { display: true, text: label, color: '#94a3b8', font: { size: 11 } },
      ticks: { color: '#94a3b8' },
      grid: { color: '#1e2235' },
    };
  }

  function baseChartOptions(yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d27',
          borderColor: '#2d3148',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#e2e8f0',
        },
      },
      scales: {
        x: timeScaleOptions(),
        y: yScaleOptions(yLabel),
      },
    };
  }

  // ── 水平閾值線 dataset ────────────────────────────────────
  function thresholdDataset(points, value, color, label) {
    if (value == null || points.length === 0) return null;
    const first = points[0].x;
    const last = points[points.length - 1].x;
    return {
      label,
      data: [{ x: first, y: value }, { x: last, y: value }],
      borderColor: color,
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
      order: 1,
    };
  }

  // ── 建立或更新 DiffTime 圖 ────────────────────────────────
  function renderDiffChart(data, thresholdYellow, thresholdOrange, thresholdRed) {
    const noDataEl = document.getElementById('diff-no-data');
    const canvas = document.getElementById('diff-chart');

    if (!data || data.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (_diffChart) { _diffChart.destroy(); _diffChart = null; }
      return;
    }

    noDataEl.classList.add('hidden');
    canvas.style.display = '';

    const points = data.map(d => ({ x: d.time, y: d.diff_time_minutes }));

    const datasets = [
      {
        label: 'DiffTime（分鐘）',
        data: points,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.2,
        order: 0,
      },
    ];

    const yellowDs = thresholdDataset(points, thresholdYellow, '#facc15', `黃色閾值 ${thresholdYellow} 分`);
    const orangeDs = thresholdDataset(points, thresholdOrange, '#fb923c', `橙色閾值 ${thresholdOrange} 分`);
    const redDs = thresholdDataset(points, thresholdRed, '#ef4444', `紅色閾值 ${thresholdRed} 分`);
    if (yellowDs) datasets.push(yellowDs);
    if (orangeDs) datasets.push(orangeDs);
    if (redDs) datasets.push(redDs);

    const options = baseChartOptions('分鐘');
    options.plugins.legend = {
      display: true,
      labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 20 },
    };

    if (_diffChart) {
      _diffChart.data.datasets = datasets;
      _diffChart.update('none');
    } else {
      _diffChart = new Chart(canvas, { type: 'line', data: { datasets }, options });
    }
  }

  // ── 建立或更新系統圖（通用，可選疊加閾值線） ──────────────
  function renderSystemChart(chartRef, canvasId, noDataId, data, valueKey, yLabel, color, thresholds) {
    const noDataEl = document.getElementById(noDataId);
    const canvas = document.getElementById(canvasId);

    if (!data || data.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (chartRef.instance) { chartRef.instance.destroy(); chartRef.instance = null; }
      return;
    }

    noDataEl.classList.add('hidden');
    canvas.style.display = '';

    const points = data.map(d => ({ x: d.time, y: d[valueKey] }));
    const datasets = [{
      label: yLabel,
      data: points,
      borderColor: color,
      backgroundColor: color.replace(')', ', 0.08)').replace('rgb', 'rgba'),
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.2,
      order: 0,
    }];

    const hasThresholds = Array.isArray(thresholds) && thresholds.length > 0;
    if (hasThresholds) {
      for (const t of thresholds) {
        const ds = thresholdDataset(points, t.value, t.color, t.label);
        if (ds) datasets.push(ds);
      }
    }

    const options = baseChartOptions(yLabel);
    if (hasThresholds) {
      options.plugins.legend = {
        display: true,
        labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 16 },
      };
    }

    // 已存在但 dataset 數量改變時重建，避免殘留閾值線
    if (chartRef.instance && chartRef.instance.data.datasets.length === datasets.length) {
      chartRef.instance.data.datasets = datasets;
      chartRef.instance.update('none');
    } else {
      if (chartRef.instance) { chartRef.instance.destroy(); }
      chartRef.instance = new Chart(canvas, { type: 'line', data: { datasets }, options });
    }
  }

  // ── 狀態列 ────────────────────────────────────────────────
  function showError(msg) {
    const bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.className = 'status-bar error';
  }

  function hideError() {
    const bar = document.getElementById('status-bar');
    bar.className = 'status-bar hidden';
  }

  // ── 相關儀器卡片（電腦模式，樣式同儀器即時狀況頁面） ──────
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

  function _makeInstrumentCard(inst) {
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
      statusBadge = isAlert
        ? `<span class="badge-${level}">⚠ 缺資料警示</span>`
        : '<span class="ok-label">✓ 正常</span>';
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

  async function loadRelatedInstruments() {
    const container = document.getElementById('related-container');
    if (!container) return;
    try {
      const data = await fetchCurrentStatus();
      const related = (data.instruments || []).filter(i => (i.ip || '') === IP);
      if (related.length === 0) {
        container.innerHTML = '<p class="loading">此電腦無相關儀器資料</p>';
        return;
      }
      container.innerHTML = related.map(_makeInstrumentCard).join('');
    } catch (err) {
      container.innerHTML = '<p class="loading">無法取得相關儀器資料</p>';
    }
  }

  // ── 載入並渲染圖表 ────────────────────────────────────────
  async function loadAll(range) {
    if (!IP) {
      showError('缺少必要參數（ip）');
      return;
    }
    if (!COMPUTER_MODE && !FILE_TYPE) {
      showError('缺少必要參數（file_type）');
      return;
    }

    hideError();

    try {
      if (COMPUTER_MODE) {
        const sysData = await fetchSystemHistory(IP, range);
        renderSystemChart(_cpuRef, 'cpu-chart', 'cpu-no-data', sysData.cpu, 'load_1', 'Load_1', 'rgb(74,222,128)');
        renderSystemChart(_memRef, 'memory-chart', 'memory-no-data', sysData.memory, 'memory_use', 'MemoryUSE %', 'rgb(251,191,36)', MEM_THRESHOLDS);
        renderSystemChart(_diskRef, 'disk-chart', 'disk-no-data', sysData.disk, 'used', 'Used %', 'rgb(251,146,60)', DISK_THRESHOLDS);
      } else {
        const [instrData, sysData] = await Promise.all([
          fetchInstrumentHistory(FILE_TYPE, IP, range),
          fetchSystemHistory(IP, range),
        ]);

        renderDiffChart(
          instrData.data,
          instrData.threshold_yellow,
          instrData.threshold_orange,
          instrData.threshold_red,
        );

        renderSystemChart(_cpuRef, 'cpu-chart', 'cpu-no-data', sysData.cpu, 'load_1', 'Load_1', 'rgb(74,222,128)');
        renderSystemChart(_memRef, 'memory-chart', 'memory-no-data', sysData.memory, 'memory_use', 'MemoryUSE %', 'rgb(251,191,36)');
        renderSystemChart(_diskRef, 'disk-chart', 'disk-no-data', sysData.disk, 'used', 'Used %', 'rgb(251,146,60)');
      }
    } catch (err) {
      const msg = err.type === 'timeout'
        ? '請求逾時，請稍後再試'
        : err.type === 'db_error'
          ? '資料庫連線失敗'
          : `載入失敗：${err.message}`;
      showError(msg);
    }
  }

  // ── 時間範圍按鈕 ──────────────────────────────────────────
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentRange = btn.dataset.range;
      loadAll(_currentRange);
    });
  });

  // ── 初始載入 ──────────────────────────────────────────────
  loadAll(_currentRange);
  if (COMPUTER_MODE) {
    loadRelatedInstruments();
  }
})();
