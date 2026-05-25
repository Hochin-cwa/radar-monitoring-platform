/**
 * clock.js — 共用時鐘，每秒更新本地時間與 UTC 時間
 */
function _pad(n) { return String(n).padStart(2, '0'); }

function _formatDatetime(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())} ` +
         `${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}

function _tickClock() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const localEl = document.getElementById('local-time');
  const utcEl   = document.getElementById('utc-time');
  if (localEl) localEl.textContent = _formatDatetime(now);
  if (utcEl)   utcEl.textContent   = _formatDatetime(utc);
}

_tickClock();
setInterval(_tickClock, 1000);
