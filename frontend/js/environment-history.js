/**
 * environment-history.js — 溫溼度計歷史資料頁面控制器
 * 讀取 URL query string: ip, name
 * 繪製溫度與濕度時序折線圖
 * 支援 6h / 1d / 1w / 1m / 3m 時間範圍切換
 */

(function () {
  'use strict';

  // ── URL 參數 ──────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const IP = params.get('ip') || '';
  const NAME = params.get('name') || '溫溼度計';

  // ── 頁面標題 ──────────────────────────────────────────────
  document.title = `${NAME}（${IP}）— 溫溼度歷史資料`;
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.textContent = `${NAME} 歷史資料`;
  const headerIpEl = document.getElementById('header-ip');
  if (headerIpEl) headerIpEl.textContent = IP || '--';
  const headerNameEl = document.getElementById('header-name');
  if (headerNameEl) headerNameEl.textContent = NAME || '--';

  // ── 狀態 ──────────────────────────────────────────────────
  let _currentRange = '6h';

  // ── Chart 實例 ────────────────────────────────────────────
  let _tempChart = null;
  let _humiChart = null;

  // ── 共用 Chart.js 時間軸選項 ──────────────────────────────
  function timeScaleOptions() {
    return {
      type: 'time',
      time: {
        tooltipFormat: 'yyyy-MM-dd HH:mm:ss',
        displayFormats: { hour: 'MM/dd HH:mm', day: 'MM/dd', week: 'MM/dd', month: 'yyyy/MM' },
      },
      ticks: { color: '#94a3b8', maxTicksLimit: 8 },
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
        y: {
          title: { display: true, text: yLabel, color: '#94a3b8', font: { size: 11 } },
          ticks: { color: '#94a3b8' },
          grid: { color: '#1e2235' },
        },
      },
    };
  }

  // ── 渲染單一圖表 ─────────────────────────────────────────
  function renderChart(chartRef, canvasId, noDataId, data, yLabel, color) {
    const noDataEl = document.getElementById(noDataId);
    const canvas = document.getElementById(canvasId);

    const arr = Array.isArray(data) ? data : [];
    const points = arr
      .map(d => ({ x: new Date(d.time).getTime(), y: d.value }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);

    if (points.length === 0) {
      noDataEl.classList.remove('hidden');
      canvas.style.display = 'none';
      if (chartRef.instance) { chartRef.instance.destroy(); chartRef.instance = null; }
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
      pointRadius: 1.5,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.3,
    };

    const options = baseChartOptions(yLabel);
    options.plugins.tooltip.callbacks = {
      label: ctx => `${yLabel}：${Number(ctx.parsed.y).toFixed(1)}`,
    };

    if (chartRef.instance) {
      chartRef.instance.data.datasets = [dataset];
      chartRef.instance.options = options;
      chartRef.instance.update('none');
    } else {
      chartRef.instance = new Chart(canvas, {
        type: 'line',
        data: { datasets: [dataset] },
        options,
      });
    }
  }

  // ── Chart refs ────────────────────────────────────────────
  const tempChartRef = { instance: null };
  const humiChartRef = { instance: null };

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

  // ── 載入並渲染圖表 ────────────────────────────────────────
  async function loadAll(range) {
    if (!IP) {
      showError('缺少必要參數（ip）');
      return;
    }

    hideError();

    try {
      const result = await fetchEnvironmentHistory(IP, range);

      renderChart(
        tempChartRef,
        'temperature-chart',
        'temperature-no-data',
        result.temperature,
        '溫度（°C）',
        'rgb(251, 146, 60)',  // orange
      );

      renderChart(
        humiChartRef,
        'humidity-chart',
        'humidity-no-data',
        result.humidity,
        '濕度（%RH）',
        'rgb(56, 189, 248)',  // blue
      );
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
