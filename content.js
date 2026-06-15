// content.js — detect CA and notify side panel

(function () {
  'use strict';
  let lastCA = null;

  function extractCA(url) {
    const patterns = [
      /axiom\.trade\/meme\/([A-HJ-NP-Za-km-z1-9]{32,44})/,
      /axiom\.trade\/token\/([A-HJ-NP-Za-km-z1-9]{32,44})/,
      /axiom\.trade\/[^/?#]+\/([A-HJ-NP-Za-km-z1-9]{32,44})/,
      /[?&]token=([A-HJ-NP-Za-km-z1-9]{32,44})/,
      /[?&]address=([A-HJ-NP-Za-km-z1-9]{32,44})/
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function check() {
    const ca = extractCA(location.href);
    if (ca && ca !== lastCA) {
      lastCA = ca;
      chrome.runtime.sendMessage({ type: 'CA_CHANGED', ca }).catch(() => {});
    }
  }

  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = (...a) => { _push(...a); setTimeout(check, 150); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(check, 150); };
  window.addEventListener('popstate', check);

  check();
  setInterval(check, 1500);
})();