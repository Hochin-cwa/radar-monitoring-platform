/**
 * header.js — 全站共用頁首元件
 *
 * 用法：在 <body> 開頭（其他頁面 JS 之前）加入：
 *   <script src="/js/header.js" data-active="instruments"></script>
 *
 * 參數（放在 <script> 標籤上）：
 *   data-active   目前頁面對應的導覽鍵，用來標示 active 連結。
 *                 可用值：index | instruments | computers | settings | environment
 *   data-no-refresh  若存在，時間列不顯示「刷新」按鈕（例如設定頁）。
 *   data-timebar-html  自訂時間列（time-bar）內的 HTML。若提供，將取代預設的
 *                 本地/UTC 時間顯示（例如環境監控頁顯示 IP／設備）。
 *
 * 說明：
 *   - 頁首為「同步注入」，在頁面解析當下即插入，確保後續各頁 JS
 *     （DOMContentLoaded 時）能找到 #local-time / #utc-time / #btn-refresh 等元素。
 *   - 以後要修改頁首（文字、導覽項目、樣式結構），只需改這一個檔案，全站同步生效。
 */
(function () {
  // 取得目前這支 <script> 標籤，讀取其 data-* 設定
  const currentScript = document.currentScript;
  const activeKey = (currentScript && currentScript.dataset.active) || '';
  const noRefresh = currentScript && currentScript.hasAttribute('data-no-refresh');
  const customTimebar = (currentScript && currentScript.dataset.timebarHtml) || '';

  // 導覽列定義：單一來源，修改這裡即可全站更新
  const NAV_ITEMS = [
    { key: 'index',       href: '/index.html',                                  label: '首頁' },
    { key: 'instruments', href: '/instruments.html',                            label: '儀器即時狀況' },
    { key: 'computers',   href: '/computers.html',                              label: '電腦即時狀況' },
    { key: 'settings',    href: '/settings.html',                               label: '閾值設定' },
    { key: 'environment', href: '/environment-history.html?ip=192.168.178.19',  label: '環境監控' },
  ];

  const navHtml = NAV_ITEMS.map((item) => {
    const activeClass = item.key === activeKey ? ' active' : '';
    return `<a href="${item.href}" class="global-nav-link${activeClass}">${item.label}</a>`;
  }).join('\n      ');

  const refreshHtml = noRefresh
    ? ''
    : `
      <span class="refresh-info">
        上次更新：<span id="last-refreshed">--</span>
        <button id="btn-refresh">⟳ 刷新</button>
      </span>`;

  const timeBarInner = customTimebar
    ? customTimebar
    : `<span>本地時間：<span id="local-time">--</span></span>
      <span>UTC：<span id="utc-time">--</span></span>${refreshHtml}`;

  const headerHtml = `
  <header class="site-header">
    <div class="header-title">
      <div class="header-line1">中央氣象署海氣遙測組</div>
      <div class="header-line2">遙測作業系統資料傳輸監控整合平台</div>
    </div>
    <nav class="header-nav">
      ${navHtml}
    </nav>
    <div class="time-bar">
      ${timeBarInner}
    </div>
  </header>`;

  // 同步注入：在此 <script> 標籤的位置直接插入頁首
  if (currentScript) {
    currentScript.insertAdjacentHTML('afterend', headerHtml);
  } else {
    // 後備方案（理論上不會走到）：插入 body 開頭
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertAdjacentHTML('afterbegin', headerHtml);
    });
  }
})();
