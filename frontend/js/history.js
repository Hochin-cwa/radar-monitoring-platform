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
  let _currentRange = '1d';

  // ── Chart 實例 ────────────────────────────────────────────
  let _diffChart = null;
  let _cpuChart = null;
  let _memoryChart = null;
  let _diskChart = null;

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

    // 閾值水平線：以 borderDash 虛線 dataset 實作
    const tYellow = thresholdYellow != null ? thresholdYellow : null;
    const tOrange = thresholdOrange != null ? thresholdOrange : null;
    const tRed = thresholdRed != null ? thresholdRed : null;

    function thresholdDataset(value, color, label) {
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

    if (_diffChart) {
      _diffChart.data.datasets = datasets;
      _diffChart.update('none');
    } else {
      _diffChart = new Chart(canvas, { type: 'line', data: { datasets }, options });
    }
  }

  // ── 建立或更新系統圖（通用） ──────────────────────────────
  function renderSystemChart(chartRef, canvasId, noDataId, data, valueKey, yLabel, color) {
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

    if (chartRef.instance) {
      chartRef.instance.data.datasets[0].data = points;
      chartRef.instance.update('none');
    } else {
      chartRef.instance = new Chart(canvas, {
        type: 'line',
        data: { datasets: [dataset] },
        options: baseChartOptions(yLabel),
      });
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
  const _cpuRef = {};
  const _memRef = {};
  const _diskRef = {};

  async function loadAll(range) {
    if (!FILE_TYPE || !IP) {
      showError('缺少必要參數（file_type 或 ip）');
      return;
    }

    hideError();

    try {
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
