/**
 * api.js — 統一封裝所有對後端的 fetch 呼叫與錯誤處理
 * 其他模組不直接發出 HTTP 請求，一律透過此模組。
 */

const API_BASE = '/api/v1';
const TIMEOUT_MS = 8000;

/**
 * 帶逾時的 fetch wrapper。
 * @returns {Promise<any>} 解析後的 JSON，或拋出含 type 的 Error
 */
async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_BASE + path, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.type = res.status >= 500 ? 'db_error' : 'client_error';
      try { err.detail = await res.json(); } catch (_) {}
      throw err;
    }

    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error('請求逾時');
      err.type = 'timeout';
      throw err;
    }
    if (!e.type) e.type = 'network_error';
    throw e;
  }
}

/** 取得所有儀器即時警示狀態 */
async function fetchCurrentStatus() {
  return apiFetch('/completeness/current');
}

/** 取得所有儀器清單與閾值 */
async function fetchInstruments() {
  return apiFetch('/instruments');
}

/**
 * 更新儀器閾值
 * @param {string} fileType
 * @param {{ threshold_yellow: number, threshold_orange: number, threshold_red: number }} thresholds
 */
async function updateThreshold(fileType, thresholds) {
  return apiFetch(`/instruments/${encodeURIComponent(fileType)}/threshold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(thresholds),
  });
}

/** 取得系統狀態（負載、記憶體） */
async function fetchSystemStatus() {
  return apiFetch('/system/current');
}

/** 取得磁碟狀態 */
async function fetchDiskStatus() {
  return apiFetch('/disk/current');
}

/** 取得電腦統一狀態（系統 + 磁碟合併） */
async function fetchComputerStatus() {
  return apiFetch('/computers/current');
}

/**
 * 取得儀器 DiffTime 歷史記錄
 * @param {string} fileType
 * @param {string} ip
 * @param {string} range  6h | 1d | 1w | 1m | 3m
 */
async function fetchInstrumentHistory(fileType, ip, range) {
  return apiFetch(`/history/${encodeURIComponent(fileType)}?ip=${encodeURIComponent(ip)}&range=${encodeURIComponent(range)}`);
}

/**
 * 取得同 IP 電腦的 CPU / 記憶體 / 磁碟歷史記錄
 * @param {string} ip
 * @param {string} range  6h | 1d | 1w | 1m | 3m
 */
async function fetchSystemHistory(ip, range) {
  return apiFetch(`/history/system?ip=${encodeURIComponent(ip)}&range=${encodeURIComponent(range)}`);
}
