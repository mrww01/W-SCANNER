// W Scanner v5.1 — live alerts overhaul, trade plan removed

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let currentCA = null;
let currentPairAddress = null;
let trackedWallets = [];
let scanHistory = [];
let isAnalyzing = false;
let autoRefreshEnabled = true;
let autoRefreshTimer = null;
let liveEvents = [];
let lastScanResult = null;
let prevScanData = null; // For change detection
let filters = defaultFilters();
let heliusApiKey = "";
let pumpPortalWs = null;
let pumpPortalLaunches = new Map();
let solscanApiKey = "";
let gmgnApiKey = "";
let twitterToken = "";
let gmgnTrendingCache = [];
let xScanTabId = null;

function defaultFilters() {
  return {
    // Existing filters
    volmcMin: 60, volmcStrong: 85, volmcGold: 140,
    mcMin: 0, mcMax: 0,
    devMax: 3, nukePct: 3.5, top10Warn: 40, bundleMax: 15,
    txnMin: 5, liqMin: 3000,
    whaleBuy: 12, whaleSell: 15,
    rugPct: 90, skipRugActive: true, fakeDetect: true,
    // Verdict Tuner — score thresholds
    vtScoreRunner:     80,
    vtScoreModerate:   65,
    vtScoreHighRisk:   50,
    vtScoreRisky:      30,
    vtRedFlagRisky:    3,
    vtRedFlagHighRisk: 2,
    vtRedFlagModerate: 1,
    // Verdict Tuner — penalties
    vtPNoHolder:       20,
    vtPFake:           50,
    vtPBundle:         40,
    vtPSniper:         15,
    vtPInsider:        25,
    vtPDevDanger:      45,
    vtPDevBorder:      20,
    vtPNuke:           35,
    vtPTop10High:      30,
    vtPTop10Mod:       12,
    vtPVolmcWeak:      15,
    vtPLiqThin:        25,
    vtPHoldersThin:    30,
    vtPPumped:         30,
    vtPSlotBundle:     35,
    vtPFreshWallet:    20,
    // Verdict Tuner — bonuses
    vtBDevZero:        8,
    vtBDevOk:          2,
    vtBVolmcStrong:    12,
    vtBVolmcMassive:   20,
    vtBTracked:        15,
    vtBHoldersGood:    5,
    vtBTxnsOrganic:    5,
    vtBAgeFresh:       5,
    // Verdict Tuner — holder thresholds
    vtMinHolders:      100,
    vtHoldersVeryThin: 50,
    vtHoldersThin:     100,
    vtHoldersBuilding: 200,
    // Verdict Tuner — dead cat
    vtDeadCatOn:       true,
    vtDeadCatWarn:     40,
    vtDeadCatSevere:   70,
  };
}

// Load saved state
chrome.storage.local.get(['trackedWallets','scanHistory','filters','heliusApiKey','solscanApiKey','gmgnApiKey','twitterToken'], r => {
  heliusApiKey = r.heliusApiKey || '';
  solscanApiKey = r.solscanApiKey || '';
  gmgnApiKey = r.gmgnApiKey || '';
  twitterToken = r.twitterToken || '';
  trackedWallets = r.trackedWallets || [];
  scanHistory = r.scanHistory || [];
  if (r.filters) filters = { ...defaultFilters(), ...r.filters };
  updateWalletCount();
  renderWalletList();
  renderHistory();
  loadFiltersToUI();
  setTimeout(() => { updateWalletCount(); renderWalletList(); }, 100);
});

// ═══════════════════════════════════════════════
// LISTEN FOR CA FROM PAGE
// ═══════════════════════════════════════════════
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'CA_CHANGED' && msg.ca) {
    if (msg.ca !== currentCA) {
      currentCA = msg.ca;
      currentPairAddress = null;
      liveEvents = [];
      lastScanResult = null;
      prevScanData = null;
      switchTab('scan');
      analyzeToken(msg.ca, true);
    }
  }
  if (msg.type === 'HELIUS_TX') {
    // Real-time transaction from Helius WebSocket
    handleHeliusTransaction(msg);
  }
  if (msg.type === 'HELIUS_ACCOUNT') {
    // Real-time account update from Helius WebSocket
    handleHeliusAccountUpdate(msg);
  }
});

// ═══════════════════════════════════════════════
// AUTO REFRESH — chained setTimeout (Bug 3 fix)
// ═══════════════════════════════════════════════

// ── HELIUS WEBSOCKET HANDLERS ──
function handleHeliusTransaction(msg) {
  if (!msg.transfers || !msg.transfers.length) return;

  for (const transfer of msg.transfers) {
    const amount = transfer.amount;
    const type = transfer.type;

    // Add to live feed
    const event = {
      type: type === 'receive' ? 'buy' : 'sell',
      icon: type === 'receive' ? '🟢' : '🔴',
      text: `<strong style="color:${type === 'receive' ? 'var(--green)' : 'var(--red)'}">${type === 'receive' ? 'BUY' : 'SELL'}</strong> — ${amount.toFixed(2)} tokens via Helius WS`,
      timestamp: msg.timestamp,
      source: 'helius_ws'
    };

    liveEvents.unshift(event);
    if (liveEvents.length > 50) liveEvents.pop();
  }

  // Update live feed display
  renderLiveFeed(liveEvents.slice(0, 25));

  // Update last scan data for comparison
  if (lastScanResult) {
    lastScanResult.time = Date.now();
  }
}

function handleHeliusAccountUpdate(msg) {
  // Holder count or balance changed
  if (!msg.account) return;

  // Could update holder count in real-time here
  console.log('[Helius WS] Account update:', msg.account, 'lamports:', msg.lamports);
}

function scheduleNextRefresh() {
  if (!autoRefreshEnabled) return;
  autoRefreshTimer = setTimeout(async () => {
    if (currentCA && !isAnalyzing && autoRefreshEnabled) {
      await analyzeToken(currentCA, false);
    }
    scheduleNextRefresh();
  }, 4000);
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (!autoRefreshEnabled) return;
  scheduleNextRefresh();
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// Toggle auto-refresh
document.getElementById('auto-badge').addEventListener('click', () => {
  autoRefreshEnabled = !autoRefreshEnabled;
  const badge = document.getElementById('auto-badge');
  if (autoRefreshEnabled) {
    badge.textContent = '4s AUTO';
    badge.classList.remove('paused');
    startAutoRefresh();
  } else {
    badge.textContent = 'PAUSED';
    badge.classList.add('paused');
    stopAutoRefresh();
  }
});

document.getElementById('btn-refresh-now').addEventListener('click', () => {
  if (currentCA) {
    stopAutoRefresh();
    isAnalyzing = false;
    analyzeToken(currentCA, false).then(() => {
      if (autoRefreshEnabled) startAutoRefresh();
    });
  }
});

// btn-rescan is the ↻ button inside the result card
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-rescan') {
    if (currentCA) {
      stopAutoRefresh();
      isAnalyzing = false;
      analyzeToken(currentCA, false).then(() => {
        if (autoRefreshEnabled) startAutoRefresh();
      });
    }
  }
});

// ── CHECK X BUTTON ──
document.getElementById('btn-check-x').addEventListener('click', async () => {
  if (!currentCA) { showToast('No token to check'); return; }
  const sym = document.getElementById('token-symbol').textContent.replace('$', '') || currentCA.slice(0, 8);
  const searchUrl = 'https://x.com/search?q=%24' + encodeURIComponent(sym) + '&f=live';
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  xScanTabId = tab.id;
  showToast('Opening X search... scraping in 3s');
  setTimeout(async () => {
    try {
      const results = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_X' });
      if (results && results.tweetCount > 0) {
        const xBox = document.getElementById('x-scan-box');
        const ageMin = results.latestTweetTime ? Math.floor((Date.now() - results.latestTweetTime) / 60000) : null;
        const ageStr = ageMin !== null ? (ageMin < 60 ? ageMin + 'm ago' : Math.floor(ageMin / 60) + 'h ago') : '?';
        const hot = results.tweetCount >= 10 && ageMin !== null && ageMin < 30;
        xBox.innerHTML = hot
          ? '𝕏 <strong style="color:var(--green)">HOT</strong> — ' + results.tweetCount + ' tweets · latest ' + ageStr + ' · ' + results.totalLikes + ' likes'
          : '𝕏 ' + results.tweetCount + ' tweets · latest ' + ageStr + ' · ' + results.totalLikes + ' likes';
        xBox.style.display = 'block';
        showToast('X scan complete: ' + results.tweetCount + ' tweets');
      } else {
        showToast('X: No tweets found or page still loading');
      }
    } catch (e) {
      showToast('X scrape failed — try again in a few seconds');
    }
    // Close the tab after scraping
    chrome.tabs.remove(tab.id).catch(() => {});
    xScanTabId = null;
  }, 3500);
});

// ═══════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════
function switchTab(tabId) {
  document.querySelectorAll('.top-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const t = document.querySelector(`.top-tab[data-tab="${tabId}"]`);
  const v = document.getElementById(`${tabId}-view`);
  if (t) t.classList.add('active');
  if (v) v.classList.add('active');
  // When switching to debug tab, refresh the breakdown
  if (tabId === 'debug') {
    updateDebugScoreBreakdown();
    if (window._lastApiStatus) updateDebugTab(window._lastApiStatus);
  }
}
document.querySelectorAll('.top-tab').forEach(t =>
  t.addEventListener('click', () => {
    switchTab(t.dataset.tab);
    if (t.dataset.tab !== 'wallet') {
      const pnl = document.getElementById('wallet-pnl-panel');
      if (pnl) pnl.style.display = 'none';
    }
  }));

function switchBtab(tabId) {
  document.querySelectorAll('.btab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.btab-content').forEach(c => c.classList.remove('active'));
  const t = document.querySelector(`.btab[data-btab="${tabId}"]`);
  const c = document.getElementById(`btab-${tabId}`);
  if (t) t.classList.add('active');
  if (c) c.classList.add('active');
}
document.querySelectorAll('.btab').forEach(t =>
  t.addEventListener('click', () => switchBtab(t.dataset.btab)));

// Start PumpPortal on load
connectPumpPortal();

// GMGN trending on first open
setTimeout(() => fetchGMGNTrending(), 2000);


// ═══════════════════════════════════════════════
// PUMPPORTAL WEBSOCKET
// ═══════════════════════════════════════════════
function connectPumpPortal() {
  if (pumpPortalWs?.readyState === WebSocket.OPEN) return;
  try {
    pumpPortalWs = new WebSocket('wss://pumpportal.fun/api/data');
    pumpPortalWs.onopen = () => {
      pumpPortalWs.send(JSON.stringify({ method: 'subscribeNewToken' }));
      updatePumpPortalStatus(true);
    };
    pumpPortalWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.mint) {
          pumpPortalLaunches.set(data.mint, { ...data, time: Date.now() });
          if (pumpPortalLaunches.size > 100) {
            const oldest = [...pumpPortalLaunches.entries()].sort((a, b) => a[1].time - b[1].time)[0];
            pumpPortalLaunches.delete(oldest[0]);
          }
          if (currentCA && data.mint === currentCA) {
            liveEvents.unshift({
              type: 'buy', icon: '🚀',
              text: `<strong style="color:var(--gold)">PUMPPORTAL LAUNCH</strong> — Just launched! Initial: ${(data.initialBuy || 0).toFixed(2)} SOL · MC: $${(data.marketCapUsd || 0).toFixed(0)}`
            });
            renderLiveFeed(liveEvents.slice(0, 25));
            const momEl = document.getElementById('momentum-indicator');
            if (momEl) { momEl.textContent = '🚀 FRESH PUMPPORTAL LAUNCH'; momEl.style.display = 'block'; }
          }
        }
      } catch (e) {}
    };
    pumpPortalWs.onclose = () => { updatePumpPortalStatus(false); setTimeout(connectPumpPortal, 5000); };
    pumpPortalWs.onerror = () => { updatePumpPortalStatus(false); };
  } catch (e) { updatePumpPortalStatus(false); }
}
function updatePumpPortalStatus(connected) {
  const el = document.getElementById('pp-status');
  if (el) {
    el.textContent = connected ? '● PP' : '○ PP';
    el.style.color = connected ? 'var(--green)' : 'var(--dim)';
    el.style.borderColor = connected ? 'rgba(63,185,80,0.3)' : 'rgba(88,166,255,0.3)';
    el.style.background = connected ? 'rgba(63,185,80,0.15)' : 'rgba(88,166,255,0.15)';
  }
}




// ═══════════════════════════════════════════════
// HELIUS WEBSOCKET — Real-time transaction feed
// ═══════════════════════════════════════════════
let heliusWs = null;
let heliusWsConnected = false;
let heliusWsSubscribed = false;

function connectHeliusWebSocket() {
  if (!filters.heliusWsEnabled || !heliusApiKey) return;
  if (heliusWs?.readyState === WebSocket.OPEN) return;

  const wsUrl = filters.heliusWsUrl || `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  try {
    heliusWs = new WebSocket(wsUrl);

    heliusWs.onopen = () => {
      heliusWsConnected = true;
      updateHeliusWsStatus(true);

      // Subscribe to token transactions if we have a CA
      if (currentCA) {
        subscribeToToken(currentCA);
      }

      // Subscribe to tracked wallets
      subscribeToTrackedWallets();
    };

    heliusWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleHeliusMessage(data);
      } catch (e) {}
    };

    heliusWs.onclose = () => {
      heliusWsConnected = false;
      heliusWsSubscribed = false;
      updateHeliusWsStatus(false);
      // Auto-reconnect if enabled
      if (filters.heliusWsAuto && filters.heliusWsEnabled) {
        setTimeout(connectHeliusWebSocket, 5000);
      }
    };

    heliusWs.onerror = () => {
      updateHeliusWsStatus(false);
    };

  } catch (e) {
    updateHeliusWsStatus(false);
  }
}

function subscribeToToken(ca) {
  if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN) return;

  // Subscribe to token account transactions
  heliusWs.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'accountSubscribe',
    params: [ca, { commitment: 'confirmed', encoding: 'jsonParsed' }]
  }));

  heliusWsSubscribed = true;
}

function subscribeToTrackedWallets() {
  if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN || !trackedWallets.length) return;

  trackedWallets.forEach((w, i) => {
    const addr = typeof w === 'string' ? w : (w.address || '');
    if (!addr) return;

    heliusWs.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 100 + i,
      method: 'accountSubscribe',
      params: [addr, { commitment: 'confirmed', encoding: 'jsonParsed' }]
    }));
  });
}

function handleHeliusMessage(data) {
  if (!data || !data.params) return;

  const result = data.params.result;
  if (!result || !result.value) return;

  // Check if this is a token transaction
  if (result.value.lamports !== undefined) {
    // This is a SOL balance change (wallet activity)
    const addr = data.params.subscription;
    const wallet = trackedWallets.find(w => {
      const a = typeof w === 'string' ? w : (w.address || '');
      return a === addr;
    });

    if (wallet) {
      const label = typeof wallet === 'object' && wallet.name ? wallet.name : addr.slice(0, 6) + '...';
      const change = result.value.lamports;
      const emoji = change > 0 ? '🟢' : '🔴';
      const action = change > 0 ? 'received' : 'sent';

      liveEvents.unshift({
        type: change > 0 ? 'buy' : 'sell',
        icon: emoji,
        text: `<strong style="color:${change > 0 ? 'var(--green)' : 'var(--red)'}">TRACKED WALLET ${action.toUpperCase()}</strong> — ${label} ${action} ${Math.abs(change / 1e9).toFixed(3)} SOL`
      });
      renderLiveFeed(liveEvents.slice(0, 25));
    }
  }

  // Token balance changes (holder count tracking)
  if (result.value.data && result.value.data.parsed) {
    const parsed = result.value.data.parsed;
    if (parsed.type === 'spl-token' && parsed.info) {
      const info = parsed.info;
      if (info.mint === currentCA || info.tokenAmount) {
        // Token transfer detected
        const amount = info.tokenAmount?.uiAmount || 0;
        const from = info.owner || info.authority || 'unknown';

        liveEvents.unshift({
          type: 'info',
          icon: '💎',
          text: `<strong>Token Transfer</strong> — ${amount.toFixed(2)} tokens moved`
        });
        renderLiveFeed(liveEvents.slice(0, 25));
      }
    }
  }
}

function updateHeliusWsStatus(connected) {
  // Update UI indicator if exists
  const el = document.getElementById('helius-ws-status');
  if (el) {
    el.textContent = connected ? '● WS' : '○ WS';
    el.style.color = connected ? 'var(--green)' : 'var(--dim)';
  }
}

function disconnectHeliusWebSocket() {
  if (heliusWs) {
    heliusWs.close();
    heliusWs = null;
    heliusWsConnected = false;
    heliusWsSubscribed = false;
  }
}

// ═══════════════════════════════════════════════
// PANEL OPEN
// ═══════════════════════════════════════════════
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'GET_LAST_CA' }, res => {
    if (chrome.runtime.lastError) return;
    if (res && res.ca && !currentCA) {
      currentCA = res.ca;
      currentPairAddress = null;
      liveEvents = [];
      analyzeToken(currentCA, true);
    }
  });
}, 300);

// ═══════════════════════════════════════════════
// WALLETS
// ═══════════════════════════════════════════════
const W_EMOJIS = ['🐋','🦈','🦁','🐯','🦊','🐺','🦅','🐉','🦄','💎','🔥','⚡','🌙','🚀','🎯','🍀','🎪','🌊','🏆','👑'];
function walletAddr(w)  { return typeof w === 'string' ? w : (w.address || ''); }
function walletLabel(w) { return (typeof w === 'object' && w.name) ? w.name : 'Rename w...'; }
function walletEmoji(w) {
  if (typeof w === 'object' && w.emoji) return w.emoji;
  const a = walletAddr(w);
  return W_EMOJIS[(a.charCodeAt(0) + (a.charCodeAt(1)||0)) % W_EMOJIS.length];
}

function renderWalletList(filterStr) {
  const listEl = document.getElementById('wallet-list');
  if (!listEl) return;
  let ws = trackedWallets;
  if (filterStr) {
    const q = filterStr.toLowerCase();
    ws = ws.filter(w => walletAddr(w).toLowerCase().includes(q) || walletLabel(w).toLowerCase().includes(q));
  }
  if (!ws.length) {
    listEl.innerHTML = `<div class="wlt-empty">${trackedWallets.length && filterStr ? 'No results' : 'No wallets added yet'}</div>`;
    return;
  }
  listEl.innerHTML = ws.map(w => {
    const addr  = walletAddr(w);
    const label = walletLabel(w);
    const emoji = walletEmoji(w);
    const bal   = (typeof w === 'object' && w.balance != null) ? w.balance : null;
    const last  = (typeof w === 'object' && w.lastActive) ? w.lastActive : '—';
    const idx   = trackedWallets.indexOf(w);
    return `<div class="wlt-row">
      <div class="wlt-col-name">
        <div class="wlt-avatar">${emoji}</div>
        <div class="wlt-namewrap">
          <div class="wlt-label">
            <span>${label}</span>
            <button class="wlt-copybtn" onclick="copyWltAddr('${addr}')" title="Copy">⎘</button>
          </div>
          <div class="wlt-short">${addr.slice(0,6)}...${addr.slice(-4)}</div>
        </div>
      </div>
      <div class="wlt-col-bal">
        ${bal !== null ? `<span class="wlt-sol">◎</span>${bal}` : '<span style="color:var(--dim)">—</span>'}
      </div>
      <div class="wlt-col-last">${last}</div>
      <div class="wlt-col-del">
        <button class="wlt-del" onclick="removeWallet(${idx})" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');
}

window.copyWltAddr = addr => navigator.clipboard.writeText(addr).then(() => showToast('Address copied!'));
window.removeWallet = i => {
  trackedWallets.splice(i, 1);
  chrome.storage.local.set({ trackedWallets });
  renderWalletList();
  updateWalletCount();
  showToast('Wallet removed');
};

document.getElementById('btn-toggle-add-wallet').addEventListener('click', () => {
  document.getElementById('wlt-add-panel').classList.toggle('open');
});
document.getElementById('btn-import-wallets').addEventListener('click', () => {
  document.getElementById('wlt-add-panel').classList.add('open');
  document.getElementById('wallet-input').focus();
});
document.getElementById('btn-export-wallets').addEventListener('click', () => {
  if (!trackedWallets.length) { showToast('No wallets to export'); return; }
  navigator.clipboard.writeText(trackedWallets.map(walletAddr).join('\n'))
    .then(() => showToast(`✅ ${trackedWallets.length} addresses copied`));
});
document.getElementById('wallet-search').addEventListener('input', e => renderWalletList(e.target.value));

document.getElementById('btn-close-pnl')?.addEventListener('click', () => {
  document.getElementById('wallet-pnl-panel').style.display = 'none';
});

document.getElementById('btn-save-wallets').addEventListener('click', () => {
  const raw = document.getElementById('wallet-input').value;
  const addrs = raw.split(/[\n,\s]+/).map(w => w.trim()).filter(w => w.length > 20);
  const existing = trackedWallets.map(walletAddr);
  let added = 0;
  for (const a of addrs) {
    if (!existing.includes(a)) { trackedWallets.push(a); added++; }
  }
  chrome.storage.local.set({ trackedWallets });
  document.getElementById('wallet-input').value = '';
  document.getElementById('wlt-add-panel').classList.remove('open');
  renderWalletList();
  updateWalletCount();
  showToast(added ? `✅ ${added} wallets added` : 'Already saved');
});
document.getElementById('btn-clear-wallets').addEventListener('click', () => {
  trackedWallets = [];
  document.getElementById('wallet-input').value = '';
  chrome.storage.local.set({ trackedWallets: [] });
  document.getElementById('wlt-add-panel').classList.remove('open');
  renderWalletList();
  updateWalletCount();
  showToast('All wallets removed');
});
function updateWalletCount() {
  const el = document.getElementById('wallet-count');
  if (el) el.textContent = `${trackedWallets.length} wallet${trackedWallets.length !== 1 ? 's' : ''} loaded`;
}

// ═══════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════
document.getElementById('btn-clear-history').addEventListener('click', () => {
  scanHistory = [];
  chrome.storage.local.set({ scanHistory: [] });
  renderHistory();
});

function addToHistory(ca, ticker, verdict, vClass, score, momentum) {
  const idx = scanHistory.findIndex(h => h.ca === ca);
  const entry = { ca, ticker, verdict, vClass, score, momentum, time: Date.now() };
  if (idx >= 0) scanHistory[idx] = entry;
  else scanHistory.unshift(entry);
  if (scanHistory.length > 30) scanHistory.length = 30;
  chrome.storage.local.set({ scanHistory: [...scanHistory] });
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('history-list');
  if (!scanHistory.length) { el.innerHTML = '<div class="history-empty">No scans yet.</div>'; return; }
  el.innerHTML = scanHistory.map(h => `
    <div class="hist-item" onclick="loadCA('${h.ca}')">
      <div class="hist-top">
        <span class="hist-ticker">${h.ticker}</span>
        <span class="hist-v hv-${h.vClass}">${h.verdict}</span>
      </div>
      <div class="hist-meta">${h.ca.slice(0,12)}... · Score ${h.score} · ${timeAgo(h.time)}${h.momentum ? ' · ' + h.momentum : ''}</div>
    </div>`).join('');
}

window.loadCA = function(ca) {
  currentCA = ca; currentPairAddress = null; liveEvents = [];
  switchTab('scan'); analyzeToken(ca, true);
};

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

// ═══════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════
function loadFiltersToUI() {
  document.getElementById('f-volmc-min').value    = filters.volmcMin;
  document.getElementById('f-volmc-strong').value = filters.volmcStrong;
  document.getElementById('f-volmc-gold').value   = filters.volmcGold;
  document.getElementById('f-mc-min').value       = filters.mcMin;
  document.getElementById('f-mc-max').value       = filters.mcMax;
  document.getElementById('f-dev-max').value      = filters.devMax;
  document.getElementById('f-nuke-pct').value     = filters.nukePct;
  document.getElementById('f-top10-warn').value   = filters.top10Warn;
  document.getElementById('f-bundle-max').value   = filters.bundleMax;
  document.getElementById('f-txn-min').value      = filters.txnMin;
  document.getElementById('f-liq-min').value      = filters.liqMin;
  document.getElementById('f-whale-buy').value    = filters.whaleBuy;
  document.getElementById('f-whale-sell').value   = filters.whaleSell;
  document.getElementById('f-rug-pct').value      = filters.rugPct;
  document.getElementById('f-skip-rug-active').checked = filters.skipRugActive;
  document.getElementById('f-fake-detect').checked     = filters.fakeDetect;

  // Verdict Tuner fields
  const vt = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const vtc = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  vt('vt-score-runner',     filters.vtScoreRunner     ?? 80);
  vt('vt-score-moderate',   filters.vtScoreModerate   ?? 65);
  vt('vt-score-highrisk',   filters.vtScoreHighRisk   ?? 50);
  vt('vt-score-risky',      filters.vtScoreRisky      ?? 30);
  vt('vt-redflag-risky',    filters.vtRedFlagRisky    ?? 3);
  vt('vt-redflag-highrisk', filters.vtRedFlagHighRisk ?? 2);
  vt('vt-redflag-moderate', filters.vtRedFlagModerate ?? 1);
  vt('vt-p-no-holder',      filters.vtPNoHolder       ?? 20);
  vt('vt-p-fake',           filters.vtPFake           ?? 50);
  vt('vt-p-bundle',         filters.vtPBundle         ?? 40);
  vt('vt-p-sniper',         filters.vtPSniper         ?? 15);
  vt('vt-p-insider',        filters.vtPInsider        ?? 25);
  vt('vt-p-dev-danger',     filters.vtPDevDanger      ?? 45);
  vt('vt-p-dev-border',     filters.vtPDevBorder      ?? 20);
  vt('vt-p-nuke',           filters.vtPNuke           ?? 35);
  vt('vt-p-top10-high',     filters.vtPTop10High      ?? 30);
  vt('vt-p-top10-mod',      filters.vtPTop10Mod       ?? 12);
  vt('vt-p-volmc-weak',     filters.vtPVolmcWeak      ?? 15);
  vt('vt-p-liq-thin',       filters.vtPLiqThin        ?? 25);
  vt('vt-p-holders-thin',   filters.vtPHoldersThin    ?? 30);
  vt('vt-p-pumped',         filters.vtPPumped         ?? 30);
  vt('vt-p-slot-bundle',    filters.vtPSlotBundle     ?? 35);
  vt('vt-p-fresh-wallet',   filters.vtPFreshWallet    ?? 20);
  vt('vt-b-dev-zero',       filters.vtBDevZero        ?? 8);
  vt('vt-b-dev-ok',         filters.vtBDevOk          ?? 2);
  vt('vt-b-volmc-strong',   filters.vtBVolmcStrong    ?? 12);
  vt('vt-b-volmc-massive',  filters.vtBVolmcMassive   ?? 20);
  vt('vt-b-tracked',        filters.vtBTracked        ?? 15);
  vt('vt-b-holders-good',   filters.vtBHoldersGood    ?? 5);
  vt('vt-b-txns-organic',   filters.vtBTxnsOrganic    ?? 5);
  vt('vt-b-age-fresh',      filters.vtBAgeFresh       ?? 5);
  vt('vt-min-holders',      filters.vtMinHolders      ?? 100);
  vt('vt-holders-very-thin',filters.vtHoldersVeryThin ?? 50);
  vt('vt-holders-thin',     filters.vtHoldersThin     ?? 100);
  vt('vt-holders-building', filters.vtHoldersBuilding ?? 200);
  vtc('vt-dead-cat-on',     filters.vtDeadCatOn       !== false);
  vt('vt-dead-cat-warn',    filters.vtDeadCatWarn     ?? 40);
  vt('vt-dead-cat-severe',  filters.vtDeadCatSevere   ?? 70);
  document.getElementById('f-helius-key').value  = heliusApiKey  || '';
  document.getElementById('f-solscan-key').value = solscanApiKey || '';
  if (document.getElementById('f-gmgn-key'))      document.getElementById('f-gmgn-key').value      = gmgnApiKey    || '';
  if (document.getElementById('f-twitter-token')) document.getElementById('f-twitter-token').value = twitterToken   || '';
  // RPC & WebSocket
  document.getElementById('f-rpc-endpoint').value = filters.rpcEndpoint || 'helius';
  document.getElementById('f-custom-rpc').value = filters.customRpcUrl || '';
  document.getElementById('f-helius-ws-enabled').checked = filters.heliusWsEnabled !== false;
  document.getElementById('f-helius-ws-url').value = filters.heliusWsUrl || 'wss://mainnet.helius-rpc.com/?api-key=';
  document.getElementById('f-helius-ws-auto').checked = filters.heliusWsAuto !== false;
}

document.getElementById('btn-save-filters').addEventListener('click', () => {
  filters = {
    volmcMin:    +document.getElementById('f-volmc-min').value,
    volmcStrong: +document.getElementById('f-volmc-strong').value,
    volmcGold:   +document.getElementById('f-volmc-gold').value,
    mcMin:       +document.getElementById('f-mc-min').value,
    mcMax:       +document.getElementById('f-mc-max').value,
    devMax:      +document.getElementById('f-dev-max').value,
    nukePct:     +document.getElementById('f-nuke-pct').value,
    top10Warn:   +document.getElementById('f-top10-warn').value,
    bundleMax:   +document.getElementById('f-bundle-max').value,
    txnMin:      +document.getElementById('f-txn-min').value,
    liqMin:      +document.getElementById('f-liq-min').value,
    whaleBuy:    +document.getElementById('f-whale-buy').value,
    whaleSell:   +document.getElementById('f-whale-sell').value,
    rugPct:      +document.getElementById('f-rug-pct').value,
    skipRugActive: document.getElementById('f-skip-rug-active').checked,
    fakeDetect:    document.getElementById('f-fake-detect').checked,
    // Verdict Tuner
    vtScoreRunner:     +document.getElementById('vt-score-runner').value,
    vtScoreModerate:   +document.getElementById('vt-score-moderate').value,
    vtScoreHighRisk:   +document.getElementById('vt-score-highrisk').value,
    vtScoreRisky:      +document.getElementById('vt-score-risky').value,
    vtRedFlagRisky:    +document.getElementById('vt-redflag-risky').value,
    vtRedFlagHighRisk: +document.getElementById('vt-redflag-highrisk').value,
    vtRedFlagModerate: +document.getElementById('vt-redflag-moderate').value,
    vtPNoHolder:       +document.getElementById('vt-p-no-holder').value,
    vtPFake:           +document.getElementById('vt-p-fake').value,
    vtPBundle:         +document.getElementById('vt-p-bundle').value,
    vtPSniper:         +document.getElementById('vt-p-sniper').value,
    vtPInsider:        +document.getElementById('vt-p-insider').value,
    vtPDevDanger:      +document.getElementById('vt-p-dev-danger').value,
    vtPDevBorder:      +document.getElementById('vt-p-dev-border').value,
    vtPNuke:           +document.getElementById('vt-p-nuke').value,
    vtPTop10High:      +document.getElementById('vt-p-top10-high').value,
    vtPTop10Mod:       +document.getElementById('vt-p-top10-mod').value,
    vtPVolmcWeak:      +document.getElementById('vt-p-volmc-weak').value,
    vtPLiqThin:        +document.getElementById('vt-p-liq-thin').value,
    vtPHoldersThin:    +document.getElementById('vt-p-holders-thin').value,
    vtPPumped:         +document.getElementById('vt-p-pumped').value,
    vtPSlotBundle:     +document.getElementById('vt-p-slot-bundle').value,
    vtPFreshWallet:    +document.getElementById('vt-p-fresh-wallet').value,
    vtBDevZero:        +document.getElementById('vt-b-dev-zero').value,
    vtBDevOk:          +document.getElementById('vt-b-dev-ok').value,
    vtBVolmcStrong:    +document.getElementById('vt-b-volmc-strong').value,
    vtBVolmcMassive:   +document.getElementById('vt-b-volmc-massive').value,
    vtBTracked:        +document.getElementById('vt-b-tracked').value,
    vtBHoldersGood:    +document.getElementById('vt-b-holders-good').value,
    vtBTxnsOrganic:    +document.getElementById('vt-b-txns-organic').value,
    vtBAgeFresh:       +document.getElementById('vt-b-age-fresh').value,
    vtMinHolders:      +document.getElementById('vt-min-holders').value,
    vtHoldersVeryThin: +document.getElementById('vt-holders-very-thin').value,
    vtHoldersThin:     +document.getElementById('vt-holders-thin').value,
    vtHoldersBuilding: +document.getElementById('vt-holders-building').value,
    vtDeadCatOn:       document.getElementById('vt-dead-cat-on').checked,
    vtDeadCatWarn:     +document.getElementById('vt-dead-cat-warn').value,
    vtDeadCatSevere:   +document.getElementById('vt-dead-cat-severe').value,
  };
  heliusApiKey = document.getElementById('f-helius-key').value.trim();
  solscanApiKey = document.getElementById('f-solscan-key').value.trim();
  // RPC & WebSocket
  filters.rpcEndpoint = document.getElementById('f-rpc-endpoint').value;
  filters.customRpcUrl = document.getElementById('f-custom-rpc').value.trim();
  filters.heliusWsEnabled = document.getElementById('f-helius-ws-enabled').checked;
  filters.heliusWsUrl = document.getElementById('f-helius-ws-url').value.trim();
  filters.heliusWsAuto = document.getElementById('f-helius-ws-auto').checked;
  heliusApiKey  = document.getElementById('f-helius-key')?.value?.trim()  || heliusApiKey;
  solscanApiKey = document.getElementById('f-solscan-key')?.value?.trim() || solscanApiKey;
  gmgnApiKey    = document.getElementById('f-gmgn-key')?.value?.trim()    || gmgnApiKey;
  twitterToken  = document.getElementById('f-twitter-token')?.value?.trim() || twitterToken;
  chrome.storage.local.set({ filters, heliusApiKey, solscanApiKey, gmgnApiKey, twitterToken });
  showToast('✅ Filters saved');
});

document.getElementById('btn-reset-filters').addEventListener('click', () => {
  filters = defaultFilters();
  heliusApiKey = '';
  loadFiltersToUI();
  chrome.storage.local.set({ filters, heliusApiKey: '', solscanApiKey: '', gmgnApiKey: '', twitterToken: '' });
  showToast('Filters reset to default');
});

// ═══════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function fmt(n) {
  if (!n || n === 0) return '$0';
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${(n/1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function flagSection(items, cls, label, sym) {
  if (!items.length) return '';
  return `<div class="flag-section fs-${cls}">
    <div class="flag-head">${sym} ${label} (${items.length})</div>
    ${items.map(i => `<div class="flag-item">${i}</div>`).join('')}
  </div>`;
}

function formatAge(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  const days = Math.floor(minutes / 1440);
  const hrs = Math.round((minutes % 1440) / 60);
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}

// ═══════════════════════════════════════════════
// FILTER ENGINE — all critical bug fixes + alert data
// ═══════════════════════════════════════════════
function runFilters(dex, rugcheck, pumpfun, earlyTraderAddrs, solBalances, gecko, helius, solscan, gmgn, platformSource, twitterData) {
  // Score logging for debug tab
  window._lastScoreLog = [];
  window._lastApiStatus = window._lastApiStatus || {};
  const logScore = (label, delta, current) => {
    window._lastScoreLog.push({ label, delta, current: Math.max(0, Math.min(100, current)) });
  };
  const redFlags = [], warnings = [], greens = [];
  let score = 100;

  const pairs = dex?.pairs || [];
  const pair = pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];

  if (pair?.pairAddress) currentPairAddress = pair.pairAddress;

  const pfMc       = pumpfun?.usd_market_cap || 0;
  const pfComplete = pumpfun?.complete || false;
  const pfRaydium  = pumpfun?.raydium_pool != null;
  // BUG FIX 1: Pump.fun virtual reserves → USD liquidity (primary for bonding curve)
  const pfLiqRaw   = pumpfun?.virtual_sol_reserves ? pumpfun.virtual_sol_reserves / 1e9 : 0;
  const pfLiq      = pfLiqRaw > 0 ? pfLiqRaw * 150 : 0;
  const pfBonding  = pumpfun?.virtual_sol_reserves ? Math.min(((pumpfun.real_sol_reserves || 0) / 85000000000 * 100), 100) : 0;
  const isBondingCurve = pumpfun && !pfComplete;

  const mc         = pair?.fdv || pair?.marketCap || pfMc || 0;
  const vol5m      = pair?.volume?.m5 || 0;
  const vol1h      = pair?.volume?.h1 || 0;
  const vol6h      = pair?.volume?.h6 || 0;
  const vol24h     = pair?.volume?.h24 || 0;
  // BUG FIX 1: Never trust $0 liquidity if token is actively trading
  let liquidity  = pair?.liquidity?.usd || 0;
  if (isBondingCurve || liquidity <= 0) {
    liquidity = pfLiq > 0 ? pfLiq : (vol5m > 0 ? vol5m * 3 : 0);
  }
  if (liquidity <= 0 && vol5m > 0 && total5m > 0) {
    liquidity = vol5m * 3;
  }
  const buys5m     = pair?.txns?.m5?.buys || 0;
  const sells5m    = pair?.txns?.m5?.sells || 0;
  const total5m    = buys5m + sells5m;
  const pairAge    = pair?.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000) :
                     pumpfun?.created_timestamp ? Math.floor((Date.now() - pumpfun.created_timestamp * 1000) / 60000) : null;
  const p5m        = pair?.priceChange?.m5  || 0;
  const p1h        = pair?.priceChange?.h1  || 0;
  const p6h        = pair?.priceChange?.h6  || 0;
  const p24h       = pair?.priceChange?.h24 || 0;
  const priceUsd   = parseFloat(pair?.priceUsd || pumpfun?.price || 0);
  const holders    = pumpfun?.holder_count || pair?.holders || rugcheck?.holders?.length || gmgn?.tokenData?.holder_count || 0;

  const sym  = pair?.baseToken?.symbol || pumpfun?.symbol || '';
  const name = pair?.baseToken?.name   || pumpfun?.name   || '';
  const img  = pair?.info?.imageUrl    || pumpfun?.image_uri || pair?.baseToken?.logoURI || '';

  const topHolders = rugcheck?.topHolders || [];

  // ── GECKOTERMINAL DATA ──
  const gtAttrs = gecko?.stats?.data?.attributes || {};
  const gtBuyers24h = gtAttrs?.transactions?.h24?.buys || 0;
  const gtSellers24h = gtAttrs?.transactions?.h24?.sells || 0;
  const gtVol24h = gtAttrs?.volume_usd?.h24 || 0;
  const gtLiq = gtAttrs?.reserve_in_usd || 0;
  const gtPriceChange = gtAttrs?.price_change_percentage?.h24 || 0;
  const ohlcvList = gecko?.ohlcv?.data?.attributes?.ohlcv_list || [];

  // ── HELIUS DATA ──
  const heliusMap = helius || {};
  let sameSlotBundle = false;
  let freshWalletCount = 0;
  let veryFreshCount = 0;
  if (Object.keys(heliusMap).length > 0) {
    const slotGroups = {};
    for (const h of topHolders) {
      const hd = heliusMap[h.address];
      if (hd) {
        if (hd.isFresh) freshWalletCount++;
        if (hd.isVeryFresh) veryFreshCount++;
        if (hd.oldestSlot) {
          if (!slotGroups[hd.oldestSlot]) slotGroups[hd.oldestSlot] = [];
          slotGroups[hd.oldestSlot].push({ ...h, helius: hd });
        }
      }
    }
    const bundles = Object.values(slotGroups).filter(g => g.length >= 3 && g.every(w => w.helius.isFresh));
    if (bundles.length > 0) {
      sameSlotBundle = true;
      redFlags.push(bundles[0].length + ' fresh wallets created in same slot — HELIUS same-slot bundle detected');
      score -= 45;
    }
    if (veryFreshCount >= 3 && !sameSlotBundle) {
      redFlags.push(veryFreshCount + ' very fresh wallets (< 5 txs) in top holders — likely bundle');
      score -= 25;
    } else if (freshWalletCount >= 4 && !sameSlotBundle) {
      warnings.push(freshWalletCount + ' fresh wallets (< 15 txs) in top holders — watch');
      score -= 15;
    }
  }

  // ── SOLSCAN WALLET AGE ──
  const solscanAges = solscan?.walletAges || {};
  const solscanHolders = solscan?.holders || [];
  let solscanFreshCount = 0;
  let solscanVeryFreshCount = 0;
  for (const h of topHolders) {
    const age = solscanAges[h.address];
    if (age) {
      if (age.firstTxAgeDays !== null && age.firstTxAgeDays < 1) {
        solscanVeryFreshCount++;
        redFlags.push('Solscan: ' + (h.address?.slice(0,6) || '?') + '... wallet created today — extremely fresh');
        score -= 12;
      } else if (age.firstTxAgeDays !== null && age.firstTxAgeDays < 7) {
        solscanFreshCount++;
        warnings.push('Solscan: ' + (h.address?.slice(0,6) || '?') + '... wallet age ' + age.firstTxAgeDays + ' days — fresh');
        score -= 6;
      } else if (age.firstTxAgeDays !== null && age.firstTxAgeDays > 90) {
        greens.push('Solscan: ' + (h.address?.slice(0,6) || '?') + '... wallet age ' + age.firstTxAgeDays + ' days — established');
        score += 3;
      }
    }
  }
  if (solscanVeryFreshCount >= 3) {
    redFlags.push(solscanVeryFreshCount + ' top holders have wallets created today — strong bundle signal');
    score -= 25;
  } else if (solscanFreshCount >= 4) {
    warnings.push(solscanFreshCount + ' top holders have wallets < 7 days old');
    score -= 12;
  }

  // ── GMGN TOKEN DATA ──
  const gmgnToken = gmgn?.tokenData;
  if (gmgnToken) {
    const gmgnMc = gmgnToken?.market_cap || 0;
    const gmgnHolders = gmgnToken?.holder_count || 0;
    const gmgnTop10 = gmgnToken?.top_10_holder_rate || 0;
    if (gmgnMc > 0 && Math.abs(gmgnMc - mc) / Math.max(gmgnMc, mc) > 0.3) {
      warnings.push('GMGN mcap (' + fmt(gmgnMc) + ') differs from DexScreener — cross-check');
    }
    if (gmgnTop10 > 0.5) {
      redFlags.push('GMGN: Top 10 hold ' + (gmgnTop10 * 100).toFixed(0) + '% — extreme concentration');
      score -= 20;
    } else if (gmgnTop10 > 0.35) {
      warnings.push('GMGN: Top 10 hold ' + (gmgnTop10 * 100).toFixed(0) + '% — high concentration');
      score -= 8;
    }
    if (gmgnHolders > 0 && holders > 0 && Math.abs(gmgnHolders - holders) / Math.max(gmgnHolders, holders) > 0.25) {
      warnings.push('GMGN holder count (' + gmgnHolders + ') differs from other sources');
    }
  }

  // GeckoTerminal OHLCV pattern detection
  if (ohlcvList.length >= 3) {
    const last3 = ohlcvList.slice(-3);
    const allGreen = last3.every(c => c[4] > c[1]);
    const volInc = last3[2][5] > last3[1][5] && last3[1][5] > last3[0][5];
    if (allGreen && volInc) {
      greens.push('GeckoTerminal: 3 consecutive green 5m candles + volume ramp — bullish');
      score += 10;
    }
    const last = last3[2];
    const high = last[3], low = last[2], open = last[1], close = last[4];
    const body = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    if (upperWick > body * 2.5 && close < open) {
      warnings.push('GeckoTerminal: Long upper wick — rejection at highs');
      score -= 8;
    }
    if (lowerWick > body * 2.5 && close > open) {
      greens.push('GeckoTerminal: Hammer candle — bounce off lows');
      score += 5;
    }
  }

  // GeckoTerminal buyer/seller dominance
  if (gtBuyers24h > 0 && gtSellers24h > 0) {
    const gtTotal = gtBuyers24h + gtSellers24h;
    const gtBuyPct = (gtBuyers24h / gtTotal) * 100;
    if (gtBuyPct >= 65) { greens.push('GeckoTerminal: ' + gtBuyers24h + ' buyers vs ' + gtSellers24h + ' sellers in 24h — strong demand'); score += 5; }
    else if (gtBuyPct <= 35) { warnings.push('GeckoTerminal: ' + gtSellers24h + ' sellers vs ' + gtBuyers24h + ' buyers in 24h — distribution'); score -= 8; }
  }

  // Cross-reference GeckoTerminal 24h vol with DexScreener
  if (gtVol24h > 0 && Math.abs(gtVol24h - vol24h) / Math.max(gtVol24h, vol24h) > 0.5) {
    warnings.push('GeckoTerminal 24h vol (' + fmt(gtVol24h) + ') differs significantly from DexScreener — verify data');
  }

  const risks      = rugcheck?.risks || [];
  const creator    = rugcheck?.creator || '';

  const maxPct     = Math.max(...topHolders.map(h => h.pct || 0), 0);

  // FIX 2: UNKNOWN DATA PENALTY flags (applied after isRugged is set below)
  const hasHolderData = topHolders.length > 0;
  const hasDexData    = pairs.length > 0;

  // FIX 3: isActivelyTrading — used to bypass rugged on running tokens
  const isActivelyTrading = (vol5m > 500 || vol1h > 2000) && total5m >= 3 && p5m > -50;
  const isVeryActive      = vol5m > 2000 && total5m >= 10;

  // RUGGED detection
  const liquidityZero   = liquidity <= 0 && vol5m <= 0 && total5m <= 0;
  const priceCrashed    = p24h <= -(filters.rugPct) && p6h <= -(filters.rugPct);
  const priceDying      = p24h <= -70 && p6h <= -50;
  const volumeDeclining = vol5m < 100 && vol1h < 500;

  let isRugged = false;
  let isDying  = false;

  if (liquidityZero) {
    isRugged = true;
    redFlags.push('Liquidity pulled to $0 — RUGGED'); score -= 100; logScore('Liquidity $0 — RUGGED', -100, score);
  } else if (priceCrashed && volumeDeclining && !isActivelyTrading) {
    // Dead with no recovery — definitely rugged
    isRugged = true;
    redFlags.push('Down ' + Math.abs(p24h).toFixed(0) + '% + volume dead — RUGGED'); score -= 90; logScore('Price crash + dead volume', -90, score);
  } else if (priceCrashed && !isVeryActive && (!filters.skipRugActive || !isActivelyTrading)) {
    // FIX 3: Only call rugged if skipRugActive is OFF or token is not trading
    isRugged = true;
    redFlags.push('Down ' + Math.abs(p24h).toFixed(0) + '% from ATH — RUGGED'); score -= 80; logScore('Price crashed >'+filters.rugPct+'%', -80, score);
  } else if (priceCrashed && isActivelyTrading && filters.skipRugActive) {
    // FIX 3: Crashed but currently trading + user has skipRugActive ON = warn not rugged
    warnings.push('Down ' + Math.abs(p24h).toFixed(0) + '% from peak but actively trading — possible recovery or dead cat');
    score -= 25;
  } else if (priceDying && volumeDeclining) {
    isDying = true;
    redFlags.push('Down ' + Math.abs(p24h).toFixed(0) + '% from ATH, volume fading — GONNA DIE'); score -= 60;
  }

  // FIX 2: Apply unknown data penalty now that isRugged is defined
  if (!hasHolderData && !isRugged) {
    warnings.push('No holder data from Rugcheck — bundle/concentration unknown');
    score -= filters.vtPNoHolder; logScore('No holder data from Rugcheck', -filters.vtPNoHolder, score);
  }
  if (!hasDexData && !pumpfun?.mint && !isRugged) {
    warnings.push('No market data — token may be too new or delisted');
    score -= 15;
  }

  // FIX 6: DEAD CAT DETECTION — already pumped and dumped
  if (!isRugged && !isDying) {
    if (p24h <= -70 && p5m >= 5) {
      redFlags.push('Down ' + Math.abs(p24h).toFixed(0) + '% from peak — this bounce is likely a TRAP'); score -= 30;
    } else if (p24h <= -40 && p5m >= 10) {
      warnings.push('Already pumped — down ' + Math.abs(p24h).toFixed(0) + '% from peak, current move may be dead cat');
      score -= 15;
    }
  }

  // FAKE / BOTTED
  const isFake = filters.fakeDetect && !isActivelyTrading && (() => {
    if (total5m < 4) return false;
    const ratio = buys5m / total5m;
    const equalRatio = ratio >= 0.45 && ratio <= 0.55;
    return equalRatio && total5m < 12 && vol5m < 5000;
  })();

  if (isFake && !isRugged) {
    redFlags.push('Identical buy/sell pattern with zero real activity — FAKE/BOTTED'); score -= filters.vtPFake; logScore('FAKE/BOTTED chart pattern', -filters.vtPFake, score);
  }

  // PUMP.FUN
  if (pfComplete && pfRaydium) {
    greens.push('Bonded & live on Raydium — legit launch ✅');
    score += 5;
  } else if (pumpfun && !pfComplete) {
    warnings.push('Still on pump.fun bonding curve — not yet migrated');
  }

  // TRACKED WALLETS — Fixed: primary check is topHolders list (most reliable),
  // secondary check is tx history. A wallet HOLDING = in rugcheck topHolders.
  // A wallet TRADED = in earlyTraderAddrs tx list. Both are shown separately.
  let trackedVerdict = null;
  let stillHoldingCount = 0;
  let exitedCount = 0;

  if (trackedWallets.length > 0) {
    const mergedTraderAddrs = (earlyTraderAddrs || []).map(a => a.toLowerCase());
    // RugCheck topHolders is the ground truth for "currently holding"
    const holderAddrs = topHolders.map(h => (h.address || '').toLowerCase());
    const trackedAddrs = trackedWallets
      .map(w => (typeof w === 'string' ? w : (w.address || '')).toLowerCase())
      .filter(Boolean);

    // PRIMARY: who is currently in top holders (definitely holding)
    stillHoldingCount = trackedAddrs.filter(w => holderAddrs.includes(w)).length;
    // SECONDARY: who appeared in recent tx history (may have bought & sold)
    const matchedInTx = trackedAddrs.filter(w => mergedTraderAddrs.includes(w)).length;
    // Exited = appeared in tx but NOT in current holders
    exitedCount = Math.max(0, matchedInTx - trackedAddrs.filter(w => mergedTraderAddrs.includes(w) && holderAddrs.includes(w)).length);
    // Total visible = holding + those only seen in tx (not double counting)
    const totalMatched = Math.max(stillHoldingCount, matchedInTx);

    if (totalMatched === 0) {
      // Don't penalise — DexScreener only gives last ~30 txs, absence is normal
      trackedVerdict = 'none';
    } else if (totalMatched <= 2) {
      warnings.push('Only ' + totalMatched + ' tracked wallet(s) found — ' + stillHoldingCount + ' holding, ' + exitedCount + ' exited');
      score -= 10; logScore('Few tracked wallets', -10, score);
      trackedVerdict = 'few';
    } else {
      greens.push(totalMatched + ' tracked wallets — ' + stillHoldingCount + ' STILL HOLDING' + (exitedCount > 0 ? ', ' + exitedCount + ' exited' : '') + ' ✅');
      score += filters.vtBTracked; logScore('Tracked wallets holding', filters.vtBTracked, score);
      trackedVerdict = 'good';
    }
  }

  // DEV
  const devHolder = topHolders.find(h => h.address === creator || h.isAuthority || h.type === 'creator');
  const devPct = devHolder ? (devHolder.pct || 0) * 1 : 0;
  if (devPct === 0) { greens.push('Dev holding 0% — clean'); score += filters.vtBDevZero; logScore('Dev holding 0%', filters.vtBDevZero, score); }
  else if (devPct <= 3) { greens.push('Dev holding ' + devPct.toFixed(1) + '% — acceptable'); score += filters.vtBDevOk; logScore('Dev '+devPct.toFixed(1)+'% acceptable', filters.vtBDevOk, score); }
  else if (devPct <= filters.devMax) { warnings.push('Dev holding ' + devPct.toFixed(1) + '% — borderline'); score -= filters.vtPDevBorder; logScore('Dev '+devPct.toFixed(1)+'% borderline', -filters.vtPDevBorder, score); }
  else { redFlags.push('Dev holding ' + devPct.toFixed(1) + '% — DANGER'); score -= filters.vtPDevDanger; logScore('Dev '+devPct.toFixed(1)+'% DANGER', -filters.vtPDevDanger, score); }

  // NUKE WALLETS + SOL BALANCE
  let nukeCount = 0;
  let bundleSolCount = 0;
  const holderSolBals = solBalances || {};
  for (const h of topHolders.filter(h => h.address !== creator)) {
    const pct = (h.pct || 0);
    const addr = h.address ? h.address.slice(0,5) + '...' + h.address.slice(-4) : '?';
    if (h.address && holderSolBals[h.address] !== undefined) {
      const sol = holderSolBals[h.address];
      if (sol < 1) {
        warnings.push(addr + ' holds ' + pct.toFixed(1) + '% but <1 SOL — 90% bundle wallet');
        bundleSolCount++;
        score -= 8;
      }
    }
    if (pct > filters.nukePct) { redFlags.push('Wallet ' + addr + ' holds ' + pct.toFixed(1) + '% — NUKE RISK'); score -= 35; nukeCount++; }
    else if (pct > filters.nukePct - 0.5) { warnings.push('Wallet ' + addr + ' holds ' + pct.toFixed(1) + '% — watch'); score -= 12; }
  }
  if (nukeCount === 0 && !isRugged) greens.push('No single-wallet nuke risk');
  if (bundleSolCount > 0) warnings.push(bundleSolCount + ' top holder(s) flagged as bundle wallets (< 1 SOL balance)');

  // TOP 10
  const top10Pct = topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);
  if (top10Pct > 70) { redFlags.push('Top 10 hold ' + top10Pct.toFixed(1) + '% — concentrated'); score -= 30; }
  else if (top10Pct > filters.top10Warn) { warnings.push('Top 10 hold ' + top10Pct.toFixed(1) + '% — moderate'); score -= 12; }
  else if (!isRugged) { greens.push('Top 10 hold ' + top10Pct.toFixed(1) + '% — good distribution'); }

  // FRESH WALLETS
  const freshWallets = topHolders.filter(h => h.insider || h.tags?.includes('fresh') || h.isFresh);
  if (freshWallets.length >= 3) {
    redFlags.push(freshWallets.length + ' fresh wallets in top holders — likely bundle');
    score -= 20 * Math.min(freshWallets.length, 3);
  } else if (freshWallets.length >= 2) {
    warnings.push(freshWallets.length + ' fresh wallets in top holders — watch');
    score -= 10;
  }

  // CLUSTER DETECTION
  const smallHolders = topHolders.filter(h => {
    const pct = (h.pct || 0);
    return pct >= 1 && pct <= 3.5 && h.address !== creator;
  });
  const clusterPct = smallHolders.reduce((s, h) => s + (h.pct || 0), 0);
  if (smallHolders.length >= 5 && clusterPct > 15) {
    redFlags.push('Bundle cluster: ' + smallHolders.length + ' wallets = ' + clusterPct.toFixed(1) + '% — coordinated');
    score -= 35;
  } else if (smallHolders.length >= 3 && clusterPct > 10) {
    warnings.push(smallHolders.length + ' similar-sized wallets hold ' + clusterPct.toFixed(1) + '% — watch');
    score -= 15;
  }

  // BUNDLES
  const rt = r => (r.description || r.name || '').toLowerCase();
  const bundleRisk  = risks.find(r => rt(r).includes('bundle'));
  const snipeRisk   = risks.find(r => rt(r).includes('sniper') || rt(r).includes('snipe'));
  const insiderRisk = risks.find(r => rt(r).includes('insider') || rt(r).includes('coordinated'));
  if (bundleRisk)  { redFlags.push('Bundle: ' + (bundleRisk.description || bundleRisk.name)); score -= filters.vtPBundle; logScore('Bundle detected', -filters.vtPBundle, score); }
  if (snipeRisk)   { warnings.push('Sniper: ' + (snipeRisk.description || snipeRisk.name)); score -= 15; }
  if (insiderRisk) { redFlags.push('Insider/coordinated wallets'); score -= 25; }
  if (!bundleRisk && !insiderRisk && !isRugged) greens.push('No bundle/insider flags');

  // ── GMGN SECURITY CHECKS (from official API) ──
  const gmgnSec = gmgn?.security || gmgn?.securityData || null;
  if (gmgnSec) {
    // Honeypot — can't sell
    if (gmgnSec.is_honeypot === true || gmgnSec.honeypot === true) {
      redFlags.push('HONEYPOT detected — you cannot sell this token');
      score -= 100;
      logScore('HONEYPOT', -100, score);
    }
    // Blacklist — dev can freeze wallets
    if (gmgnSec.is_blacklist === true || gmgnSec.blacklist === true) {
      redFlags.push('Blacklist enabled — dev can freeze your wallet');
      score -= 40;
      logScore('Blacklist enabled', -40, score);
    }
    // Mintable — dev can print more tokens
    if (gmgnSec.is_mintable === true || gmgnSec.mintable === true) {
      redFlags.push('Token is mintable — dev can inflate supply');
      score -= 30;
      logScore('Mintable token', -30, score);
    }
    // LP burned — good sign
    const lpBurned = gmgnSec.lp_burned_pct || gmgnSec.burn_ratio || 0;
    if (lpBurned >= 99) {
      greens.push('LP 100% burned — cannot rug liquidity');
      score += 8;
      logScore('LP fully burned', +8, score);
    } else if (lpBurned >= 50) {
      greens.push('LP ' + lpBurned.toFixed(0) + '% burned');
      score += 4;
    } else if (lpBurned < 20 && lpBurned > 0) {
      warnings.push('LP only ' + lpBurned.toFixed(0) + '% burned — rug risk');
      score -= 10;
    }
    // Contract renounced — good
    if (gmgnSec.renounced === true || gmgnSec.is_renounced === true) {
      greens.push('Contract renounced — dev cannot modify');
      score += 5;
      logScore('Contract renounced', +5, score);
    }
    // Rug probability from GMGN
    const rugProb = gmgnSec.rug_ratio || gmgnSec.rug_probability || 0;
    if (rugProb > 0.7) {
      redFlags.push('GMGN rug probability: ' + (rugProb * 100).toFixed(0) + '% — HIGH');
      score -= 35;
      logScore('GMGN rug probability high', -35, score);
    } else if (rugProb > 0.4) {
      warnings.push('GMGN rug probability: ' + (rugProb * 100).toFixed(0) + '%');
      score -= 15;
    } else if (rugProb < 0.1 && rugProb > 0) {
      greens.push('GMGN rug probability: ' + (rugProb * 100).toFixed(0) + '% — LOW');
      score += 5;
    }
  }

  // ── SMART MONEY & KOL HOLDERS (from GMGN official API) ──
  const smartMoney  = gmgn?.smartMoney  || [];
  const kolHolders  = gmgn?.kolHolders  || [];
  if (smartMoney.length > 0 && !isRugged) {
    greens.push(smartMoney.length + ' smart money wallet(s) holding ✅');
    score += Math.min(smartMoney.length * 5, 20);
    logScore('Smart money holding x' + smartMoney.length, Math.min(smartMoney.length * 5, 20), score);
  }
  if (kolHolders.length > 0 && !isRugged) {
    greens.push(kolHolders.length + ' KOL wallet(s) holding 🔥');
    score += Math.min(kolHolders.length * 8, 25);
    logScore('KOL holding x' + kolHolders.length, Math.min(kolHolders.length * 8, 25), score);
  }

  const handled = [bundleRisk, snipeRisk, insiderRisk].filter(Boolean);
  for (const r of risks) {
    if (handled.includes(r)) continue;
    const lvl = (r.level || '').toLowerCase();
    if (lvl === 'danger' || lvl === 'critical') { redFlags.push(r.description || r.name || 'Critical risk'); score -= 20; }
    else if (lvl === 'warn') { warnings.push(r.description || r.name || 'Warning'); score -= 5; }
  }

  // 5m VOL/MC
  const volMcRatio = (mc > 0 && vol5m > 0) ? (vol5m / mc) * 100 : 0;
  if (mc > 0 && vol5m > 0 && !isRugged) {
    if (volMcRatio >= filters.volmcGold)   { greens.push('5m Vol/MC: ' + volMcRatio.toFixed(0) + '% — MASSIVE 🔥🔥'); score += filters.vtBVolmcMassive; logScore('Vol/MC '+volMcRatio.toFixed(0)+'% massive', filters.vtBVolmcMassive, score); }
    else if (volMcRatio >= filters.volmcStrong) { greens.push('5m Vol/MC: ' + volMcRatio.toFixed(0) + '% — strong 🔥'); score += filters.vtBVolmcStrong; logScore('Vol/MC '+volMcRatio.toFixed(0)+'% strong', filters.vtBVolmcStrong, score); }
    else if (volMcRatio >= filters.volmcMin) { warnings.push('5m Vol/MC: ' + volMcRatio.toFixed(0) + '% — average'); }
    else { redFlags.push('5m Vol/MC: ' + volMcRatio.toFixed(0) + '% — weak'); score -= filters.vtPVolmcWeak; logScore('Vol/MC '+volMcRatio.toFixed(0)+'% weak', -filters.vtPVolmcWeak, score); }
  }

  // 24h VOL/MC
  const vol24hMcRatio = (mc > 0 && vol24h > 0) ? vol24h / mc : 0;
  if (mc > 0 && vol24h > 0 && !isRugged) {
    if (vol24hMcRatio < 0.8) {
      redFlags.push('24h Vol/MC: ' + (vol24hMcRatio*100).toFixed(0) + '% — below 80% (bundle signal)');
      score -= 20;
    } else if (vol24hMcRatio >= 1.0) {
      greens.push('24h Vol/MC: ' + (vol24hMcRatio*100).toFixed(0) + '% — healthy (vol > MC)');
      score += 5;
    }
  }

  // TRANSACTION ACTIVITY
  if (!isRugged && !isFake) {
    if (total5m >= 15) { greens.push(total5m + ' txns in 5m — organic'); score += 5; }
    else if (total5m > 0 && total5m < filters.txnMin) { warnings.push('Low activity: ' + total5m + ' txns in 5m'); score -= 10; }
  }

  // LIQUIDITY
  if (!liquidityZero) {
    if (liquidity < filters.liqMin) { redFlags.push('Liquidity $' + liquidity.toFixed(0) + ' — extremely thin'); score -= filters.vtPLiqThin; logScore('Liquidity extremely thin', -filters.vtPLiqThin, score); }
    else if (liquidity < filters.liqMin * 5) { warnings.push('Low liquidity $' + Math.round(liquidity/1000) + 'K'); score -= 8; }
    else if (!isRugged) { greens.push('Liquidity $' + (liquidity/1000).toFixed(1) + 'K'); }
  }

  // ── TWITTER NARRATIVE (from OpenTwitter MCP) ──
  let twitterNarrScore = 0;
  if (twitterData && twitterData.tweets && twitterData.tweets.length > 0) {
    twitterNarrScore = twitterData.narrScore || 0;
    if (twitterNarrScore >= 70) {
      greens.push('Strong Twitter narrative — ' + twitterData.tweets.length + ' relevant tweets 🔥');
      score += 15; logScore('Strong Twitter narrative', +15, score);
    } else if (twitterNarrScore >= 40) {
      greens.push('Moderate Twitter activity (' + twitterData.tweets.length + ' tweets)');
      score += 5; logScore('Moderate Twitter activity', +5, score);
    } else {
      warnings.push('Low Twitter engagement found');
    }
  } else if (twitterData && twitterData.hasKey && !isRugged) {
    warnings.push('No tweets found for this token — weak narrative');
    score -= 8; logScore('No Twitter narrative', -8, score);
  }

  // AGE
  if (pairAge !== null && !isRugged) {
    if (pairAge < 5) { greens.push('Age: ' + formatAge(pairAge) + ' — very fresh'); score += filters.vtBAgeFresh; logScore('Token very fresh', filters.vtBAgeFresh, score); }
    else if (pairAge < 30) { greens.push('Age: ' + formatAge(pairAge) + ' — still early'); }
    else if (pairAge > 2880) { warnings.push('Age: ' + formatAge(pairAge) + ' — older token'); score -= 5; }
  }

  // FIX 5: MINIMUM HOLDER COUNT — real runners need real holders
  const holderCount = holders || gmgn?.tokenData?.holder_count || pumpfun?.holder_count || 0;
  if (holderCount > 0 && !isRugged) {
    if (holderCount < (filters.vtHoldersVeryThin ?? 50)) {
      redFlags.push('Only ' + holderCount + ' holders — extremely thin, likely fake/bundled');
      score -= (filters.vtPHoldersThin ?? 30); logScore('Only '+holderCount+' holders very thin', -(filters.vtPHoldersThin ?? 30), score);
    } else if (holderCount < (filters.vtHoldersThin ?? 100)) {
      redFlags.push('Only ' + holderCount + ' holders — too few for a real runner');
      score -= 20; logScore('Only '+holderCount+' holders', -20, score);
    } else if (holderCount < (filters.vtHoldersBuilding ?? 200)) {
      warnings.push('Only ' + holderCount + ' holders — still building');
      score -= 8; logScore('Only '+holderCount+' holders building', -8, score);
    } else if (holderCount > (filters.vtMinHolders ?? 100)) {
      greens.push(holderCount.toLocaleString() + ' holders — good distribution');
      score += (filters.vtBHoldersGood ?? 5); logScore(holderCount+' holders good', (filters.vtBHoldersGood ?? 5), score);
    }
  }

  // CHART PATTERN
  if (pairAge !== null && pairAge < 10 && vol5m < 1000 && mc > 100000) {
    warnings.push('Instant MC pump with very low volume — possible dev staircase');
    score -= 15;
  }
  const priceAccel = p5m - (p1h / 12);
  if (priceAccel > 50 && vol5m < 2000) {
    warnings.push('Price accelerating faster than volume supports — artificial pump');
    score -= 12;
  }

  // BUNDLE %
  let bundlePct = 0;

  // Source 1: Rugcheck explicit description
  if (bundleRisk) {
    const m = (bundleRisk.description || '').match(/(\d+(\.\d+)?)\s*%/);
    bundlePct = m ? parseFloat(m[1]) : 20;
  }

  // Source 2: Rugcheck direct bundled field
  if (!bundlePct && rugcheck?.bundled) bundlePct = parseFloat(rugcheck.bundled) || 0;

  // Source 3: GMGN bundle rate — now from official API
  // Official API returns bundle_ratio as 0-1 float; unofficial returns bundled_rate
  const gmgnBundleRate = gmgn?.tokenData?.bundle_ratio
    || gmgn?.tokenData?.bundled_rate
    || gmgn?.tokenData?.bundle_rate
    || 0;
  if (gmgnBundleRate > 0) bundlePct = Math.max(bundlePct, gmgnBundleRate * 100);

  // Source 3b: GMGN insider ratio (separate from bundle)
  const gmgnInsiderRatio = gmgn?.tokenData?.insider_ratio
    || gmgn?.tokenData?.rat_trader_ratio
    || 0;
  if (gmgnInsiderRatio > 0.15) {
    warnings.push('GMGN: ' + (gmgnInsiderRatio * 100).toFixed(0) + '% insider/rat trader ratio');
    score -= filters.vtPInsider || 15;
    logScore('GMGN insider ratio ' + (gmgnInsiderRatio*100).toFixed(0) + '%', -(filters.vtPInsider || 15), score);
  }

  // Source 4: Tiny wallet clustering
  const tinyHolders = topHolders.filter(h => (h.pct || 0) < 0.5 && (h.pct || 0) > 0);
  if (!bundlePct && tinyHolders.length > 5) bundlePct = Math.min(tinyHolders.length * 1.5, 45);
  if (clusterPct > 0) bundlePct = Math.max(bundlePct, clusterPct);

  // Source 5: Helius same-slot detection
  if (sameSlotBundle) bundlePct = Math.max(bundlePct, 25);

  // TOP 70 % — BUG FIX 3: GMGN top_70_holder_rate as primary
  let top70Pct = 0;
  const gmgnTop70 = gmgn?.tokenData?.top_70_holder_rate || 0;
  if (gmgnTop70 > 0) {
    top70Pct = gmgnTop70 * 100;
  } else if (topHolders.length > 0) {
    top70Pct = topHolders.slice(0, 70).reduce((s, h) => s + (h.pct || 0), 0);
  }

  // NARRA SCORE
  const narrScore = calcNarraScore(sym, name, pairAge, volMcRatio, pumpfun);

  score = Math.max(0, Math.min(100, score));

  // MCap filter
  if (filters.mcMin > 0 && mc < filters.mcMin) { warnings.push('MCap ' + fmt(mc) + ' below your min filter'); }
  if (filters.mcMax > 0 && mc > filters.mcMax) { warnings.push('MCap ' + fmt(mc) + ' above your max filter'); }

  // VERDICT — all thresholds come from Verdict Tuner (Filters tab)
  let verdict, vClass, vEmoji;
  if (liquidityZero) {
    verdict = 'RUGGED — AVOID'; vClass = 'rugged'; vEmoji = '💀';
  } else if (isRugged) {
    verdict = 'RUGGED — AVOID'; vClass = 'rugged'; vEmoji = '💀';
  } else if (isDying) {
    verdict = 'GONNA DIE — EXIT'; vClass = 'rugged'; vEmoji = '☠️';
  } else if (isFake) {
    verdict = 'FAKE / BOTTED — SKIP'; vClass = 'fake'; vEmoji = '🤖';
  } else if (redFlags.length >= (filters.vtRedFlagRisky ?? 3) || score < (filters.vtScoreRisky ?? 30)) {
    verdict = 'RISKY — SKIP'; vClass = 'risky'; vEmoji = '🔴';
  } else if (redFlags.length >= (filters.vtRedFlagHighRisk ?? 2) || score < (filters.vtScoreHighRisk ?? 50)) {
    verdict = 'HIGH RISK'; vClass = 'risky'; vEmoji = '🔴';
  } else if (redFlags.length >= (filters.vtRedFlagModerate ?? 1) || score < (filters.vtScoreModerate ?? 65)) {
    verdict = 'MODERATE — Careful'; vClass = 'moderate'; vEmoji = '🟡';
  } else if (score >= (filters.vtScoreRunner ?? 80)) {
    verdict = 'POTENTIAL RUNNER 🚀'; vClass = 'runner'; vEmoji = '🟢';
  } else {
    verdict = 'DECENT — Check narra'; vClass = 'moderate'; vEmoji = '🟡';
  }

  // MOMENTUM — Bug 13: Price-based momentum as primary
  let momentum = null;
  if (lastScanResult && lastScanResult.ca === currentCA) {
    const prevVolMc = lastScanResult.volMcRatio || 0;
    const currVolMc = volMcRatio;
    const prevPrice = lastScanResult.priceUsd || 0;
    const priceChange = (priceUsd > 0 && prevPrice > 0) ? ((priceUsd - prevPrice) / prevPrice) * 100 : 0;

    if (p5m > 20) momentum = '🚀 EXPLODING';
    else if (p1h > 100) momentum = '🔥 PARABOLIC';
    else if (p5m > 10) momentum = '📈 STRONG PUMP';
    else if (p5m < -15) momentum = '📉 CRASHING';
    else if (p1h < -50) momentum = '💀 DYING';
    else if (currVolMc > prevVolMc * 1.2) momentum = '📈 MOMENTUM UP';
    else if (currVolMc < prevVolMc * 0.8) momentum = '📉 MOMENTUM DOWN';
    else momentum = '➡️ STEADY';
  }

  // Store current scan for next comparison (alert detection)
  const currentScanData = {
    ca: currentCA, mc, vol5m, vol1h, liquidity, total5m, holders, p5m, p1h, p6h, p24h,
    priceUsd, score, verdict, vClass, buys5m, sells5m, pairAge, pfBonding,
    topHolders: topHolders.slice(0, 20).map(h => ({
      address: h.address, pct: (h.pct || 0),
      insider: h.insider || h.tags?.includes('fresh') || h.isFresh
    })),
    time: Date.now()
  };

  return {
    verdict, vClass, vEmoji, score, redFlags, warnings, greens, trackedVerdict,
    stillHoldingCount, exitedCount,
    token: { sym, name, img,
      about: pumpfun?.description || pumpfun?.about || pumpfun?.metadata?.description || '',
      twitter: pumpfun?.twitter || pumpfun?.metadata?.twitter || '',
      website: pumpfun?.website || pumpfun?.metadata?.website || '',
      telegram: pumpfun?.telegram || pumpfun?.metadata?.telegram || ''
    },
    data: { mc, vol5m, liquidity, buys5m, sells5m, pairAge, p5m, p1h, p24h, volMcRatio, vol24h, holders, priceUsd, pfBonding, total5m, devPct, top10Pct },
    extras: { bundlePct, hasHolderData, top70Pct, narrScore, twitterNarrScore, twitterData, volMcRatio, vol24hMcRatio, isRugged, liquidityZero, isFake, isDying, isActivelyTrading, momentum, gtBuyers24h, gtSellers24h, gtVol24h, gtLiq, sameSlotBundle, freshWalletCount, veryFreshCount, solscanFreshCount, solscanVeryFreshCount, gmgnTop10: gmgn?.tokenData?.top_10_holder_rate || 0, platformSource: platformSource || 'dexscreener' },
    _currentScan: currentScanData
  };
}

function calcNarraScore(sym, name, ageMin, volMcRatio, pumpfun) {
  let s = 45;
  const c = (sym + ' ' + name).toLowerCase();
  const hot = ['trump','elon','musk','pepe','doge','maga','ai','gpt','bitcoin','sol','pump','ape','moon','based','chad','wojak','cat','dog','frog','viral','tiktok','meme','president'];
  const pol = ['president','congress','senate','election','white house','fed','reserve'];
  const tec = ['robot','quantum','neural','cyber','matrix','defi','meta'];
  if (hot.some(t => c.includes(t))) s += 18;
  if (pol.some(t => c.includes(t))) s += 12;
  if (tec.some(t => c.includes(t))) s += 8;

  const pfDesc = (pumpfun?.description || '').toLowerCase();
  if (pfDesc.length > 20) s += 8;
  if (hot.some(t => pfDesc.includes(t))) s += 10;

  if (ageMin !== null) {
    if (ageMin < 5) s += 20;
    else if (ageMin < 15) s += 12;
    else if (ageMin < 30) s += 5;
    else if (ageMin > 2880) s -= 15;
    else if (ageMin > 1440) s -= 8;
  }
  if (volMcRatio >= 140) s += 18;
  else if (volMcRatio >= 85) s += 10;
  else if (volMcRatio < 30) s -= 10;
  if (pumpfun?.complete) s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// ═══════════════════════════════════════════════
// LIVE ALERTS ENGINE — all new alerts
// ═══════════════════════════════════════════════

// Store for cross-scan comparison
let _prevScan = null;
let _prevTrades = {};
let _alertHistory = [];

function generateLiveAlerts(current, prev, trades) {
  const events = [];
  if (!current) return events;

  const { mc, vol5m, vol1h, liquidity, total5m, holders, p5m, p1h, p6h, p24h,
          priceUsd, buys5m, sells5m, pairAge, pfBonding, sym, score, vClass } = current;

  // BUG FIX 14: Suppress positive alerts when verdict is RUGGED/FAKE
  const isSevere = vClass === 'rugged' || vClass === 'fake';
  if (isSevere && p5m > 10 && vol5m > 1000 && total5m > 3) {
    events.push({
      type: 'warn', icon: '⚠️',
      text: '<strong style="color:var(--yellow)">SUSPICIOUS — Verify liquidity</strong> Price pumping but data unclear. Check Axiom manually.'
    });
  }

  const prevData = prev || {};

  // ── 1. DEV / CREATOR WALLET MOVEMENT ──
  // Detected from trades analysis
  const devEvents = detectDevMovement(trades, current);
  events.push(...devEvents);

  // ── 2. LIQUIDITY DRAIN ALERT ──
  if (prevData.liquidity && liquidity > 0) {
    const liqChange = (liquidity - prevData.liquidity) / prevData.liquidity;
    if (liqChange < -0.3) {
      events.push({
        type: 'sell', icon: '🩸',
        text: '<strong style="color:var(--red)">LIQUIDITY DRAINING</strong> — Down ' + Math.abs(liqChange*100).toFixed(0) + '% in 5m (' + fmt(prevData.liquidity) + ' → ' + fmt(liquidity) + ')'
      });
    }
    if (liquidity < 2000 && prevData.liquidity >= 2000) {
      events.push({
        type: 'sell', icon: '🔴',
        text: '<strong style="color:var(--red)">LIQUIDITY CRITICAL</strong> — Only ' + fmt(liquidity) + ' left — RUG IMMINENT'
      });
    }
  }

  // ── 3. HOLDER COUNT CHANGE ──
  if (prevData.holders && holders > 0) {
    const hDiff = holders - prevData.holders;
    if (hDiff >= 20) {
      events.push({
        type: 'buy', icon: '📈',
        text: '<strong style="color:var(--green)">HOLDERS +' + hDiff + '</strong> in 5m — growing fast (' + holders + ' total)'
      });
    } else if (hDiff <= -10) {
      events.push({
        type: 'sell', icon: '📉',
        text: '<strong style="color:var(--red)">HOLDERS ' + hDiff + '</strong> in 5m — people leaving (' + holders + ' total)'
      });
    } else if (hDiff === 0 && total5m > 5) {
      events.push({
        type: 'warn', icon: '🚨',
        text: 'HOLDERS STUCK — No new buyers in 5m despite ' + total5m + ' txns'
      });
    }
  }

  // ── 4. MCAP MILESTONES ──
  if (!isSevere) {
    const milestones = [25000, 50000, 100000, 250000, 500000, 1000000, 5000000];
    for (const m of milestones) {
      if (prevData.mc && prevData.mc < m && mc >= m) {
        const label = m >= 1e6 ? (m/1e6).toFixed(0) + 'M' : (m/1000).toFixed(0) + 'K';
        events.push({
          type: 'buy', icon: '🎯',
          text: '<strong style="color:var(--gold)">MCAP HIT $' + label + '</strong> — major milestone reached'
        });
        break;
      }
    }
  }

  // ── 5. PRICE REVERSAL PATTERNS (in Mcap) ──
  if (prevData.mc && mc > 0) {
    // Support/Resistance based on recent history
    if (prevData.p5m && p5m > 0 && prevData.p5m < 0) {
      events.push({
        type: 'buy', icon: '🔄',
        text: '<strong style="color:var(--green)">REVERSAL DETECTED</strong> — Price bounced at ' + fmt(mc) + ' mcap'
      });
    }
    if (prevData.p5m && p5m < -5 && prevData.p5m > 0) {
      events.push({
        type: 'sell', icon: '📉',
        text: '<strong style="color:var(--red)">SUPPORT BROKEN</strong> — Dropped below ' + fmt(prevData.mc) + ' mcap level'
      });
    }
    // Resistance break
    if (prevData.mc && mc > prevData.mc * 1.15 && p5m > 10) {
      events.push({
        type: 'buy', icon: '📈',
        text: '<strong style="color:var(--green)">RESISTANCE CLEARED</strong> — Broke above ' + fmt(prevData.mc) + ' mcap'
      });
    }
  }

  // ── 6. SMART MONEY SIGNALS ──
  if (!isSevere) {
    const smartEvents = detectSmartMoney(trades, current);
    events.push(...smartEvents);
  }

  // ── 7. VOLUME ANOMALY ──
  if (prevData.vol5m && prevData.vol5m > 0 && vol5m > 0) {
    const volRatio = vol5m / prevData.vol5m;
    if (volRatio >= 8) {
      events.push({
        type: 'buy', icon: '📊',
        text: '<strong style="color:var(--gold)">VOLUME SPIKE</strong> — ' + volRatio.toFixed(0) + '× normal 5m average'
      });
    } else if (volRatio < 0.1 && prevData.vol5m > 1000) {
      events.push({
        type: 'sell', icon: '🔇',
        text: '<strong style="color:var(--red)">VOLUME DEATH</strong> — 90% below previous 5m average'
      });
    }
  }
  // Wash trading detection over time
  if (prevData.buys5m && prevData.sells5m && buys5m && sells5m) {
    const prevRatio = prevData.buys5m / (prevData.buys5m + prevData.sells5m);
    const currRatio = buys5m / total5m;
    if (Math.abs(currRatio - 0.5) < 0.03 && Math.abs(prevRatio - 0.5) < 0.03 && total5m > 8) {
      events.push({
        type: 'bundle', icon: '🔄',
        text: '<strong style="color:var(--yellow)">WASH TRADING</strong> — Buy/sell ratio stuck at 50/50 for 10m+'
      });
    }
  }

  // ── 8. PUMP.FUN SPECIFIC ──
  if (pfBonding > 0) {
    if (pfBonding >= 85 && (!prevData.pfBonding || prevData.pfBonding < 85)) {
      events.push({
        type: 'buy', icon: '🎯',
        text: '<strong style="color:var(--gold)">BONDING ' + pfBonding.toFixed(0) + '%</strong> — Close to Raydium migration'
      });
    }
    if (pfBonding >= 100 && (!prevData.pfBonding || prevData.pfBonding < 100)) {
      events.push({
        type: 'buy', icon: '✅',
        text: '<strong style="color:var(--green)">MIGRATED TO RAYDIUM</strong> — Now live on DEX'
      });
    }
  }

  // ── 9. MULTI-TIMEFRAME MOMENTUM ──
  if (p5m !== undefined && p1h !== undefined && p6h !== undefined) {
    const m5trend = p5m > 0 ? '+' + p5m.toFixed(0) + '%' : p5m.toFixed(0) + '%';
    const h1trend = p1h > 0 ? '+' + p1h.toFixed(0) + '%' : p1h.toFixed(0) + '%';
    const h6trend = p6h > 0 ? '+' + p6h.toFixed(0) + '%' : p6h.toFixed(0) + '%';

    if (p5m > 5 && p1h > 20 && p6h > 50) {
      events.push({
        type: 'buy', icon: '📈',
        text: '<strong style="color:var(--green)">STRONG UPTREND</strong> — 5m: ' + m5trend + ' | 1h: ' + h1trend + ' | 6h: ' + h6trend
      });
    } else if (p5m < -5 && p1h < -20 && p6h < -40) {
      events.push({
        type: 'sell', icon: '📉',
        text: '<strong style="color:var(--red)">DOWNTREND ACCELERATING</strong> — 5m: ' + m5trend + ' | 1h: ' + h1trend + ' | 6h: ' + h6trend
      });
    } else if (p5m > 10 && vol5m < (prevData.vol5m || vol5m) * 0.5) {
      events.push({
        type: 'warn', icon: '⚠️',
        text: '<strong style="color:var(--yellow)">DIVERGENCE</strong> — Price up ' + p5m.toFixed(0) + '% but volume down 40%+'
      });
    }
  }

  // ── 10. BUNDLE / INSIDER ACTIVITY ──
  const bundleEvents = detectBundleActivity(trades, current, prev);
  events.push(...bundleEvents);

  // ── 11. RISK ESCALATION ──
  if (prevData.score && score !== undefined) {
    const scoreDrop = prevData.score - score;
    if (scoreDrop >= 20) {
      events.push({
        type: 'sell', icon: '⚠️',
        text: '<strong style="color:var(--red)">RISK ESCALATED</strong> — Score dropped ' + scoreDrop + ' points (' + prevData.score + ' → ' + score + ')'
      });
    }
    if (prevData.vClass === 'runner' && vClass === 'moderate') {
      events.push({
        type: 'sell', icon: '🔴',
        text: '<strong style="color:var(--red)">VERDICT CHANGED</strong> — RUNNER → MODERATE (momentum fading)'
      });
    }
    if (score < 30 && prevData.score >= 30) {
      events.push({
        type: 'sell', icon: '🚨',
        text: '<strong style="color:var(--red)">CRITICAL</strong> — Score below 30, consider immediate exit'
      });
    }
  }

  // ── 12. WHALE ALERTS (14+ SOL buy, 16+ SOL sell) ──
  const whaleEvents = detectWhaleAlerts(trades);
  events.push(...whaleEvents);

  // ── 13. FIRST SCAN BASELINE ──
  if (!prev) {
    events.push({
      type: 'info', icon: '👁️',
      text: 'First scan — baseline established. Alerts will fire on changes.'
    });
  }

  return events;
}

// ── DEV MOVEMENT DETECTION ──
function detectDevMovement(trades, current) {
  const events = [];
  if (!trades || !trades.length) return events;

  // We need creator address from rugcheck — passed via current._creator or similar
  // For now, detect any wallet with very high sell activity
  const walletActivity = {};
  for (const t of trades) {
    const maker = t.maker || t.from || '';
    if (!maker) continue;
    if (!walletActivity[maker]) walletActivity[maker] = { buys: 0, sells: 0, buySol: 0, sellSol: 0 };
    const amtSol = parseFloat(t.volumeUsd || t.amountUsd || 0) / 150;
    const type = (t.type || '').toLowerCase();
    if (type === 'buy') { walletActivity[maker].buys++; walletActivity[maker].buySol += amtSol; }
    else { walletActivity[maker].sells++; walletActivity[maker].sellSol += amtSol; }
  }

  for (const [addr, act] of Object.entries(walletActivity)) {
    const short = addr.slice(0, 6);
    // High sell activity = potential dev dump
    if (act.sellSol > 5 && act.sells >= 2) {
      events.push({
        type: 'sell', icon: '🚨',
        text: '<strong style="color:var(--red)">DEV WALLET MOVED</strong> — <a class="live-link" href="https://solscan.io/account/' + addr + '" target="_blank">' + short + '...</a> sold ' + act.sellSol.toFixed(1) + ' SOL in ' + act.sells + ' txs'
      });
    }
    // Creator reward claim pattern
    if (act.buySol < 0.1 && act.sellSol > 3) {
      events.push({
        type: 'warn', icon: '⚠️',
        text: '<strong style="color:var(--yellow)">CREATOR CLAIMED</strong> — <a class="live-link" href="https://solscan.io/account/' + addr + '" target="_blank">' + short + '...</a> extracted ' + act.sellSol.toFixed(1) + ' SOL (no buy activity)'
      });
    }
  }

  return events;
}

// ── SMART MONEY DETECTION ──
function detectSmartMoney(trades, current) {
  const events = [];
  if (!trades || !trades.length || !trackedWallets.length) return events;

  const trackedAddrs = trackedWallets
    .map(w => (typeof w === 'string' ? w : (w.address || '')).toLowerCase())
    .filter(Boolean);

  const walletActivity = {};
  for (const t of trades) {
    const maker = (t.maker || t.from || '').toLowerCase();
    if (!maker || !trackedAddrs.includes(maker)) continue;
    if (!walletActivity[maker]) walletActivity[maker] = { buys: 0, sells: 0, buySol: 0, sellSol: 0, firstBuy: null };
    const amtSol = parseFloat(t.volumeUsd || t.amountUsd || 0) / 150;
    const type = (t.type || '').toLowerCase();
    if (type === 'buy') {
      walletActivity[maker].buys++;
      walletActivity[maker].buySol += amtSol;
      if (!walletActivity[maker].firstBuy) walletActivity[maker].firstBuy = Date.now();
    } else {
      walletActivity[maker].sells++;
      walletActivity[maker].sellSol += amtSol;
    }
  }

  let totalBuys = 0, totalSells = 0, totalBuySol = 0, totalSellSol = 0;
  for (const [addr, act] of Object.entries(walletActivity)) {
    totalBuys += act.buys;
    totalSells += act.sells;
    totalBuySol += act.buySol;
    totalSellSol += act.sellSol;
  }

  if (totalBuys >= 3) {
    events.push({
      type: 'buy', icon: '🐋',
      text: '<strong style="color:var(--green)">SMART MONEY ACCUMULATING</strong> — ' + Object.keys(walletActivity).length + ' tracked wallets bought ' + totalBuys + '× in 5m'
    });
  }
  if (totalSells >= 3) {
    events.push({
      type: 'sell', icon: '🦈',
      text: '<strong style="color:var(--red)">SMART MONEY EXITING</strong> — ' + Object.keys(walletActivity).length + ' tracked wallets sold ' + totalSells + '× in 5m'
    });
  }
  // Diamond hands: bought early, still holding
  for (const [addr, act] of Object.entries(walletActivity)) {
    if (act.buys > 0 && act.sells === 0 && act.buySol > 1) {
      const short = addr.slice(0, 6);
      events.push({
        type: 'buy', icon: '💎',
        text: '<strong style="color:var(--green)">DIAMOND HANDS</strong> — <a class="live-link" href="https://solscan.io/account/' + addr + '" target="_blank">' + short + '...</a> holding since first buy (' + act.buySol.toFixed(1) + ' SOL)'
      });
    }
  }

  return events;
}

// ── BUNDLE ACTIVITY DETECTION ──
function detectBundleActivity(trades, current, prev) {
  const events = [];
  if (!trades || !trades.length) return events;

  const amountGroups = {};
  const walletFirstSeen = {};

  for (const t of trades) {
    const maker = t.maker || t.from || '';
    const amtSol = parseFloat(t.volumeUsd || t.amountUsd || 0) / 150;
    const amtKey = amtSol.toFixed(2);
    if (!amountGroups[amtKey]) amountGroups[amtKey] = new Set();
    amountGroups[amtKey].add(maker);
    if (!walletFirstSeen[maker]) walletFirstSeen[maker] = Date.now();
  }

  // Coordinated buy detection
  for (const [amt, wallets] of Object.entries(amountGroups)) {
    if (wallets.size >= 3 && parseFloat(amt) > 0.05) {
      events.push({
        type: 'bundle', icon: '🎯',
        text: '<strong style="color:var(--yellow)">COORDINATED BUY</strong> — ' + wallets.size + ' wallets bought ' + parseFloat(amt).toFixed(2) + ' SOL each'
      });
    }
  }

  // Fresh wallet activity (wallets that just appeared)
  const freshWallets = Object.entries(walletFirstSeen).filter(([addr, time]) => {
    return prev && prev._walletFirstSeen && !prev._walletFirstSeen[addr];
  });
  if (freshWallets.length >= 3) {
    events.push({
      type: 'bundle', icon: '🤖',
      text: '<strong style="color:var(--yellow)">BUNDLE WAKEUP</strong> — ' + freshWallets.length + ' new wallets active after silence'
    });
  }

  // Insider selling: wallet that bought early now dumping
  if (prev && prev._walletFirstSeen) {
    for (const [addr, firstTime] of Object.entries(prev._walletFirstSeen)) {
      const nowSelling = trades.filter(t => (t.maker || t.from || '').toLowerCase() === addr.toLowerCase() && (t.type || '').toLowerCase() === 'sell');
      if (nowSelling.length > 0) {
        const sellSol = nowSelling.reduce((s, t) => s + parseFloat(t.volumeUsd || t.amountUsd || 0) / 150, 0);
        if (sellSol > 2) {
          const short = addr.slice(0, 6);
          events.push({
            type: 'sell', icon: '🔴',
            text: '<strong style="color:var(--red)">INSIDER SELLING</strong> — <a class="live-link" href="https://solscan.io/account/' + addr + '" target="_blank">' + short + '...</a> dumped ' + sellSol.toFixed(1) + ' SOL (100% exit)'
          });
        }
      }
    }
  }

  return events;
}

// ── WHALE ALERTS (14+ SOL buy, 16+ SOL sell) ──
function detectWhaleAlerts(trades) {
  const events = [];
  if (!trades || !trades.length) return events;

  for (const t of trades) {
    const maker = t.maker || t.from || '';
    const amtSol = parseFloat(t.volumeUsd || t.amountUsd || 0) / 150;
    const type = (t.type || '').toLowerCase();
    const short = maker.slice(0, 6);

    if (type === 'buy' && amtSol >= 14) {
      events.push({
        type: 'whale', icon: '🐋',
        text: '<a class="live-link" href="https://solscan.io/account/' + maker + '" target="_blank">' + short + '...</a> <strong style="color:var(--green)">BLASTED ' + amtSol.toFixed(1) + ' SOL</strong> 🔥'
      });
    }
    if (type !== 'buy' && amtSol >= 16) {
      events.push({
        type: 'sell', icon: '🔴',
        text: '<a class="live-link" href="https://solscan.io/account/' + maker + '" target="_blank">' + short + '...</a> <strong style="color:var(--red)">EXTRACTED ' + amtSol.toFixed(1) + ' SOL</strong> 💀'
      });
    }
  }

  return events;
}

// ═══════════════════════════════════════════════
// LIVE FEED — integrated with new alerts
// ═══════════════════════════════════════════════
async function fetchLiveActivity(ca, pairAddr, knownPair, pumpfun) {
  // Always build baseline events from pair data
  const baselineEvents = buildEventsFromPair(knownPair, pumpfun);

  try {
    const resp = await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'FETCH_TRADES', ca, pairAddress: pairAddr }, r => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });

    let tradeEvents = [];
    let trades = [];
    if (resp?.trades?.length) {
      trades = resp.trades;
      tradeEvents = analyzeTrades(trades, resp.pairData || knownPair, pumpfun);
    }

    // Generate new alerts comparing with previous scan
    const currentData = knownPair ? extractPairData(knownPair, pumpfun) : null;
    const alertEvents = generateLiveAlerts(currentData, _prevScan, trades);

    // Merge: alerts first (highest priority), then trade events, then baseline
    const allEvents = [...alertEvents, ...tradeEvents, ...baselineEvents];

    // Deduplicate by text content (keep first occurrence)
    const seen = new Set();
    const deduped = allEvents.filter(e => {
      const key = e.text?.replace(/<[^>]+>/g, '').slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    renderLiveFeed(deduped.slice(0, 25)); // cap at 25 events

    // Store for next comparison
    if (currentData) {
      _prevScan = currentData;
    }

  } catch (e) {
    // Fallback to baseline events only
    renderLiveFeed(baselineEvents);
  }
}

function extractPairData(pair, pumpfun) {
  if (!pair) return null;
  const mc = pair?.fdv || pair?.marketCap || pumpfun?.usd_market_cap || 0;
  const vol5m = pair?.volume?.m5 || 0;
  const vol1h = pair?.volume?.h1 || 0;
  const liquidity = pair?.liquidity?.usd || 0;
  const buys5m = pair?.txns?.m5?.buys || 0;
  const sells5m = pair?.txns?.m5?.sells || 0;
  const total5m = buys5m + sells5m;
  const holders = pair?.holders || 0;
  const p5m = pair?.priceChange?.m5 || 0;
  const p1h = pair?.priceChange?.h1 || 0;
  const p6h = pair?.priceChange?.h6 || 0;
  const p24h = pair?.priceChange?.h24 || 0;
  const priceUsd = parseFloat(pair?.priceUsd || pumpfun?.price || 0);
  const pfBonding = pumpfun?.virtual_sol_reserves ? Math.min(((pumpfun.real_sol_reserves || 0) / 85000000000 * 100), 100) : 0;
  const pairAge = pair?.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000) : null;

  return {
    ca: currentCA, mc, vol5m, vol1h, liquidity, total5m, holders,
    p5m, p1h, p6h, p24h, priceUsd, pfBonding, pairAge,
    buys5m, sells5m, score: lastScanResult?.score,
    vClass: lastScanResult?.vClass
  };
}

function buildEventsFromPair(pair, pumpfun) {
  const events = [];
  const buys5m  = pair?.txns?.m5?.buys   || 0;
  const sells5m = pair?.txns?.m5?.sells  || 0;
  const buys1h  = pair?.txns?.h1?.buys   || 0;
  const sells1h = pair?.txns?.h1?.sells  || 0;
  const vol5m   = pair?.volume?.m5  || 0;
  const vol1h   = pair?.volume?.h1  || 0;
  const p5m     = pair?.priceChange?.m5  || 0;
  const p1h     = pair?.priceChange?.h1  || 0;
  const liq     = pair?.liquidity?.usd   || 0;
  const mc      = pair?.fdv || pair?.marketCap || pumpfun?.usd_market_cap || 0;
  const total5m = buys5m + sells5m;
  const total1h = buys1h + sells1h;

  if (total5m > 0) {
    const buyPct = Math.round((buys5m / total5m) * 100);
    if (buyPct >= 70) events.push({ type: 'buy', icon: '📈', text: '<strong style="color:var(--green)">Strong BUY pressure</strong> — ' + buys5m + 'B / ' + sells5m + 'S in 5m (' + buyPct + '% buys)' });
    else if (buyPct <= 30) events.push({ type: 'sell', icon: '📉', text: '<strong style="color:var(--red)">Heavy SELL pressure</strong> — ' + sells5m + 'S / ' + buys5m + 'B in 5m (' + (100-buyPct) + '% sells)' });
    else if (buyPct >= 55) events.push({ type: 'buy', icon: '📊', text: 'Slight buy lean — ' + buys5m + 'B / ' + sells5m + 'S in 5m (' + buyPct + '% buys)' });
    else if (buyPct <= 45) events.push({ type: 'sell', icon: '📊', text: 'Slight sell lean — ' + sells5m + 'S / ' + buys5m + 'B in 5m (' + (100-buyPct) + '% sells)' });
    else events.push({ type: 'info', icon: '⚖️', text: 'Balanced trading — ' + buys5m + 'B / ' + sells5m + 'S in 5m (50/50)' });
  }

  if (p5m >= 15) events.push({ type: 'buy', icon: '🚀', text: '<strong style="color:var(--green)">Pumping +' + p5m.toFixed(1) + '%</strong> in 5m' });
  else if (p5m > 5) events.push({ type: 'buy', icon: '📈', text: 'Up +' + p5m.toFixed(1) + '% in 5m' });
  else if (p5m <= -15) events.push({ type: 'sell', icon: '💥', text: '<strong style="color:var(--red)">Dumping ' + p5m.toFixed(1) + '%</strong> in 5m' });
  else if (p5m < -5) events.push({ type: 'sell', icon: '📉', text: 'Down ' + p5m.toFixed(1) + '% in 5m' });

  if (vol5m > 0 && vol1h > 0) {
    const runRate = (vol5m / vol1h) * 12;
    if (runRate >= 2.5) events.push({ type: 'buy', icon: '🔥🔥', text: 'Volume <strong style="color:var(--gold)">EXPLODING</strong> — 5m pace is ' + runRate.toFixed(1) + '× the 1h average' });
    else if (runRate >= 1.5) events.push({ type: 'buy', icon: '🔥', text: 'Volume accelerating — 5m pace is ' + runRate.toFixed(1) + '× the 1h average' });
    else if (runRate < 0.25 && vol5m > 0) events.push({ type: 'sell', icon: '❄️', text: 'Volume cooling fast — only ' + (runRate*100).toFixed(0) + '% of 1h pace in last 5m' });
  }

  if (vol5m >= 5000) events.push({ type: 'buy', icon: '💰', text: '$' + (vol5m/1000).toFixed(1) + 'K volume in last 5m' + (mc > 0 ? ' — ' + ((vol5m/mc)*100).toFixed(0) + '% of MC' : '') });
  else if (vol5m > 0) events.push({ type: 'info', icon: '💵', text: '$' + (vol5m < 1000 ? vol5m.toFixed(0) : (vol5m/1000).toFixed(1)+'K') + ' volume in last 5m' });

  if (total5m >= 4) {
    const ratio = buys5m / total5m;
    if (ratio >= 0.47 && ratio <= 0.53 && total5m < 20 && vol5m < 5000) {
      events.push({ type: 'bundle', icon: '🤖', text: '<strong style="color:var(--yellow)">Suspicious pattern</strong> — ' + buys5m + 'B/' + sells5m + 'S too equal, possible wash trading' });
    }
  }

  if (total1h > 0) {
    const h1ratio = buys1h / total1h;
    if (h1ratio >= 0.72) events.push({ type: 'buy', icon: '💎', text: '<strong style="color:var(--green)">1h buy dominated</strong>: ' + buys1h + 'B vs ' + sells1h + 'S' });
    else if (h1ratio <= 0.28) events.push({ type: 'sell', icon: '⚠️', text: '<strong style="color:var(--red)">1h sell dominated</strong>: ' + sells1h + 'S vs ' + buys1h + 'B' });
  }

  if (liq >= 50000) events.push({ type: 'buy', icon: '🏊', text: 'Deep liquidity $' + (liq/1000).toFixed(0) + 'K' });
  else if (liq > 0 && liq < 3000) events.push({ type: 'sell', icon: '⚠️', text: '<strong style="color:var(--red)">Thin liquidity</strong> $' + liq.toFixed(0) });

  if (pumpfun) {
    if (pumpfun.complete && pumpfun.raydium_pool) events.push({ type: 'buy', icon: '✅', text: 'Bonded & migrated to Raydium' });
    else if (!pumpfun.complete) {
      const progPct = pumpfun.virtual_sol_reserves ? Math.min(((pumpfun.real_sol_reserves || 0) / 85000000000 * 100), 100).toFixed(1) : '?';
      events.push({ type: 'info', icon: '🎯', text: 'Still on pump.fun bonding curve — ' + progPct + '% to migration' });
    }
  }

  if (!events.length) events.push({ type: 'info', icon: '👀', text: 'Watching for activity — refresh to update' });
  return events;
}

function analyzeTrades(trades, pairData, pumpfun) {
  const events = [];
  if (pairData) events.push(...buildEventsFromPair(pairData, pumpfun));

  const walletVol = {};
  const amountGroups = {};

  for (const t of trades) {
    if (t.synthetic) continue;
    const maker  = t.maker || t.from || '';
    const amtUsd = parseFloat(t.volumeUsd || t.amountUsd || 0);
    const amtSol = amtUsd / 150;
    const type   = (t.type || '').toLowerCase();
    if (!maker) continue;
    if (!walletVol[maker]) walletVol[maker] = { buyUsd: 0, sellUsd: 0 };
    if (type === 'buy') walletVol[maker].buyUsd += amtUsd;
    else walletVol[maker].sellUsd += amtUsd;
    const amtKey = amtSol.toFixed(2);
    if (!amountGroups[amtKey]) amountGroups[amtKey] = new Set();
    amountGroups[amtKey].add(maker);
  }

  let bundleCount = 0;
  for (const [amt, wallets] of Object.entries(amountGroups)) {
    if (wallets.size >= 3 && parseFloat(amt) > 0.01) bundleCount += wallets.size;
  }
  if (bundleCount >= 3) {
    events.unshift({ type: 'bundle', icon: '🤖', text: '<strong style="color:var(--yellow)">⚠️ Bundlers detected</strong> — ' + bundleCount + ' wallets buying identical amounts' });
  }

  for (const [wallet, vol] of Object.entries(walletVol)) {
    const buySol  = vol.buyUsd  / 150;
    const sellSol = vol.sellUsd / 150;
    const short   = wallet.slice(0, 6);
    if (buySol > filters.whaleBuy) {
      events.push({ type: 'whale', icon: '🐳', text: '<a class="live-link" href="https://solscan.io/account/' + wallet + '" target="_blank">' + short + '...</a> <strong>BLASTED ' + buySol.toFixed(1) + ' SOL</strong>' });
    }
    if (sellSol > filters.whaleSell) {
      events.push({ type: 'sell', icon: '🔴', text: '<a class="live-link" href="https://solscan.io/account/' + wallet + '" target="_blank">' + short + '...</a> <strong>EXTRACTED ' + sellSol.toFixed(1) + ' SOL</strong>' });
    }
  }

  if (!events.length) events.push({ type: 'info', icon: '👀', text: 'No notable patterns — normal trading activity' });
  return events;
}

function renderLiveFeed(events) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  if (!events?.length) { feed.innerHTML = '<div class="live-empty">No events</div>'; return; }
  feed.innerHTML = events.map(e => `
    <div class="live-item li-${e.type || 'info'}">
      <span class="live-icon">${e.icon}</span>
      <span class="live-text">${e.text}</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════════
// GMGN TRENDING
// ═══════════════════════════════════════════════
async function fetchGMGNTrending() {
  try {
    const resp = await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'FETCH_GMGN_TRENDING' }, r => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });
    if (resp?.trending?.length) {
      gmgnTrendingCache = resp.trending;
      renderGMGNTrending();
    }
  } catch (e) {
    document.getElementById('gmgn-trending-feed').innerHTML = '<div class="live-empty">GMGN trending unavailable (Cloudflare/fragile)</div>';
  }
}

function renderGMGNTrending() {
  const feed = document.getElementById('gmgn-trending-feed');
  if (!gmgnTrendingCache.length) {
    feed.innerHTML = '<div class="live-empty">No trending data</div>';
    return;
  }
  feed.innerHTML = gmgnTrendingCache.map((t, i) => {
    const mc = t.market_cap || 0;
    const chg = t.price_change_1h || 0;
    const sym = t.symbol || '?';
    const ca = t.address || '';
    const vol = t.volume_1h || 0;
    return `<div class="live-item" style="cursor:pointer" onclick="loadCA('${ca}')">
      <span class="live-icon">${i < 3 ? '🔥' : '📈'}</span>
      <span class="live-text">
        <strong style="color:var(--text)">$${sym}</strong> · MC ${fmt(mc)} · 1h ${chg > 0 ? '+' : ''}${chg.toFixed(1)}% · Vol ${fmt(vol)}
      </span>
    </div>`;
  }).join('');
}

document.getElementById('btn-gmgn-refresh').addEventListener('click', fetchGMGNTrending);

// ═══════════════════════════════════════════════
// GMGN WALLET PNL (in wallet view)
// ═══════════════════════════════════════════════
async function fetchWalletPnL(address) {
  try {
    const resp = await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'FETCH_GMGN_PNL', wallet: address }, r => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });
    return resp;
  } catch (e) { return null; }
}

// Add PnL lookup to wallet row click
window.showWalletPnL = async function(idx) {
  const w = trackedWallets[idx];
  const addr = typeof w === 'string' ? w : (w.address || '');
  if (!addr) return;
  const panel = document.getElementById('wallet-pnl-panel');
  const list = document.getElementById('wallet-pnl-list');
  panel.style.display = 'flex';
  list.innerHTML = '<span style="color:var(--dim)">Loading GMGN PnL...</span>';
  const data = await fetchWalletPnL(addr);
  if (!data || !data.success) {
    list.innerHTML = '<span style="color:var(--red)">GMGN PnL unavailable (Cloudflare/fragile)</span>';
    return;
  }
  const pnl = data.data || {};
  const total = pnl.total_profit || 0;
  const winRate = pnl.win_rate || 0;
  const trades = pnl.trade_count || 0;
  const color = total >= 0 ? 'var(--green)' : 'var(--red)';
  list.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><div style="font-size:9px;color:var(--dim)">Total PnL</div><div style="color:${color};font-weight:700">${total >= 0 ? '+' : ''}${total.toFixed(2)} SOL</div></div>
      <div><div style="font-size:9px;color:var(--dim)">Win Rate</div><div style="font-weight:700">${(winRate * 100).toFixed(0)}%</div></div>
      <div><div style="font-size:9px;color:var(--dim)">Trades</div><div style="font-weight:700">${trades}</div></div>
      <div><div style="font-size:9px;color:var(--dim)">Source</div><div style="color:var(--dim)">GMGN (fragile)</div></div>
    </div>`;
};

// ═══════════════════════════════════════════════
// UPDATE UI — trade plan REMOVED
// ═══════════════════════════════════════════════
function updateUI(ca, result) {
  const { verdict, vClass, vEmoji, score, redFlags, warnings, greens, trackedVerdict,
          stillHoldingCount, exitedCount, token, data, extras } = result;

  lastScanResult = { ca, volMcRatio: extras.volMcRatio, priceUsd: data.priceUsd, score, vClass: result.vClass, time: Date.now() };

  const imgEl = document.getElementById('token-img-el');
  if (imgEl && token.img) {
    if (imgEl.tagName !== 'IMG') {
      const img = document.createElement('img');
      img.className = 'token-img';
      img.id = 'token-img-el';
      img.onerror = () => img.style.display = 'none';
      img.src = token.img;
      imgEl.replaceWith(img);
    } else { imgEl.src = token.img; }
  }

  const ticker = token.sym ? '$' + token.sym : ca.slice(0,8)+'...';
  document.getElementById('token-symbol').textContent = ticker;
  document.getElementById('token-name').textContent = token.name || '';

  const ageEl = document.getElementById('token-age');
  if (ageEl) ageEl.textContent = formatAge(data.pairAge);

  const hdr = document.getElementById('token-header-box');
  if (extras.volMcRatio >= filters.volmcGold) hdr.classList.add('golden');
  else hdr.classList.remove('golden');

  const symEl = document.getElementById('token-symbol');
  if (symEl) {
    const baseText = token.sym ? '$' + token.sym : ca.slice(0,8)+'...';
    symEl.textContent = extras.volMcRatio >= 100 ? baseText + ' 🔥' : baseText;
  }

  const wbWrap = document.getElementById('wallet-badge-wrap');
  if (trackedWallets.length > 0 && wbWrap) {
    if (stillHoldingCount > 0) {
      const cls = stillHoldingCount >= 3 ? 'wb-good' : 'wb-few';
      const exitStr = exitedCount > 0 ? ' · ' + exitedCount + ' exited' : '';
      wbWrap.innerHTML = '<div class="wallet-badge ' + cls + '">💎 ' + stillHoldingCount + '/' + trackedWallets.length + ' holding' + exitStr + '</div>';
    } else if (exitedCount > 0) {
      wbWrap.innerHTML = '<div class="wallet-badge wb-few">🚪 ' + exitedCount + '/' + trackedWallets.length + ' traded — none currently holding</div>';
    } else {
      // Not in top 50 holders or recent txs — neutral, don't show false red
      wbWrap.innerHTML = '<div class="wallet-badge" style="background:rgba(88,166,255,0.08);color:var(--dim)">👁 0/' + trackedWallets.length + ' tracked wallets detected</div>';
    }
  } else if (wbWrap) {
    wbWrap.innerHTML = '';
  }

  const copyBtn = document.getElementById('copy-ca-btn');
  if (copyBtn) copyBtn.onclick = () => {
    navigator.clipboard.writeText(ca).then(() => {
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = '⎘ CA'; copyBtn.classList.remove('copied'); }, 1500);
    });
  };

  const vBox = document.getElementById('verdict-box');
  if (vBox) vBox.className = 'verdict-box v-' + vClass;
  const vText = document.getElementById('verdict-text');
  if (vText) vText.textContent = vEmoji + ' ' + verdict;
  const sBar = document.getElementById('score-bar');
  if (sBar) { sBar.className = 'score-bar sb-' + vClass; sBar.style.width = score + '%'; }
  const sLabel = document.getElementById('score-label');
  if (sLabel) sLabel.textContent = 'Score ' + score + ' / 100';

  const volR = Math.round(extras.volMcRatio);
  setText('s-mc', fmt(data.mc));
  setText('s-vol', fmt(data.vol5m));
  setStatColor('s-ratio', volR + '%', volR >= filters.volmcGold ? 'c-gold' : volR >= filters.volmcStrong ? 'c-green' : volR >= filters.volmcMin ? 'c-yellow' : 'c-red');
  const bundleDisplay = extras.bundlePct > 0 ? extras.bundlePct.toFixed(0) + '%' :
    (extras.hasHolderData === false ? '?' : 'Clean');
  setStatColor('s-bundle', bundleDisplay,
    extras.bundlePct > filters.bundleMax ? 'c-red' : extras.bundlePct > filters.bundleMax/2 ? 'c-yellow' : 'c-green');
  setStatColor('s-top70', extras.top70Pct.toFixed(0) + '%',
    extras.top70Pct > 70 ? 'c-red' : extras.top70Pct > 55 ? 'c-yellow' : 'c-green');
  setStatColor('s-narra', extras.narrScore + '%',
    extras.narrScore >= 70 ? 'c-green' : extras.narrScore >= 45 ? 'c-yellow' : 'c-red');
  // HOLDER TREND — handled below in the new DEV FUND / HOLDERS / TREND RANK block

  // ── STAT: DEV FUND — who funded the creator wallet ──
  const devFundEl = document.getElementById('s-dev-fund');
  if (devFundEl) {
    const df = result._devFund;
    if (df && df.funder) {
      // source = exchange name if known, else short wallet prefix
      const label = df.source && df.source !== df.funder
        ? df.source
        : df.funder.slice(0, 5) + '…' + df.funder.slice(-4);
      const amtStr = (df.amount && df.amount > 0) ? ' ' + df.amount + '◎' : '';
      devFundEl.textContent = label + amtStr;
      devFundEl.className = 'stat-val c-mute';
      devFundEl.style.cursor = 'pointer';
      devFundEl.title = 'Click to open on Solscan';
      // Click opens funder wallet on Solscan (more useful than tx)
      devFundEl.onclick = () => {
        const url = df.txSig
          ? 'https://solscan.io/tx/' + df.txSig
          : 'https://solscan.io/account/' + df.funder;
        window.open(url, '_blank');
      };
    } else {
      devFundEl.textContent = '—';
      devFundEl.className = 'stat-val c-mute';
      devFundEl.style.cursor = 'default';
      devFundEl.onclick = null;
    }
  }

  // ── STAT: HOLDERS — from pump.fun holder_count (most reliable) ──
  const holdersEl = document.getElementById('s-holders');
  if (holdersEl) {
    const hCount = data.holders || result._holderCount || 0;
    if (hCount > 0) {
      let hTxt = hCount.toLocaleString();
      let hCls = 'stat-val';
      if (prevScanData && prevScanData.ca === ca && prevScanData.holders > 0) {
        const diff = hCount - prevScanData.holders;
        if (diff >= 5)        { hTxt += ' ▲'; hCls = 'stat-val c-green'; }
        else if (diff <= -5)  { hTxt += ' ▼'; hCls = 'stat-val c-red'; }
        else                  { hTxt += ' →'; hCls = 'stat-val c-mute'; }
      }
      holdersEl.textContent = hTxt;
      holdersEl.className = hCls;
    } else {
      holdersEl.textContent = '—';
      holdersEl.className = 'stat-val c-mute';
    }
  }

  // ── STAT: TREND RANK — GMGN trending position ──
  const trendEl = document.getElementById('s-trend-rank');
  if (trendEl) {
    const rank = result._trendRank;
    if (rank !== null && rank !== undefined) {
      trendEl.textContent = '#' + rank;
      trendEl.className = rank <= 5 ? 'stat-val c-gold' : rank <= 10 ? 'stat-val c-green' : 'stat-val c-mute';
    } else {
      trendEl.textContent = 'Not trending';
      trendEl.className = 'stat-val c-mute';
    }
  }

  // Solscan + GMGN extra indicators in info tab
  if (extras.solscanVeryFreshCount > 0 || extras.solscanFreshCount > 0) {
    const sItems = [];
    if (extras.solscanVeryFreshCount > 0) sItems.push(extras.solscanVeryFreshCount + ' wallets created TODAY');
    if (extras.solscanFreshCount > 0) sItems.push(extras.solscanFreshCount + ' wallets < 7 days old');
    const existingInfo = document.getElementById('info-content').innerHTML;
    document.getElementById('info-content').innerHTML = '<div class="flag-section fs-yellow"><div class="flag-head">📡 Solscan Wallet Age</div>' + sItems.map(i => '<div class="flag-item">' + i + '</div>').join('') + '</div>' + existingInfo;
  }
  if (extras.gmgnTop10 > 0.35) {
    const existingInfo = document.getElementById('info-content').innerHTML;
    document.getElementById('info-content').innerHTML = '<div class="flag-section fs-red"><div class="flag-head">📡 GMGN Concentration</div><div class="flag-item">Top 10 hold ' + (extras.gmgnTop10 * 100).toFixed(0) + '%</div></div>' + existingInfo;
  }

  if (extras.momentum) {
    const momEl = document.getElementById('momentum-indicator');
    if (momEl) {
      momEl.textContent = extras.momentum;
      momEl.style.display = 'block';
    }
  }

  const caEl = document.getElementById('ca-text');
  if (caEl) caEl.textContent = ca.slice(0,8) + '...' + ca.slice(-6);
  const utEl = document.getElementById('update-time');
  if (utEl) utEl.textContent = new Date().toLocaleTimeString();

  // Save scan data for next refresh comparison (holder trend, etc.)
  prevScanData = { ca, holders: result.data?.holders || 0, mc: result.data?.mc || 0, score, time: Date.now() };

  const infoEl = document.getElementById('info-content');
  if (infoEl) {
    infoEl.innerHTML = flagSection(redFlags,'red','RED FLAGS','🚨') +
      flagSection(warnings,'yellow','WARNINGS','⚠️') +
      flagSection(greens,'green','GOOD SIGNS','✅') ||
      '<div class="live-empty">No analysis data</div>';
  }

  const narrEl = document.getElementById('narra-content');
  if (narrEl) {
    const nc  = extras.narrScore || 0;
    const tnc = extras.twitterNarrScore || 0;
    // Combined score: if Twitter data present, weight it 60% Twitter + 40% keyword
    const combinedNarr = extras.twitterData?.hasKey
      ? Math.round(tnc * 0.6 + nc * 0.4)
      : nc;
    const ncol = combinedNarr >= 70 ? 'var(--green)' : combinedNarr >= 45 ? 'var(--yellow)' : 'var(--red)';
    const nlbl = combinedNarr >= 70 ? 'Strong narrative signal' : combinedNarr >= 45 ? 'Moderate — worth checking' : 'Weak narrative';
    const ageStr  = data.pairAge !== null ? formatAge(data.pairAge) : '?';
    const freshness = data.pairAge !== null && data.pairAge < 10 ? '🟢 Very fresh — narrative likely hot'
      : data.pairAge !== null && data.pairAge < 30 ? '🟡 Still early — check engagement'
      : '🔴 Older token — narrative may have cooled';

    // Build tweet cards HTML
    const tweets = extras.twitterData?.tweets || [];
    function buildTweetCard(t) {
      const likes    = t.likes    || t.like_count    || 0;
      const retweets = t.retweets || t.retweet_count || 0;
      const views    = t.views    || t.view_count    || 0;
      const author   = t.author   || t.username      || (t.user && t.user.username) || '';
      const rawText  = (t.text || t.content || '').slice(0, 120);
      const text     = rawText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const tweetUrl = t.url || t.tweet_url || (author ? 'https://x.com/' + author : '');
      const badge    = (t.verified || t.is_verified) ? ' ✓' : '';
      const likeStr  = likes    > 999 ? (likes/1000).toFixed(1)+'K' : String(likes);
      const rtStr    = retweets > 999 ? (retweets/1000).toFixed(1)+'K' : String(retweets);
      const viewStr  = views    > 999 ? (views/1000).toFixed(1)+'K' : String(views);
      let stats = '';
      if (likes    > 0) stats += '<span>❤ ' + likeStr  + '</span>';
      if (retweets > 0) stats += '<span>🔁 ' + rtStr    + '</span>';
      if (views    > 0) stats += '<span>👁 ' + viewStr  + '</span>';
      let card = '<div class="tweet-card">';
      card += '<div class="tweet-header">';
      card += '<span class="tweet-author">' + (author ? '@' + author + badge : 'Unknown') + '</span>';
      card += '<div class="tweet-stats">' + stats + '</div>';
      card += '</div>';
      card += '<div class="tweet-text">' + text + (rawText.length >= 120 ? '...' : '') + '</div>';
      if (tweetUrl) card += '<a class="tweet-link" href="' + tweetUrl + '" target="_blank">View tweet →</a>';
      card += '</div>';
      return card;
    }
    const tweetCardsHtml = tweets.slice(0, 5).map(buildTweetCard).join('');

    // KOL holders from GMGN — build without nested template literals
    const kolHolders = (result && result.extras && result.extras.kolHolders) ? result.extras.kolHolders : [];
    const smartMoney = (result && result.extras && result.extras.smartMoney)  ? result.extras.smartMoney  : [];

    function buildHolderRows(holders, color) {
      return holders.slice(0,3).map(function(h) {
        const addr = h.address || h.wallet || '';
        const name = h.name || h.tag || (addr ? addr.slice(0,8)+'...' : 'Unknown');
        const pct  = h.percent || h.holding_percent || '';
        return '<div class="narra-hint"><a href="https://solscan.io/account/'+addr+'" target="_blank" style="color:'+color+';text-decoration:none">'+name+'</a>'+(pct ? ' — '+pct+'%' : '')+'</div>';
      }).join('');
    }

    let kolHtml    = '';
    let smartHtml  = '';
    if (kolHolders.length > 0) {
      kolHtml = '<div class="narra-row" style="margin-top:2px"><div class="narra-label" style="color:var(--gold)">🏆 KOL Wallets Holding</div>'
        + buildHolderRows(kolHolders, 'var(--gold)') + '</div>';
    }
    if (smartMoney.length > 0) {
      smartHtml = '<div class="narra-row" style="margin-top:2px"><div class="narra-label" style="color:var(--blue)">🧠 Smart Money Holding</div>'
        + buildHolderRows(smartMoney, 'var(--blue)') + '</div>';
    }

    // Twitter status line
    const twitterStatusLine = extras.twitterData && extras.twitterData.hasKey
      ? '<div class="narra-hint" style="font-size:9px;color:var(--dim);margin-top:3px">📡 Twitter: '+tweets.length+' tweets · Score: Twitter '+tnc+'% + Keywords '+nc+'%</div>'
      : '<div class="narra-hint" style="font-size:9px;color:var(--dim);margin-top:3px">⚠️ Add OpenTwitter key in Filters tab for live tweet data</div>';

    // Tweet section
    const tweetSection = tweets.length > 0
      ? '<div class="narra-row"><div class="narra-label">📢 Live Tweets ('+tweets.length+' found)</div><div id="tweet-cards-wrap">'+tweetCardsHtml+'</div></div>'
      : '';

    // About coin
    let aboutHtml = '';
    if (token.about && token.about.trim().length > 3) {
      const safeAbout = token.about.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      let links = '';
      if (token.twitter)  links += '<a href="'+token.twitter+'"  target="_blank" style="color:var(--blue);font-size:10px;margin-right:8px">🐦 Twitter</a>';
      if (token.website)  links += '<a href="'+token.website+'"  target="_blank" style="color:var(--blue);font-size:10px;margin-right:8px">🌐 Website</a>';
      if (token.telegram) links += '<a href="'+token.telegram+'" target="_blank" style="color:var(--blue);font-size:10px">📲 Telegram</a>';
      aboutHtml = '<div class="narra-row"><div class="narra-label">About Coin</div><div class="narra-hint" style="color:var(--text2);line-height:1.6;white-space:pre-wrap;word-break:break-word">'+safeAbout+'</div>'+(links?'<div class="narra-hint" style="margin-top:6px">'+links+'</div>':'')+'</div>';
    } else {
      aboutHtml = '<div class="narra-row"><div class="narra-label">About Coin</div><div class="narra-hint" style="color:var(--dim);font-style:italic">No description available</div></div>';
    }

    narrEl.innerHTML =
      '<div class="narra-row">' +
        '<div class="narra-label">Narrative Strength</div>' +
        '<div class="narra-bar-wrap"><div class="narra-bar-bg"><div class="narra-bar" style="width:'+combinedNarr+'%;background:'+ncol+'"></div></div><div class="narra-val" style="color:'+ncol+'">'+combinedNarr+'%</div></div>' +
        '<div class="narra-hint">'+nlbl+'</div>' +
        twitterStatusLine +
      '</div>' +
      tweetSection +
      '<div class="narra-row"><div class="narra-label">Tweet Freshness</div><div class="narra-hint">Token age: <strong style="color:var(--text)">'+ageStr+'</strong><br>'+freshness+'</div></div>' +
      kolHtml + smartHtml + aboutHtml;
  }


  // Sound alerts
  if (score >= 80 && (!lastScanResult || lastScanResult.score < 80)) {
    playAlert('buy');
  } else if (lastScanResult && lastScanResult.score - score >= 20) {
    playAlert('exit');
  }

  addToHistory(ca, ticker, verdict, vClass, score, extras.momentum);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setStatColor(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = 'stat-val ' + cls;
}

function playAlert(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'buy') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(200, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════
// MAIN ANALYZE
// ═══════════════════════════════════════════════
async function analyzeToken(ca, isFirst) {
  if (isAnalyzing) return;
  isAnalyzing = true;

  if (isFirst) {
    document.getElementById('idle-state').style.display = 'none';
    document.getElementById('loading-state').style.display = 'flex';
    document.getElementById('result-state').style.display = 'none';
    document.getElementById('loading-text').textContent = 'Scanning token...';
  }

  try {
    await new Promise(resolve => {
      chrome.storage.local.get(['trackedWallets', 'filters'], r => {
        trackedWallets = r.trackedWallets || [];
        if (r.filters) filters = { ...defaultFilters(), ...r.filters };
        resolve();
      });
    });

    const _fetchStart = Date.now();
    window._lastApiStatus = { fetching: true, startTime: _fetchStart };
    updateDebugSourcesLoading();

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_TOKEN_DATA', ca, heliusApiKey, solscanApiKey, gmgnApiKey, twitterToken }, res => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });

    // Connect to Helius WebSocket if enabled
    if (filters.heliusWsEnabled && heliusApiKey) {
      chrome.runtime.sendMessage({ 
        type: 'CONNECT_HELIUS_WS', 
        apiKey: heliusApiKey 
      });

      // Subscribe to token transactions and account
      setTimeout(() => {
        chrome.runtime.sendMessage({ 
          type: 'SUBSCRIBE_TOKEN', 
          ca: currentCA 
        });
      }, 1000);
    }

    const _fetchMs = Date.now() - _fetchStart;
    // Store API status for debug tab
    if (response) {
      window._lastApiStatus = {
        fetchMs: _fetchMs,
        dex:      response.dex?.pairs?.length > 0 ? { ok: true, pairs: response.dex.pairs.length } : { ok: false },
        rugcheck: response.rugcheck?.topHolders?.length > 0 ? { ok: true, holders: response.rugcheck.topHolders.length } : { ok: false },
        pumpfun:  response.pumpfun?.mint ? { ok: true, holders: response.pumpfun.holder_count || 0, source: response.pumpfun._source || 'pumpfun' } : { ok: false },
        bonkfun:  response.pumpfun?._source === 'bonkfun' ? { ok: true, holders: response.pumpfun.holder_count || 0 } : { ok: false, note: 'not bonk token' },
        birdeye:  response.dex?._source === 'birdeye' ? { ok: true } : { ok: false, note: 'skipped' },
        gmgn:     response.gmgn?.blocked ? { ok: false, note: 'rate limited' } : response.gmgn?.tokenData ? { ok: true } : { ok: false },
        gecko:    response.gecko?.stats ? { ok: true } : { ok: false },
        helius:   response.helius && Object.keys(response.helius).length > 0 ? { ok: true, count: Object.keys(response.helius).length } : { ok: heliusApiKey ? false : null, note: heliusApiKey ? 'no data' : 'no key' },
        earlyTraders: response.earlyTraders?.length || 0,
        trackedWalletsLoaded: trackedWallets.length,
        platformSource: response.platformSource || 'dexscreener',
        ca
      };
      updateDebugTab(response);
    }

    if (!response?.success) {
      if (isFirst) showError('Could not fetch data — check connection');
      isAnalyzing = false;
      startAutoRefresh();
      return;
    }

    const { dex, rugcheck, pumpfun, earlyTraders, solBalances, gecko, helius, solscan, gmgn, devFund, trendRank, holderCount } = response;

    // Inject holderCount back into pumpfun if missing (from background aggregation)
    if (pumpfun && holderCount && !pumpfun.holder_count) pumpfun.holder_count = holderCount;
    const hasDex    = dex?.pairs?.length > 0;
    const hasRug    = rugcheck?.topHolders?.length > 0;
    const hasPump   = !!(pumpfun?.mint || pumpfun?.symbol);

    if (!hasDex && !hasRug && !hasPump) {
      if (isFirst) {
        document.getElementById('loading-text').textContent = 'No data yet — retrying...';
      }
      isAnalyzing = false;
      startAutoRefresh();
      return;
    }

    const result = runFilters(dex || { pairs: [] }, rugcheck || {}, pumpfun, earlyTraders || [], solBalances || {}, gecko, helius, solscan, gmgn, response.platformSource, response.twitter || null);
    result._devFund = devFund || null;
    result._trendRank = trendRank;
    result._holderCount = holderCount || 0;

    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('idle-state').style.display = 'none';
    document.getElementById('result-state').style.display = 'flex';

    updateUI(ca, result);
    onScanComplete(ca, result, response);  // Update debug tab

    const bestPair = (dex?.pairs || []).sort((a,b) => (b.volume?.h24||0)-(a.volume?.h24||0))[0] || null;
    fetchLiveActivity(ca, currentPairAddress, bestPair, pumpfun);

    startAutoRefresh();

  } catch (err) {
    if (isFirst) showError(err.message);
    startAutoRefresh();
  }

  isAnalyzing = false;
}

function showError(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('idle-state').style.display = 'flex';
  document.getElementById('idle-state').innerHTML =
    '<div class="idle-icon">❌</div><div class="idle-text">' + msg + '</div>';
}


// ══════════════════════════════════════════════════════════════
// DEBUG TAB — full visibility into every scan
// ══════════════════════════════════════════════════════════════



function updateDebugSourcesLoading() {
  const el = document.getElementById('dbg-sources');
  if (!el) return;
  // Ensure Bonk.fun row exists
  if (!el.querySelector('[data-api="bonkfun"]')) {
    const bonkRow = document.createElement('div');
    bonkRow.className = 'dbg-row';
    bonkRow.setAttribute('data-api', 'bonkfun');
    bonkRow.innerHTML = '<span class="dbg-label">Bonk.fun</span><span class="dbg-val dbg-skip">—</span>';
    el.appendChild(bonkRow);
  }
  el.querySelectorAll('.dbg-val').forEach(v => {
    v.textContent = '...';
    v.className = 'dbg-val dbg-skip';
  });
}

function updateDebugTab(response) {
  if (!response) return;
  const st = window._lastApiStatus || {};

  // ── API Sources ──
  const srcEl = document.getElementById('dbg-sources');
  if (srcEl) {
    const rows = [
      ['DexScreener',   st.dex],
      ['Rugcheck',      st.rugcheck],
      ['Pump.fun',      st.pumpfun],
      ['Bonk.fun',      st.bonkfun || { ok: false, note: 'not checked' }],
      ['Birdeye',       st.birdeye],
      ['GMGN',          st.gmgn],
      ['GeckoTerminal', st.gecko],
      ['Helius',        st.helius],
    ];
    srcEl.innerHTML = rows.map(([name, s]) => {
      if (!s) return `<div class="dbg-row"><span class="dbg-label">${name}</span><span class="dbg-val dbg-skip">—</span></div>`;
      if (s.ok === null) return `<div class="dbg-row"><span class="dbg-label">${name}</span><span class="dbg-val dbg-skip">⏭ ${s.note || 'skipped'}</span></div>`;
      if (s.ok === false) return `<div class="dbg-row"><span class="dbg-label">${name}</span><span class="dbg-val dbg-fail">❌ ${s.note || 'failed'}</span></div>`;
      const extra = s.pairs ? ` (${s.pairs} pairs)` : s.holders ? ` (${s.holders} holders)` : s.count ? ` (${s.count})` : '';
      return `<div class="dbg-row"><span class="dbg-label">${name}</span><span class="dbg-val dbg-ok">✅${extra}</span></div>`;
    }).join('');
  }

  // ── Tracked Wallet Detail ──
  const tw = document.getElementById('dbg-tracked');
  if (tw) {
    const loaded = st.trackedWalletsLoaded || 0;
    const sources = st.earlyTraders || 0;
    const log = window._lastScoreLog || [];
    const twLog = log.find(l => l.label.includes('tracked') || l.label.includes('Tracked'));
    const matched = twLog ? (twLog.delta > 0 ? 'Multiple matched ✅' : twLog.delta < 0 ? 'Few/none matched ⚠️' : '—') : '—';

    tw.innerHTML = `
      <div class="dbg-tracked-row">Your wallets loaded: <strong style="color:var(--text)">${loaded}</strong></div>
      <div class="dbg-tracked-row">Addresses checked against: <strong style="color:var(--text)">${sources}</strong>
        <span style="color:var(--dim)"> (DexScreener txns + Helius + GMGN holders + PumpFun holders)</span>
      </div>
      <div class="dbg-tracked-row">Result: <strong style="color:${twLog?.delta > 0 ? 'var(--green)' : twLog?.delta < 0 ? 'var(--yellow)' : 'var(--dim)'}">${matched}</strong></div>
      ${!heliusApiKey ? '<div class="dbg-tracked-row" style="color:var(--yellow)">⚠️ No Helius key — add key in Filters tab for better wallet matching</div>' : ''}
      ${st.gmgn?.ok === false ? '<div class="dbg-tracked-row" style="color:var(--yellow)">⚠️ GMGN blocked — top holder list unavailable, wallet matching reduced</div>' : ''}
    `;
  }

  // ── Raw values ──
  const lastResult = window._lastDebugResult;
  if (lastResult) {
    const d = lastResult.data || {};
    const e = lastResult.extras || {};
    const fmt = n => !n ? '$0' : n >= 1e6 ? '$'+(n/1e6).toFixed(2)+'M' : n >= 1000 ? '$'+(n/1000).toFixed(1)+'K' : '$'+n.toFixed(0);
    const setDbgText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setDbgText('dbg-mc',      fmt(d.mc));
    setDbgText('dbg-vol',     fmt(d.vol5m));
    setDbgText('dbg-liq',     fmt(d.liquidity));
    setDbgText('dbg-txns',    (d.buys5m||0) + 'B / ' + (d.sells5m||0) + 'S');
    setDbgText('dbg-holders', d.holders || '—');
    setDbgText('dbg-dev',     d.devPct !== undefined ? d.devPct.toFixed(1)+'%' : '—');
    setDbgText('dbg-bundle',  e.bundlePct > 0 ? e.bundlePct.toFixed(0)+'%' : (e.hasHolderData === false ? '?' : 'Clean'));
    setDbgText('dbg-top10',   d.top10Pct !== undefined ? d.top10Pct.toFixed(1)+'%' : '—');
    setDbgText('dbg-price',   (d.p5m||0).toFixed(1)+'% / '+(d.p1h||0).toFixed(1)+'% / '+(d.p24h||0).toFixed(1)+'%');
    setDbgText('dbg-age',     d.pairAge !== null && d.pairAge !== undefined ? formatAge(d.pairAge) : '—');
    // Show primary data source
    let sourceLabel = 'DexScreener';
    if (e.platformSource === 'pumpfun') sourceLabel = 'Pump.fun (Primary)';
    else if (e.platformSource === 'bonkfun') sourceLabel = 'Bonk.fun (Primary)';
    else if (st.dex?.ok) sourceLabel = 'DexScreener';
    else if (st.birdeye?.ok) sourceLabel = 'Birdeye';
    setDbgText('dbg-source', sourceLabel);
  }
}

function updateDebugScoreBreakdown() {
  const el = document.getElementById('dbg-score-steps');
  if (!el) return;
  const log = window._lastScoreLog || [];
  if (!log.length) { el.innerHTML = '<div class="score-step"><span class="score-step-label">No data yet</span></div>'; return; }

  let html = '<div class="score-step" style="border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:4px;margin-bottom:4px"><span class="score-step-label" style="font-weight:700">Start</span><span class="score-step-val" style="color:var(--text)">100</span></div>';
  for (const step of log) {
    const cls = step.delta > 0 ? 'score-plus' : step.delta < 0 ? 'score-minus' : 'score-zero';
    const sign = step.delta > 0 ? '+' : '';
    html += `<div class="score-step">
      <span class="score-step-label">${step.label}</span>
      <span class="score-step-val ${cls}">${sign}${step.delta} → ${step.current}</span>
    </div>`;
  }
  const last = log[log.length - 1];
  html += `<div class="score-step" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;margin-top:4px"><span class="score-step-label" style="font-weight:700">FINAL SCORE</span><span class="score-step-val" style="color:var(--text);font-size:13px">${last?.current ?? 100}</span></div>`;
  el.innerHTML = html;
}

// Update debug tab whenever a scan completes
function onScanComplete(ca, result, response) {
  window._lastDebugResult = result;
  updateDebugTab(response);
  updateDebugScoreBreakdown();
}

// Debug refresh button
document.addEventListener('DOMContentLoaded', () => {
  const dbgBtn = document.getElementById('dbg-refresh-btn');
  if (dbgBtn) dbgBtn.addEventListener('click', () => {
    if (currentCA) { isAnalyzing = false; analyzeToken(currentCA, false); }
    // Switch to debug tab after rescan
    setTimeout(() => {
      updateDebugScoreBreakdown();
      updateDebugTab(window._lastApiStatus);
    }, 500);
  });
});