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

    // response 每一筆 diff_time_minutes 都畫成一個資料點。
    // 同一個 FileTime 常有多筆記錄（同一次掃描的多個檔案），
    // x 轉成 epoch 毫秒讓 Chart.js 不必逐筆 parse 字串。
    const points = data
      .map(d => ({ x: new Date(d.time).getTime(), y: d.diff_time_minutes }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);

    if (points.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (_diffChart) { _diffChart.destroy(); _diffChart = null; }
      return;
    }

    // y 軸以實際 diff_time_minutes 範圍為準（上下留 10% 邊界）。
    // 否則閾值線（例如紅色 27 分）會把 7~8 分的資料壓成一條平線。
    // 資料量可能上萬筆，用迴圈而非 Math.min(...arr) 避免超出參數上限。
    let yMin = points[0].y;
    let yMax = points[0].y;
    for (const p of points) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const pad = Math.max((yMax - yMin) * 0.1, 0.1);
    const axisMin = Math.max(0, yMin - pad);
    const axisMax = yMax + pad;

    // 閾值水平線：以 borderDash 虛線 dataset 實作。
    // 只有落在 y 軸範圍內的閾值才畫出來，圖例才會與實際線條一致。
    const tYellow = thresholdYellow != null ? thresholdYellow : null;
    const tOrange = thresholdOrange != null ? thresholdOrange : null;
    const tRed = thresholdRed != null ? thresholdRed : null;

    function thresholdDataset(value, color, label) {
      if (value == null || value < axisMin || value > axisMax) return null;
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
    options.scales.y.min = axisMin;
    options.scales.y.max = axisMax;

    if (_diffChart) {
      _diffChart.data.datasets = datasets;
      _diffChart.options = options;
      _diffChart.update('none');
    } else {
      _diffChart = new Chart(canvas, { type: 'line', data: { datasets }, options });
    }
  }

  // ── 建立或更新系統圖（通用） ──────────────────────────────
  // chartInstances stores { canvasId: Chart instance }
  const _chartInstances = {};

  function renderSingleChart(canvasId, noDataId, data, valueKey, yLabel, color) {
    const noDataEl = document.getElementById(noDataId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !noDataEl) return;

    // Ensure data is an array
    const arr = Array.isArray(data) ? data : [];

    if (arr.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (_chartInstances[canvasId]) { _chartInstances[canvasId].destroy(); delete _chartInstances[canvasId]; }
      return;
    }

    noDataEl.classList.add('hidden');
    canvas.style.display = '';

    const points = arr.map(d => ({ x: d.time, y: d[valueKey] }));
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
   *   cpu: { load_1: [{time, value}], load_5: [...], load_15: [...] }
   *   memory: [{time, value}]
   *   disk: { "/path1": [{time, used}], "/path2": [...] }
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

    const cpuData = sysData.cpu || {};
    for (const cfg of cpuConfigs) {
      const data = Array.isArray(cpuData[cfg.key]) ? cpuData[cfg.key] : [];
      const canvasId = `chart-cpu-${cfg.key}`;
      const noDataId = `nodata-cpu-${cfg.key}`;
      cpuMemCards.push({ title: cfg.label, canvasId, noDataId, data, valueKey: 'value', yLabel: cfg.key, color: cfg.color });
    }

    // Memory card
    const memData = Array.isArray(sysData.memory) ? sysData.memory : [];
    cpuMemCards.push({
      title: '記憶體使用率（MemoryUSE %）',
      canvasId: 'chart-memory',
      noDataId: 'nodata-memory',
      data: memData,
      valueKey: 'value',
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
    const diskCards = [];
    const diskDataObj = (sysData.disk && typeof sysData.disk === 'object' && !Array.isArray(sysData.disk)) ? sysData.disk : {};
    const diskPaths = Object.keys(diskDataObj).sort();

    for (const fsPath of diskPaths) {
      const safeId = fsPath.replace(/[^a-zA-Z0-9]/g, '_');
      const canvasId = `chart-disk-${safeId}`;
      const noDataId = `nodata-disk-${safeId}`;
      diskCards.push({
        title: `磁碟 ${fsPath}（Used %）`,
        canvasId,
        noDataId,
        data: Array.isArray(diskDataObj[fsPath]) ? diskDataObj[fsPath] : [],
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
      const hasCpuData = sysData.cpu && (sysData.cpu.load_1 || []).length > 0;
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
})();
