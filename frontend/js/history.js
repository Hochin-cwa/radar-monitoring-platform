/**
 * history.js — 儀器歷史資料頁面控制器
 * 讀取 URL query string: file_type, ip, name
 * 繪製 DiffTime 時序折線圖（含三條閾值水平線）
 * 繪製 CPU / 記憶體 / 磁碟三張時序圖
 * 支援 6h / 1d / 1w / 1m / 3m 時間範圍切換
 */

(function () {
  'use strict';

  // ── URL 參數 ──────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const FILE_TYPE = params.get('file_type') || '';
  const IP = params.get('ip') || '';
  const EQUIPMENT_NAME = params.get('name') || FILE_TYPE;

  // ── 頁面標題 ──────────────────────────────────────────────
  document.title = `${EQUIPMENT_NAME}（${IP}）— 歷史資料`;
  document.getElementById('page-title').textContent = `${EQUIPMENT_NAME} 歷史資料`;
  document.getElementById('header-ip').textContent = IP || '--';
  document.getElementById('header-filetype').textContent = FILE_TYPE || '--';

  // ── 狀態 ──────────────────────────────────────────────────
  let _currentRange = '6h';

  // ── Chart 實例 ────────────────────────────────────────────
  let _diffChart = null;

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
      normalized: true,
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

    // 同一個 FileTime（x 軸時間）有多筆 DiffTime（同一次掃描的多個檔案），
    // 取平均值後只畫一個點，避免垂直散布。
    const rawPoints = data
      .map(d => ({ x: new Date(d.time).getTime(), y: d.diff_time_minutes }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    // 依 x（epoch ms）分組取平均
    const grouped = {};
    for (const p of rawPoints) {
      if (!grouped[p.x]) grouped[p.x] = { sum: 0, count: 0 };
      grouped[p.x].sum += p.y;
      grouped[p.x].count += 1;
    }
    const points = Object.keys(grouped)
      .map(x => ({ x: Number(x), y: grouped[x].sum / grouped[x].count }))
      .sort((a, b) => a.x - b.x);

    if (points.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (_diffChart) { _diffChart.destroy(); _diffChart = null; }
      return;
    }

    const tYellow = thresholdYellow != null ? thresholdYellow : null;
    const tOrange = thresholdOrange != null ? thresholdOrange : null;
    const tRed = thresholdRed != null ? thresholdRed : null;

    // y 軸改為固定範圍：從 0 起算，上界必須同時容納資料最大值與三個閾值，
    // 並額外保留 10% 邊界，讓最高的閾值線（通常是紅色）不會貼齊上緣。
    // 資料量可能上萬筆，用迴圈而非 Math.max(...arr) 避免超出參數上限。
    let dataMax = points[0].y;
    for (const p of points) {
      if (p.y > dataMax) dataMax = p.y;
    }
    const thresholdMax = Math.max(
      tYellow != null ? tYellow : 0,
      tOrange != null ? tOrange : 0,
      tRed != null ? tRed : 0,
    );
    // 固定 y 軸下界為 0，上界取「資料最大值」與「最大閾值」中較大者再加 10% 邊界，
    // 並設一個最小高度（至少 1 分）避免資料與閾值都極小時圖形被壓扁。
    const axisMin = 0;
    const axisMax = Math.max(dataMax, thresholdMax, 1) * 1.1;

    // 閾值水平線：以 borderDash 虛線 dataset 實作。
    // 固定範圍已保證三個閾值都落在 y 軸內，因此一律畫出，圖例與線條一致。
    function thresholdDataset(value, color, label) {
      if (value == null) return null;
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

    const datasets = [
      {
        label: 'DiffTime（分鐘）',
        data: points,
        borderColor: '#38bdf8',
        backgroundColor: '#38bdf8',
        borderWidth: 1,
        // 每筆數值都畫出點；同一時間多筆時才看得出分布
        pointRadius: 2,
        pointHoverRadius: 4,
        pointBackgroundColor: '#38bdf8',
        fill: false,
        // 同一個 x 有多筆，平滑曲線會產生假造的擺盪，關閉
        tension: 0,
        order: 0,
      },
    ];

    const yellowDs = thresholdDataset(tYellow, '#facc15', `黃色閾值 ${tYellow} 分`);
    const orangeDs = thresholdDataset(tOrange, '#fb923c', `橙色閾值 ${tOrange} 分`);
    const redDs = thresholdDataset(tRed, '#ef4444', `紅色閾值 ${tRed} 分`);
    if (yellowDs) datasets.push(yellowDs);
    if (orangeDs) datasets.push(orangeDs);
    if (redDs) datasets.push(redDs);

    const options = baseChartOptions('分鐘');
    options.plugins.legend = {
      display: true,
      labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 20 },
    };
    options.plugins.tooltip.callbacks = {
      label: ctx => `${ctx.dataset.label}：${Number(ctx.parsed.y).toFixed(3)} 分`,
    };
    options.scales.x.time.tooltipFormat = 'yyyy-MM-dd HH:mm:ss';
    // 固定 y 軸範圍
    options.scales.y.min = axisMin;
    options.scales.y.max = axisMax;
    // 提供給 threshold 標籤外掛使用的閾值資訊
    options._thresholds = [
      { value: tYellow, color: '#facc15', text: `黃 ${tYellow != null ? tYellow : '--'} 分` },
      { value: tOrange, color: '#fb923c', text: `橙 ${tOrange != null ? tOrange : '--'} 分` },
      { value: tRed, color: '#ef4444', text: `紅 ${tRed != null ? tRed : '--'} 分` },
    ];

    if (_diffChart) {
      _diffChart.data.datasets = datasets;
      _diffChart.options = options;
      _diffChart.update('none');
    } else {
      _diffChart = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options,
        plugins: [_thresholdLabelPlugin],
      });
    }
  }

  // ── 閾值數值標籤外掛 ──────────────────────────────────────
  // 直接在每條閾值虛線的右端（繪圖區內）標示該閾值數值，
  // 讓使用者不必看圖例就能在圖上讀到三個閾值。
  const _thresholdLabelPlugin = {
    id: 'thresholdLabels',
    afterDatasetsDraw(chart) {
      const thresholds = chart.options && chart.options._thresholds;
      if (!thresholds) return;
      const yScale = chart.scales.y;
      const area = chart.chartArea;
      if (!yScale || !area) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      for (const t of thresholds) {
        if (t.value == null) continue;
        const y = yScale.getPixelForValue(t.value);
        if (y < area.top || y > area.bottom) continue;
        ctx.fillStyle = t.color;
        // 標籤貼在虛線上方、繪圖區右內側，避免蓋住線條
        ctx.fillText(t.text, area.right - 6, y - 2);
      }
      ctx.restore();
    },
  };

  // ── 建立或更新系統圖（通用） ──────────────────────────────
  // chartInstances stores { canvasId: Chart instance }
  const _chartInstances = {};

  function renderSingleChart(canvasId, noDataId, data, valueKey, yLabel, color) {
    const noDataEl = document.getElementById(noDataId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !noDataEl) return;

    // Ensure data is an array
    const arr = Array.isArray(data) ? data : [];
    const points = arr
      .map(d => ({ x: new Date(d.time).getTime(), y: d[valueKey] }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);

    if (points.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (_chartInstances[canvasId]) { _chartInstances[canvasId].destroy(); delete _chartInstances[canvasId]; }
      return;
    }

    noDataEl.classList.add('hidden');
    canvas.style.display = '';

    const dataset = {
      label: yLabel,
      data: points,
      borderColor: color,
      backgroundColor: color.replace(')', ', 0.08)').replace('rgb', 'rgba'),
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.2,
    };

    if (_chartInstances[canvasId]) {
      _chartInstances[canvasId].data.datasets[0].data = points;
      _chartInstances[canvasId].update('none');
    } else {
      _chartInstances[canvasId] = new Chart(canvas, {
        type: 'line',
        data: { datasets: [dataset] },
        options: baseChartOptions(yLabel),
      });
    }
  }

  /**
   * Dynamically build system chart cards and render charts.
   * API: GET /api/v1/history/system?ip=...&range=...
   * Response format:
   *   cpu:    [{time, load_1, load_5, load_15}]
   *   memory: [{time, memory_use}]
   *   disk:   [{time, file_system, used}]
   *
   * CPU/Memory data comes from SystemStatus DB (Status table).
   * Disk data comes from DiskStatus DB (Status table).
   */
  function renderSystemCharts(sysData) {
    const cpuMemGrid = document.getElementById('cpu-memory-charts-grid');
    const diskGrid = document.getElementById('disk-charts-grid');

    // Destroy existing chart instances before rebuilding DOM
    Object.keys(_chartInstances).forEach(id => {
      _chartInstances[id].destroy();
      delete _chartInstances[id];
    });

    // ── CPU + Memory cards ──
    const cpuMemCards = [];

    const cpuConfigs = [
      { key: 'load_1', label: 'CPU 負載 1m（Load_1）', color: 'rgb(74,222,128)' },
      { key: 'load_5', label: 'CPU 負載 5m（Load_5）', color: 'rgb(52,211,153)' },
      { key: 'load_15', label: 'CPU 負載 15m（Load_15）', color: 'rgb(16,185,129)' },
    ];

    // cpu 是一個扁平陣列，每筆同時含 load_1 / load_5 / load_15
    const cpuData = Array.isArray(sysData.cpu) ? sysData.cpu : [];
    for (const cfg of cpuConfigs) {
      const canvasId = `chart-cpu-${cfg.key}`;
      const noDataId = `nodata-cpu-${cfg.key}`;
      cpuMemCards.push({
        title: cfg.label,
        canvasId,
        noDataId,
        data: cpuData,
        valueKey: cfg.key,
        yLabel: cfg.key,
        color: cfg.color,
      });
    }

    // Memory card
    const memData = Array.isArray(sysData.memory) ? sysData.memory : [];
    cpuMemCards.push({
      title: '記憶體使用率（MemoryUSE %）',
      canvasId: 'chart-memory',
      noDataId: 'nodata-memory',
      data: memData,
      valueKey: 'memory_use',
      yLabel: 'MemoryUSE %',
      color: 'rgb(251,191,36)',
    });

    if (cpuMemGrid) {
      cpuMemGrid.innerHTML = cpuMemCards.map(c => `
        <div class="system-chart-card">
          <h3>${c.title}</h3>
          <div class="system-chart-wrapper">
            <canvas id="${c.canvasId}"></canvas>
            <div id="${c.noDataId}" class="no-data hidden">此時間範圍內無資料</div>
          </div>
        </div>
      `).join('');

      for (const c of cpuMemCards) {
        renderSingleChart(c.canvasId, c.noDataId, c.data, c.valueKey, c.yLabel, c.color);
      }
    }

    // ── Disk cards ──
    // disk 是扁平陣列 [{time, file_system, used}]，在前端依掛載點分組
    const diskCards = [];
    const diskDataObj = {};
    for (const d of (Array.isArray(sysData.disk) ? sysData.disk : [])) {
      const fs = d.file_system || '(unknown)';
      (diskDataObj[fs] = diskDataObj[fs] || []).push({ time: d.time, used: d.used });
    }
    const diskPaths = Object.keys(diskDataObj).sort();

    for (const fsPath of diskPaths) {
      const safeId = fsPath.replace(/[^a-zA-Z0-9]/g, '_');
      const canvasId = `chart-disk-${safeId}`;
      const noDataId = `nodata-disk-${safeId}`;
      diskCards.push({
        title: `磁碟 ${fsPath}（Used %）`,
        canvasId,
        noDataId,
        data: diskDataObj[fsPath],
        valueKey: 'used',
        yLabel: 'Used %',
        color: 'rgb(251,146,60)',
      });
    }

    if (diskPaths.length === 0) {
      diskCards.push({
        title: '磁碟使用率',
        canvasId: 'chart-disk-empty',
        noDataId: 'nodata-disk-empty',
        data: [],
        valueKey: 'used',
        yLabel: 'Used %',
        color: 'rgb(251,146,60)',
      });
    }

    if (diskGrid) {
      diskGrid.innerHTML = diskCards.map(c => `
        <div class="system-chart-card">
          <h3>${c.title}</h3>
          <div class="system-chart-wrapper">
            <canvas id="${c.canvasId}"></canvas>
            <div id="${c.noDataId}" class="no-data hidden">此時間範圍內無資料</div>
          </div>
        </div>
      `).join('');

      for (const c of diskCards) {
        renderSingleChart(c.canvasId, c.noDataId, c.data, c.valueKey, c.yLabel, c.color);
      }
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

  // ── 載入並渲染所有圖表 ────────────────────────────────────

  async function loadAll(range) {
    if (!FILE_TYPE || !IP) {
      showError('缺少必要參數（file_type 或 ip）');
      return;
    }

    hideError();

    try {
      // First fetch instrument history — backend may resolve to actual IP
      const instrData = await fetchInstrumentHistory(FILE_TYPE, IP, range);

      renderDiffChart(
        instrData.data,
        instrData.threshold_yellow,
        instrData.threshold_orange,
        instrData.threshold_red,
      );

      // Use the actual IP returned by instrument history for system queries
      const actualIp = instrData.ip || IP;

      // Fetch system history with actual IP; also try URL IP if different
      let sysData = await fetchSystemHistory(actualIp, range);

      // If system data is empty and actualIp differs from URL IP, try URL IP
      const hasCpuData = Array.isArray(sysData.cpu) && sysData.cpu.length > 0;
      if (!hasCpuData && actualIp !== IP) {
        sysData = await fetchSystemHistory(IP, range);
      }

      renderSystemCharts(sysData);
    } catch (err) {
      const msg = err.type === 'timeout'
        ? '請求逾時，請稍後再試'
        : err.type === 'db_error'
          ? '資料庫連線失敗'
          : `載入失敗：${err.message}`;
      showError(msg);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ═══ MODE DETECTION ═══
  // ══════════════════════════════════════════════════════════
  const MODE = params.get('mode') || 'instrument';

  if (MODE === 'computer') {
    // ── Computer mode: three-column layout ──────────────────
    document.getElementById('instrument-mode').style.display = 'none';
    document.getElementById('computer-mode').style.display = '';
    document.getElementById('global-range-nav').style.display = 'flex';

    // 顯示全域導覽列頁首，隱藏舊版頁首
    document.getElementById('site-header').style.display = '';
    document.getElementById('legacy-header').style.display = 'none';
    document.body.classList.add('layout');
    document.getElementById('header-ip-site').textContent = IP || '--';
    document.getElementById('header-name-site').textContent = EQUIPMENT_NAME || '--';

    document.title = `${EQUIPMENT_NAME}（${IP}）— 電腦歷史資料`;

    const _compChartInstances = {};

    function compRenderSingleChart(canvasId, noDataId, data, valueKey, yLabel, color) {
      const noDataEl = document.getElementById(noDataId);
      const canvas = document.getElementById(canvasId);
      if (!canvas || !noDataEl) return;

      const arr = Array.isArray(data) ? data : [];
      const points = arr
        .map(d => ({ x: new Date(d.time).getTime(), y: d[valueKey] }))
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x);

      if (points.length === 0) {
        noDataEl.classList.remove('hidden');
        canvas.style.display = 'none';
        if (_compChartInstances[canvasId]) { _compChartInstances[canvasId].destroy(); delete _compChartInstances[canvasId]; }
        return;
      }

      noDataEl.classList.add('hidden');
      canvas.style.display = '';

      const dataset = {
        label: yLabel,
        data: points,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      };

      const options = baseChartOptions(yLabel);

      if (_compChartInstances[canvasId]) {
        _compChartInstances[canvasId].data.datasets = [dataset];
        _compChartInstances[canvasId].options = options;
        _compChartInstances[canvasId].update('none');
      } else {
        _compChartInstances[canvasId] = new Chart(canvas, {
          type: 'line',
          data: { datasets: [dataset] },
          options,
        });
      }
    }

    function compRenderSystemCharts(sysData) {
      const cpuMemGrid = document.getElementById('computer-cpu-memory-grid');
      const diskGrid = document.getElementById('computer-disk-grid');

      Object.keys(_compChartInstances).forEach(id => {
        _compChartInstances[id].destroy();
        delete _compChartInstances[id];
      });

      // CPU + Memory
      const cpuMemCards = [];
      const cpuConfigs = [
        { key: 'load_1', label: 'CPU 負載 1m（Load_1）', color: 'rgb(74,222,128)' },
        { key: 'load_5', label: 'CPU 負載 5m（Load_5）', color: 'rgb(52,211,153)' },
        { key: 'load_15', label: 'CPU 負載 15m（Load_15）', color: 'rgb(16,185,129)' },
      ];
      const cpuData = Array.isArray(sysData.cpu) ? sysData.cpu : [];
      for (const cfg of cpuConfigs) {
        const canvasId = `comp-chart-cpu-${cfg.key}`;
        const noDataId = `comp-nodata-cpu-${cfg.key}`;
        cpuMemCards.push({ title: cfg.label, canvasId, noDataId, data: cpuData, valueKey: cfg.key, yLabel: cfg.key, color: cfg.color });
      }
      const memData = Array.isArray(sysData.memory) ? sysData.memory : [];
      cpuMemCards.push({ title: '記憶體使用率（MemoryUSE %）', canvasId: 'comp-chart-memory', noDataId: 'comp-nodata-memory', data: memData, valueKey: 'memory_use', yLabel: 'MemoryUSE %', color: 'rgb(251,191,36)' });

      if (cpuMemGrid) {
        cpuMemGrid.innerHTML = cpuMemCards.map(c => `
          <div class="system-chart-card">
            <h3>${c.title}</h3>
            <div class="system-chart-wrapper">
              <canvas id="${c.canvasId}"></canvas>
              <div id="${c.noDataId}" class="no-data hidden">此時間範圍內無資料</div>
            </div>
          </div>
        `).join('');
        for (const c of cpuMemCards) compRenderSingleChart(c.canvasId, c.noDataId, c.data, c.valueKey, c.yLabel, c.color);
      }

      // Disk
      const diskCards = [];
      const diskDataObj = {};
      for (const d of (Array.isArray(sysData.disk) ? sysData.disk : [])) {
        const fs = d.file_system || '(unknown)';
        (diskDataObj[fs] = diskDataObj[fs] || []).push({ time: d.time, used: d.used });
      }
      const diskPaths = Object.keys(diskDataObj).sort();
      for (const fsPath of diskPaths) {
        const safeId = fsPath.replace(/[^a-zA-Z0-9]/g, '_');
        diskCards.push({ title: `磁碟 ${fsPath}（Used %）`, canvasId: `comp-chart-disk-${safeId}`, noDataId: `comp-nodata-disk-${safeId}`, data: diskDataObj[fsPath], valueKey: 'used', yLabel: 'Used %', color: 'rgb(251,146,60)' });
      }
      if (diskPaths.length === 0) {
        diskCards.push({ title: '磁碟使用率', canvasId: 'comp-chart-disk-empty', noDataId: 'comp-nodata-disk-empty', data: [], valueKey: 'used', yLabel: 'Used %', color: 'rgb(251,146,60)' });
      }
      if (diskGrid) {
        diskGrid.innerHTML = diskCards.map(c => `
          <div class="system-chart-card">
            <h3>${c.title}</h3>
            <div class="system-chart-wrapper">
              <canvas id="${c.canvasId}"></canvas>
              <div id="${c.noDataId}" class="no-data hidden">此時間範圍內無資料</div>
            </div>
          </div>
        `).join('');
        for (const c of diskCards) compRenderSingleChart(c.canvasId, c.noDataId, c.data, c.valueKey, c.yLabel, c.color);
      }
    }

    // ── 左欄：載入電腦列表（科別按鈕展開式） ──────────────
    async function loadComputerNav() {
      try {
        const data = await fetchComputerStatus();
        const items = data.items || [];
        const navList = document.getElementById('computer-nav-list');
        // 依科別分組
        const groups = {};
        for (const item of items) {
          const dept = item.department || 'other';
          (groups[dept] = groups[dept] || []).push(item);
        }
        const DEPT_LABELS = { sos: '衛星作業科', dqcs: '品管科', rsa: '應用科', wrs: '氣象雷達科', mrs: '海象雷達科' };
        const DEPT_ORDER = ['wrs', 'mrs', 'sos', 'dqcs', 'rsa'];
        const orderedKeys = [...DEPT_ORDER.filter(k => groups[k]), ...Object.keys(groups).filter(k => !DEPT_ORDER.includes(k))];

        let html = '';
        for (const key of orderedKeys) {
          const label = DEPT_LABELS[key] || key;
          const containsCurrent = groups[key].some(item => item.ip === IP);
          html += `<button class="dept-toggle-btn${containsCurrent ? ' expanded' : ''}" data-dept-key="${key}">${label}</button>`;
          html += `<div class="dept-computer-list${containsCurrent ? ' show' : ''}" data-dept-list="${key}">`;
          for (const item of groups[key]) {
            const isActive = item.ip === IP;
            html += `<a class="nav-item${isActive ? ' active' : ''}" href="/history.html?mode=computer&ip=${encodeURIComponent(item.ip)}&name=${encodeURIComponent(item.equipment_name || item.ip)}">
              <div style="font-weight:500;">${item.equipment_name || item.ip}</div>
              <div style="font-size:0.72rem;color:#64748b;">${item.ip}</div>
            </a>`;
          }
          html += '</div>';
        }
        navList.innerHTML = html;

        // Wire up toggle buttons
        navList.querySelectorAll('.dept-toggle-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.deptKey;
            const list = navList.querySelector(`.dept-computer-list[data-dept-list="${key}"]`);
            const isExpanded = btn.classList.contains('expanded');
            if (isExpanded) {
              btn.classList.remove('expanded');
              list.classList.remove('show');
            } else {
              btn.classList.add('expanded');
              list.classList.add('show');
            }
          });
        });
      } catch (e) {
        document.getElementById('computer-nav-list').innerHTML = '<p style="color:#64748b;font-size:0.78rem;">無法載入</p>';
      }
    }

    // ── 右欄：載入同 IP 的儀器（卡片含狀態燈號） ────────
    async function loadRelatedInstruments() {
      try {
        const data = await fetchCurrentStatus();
        const instruments = data.instruments || [];
        const related = instruments.filter(i => i.ip === IP);
        const list = document.getElementById('related-instruments-list');

        if (related.length === 0) {
          list.innerHTML = '<p style="color:#64748b;font-size:0.78rem;">此 IP 無相關儀器</p>';
          return;
        }

        list.innerHTML = related.map(inst => {
          const diff = inst.diff_time_minutes;
          const threshold_yellow = inst.threshold_yellow ?? 10;
          const threshold_orange = inst.threshold_orange ?? 15;
          const threshold_red = inst.threshold_red ?? 20;

          let level, diffText, badgeText;
          if (diff == null || diff >= 14400) {
            level = 'disconnected';
            diffText = '斷線';
            badgeText = '⚠ 斷線';
          } else if (diff > threshold_red) {
            level = 'red';
            diffText = diff.toFixed(1) + ' 分鐘';
            badgeText = '⚠ 異常';
          } else if (diff > threshold_orange) {
            level = 'orange';
            diffText = diff.toFixed(1) + ' 分鐘';
            badgeText = '⚠ 異常';
          } else if (diff > threshold_yellow) {
            level = 'yellow';
            diffText = diff.toFixed(1) + ' 分鐘';
            badgeText = '⚠ 異常';
          } else {
            level = 'ok';
            diffText = diff.toFixed(1) + ' 分鐘';
            badgeText = '✓ 正常';
          }

          const url = '/history.html?file_type=' + encodeURIComponent(inst.file_type || '') +
                      '&ip=' + encodeURIComponent(inst.ip || '') +
                      '&name=' + encodeURIComponent(inst.equipment_name || '');

          return `<a class="related-inst-card" href="${url}">
            <div class="ri-ip">${inst.ip || '--'}</div>
            <div class="ri-filetype">${inst.file_type || '--'}</div>
            <div class="ri-name">${inst.equipment_name || '--'}</div>
            <div class="ri-diff ri-${level}">${diffText}</div>
            <span class="ri-badge ri-badge-${level}">${badgeText}</span>
          </a>`;
        }).join('');
      } catch (e) {
        document.getElementById('related-instruments-list').innerHTML = '<p style="color:#64748b;font-size:0.78rem;">無法載入</p>';
      }
    }

    // ── 電腦模式資料載入 ──────────────────────────────────
    async function loadComputerData(range) {
      if (!IP) return;
      const bar = document.getElementById('computer-status-bar');
      bar.className = 'status-bar hidden';

      try {
        const sysData = await fetchSystemHistory(IP, range);
        compRenderSystemCharts(sysData);
      } catch (err) {
        bar.textContent = err.type === 'timeout' ? '請求逾時' : `載入失敗：${err.message}`;
        bar.className = 'status-bar error';
      }
    }

    // ── 時間範圍按鈕（header） ────────────────────────────
    document.querySelectorAll('#header-range-bar .range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#header-range-bar .range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentRange = btn.dataset.range;
        loadComputerData(_currentRange);
      });
    });

    // ── 初始化 ───────────────────────────────────────────
    loadComputerNav();
    loadRelatedInstruments();
    loadComputerData(_currentRange);

  } else {
    // ── Instrument mode (default) ──────────────────────────
    document.getElementById('site-header').style.display = 'none';
    document.getElementById('legacy-header').style.display = '';
    document.getElementById('back-link').href = '/instruments.html';
    document.getElementById('back-link').textContent = '← 儀器即時狀況';

    // 時間範圍按鈕（儀器模式內部）
    document.querySelectorAll('#instrument-range-bar .range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#instrument-range-bar .range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentRange = btn.dataset.range;
        loadAll(_currentRange);
      });
    });

    // 初始載入
    loadAll(_currentRange);
  }
})();
