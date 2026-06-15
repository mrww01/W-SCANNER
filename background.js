// background.js v5.0 — critical bug fixes

let lastKnownCA = null;

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('axiom.trade')) {
    chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH_TOKEN_DATA') {
    fetchAllData(request.ca, request.heliusApiKey, request.solscanApiKey, request.gmgnApiKey, request.twitterToken).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === 'FETCH_TWITTER') {
    searchTokenTweets(request.symbol, request.ca, request.twitterToken)
      .then(sendResponse).catch(() => sendResponse({ tweets: [], hasKey: false }));
    return true;
  }

  if (request.type === 'FETCH_GMGN_TRENDING') {
    fetchGMGNTrending().then(trending => sendResponse({ success: true, trending })).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === 'FETCH_GMGN_PNL') {
    fetchGMGNWalletPnL(request.wallet, request.gmgnApiKey).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === 'FETCH_TRADES') {
    fetchTrades(request.ca, request.pairAddress).then(sendResponse).catch(err =>
      sendResponse({ success: false, trades: [] }));
    return true;
  }
  if (request.type === 'CA_CHANGED') {
    if (request.ca) lastKnownCA = request.ca;
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }
  if (request.type === 'GET_LAST_CA') {
    sendResponse({ ca: lastKnownCA });
    return false;
  }
  if (request.type === 'CONNECT_HELIUS_WS') {
    connectHeliusWebSocket(request.apiKey);
    sendResponse({ success: true });
    return false;
  }
  if (request.type === 'SUBSCRIBE_TOKEN') {
    const txSubId = subscribeToTokenTransactions(request.ca);
    const accSubId = subscribeToTokenAccount(request.ca);
    sendResponse({ success: true, txSubId, accSubId });
    return false;
  }
  if (request.type === 'UNSUBSCRIBE_TOKEN') {
    if (request.txSubId) unsubscribeHelius(request.txSubId);
    if (request.accSubId) unsubscribeHelius(request.accSubId);
    sendResponse({ success: true });
    return false;
  }
  if (request.type === 'DISCONNECT_HELIUS_WS') {
    disconnectHeliusWebSocket();
    sendResponse({ success: true });
    return false;
  }
return false;
});

// ── BONK.FUN / LETSBONK ──
// LetsBonk.fun uses Raydium LaunchLab (Program: LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj)
// API endpoint: https://api.letsbonk.fun/coins/{ca}
// Response format based on Apify scraper: { mint, poolId, creator, createAt, name, symbol, marketCap, volumeU, finishingRate, totalSellA, totalFundRaisingB, migrateType, imgUrl, ... }
async function fetchBonkFun(ca) {
  try {
    const res = await fetch(`https://api.letsbonk.fun/coins/${ca}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) {
      // Try fallback endpoint
      const fallbackRes = await fetch(`https://frontend-api.letsbonk.fun/coins/${ca}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' }
      });
      if (!fallbackRes.ok) return null;
      const data = await fallbackRes.json();
      return normalizeBonkData(data, ca);
    }

    const data = await res.json();
    return normalizeBonkData(data, ca);

  } catch (e) { 
    return null; 
  }
}

function normalizeBonkData(data, ca) {
  if (!data || (!data.mint && !data.address && !data.symbol && !data.name)) {
    return null;
  }

  // Calculate price from reserves if available
  let price = 0;
  if (data.initPrice) {
    price = parseFloat(data.initPrice);
  } else if (data.marketCap && data.supply) {
    price = data.marketCap / data.supply;
  }

  // Calculate bonding curve progress
  const finishingRate = data.finishingRate || 0;
  const isComplete = finishingRate >= 100 || data.migrated || data.migrateType === 'amm' || data.migrateType === 'cpmm';

  // Calculate virtual SOL reserves for bonding curve display
  const virtualSolReserves = data.totalFundRaisingB ? parseFloat(data.totalFundRaisingB) / 1e9 : 0;

  return {
    mint: data.mint || data.address || ca,
    symbol: data.symbol || '',
    name: data.name || '',
    usd_market_cap: data.marketCap || data.market_cap || data.usd_market_cap || 0,
    holder_count: data.numHolders || data.holder_count || data.holders || 0,
    complete: isComplete,
    raydium_pool: data.migrated || data.poolId || data.migrateType ? true : null,
    // Bonk.fun uses Raydium LaunchLab reserves
    virtual_sol_reserves: virtualSolReserves * 1e9, // Convert back to lamports for compatibility
    real_sol_reserves: virtualSolReserves * 1e9,
    price: price,
    image_uri: data.imgUrl || data.image_uri || data.image || '',
    description: data.description || '',
    twitter: data.twitter || '',
    website: data.website || '',
    telegram: data.telegram || '',
    created_timestamp: data.createAt || data.createdAt || data.created_timestamp || 0,
    creator: data.creator || '',
    _source: 'bonkfun',
    // Bonk.fun specific fields
    finishingRate: finishingRate,
    totalSellA: data.totalSellA || 0,
    totalFundRaisingB: data.totalFundRaisingB || 0,
    migrateType: data.migrateType || '',
    poolId: data.poolId || '',
    supply: data.supply || 0,
    volumeU: data.volumeU || 0,
    volumeA: data.volumeA || 0,
    volumeB: data.volumeB || 0,
    configId: data.configId || ''
  };
}

// ── DEXSCREENER ──
async function fetchDexScreener(ca) {
  const endpoints = [
    `https://api.dexscreener.com/tokens/v1/solana/${ca}`,
    `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
    `https://api.dexscreener.com/latest/dex/search?q=${ca}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) return { pairs: data };
      if (data?.pairs?.length) return { pairs: data.pairs };
      if (data?.pair) return { pairs: [data.pair] };
    } catch (e) { continue; }
  }
  return null;
}

// ── PUMP.FUN ──
async function fetchPumpFun(ca) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://frontend-api.pump.fun/coins/${ca}`, {
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) { if (attempt === 0) continue; return null; }
      return await res.json();
    } catch (e) { if (attempt === 0) continue; return null; }
  }
  return null;
}

// ── BIRDEYE ──
async function fetchBirdeye(ca) {
  try {
    const res = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${ca}`,
      {
        headers: { 'X-API-KEY': 'public', 'x-chain': 'solana' },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data) return null;
    const t = data.data;
    const pair = {
      baseToken: { symbol: t.symbol || '', name: t.name || '', address: ca },
      fdv: t.mc || t.fdv || 0,
      marketCap: t.mc || 0,
      liquidity: { usd: t.liquidity || 0 },
      volume: { m5: t.v5mUSD||0, h1: t.v1hUSD||0, h6: t.v6hUSD||0, h24: t.v24hUSD||0 },
      txns: { m5: { buys: t.buy5m||0, sells: t.sell5m||0 }, h1: { buys: t.buy1h||0, sells: t.sell1h||0 } },
      priceChange: { m5: t.priceChange5mPercent||0, h1: t.priceChange1hPercent||0, h6: t.priceChange6hPercent||0, h24: t.priceChange24hPercent||0 },
      priceUsd: String(t.price || 0),
      pairCreatedAt: t.creationTime ? t.creationTime * 1000 : null,
      info: { imageUrl: t.logoURI || '' },
      _source: 'birdeye'
    };
    return { pairs: [pair], source: 'birdeye' };
  } catch (e) { return null; }
}

// ── RUGCHECK ──
async function fetchRugcheck(ca) {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${ca}/report`, {
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

// ── FETCH TRADES ──
async function fetchTrades(ca, pairAddress) {
  const attempts = [];
  if (pairAddress) {
    attempts.push(
      fetch(`https://api.dexscreener.com/latest/dex/trades/${pairAddress}`, {
        signal: AbortSignal.timeout(4000)
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    );
  }
  attempts.push(
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, {
      signal: AbortSignal.timeout(4000)
    }).then(r => r.ok ? r.json() : null).catch(() => null)
  );
  const results = await Promise.all(attempts);
  for (const data of results) {
    if (!data) continue;
    if (Array.isArray(data) && data.length > 0 && data[0]?.maker) {
      return { success: true, trades: data, source: 'dexscreener' };
    }
    const pairs = data?.pairs || (Array.isArray(data) ? data : []);
    if (pairs.length > 0) {
      return { success: true, trades: [], source: 'dexscreener_pair', pairData: pairs[0] };
    }
  }
  return { success: true, trades: [], source: 'none' };
}

// ── EARLY TRADERS ──
async function fetchEarlyTraders(ca, pairAddress) {
  const addrs = new Set();
  try {
    if (pairAddress) {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/trades/${pairAddress}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach(t => { if (t.maker) addrs.add(t.maker); });
          if (addrs.size > 0) return [...addrs];
        }
      }
    }
    const res2 = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res2.ok) {
      const data2 = await res2.json();
      const trades = Array.isArray(data2) ? data2 : (data2?.trades || []);
      trades.forEach(t => { if (t.maker) addrs.add(t.maker); });
    }
  } catch (e) { }
  return [...addrs];
}

// ── SOL BALANCES ──
async function fetchSolBalances(addresses) {
  if (!addresses || addresses.length === 0) return {};
  try {
    const batch = addresses.slice(0, 20);
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getMultipleAccounts',
        params: [batch, { encoding: 'base64' }]
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const result = {};
    (data?.result?.value || []).forEach((acc, i) => {
      if (batch[i]) result[batch[i]] = acc ? (acc.lamports || 0) / 1e9 : 0;
    });
    return result;
  } catch (e) { return {}; }
}


// ── HELIUS TRADERS (bonding-curve backup when DexScreener fails) ──
async function fetchHeliusTraders(ca, apiKey) {
  if (!apiKey || !ca) return [];
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const addrs = new Set();
  try {
    const sigRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [ca, { limit: 50 }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!sigRes.ok) return [];
    const sigData = await sigRes.json();
    const sigs = (sigData?.result || []).map(s => s.signature).filter(Boolean);
    if (!sigs.length) return [];
    const limit = Math.min(sigs.length, 20);
    for (let i = 0; i < limit; i += 5) {
      const batch = sigs.slice(i, i + 5);
      const body = batch.map((sig, idx) => ({
        jsonrpc: '2.0', id: i + idx,
        method: 'getTransaction',
        params: [sig, { encoding: 'json', maxSupportedTransactionVersion: 0 }]
      }));
      const txRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      if (!txRes.ok) continue;
      const txData = await txRes.json();
      const responses = Array.isArray(txData) ? txData : [txData];
      for (const item of responses) {
        if (item?.result?.transaction?.message) {
          const msg = item.result.transaction.message;
          const keys = msg.accountKeys || [];
          const numSigs = msg.header?.numRequiredSignatures || 1;
          for (let k = 0; k < Math.min(keys.length, numSigs); k++) {
            if (typeof keys[k] === 'string') addrs.add(keys[k]);
          }
        }
      }
    }
  } catch (e) {}
  return [...addrs];
}

// ── GECKOTERMINAL ──
async function fetchGeckoTerminal(ca) {
  try {
    const poolsRes = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${ca}/pools?page=1`, {
      signal: AbortSignal.timeout(6000)
    });
    if (!poolsRes.ok) return null;
    const poolsData = await poolsRes.json();
    const pools = poolsData?.data || [];
    if (!pools.length) return null;
    const best = pools.sort((a, b) => (b.attributes?.volume_usd?.h24 || 0) - (a.attributes?.volume_usd?.h24 || 0))[0];
    const poolAddr = best?.attributes?.address;
    if (!poolAddr) return null;

    const [statsRes, ohlcvRes] = await Promise.all([
      fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddr}?include=base_token,quote_token`, {
        signal: AbortSignal.timeout(6000)
      }),
      fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddr}/ohlcv/minute?aggregate=5&limit=50`, {
        signal: AbortSignal.timeout(6000)
      })
    ]);

    const stats = statsRes.ok ? await statsRes.json() : null;
    const ohlcv = ohlcvRes.ok ? await ohlcvRes.json() : null;
    return { pool: poolAddr, stats, ohlcv, source: 'geckoterminal' };
  } catch (e) { return null; }
}

// ── HELIUS ──
async function fetchHeliusData(addresses, apiKey) {
  if (!apiKey || !addresses?.length) return null;
  const result = {};
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  for (let i = 0; i < addresses.length; i += 10) {
    const batch = addresses.slice(i, i + 10);
    const body = batch.map((addr, idx) => ({
      jsonrpc: '2.0',
      id: i + idx,
      method: 'getSignaturesForAddress',
      params: [addr, { limit: 100 }]
    }));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const responses = Array.isArray(data) ? data : [data];
      for (const item of responses) {
        if (item?.result && typeof item.id === 'number') {
          const addr = addresses[item.id];
          const sigs = item.result;
          result[addr] = {
            txCount: sigs.length,
            isFresh: sigs.length < 15,
            isVeryFresh: sigs.length < 5,
            oldestSlot: sigs.length > 0 ? sigs[sigs.length - 1].slot : null,
            oldestBlockTime: sigs.length > 0 ? sigs[sigs.length - 1].blockTime : null,
            newestSlot: sigs.length > 0 ? sigs[0].slot : null,
            signatures: sigs.slice(0, 10)
          };
        }
      }
    } catch (e) {}
  }
  return result;
}


// ── SOLSCAN ──
async function fetchSolscan(ca, apiKey) {
  const result = { holders: [], walletAges: {}, source: 'solscan' };
  try {
    // Token holders
    const holdersRes = await fetch(`https://api.solscan.io/token/holders?tokenAddress=${ca}&limit=20`, {
      signal: AbortSignal.timeout(6000)
    });
    if (holdersRes.ok) {
      const hData = await holdersRes.json();
      result.holders = (hData?.data?.items || []).map(h => ({
        address: h.address,
        amount: h.amount,
        decimals: h.decimals,
        rank: h.rank
      }));
    }
  } catch (e) {}

  // Wallet first-tx dates for top holders
  const holderAddrs = result.holders.map(h => h.address).filter(Boolean);
  if (apiKey && holderAddrs.length > 0) {
    for (let i = 0; i < Math.min(holderAddrs.length, 10); i++) {
      const addr = holderAddrs[i];
      try {
        const res = await fetch(`https://pro-api.solscan.io/v2.0/account/${addr}/transactions?limit=1`, {
          headers: { 'token': apiKey },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          const txs = data?.data || [];
          if (txs.length > 0) {
            const oldest = txs[txs.length - 1];
            result.walletAges[addr] = {
              firstTxSlot: oldest.slot,
              firstTxTime: oldest.blockTime,
              firstTxAgeDays: oldest.blockTime ? Math.floor((Date.now() / 1000 - oldest.blockTime) / 86400) : null
            };
          } else {
            result.walletAges[addr] = { firstTxSlot: null, firstTxTime: null, firstTxAgeDays: null, noTxs: true };
          }
        }
      } catch (e) {}
    }
  } else if (holderAddrs.length > 0) {
    // Free public endpoint fallback — account creation time
    for (let i = 0; i < Math.min(holderAddrs.length, 5); i++) {
      const addr = holderAddrs[i];
      try {
        const res = await fetch(`https://api.solscan.io/account?address=${addr}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.data?.createdAt) {
            result.walletAges[addr] = {
              firstTxTime: data.data.createdAt,
              firstTxAgeDays: Math.floor((Date.now() / 1000 - data.data.createdAt) / 86400),
              from: 'account_created'
            };
          }
        }
      } catch (e) {}
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════
// GMGN OPENAPI — Official REST API (no more scraping, no rate limits)
// Docs: github.com/GMGNAI/gmgn-skills
// Key set in Filters → API Keys → GMGN API Key
// ══════════════════════════════════════════════════════════════════════

let _gmgnApiKey = '';

// Base URL — GMGN confirmed openapi endpoint
const GMGN_BASE = 'https://gmgn.ai';

function gmgnHeaders(key) {
  const h = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (key) h['x-api-key'] = key;          // official header per docs
  return h;
}

async function gmgnGet(path, key, timeout = 6000) {
  const url = GMGN_BASE + path;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: gmgnHeaders(key || _gmgnApiKey)
    });
    if (res.status === 401 || res.status === 403) return { _err: 'invalid_key', _status: res.status };
    if (res.status === 429)                        return { _err: 'rate_limited', _status: 429 };
    if (!res.ok)                                   return { _err: 'http_' + res.status, _status: res.status };
    return await res.json();
  } catch (e) { return { _err: e.message || 'fetch_failed' }; }
}

// ── TOKEN INFO: bundle_ratio, insider_ratio, dev_holding, top10%, honeypot, LP burned ──
async function fetchGMGNTokenInfo(ca, key) {
  const apiKey = key || _gmgnApiKey;
  const result = { tokenData: null, topHolders: [], securityData: null, smartMoney: [], kolHolders: [], hasKey: !!apiKey, source: apiKey ? 'gmgn_api' : 'gmgn_unofficial', blocked: false };

  if (apiKey) {
    // Official endpoints — all in parallel
    const [info, sec, holders, smart, kol] = await Promise.all([
      // Token fundamentals: holder_count, bundle_ratio, insider_ratio, dev_pct, top10_pct
      gmgnGet(`/defi/openapi/v1/token/info/sol/${ca}`, apiKey),
      // Security: is_honeypot, renounced, lp_burned_pct, blacklist, mintable
      gmgnGet(`/defi/openapi/v1/token/security/sol/${ca}`, apiKey),
      // Top 70 holders with wallet classification (bundler, sniper, smart_money, kol, normal)
      gmgnGet(`/defi/openapi/v1/token/top_holders/sol/${ca}?limit=70`, apiKey),
      // Smart money currently holding this token
      gmgnGet(`/defi/openapi/v1/token/smart_money_holders/sol/${ca}?limit=20`, apiKey),
      // KOL wallets holding this token
      gmgnGet(`/defi/openapi/v1/token/kol_holders/sol/${ca}?limit=20`, apiKey),
    ]);

    if (!info._err)     result.tokenData    = info?.data  || info  || null;
    if (!sec._err)      result.securityData = sec?.data   || sec   || null;
    if (!holders._err)  result.topHolders   = holders?.data?.holders || holders?.data || holders?.holders || [];
    if (!smart._err)    result.smartMoney   = smart?.data  || smart?.holders || [];
    if (!kol._err)      result.kolHolders   = kol?.data   || kol?.holders   || [];

  } else {
    // No key — unofficial fallback (may get blocked)
    const r = await fetch(`${GMGN_BASE}/defi/quotation/v1/tokens/solana/${ca}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    }).catch(() => null);
    if (r?.ok) { const d = await r.json().catch(() => null); result.tokenData = d?.data || null; }
    else result.blocked = true;
  }

  return result;
}

// ── TRENDING — real-time 1m/5m/1h trending tokens ──
async function fetchGMGNTrending(key, period = '5m', limit = 20) {
  const apiKey = key || _gmgnApiKey;
  if (apiKey) {
    const data = await gmgnGet(`/defi/openapi/v1/token/trending/sol?period=${period}&limit=${limit}`, apiKey);
    if (!data._err) return data?.data?.rank || data?.data || data?.rank || [];
  }
  // Unofficial fallback
  const r = await fetch(`${GMGN_BASE}/defi/quotation/v1/rank/sol/swaps/${period}?orderby=volume&direction=desc&filters[]=renounced&filters[]=not_honeypot&limit=${limit}`, {
    signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  }).catch(() => null);
  if (r?.ok) { const d = await r.json().catch(() => null); return d?.data?.rank || []; }
  return [];
}

// ── NEW TOKENS (Trenches) — newly launched tokens ──
async function fetchGMGNNewTokens(key) {
  const apiKey = key || _gmgnApiKey;
  if (!apiKey) return [];
  const data = await gmgnGet('/defi/openapi/v1/token/new/sol?period=1h&limit=20', apiKey);
  return data?.data?.rank || data?.data || [];
}

// ── NEAR GRADUATION — tokens close to bonding curve fill ──
async function fetchGMGNNearGraduation(key) {
  const apiKey = key || _gmgnApiKey;
  if (!apiKey) return [];
  const data = await gmgnGet('/defi/openapi/v1/token/graduation/sol?limit=20', apiKey);
  return data?.data?.tokens || data?.data || [];
}

// ── WALLET PNL ──
async function fetchGMGNWalletPnL(wallet, key) {
  const apiKey = key || _gmgnApiKey;
  const path = `/defi/openapi/v1/wallet/sol/stat/${wallet}`;
  const fallback = `${GMGN_BASE}/defi/quotation/v1/wallet/solana/stat/${wallet}`;
  if (apiKey) {
    const d = await gmgnGet(path, apiKey);
    if (!d._err) return d?.data || null;
  }
  const r = await fetch(fallback, { signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } }).catch(() => null);
  if (r?.ok) { const d = await r.json().catch(() => null); return d?.data || null; }
  return null;
}

// ── TOP HOLDER ADDRESSES — for tracked wallet matching ──
async function fetchGMGNTopHolders(ca, key) {
  const info = await fetchGMGNTokenInfo(ca, key || _gmgnApiKey);
  const addresses = (info.topHolders || []).map(h => h.address || h.wallet || '').filter(Boolean);
  // Also include smart money addresses
  const smartAddrs = (info.smartMoney || []).map(h => h.address || h.wallet || '').filter(Boolean);
  return [...new Set([...addresses, ...smartAddrs])];
}

// Backward-compat wrapper
async function fetchGMGN(ca, key) {
  const apiKey = key || _gmgnApiKey;
  if (apiKey) _gmgnApiKey = apiKey;
  const info = await fetchGMGNTokenInfo(ca, apiKey);
  return {
    tokenData: info.tokenData,
    topHolders: info.topHolders,
    securityData: info.securityData,
    smartMoney: info.smartMoney,
    kolHolders: info.kolHolders,
    blocked: info.blocked,
    source: info.source,
    hasKey: info.hasKey,
    trending: []
  };
}

// ── PUMP.FUN TOP HOLDERS (unchanged) ──
async function fetchPumpFunHolders(ca) {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${ca}/holders?limit=50&offset=0`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map(h => h.holder_address || h.address || '').filter(Boolean);
  } catch (e) { return []; }
}



// ══════════════════════════════════════════════════════════════════════
// OPENTWITTER MCP — 6551.io (free Twitter data, no $100/mo API needed)
// Get key at: 6551.io — add in Filters → API Keys → Twitter Token
// Docs: https://ai.6551.io
// ══════════════════════════════════════════════════════════════════════

const TWITTER_BASE = 'https://ai.6551.io/open';

async function twitterPost(path, body, token) {
  if (!token) return null;
  try {
    const res = await fetch(TWITTER_BASE + path, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

// Search tweets for a token symbol/CA — returns top tweets with engagement
async function searchTokenTweets(symbol, ca, token) {
  if (!token) return { tweets: [], hasKey: false };

  const [symResults, caResults] = await Promise.all([
    // Search by symbol with min likes filter
    twitterPost('/twitter_search', { keyword: `$${symbol}`, minLikes: 10, maxResults: 10 }, token),
    // Also search by contract address (finds serious callers)
    twitterPost('/twitter_search', { keyword: ca.slice(0, 10), minLikes: 5, maxResults: 5 }, token)
  ]);

  const tweets = [
    ...(symResults?.data || symResults?.tweets || []),
    ...(caResults?.data  || caResults?.tweets  || [])
  ];

  // Deduplicate
  const seen = new Set();
  const unique = tweets.filter(t => { const id = t.id || t.tweet_id; return seen.has(id) ? false : seen.add(id); });

  // Calculate narrative score from engagement
  const narrScore = calcNarrativeScore(unique, symbol);

  return { tweets: unique.slice(0, 8), narrScore, hasKey: true, source: 'opentwitter' };
}

// Check if any KOLs/big accounts tweeted about this token
async function checkKOLTweets(symbol, token) {
  if (!token) return [];
  const data = await twitterPost('/twitter_search', {
    keyword: `$${symbol}`,
    minLikes: 100,   // high engagement = likely KOL or viral
    maxResults: 5
  }, token);
  return data?.data || data?.tweets || [];
}

// Calculate narrative strength from tweet engagement
function calcNarrativeScore(tweets, symbol) {
  if (!tweets || !tweets.length) return 0;
  let score = 30; // base

  const totalLikes    = tweets.reduce((s, t) => s + (t.likes || t.like_count || 0), 0);
  const totalRetweets = tweets.reduce((s, t) => s + (t.retweets || t.retweet_count || 0), 0);
  const totalReplies  = tweets.reduce((s, t) => s + (t.replies || t.reply_count || 0), 0);
  const totalViews    = tweets.reduce((s, t) => s + (t.views || t.view_count || 0), 0);
  const tweetCount    = tweets.length;

  // Virality from engagement
  if (totalLikes > 5000)   score += 25;
  else if (totalLikes > 1000) score += 15;
  else if (totalLikes > 200)  score += 8;
  else if (totalLikes > 50)   score += 3;

  if (totalRetweets > 500)  score += 15;
  else if (totalRetweets > 100) score += 8;
  else if (totalRetweets > 20)  score += 3;

  if (totalViews > 100000) score += 20;
  else if (totalViews > 10000) score += 10;
  else if (totalViews > 1000)  score += 4;

  // Multiple tweets = trending discussion
  if (tweetCount >= 5) score += 10;
  else if (tweetCount >= 3) score += 5;

  return Math.min(100, Math.max(0, score));
}

// ── HELIUS WEBSOCKET MANAGER ──
let heliusWs = null;
let heliusWsSubscriptions = new Map();
let heliusWsReconnectTimer = null;

function connectHeliusWebSocket(apiKey) {
  if (!apiKey) return;
  if (heliusWs?.readyState === WebSocket.OPEN) return;

  try {
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    heliusWs = new WebSocket(wsUrl);

    heliusWs.onopen = () => {
      console.log('[Helius WS] Connected');
      // Resubscribe to any active subscriptions
      for (const [subId, sub] of heliusWsSubscriptions) {
        sendHeliusSubscription(sub);
      }
    };

    heliusWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleHeliusMessage(data);
      } catch (e) {}
    };

    heliusWs.onclose = () => {
      console.log('[Helius WS] Disconnected');
      heliusWsReconnectTimer = setTimeout(() => connectHeliusWebSocket(apiKey), 5000);
    };

    heliusWs.onerror = () => {
      console.log('[Helius WS] Error');
    };

    // Ping every 30s to keep connection alive
    setInterval(() => {
      if (heliusWs?.readyState === WebSocket.OPEN) {
        heliusWs.ping();
      }
    }, 30000);

  } catch (e) {
    console.error('[Helius WS] Failed to connect:', e);
  }
}

function sendHeliusSubscription(sub) {
  if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN) return;
  heliusWs.send(JSON.stringify({
    jsonrpc: '2.0',
    id: sub.id,
    method: sub.method,
    params: sub.params
  }));
}

function handleHeliusMessage(data) {
  // Handle subscription confirmations
  if (data.result !== undefined && data.id !== undefined) {
    // Subscription confirmed, store the subscription ID
    for (const [subId, sub] of heliusWsSubscriptions) {
      if (sub.id === data.id) {
        sub.subscriptionId = data.result;
        break;
      }
    }
    return;
  }

  // Handle transaction notifications
  if (data.method === 'transactionNotification') {
    const result = data.params?.result;
    if (!result) return;

    const sig = result.signature;
    const tx = result.transaction;
    const meta = result.transaction?.meta;

    // Extract token transfers from the transaction
    const tokenTransfers = extractTokenTransfers(tx, meta);

    // Broadcast to sidepanel
    chrome.runtime.sendMessage({
      type: 'HELIUS_TX',
      signature: sig,
      transfers: tokenTransfers,
      timestamp: Date.now()
    }).catch(() => {});
  }

  // Handle account notifications (holder count changes)
  if (data.method === 'accountNotification') {
    const result = data.params?.result;
    if (!result) return;

    // Broadcast holder count update
    chrome.runtime.sendMessage({
      type: 'HELIUS_ACCOUNT',
      account: result.value?.owner,
      lamports: result.value?.lamports,
      timestamp: Date.now()
    }).catch(() => {});
  }
}

function extractTokenTransfers(tx, meta) {
  const transfers = [];
  if (!meta?.postTokenBalances || !meta?.preTokenBalances) return transfers;

  const preBalances = new Map();
  const postBalances = new Map();

  for (const bal of meta.preTokenBalances || []) {
    preBalances.set(bal.accountIndex, bal.uiTokenAmount?.uiAmount || 0);
  }

  for (const bal of meta.postTokenBalances || []) {
    postBalances.set(bal.accountIndex, bal.uiTokenAmount?.uiAmount || 0);
  }

  for (const [idx, post] of postBalances) {
    const pre = preBalances.get(idx) || 0;
    const diff = post - pre;
    if (diff !== 0) {
      transfers.push({
        accountIndex: idx,
        amount: Math.abs(diff),
        type: diff > 0 ? 'receive' : 'send'
      });
    }
  }

  return transfers;
}

function subscribeToTokenTransactions(ca) {
  if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN) return;

  const subId = Date.now();
  const sub = {
    id: subId,
    method: 'transactionSubscribe',
    params: [
      {
        accountInclude: [ca],
        failed: false
      },
      {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        transactionDetails: 'full',
        maxSupportedTransactionVersion: 0
      }
    ]
  };

  heliusWsSubscriptions.set(subId, sub);
  sendHeliusSubscription(sub);
  return subId;
}

function subscribeToTokenAccount(ca) {
  if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN) return;

  const subId = Date.now() + 1;
  const sub = {
    id: subId,
    method: 'accountSubscribe',
    params: [
      ca,
      {
        commitment: 'confirmed',
        encoding: 'jsonParsed'
      }
    ]
  };

  heliusWsSubscriptions.set(subId, sub);
  sendHeliusSubscription(sub);
  return subId;
}

function unsubscribeHelius(subId) {
  const sub = heliusWsSubscriptions.get(subId);
  if (!sub) return;

  if (heliusWs?.readyState === WebSocket.OPEN && sub.subscriptionId) {
    heliusWs.send(JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: sub.method.replace('Subscribe', 'Unsubscribe'),
      params: [sub.subscriptionId]
    }));
  }

  heliusWsSubscriptions.delete(subId);
}

function disconnectHeliusWebSocket() {
  if (heliusWsReconnectTimer) {
    clearTimeout(heliusWsReconnectTimer);
    heliusWsReconnectTimer = null;
  }

  for (const [subId] of heliusWsSubscriptions) {
    unsubscribeHelius(subId);
  }

  if (heliusWs) {
    heliusWs.close();
    heliusWs = null;
  }
}

// ── MAIN FETCH ──
// ── MAIN FETCH ──
async function fetchAllData(ca, heliusApiKey, solscanApiKey, gmgnApiKey, twitterToken) {
  // PRIMARY: Try Pump.fun and Bonk.fun first (they have the most reliable holder data)
  const [pumpfunRaw, bonkfunRaw, dexResult, rugcheck, birdeyeResult] = await Promise.all([
    fetchPumpFun(ca),
    fetchBonkFun(ca),
    fetchDexScreener(ca),
    fetchRugcheck(ca),
    fetchBirdeye(ca)
  ]);

  // Determine which platform data to use as primary
  let pumpfun = pumpfunRaw;
  let platformSource = 'pumpfun';

  // If Pump.fun fails but Bonk.fun succeeds, use Bonk.fun data
  if (!pumpfunRaw && bonkfunRaw) {
    pumpfun = bonkfunRaw;
    platformSource = 'bonkfun';
  }

  // If both fail, we still have DexScreener
  const hasPlatform = !!(pumpfun?.mint || pumpfun?.symbol);

  // DEX data: use DexScreener as fallback, but prefer platform data for certain fields
  let dex = (dexResult?.pairs?.length) ? dexResult : birdeyeResult;

  // If we have platform data but no DEX data, create minimal DEX structure from platform
  if (hasPlatform && !dex?.pairs?.length) {
    const platformPrice = pumpfun.price || 0;
    const platformMc = pumpfun.usd_market_cap || 0;
    const platformLiq = pumpfun.virtual_sol_reserves ? (pumpfun.virtual_sol_reserves / 1e9) * 150 : 0;

    dex = {
      pairs: [{
        baseToken: { 
          symbol: pumpfun.symbol, 
          name: pumpfun.name, 
          address: ca 
        },
        fdv: platformMc,
        marketCap: platformMc,
        liquidity: { usd: platformLiq },
        volume: { m5: 0, h1: 0, h6: 0, h24: 0 },
        txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 } },
        priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
        priceUsd: String(platformPrice),
        pairCreatedAt: pumpfun.created_timestamp ? pumpfun.created_timestamp * 1000 : Date.now(),
        info: { imageUrl: pumpfun.image_uri || '' },
        _source: platformSource
      }],
      source: platformSource
    };
  }

  const pairs = dex?.pairs || [];
  const bestPair = pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];
  const pairAddress = bestPair?.pairAddress || null;

  const topHolderAddrs = (rugcheck?.topHolders || [])
    .slice(0, 20)
    .map(h => h.address)
    .filter(Boolean);

  const geckoResult = await fetchGeckoTerminal(ca);
  const solscanResult = await fetchSolscan(ca, solscanApiKey);
  if (gmgnApiKey) _gmgnApiKey = gmgnApiKey;
  const gmgnResult = await fetchGMGN(ca, gmgnApiKey);

  let heliusResult = null;
  if (heliusApiKey && topHolderAddrs.length > 0) {
    heliusResult = await fetchHeliusData(topHolderAddrs, heliusApiKey);
  }

  // Fetch broad holder lists for tracked wallet matching
  const [earlyTraders, solBalances, heliusTraders, gmgnHolderAddrs, pumpHolderAddrs] = await Promise.all([
    fetchEarlyTraders(ca, pairAddress),
    fetchSolBalances(topHolderAddrs),
    fetchHeliusTraders(ca, heliusApiKey),
    fetchGMGNTopHolders(ca, gmgnApiKey),
    fetchPumpFunHolders(ca)
  ]);

  // Merge ALL known trader/holder addresses for tracked wallet matching
  const mergedEarlyTraders = [...new Set([
    ...(earlyTraders || []),
    ...(heliusTraders || []),
    ...(gmgnHolderAddrs || []),
    ...(pumpHolderAddrs || [])
  ])];

  // ── DEV FUND: trace creator wallet's funder ──
  // Fetch Twitter narrative data in parallel (non-blocking)
  let twitterData = { tweets: [], narrScore: 0, hasKey: !!twitterToken, source: 'none' };
  if (twitterToken && (dex?.pairs?.[0]?.baseToken?.symbol || pumpfun?.symbol)) {
    const sym = dex?.pairs?.[0]?.baseToken?.symbol || pumpfun?.symbol || '';
    twitterData = await searchTokenTweets(sym, ca, twitterToken).catch(() => twitterData);
  }

  const creatorAddr = rugcheck?.creator || pumpfun?.creator || null;
  let devFund = null;
  if (creatorAddr) {
    devFund = await fetchDevFunding(creatorAddr, heliusApiKey);
  }

  // ── GMGN TRENDING RANK for this token ──
  let trendRank = null;
  try {
    const trending = await fetchGMGNTrending(gmgnApiKey);
    if (trending && trending.length > 0) {
      const idx = trending.findIndex(t =>
        (t.address || t.mint || '').toLowerCase() === ca.toLowerCase() ||
        (t.symbol || '').toLowerCase() === (pumpfun?.symbol || '').toLowerCase()
      );
      trendRank = idx >= 0 ? idx + 1 : null;
    }
  } catch (e) {}

  // Pump.fun holder_count is the most reliable holders source
  // If Bonk.fun is primary, use its holder count
  const holderCount = pumpfun?.holder_count || gmgnResult?.tokenData?.holder_count || 0;

  return {
    success: true, 
    dex, 
    rugcheck, 
    pumpfun, 
    earlyTraders: mergedEarlyTraders,
    solBalances, 
    gecko: geckoResult, 
    helius: heliusResult, 
    solscan: solscanResult,
    gmgn: { ...gmgnResult, security: gmgnResult.securityData, smartMoney: gmgnResult.smartMoney || [], kolHolders: gmgnResult.kolHolders || [] }, 
    twitter: twitterData,
    devFund, 
    trendRank, 
    holderCount,
    platformSource  // NEW: tells which platform was primary
  };
}

async function fetchDevFunding(creatorAddr, heliusApiKey) {
  const result = { funder: null, amount: null, source: null, txSig: null };
  if (!creatorAddr) return result;

  const rpcUrl = heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
    : 'https://api.mainnet-beta.solana.com';

  try {
    // Step 1: Get oldest signatures for creator wallet (funding tx is near the start)
    const sigRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [creatorAddr, { limit: 10, commitment: 'finalized' }]
      }),
      signal: AbortSignal.timeout(7000)
    });
    if (!sigRes.ok) return result;
    const sigData = await sigRes.json();
    const sigs = sigData?.result || [];
    if (!sigs.length) return result;

    // Oldest tx = last item = most likely the initial funding
    const oldestSig = sigs[sigs.length - 1].signature;
    result.txSig = oldestSig;

    // Step 2: Parse that transaction to find who sent SOL to creator
    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'getTransaction',
        params: [oldestSig, { encoding: 'json', maxSupportedTransactionVersion: 0 }]
      }),
      signal: AbortSignal.timeout(7000)
    });
    if (!txRes.ok) return result;
    const txData = await txRes.json();
    const tx = txData?.result;
    if (!tx) return result;

    const keys = tx.transaction?.message?.accountKeys || [];
    const preBalances = tx.meta?.preBalances || [];
    const postBalances = tx.meta?.postBalances || [];

    // Find which account received SOL (the creator wallet gaining lamports)
    // Then the account that LOST SOL is the funder
    for (let i = 0; i < keys.length; i++) {
      const addr = typeof keys[i] === 'string' ? keys[i] : (keys[i]?.pubkey || '');
      if (addr.toLowerCase() === creatorAddr.toLowerCase()) {
        // Creator gained SOL - now find who sent it (lost SOL)
        for (let j = 0; j < keys.length; j++) {
          if (j === i) continue;
          const sent = (preBalances[j] || 0) - (postBalances[j] || 0);
          if (sent > 0) {
            const funderAddr = typeof keys[j] === 'string' ? keys[j] : (keys[j]?.pubkey || '');
            const amountSol = sent / 1e9;
            result.funder = funderAddr;
            result.amount = amountSol > 0 ? parseFloat(amountSol.toFixed(3)) : null;
            result.source = labelWallet(funderAddr);
            return result;
          }
        }
        break;
      }
    }

    // Fallback: key[0] is fee payer / likely the funder
    if (keys.length > 0) {
      const funderAddr = typeof keys[0] === 'string' ? keys[0] : (keys[0]?.pubkey || '');
      if (funderAddr && funderAddr.toLowerCase() !== creatorAddr.toLowerCase()) {
        const sent = (preBalances[0] || 0) - (postBalances[0] || 0);
        result.funder = funderAddr;
        result.amount = sent > 0 ? parseFloat((sent / 1e9).toFixed(3)) : null;
        result.source = labelWallet(funderAddr);
      }
    }
  } catch (e) {}
  return result;
}

// Label known CEX / exchange hot wallets by address prefix
function labelWallet(addr) {
  if (!addr) return null;
  const known = {
    'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7as2': 'Binance',
    '5tzFkiKscXHK5ZXCGbXZxdw7gigs3svF37gSd7': 'Coinbase',
    'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK': 'OKX',
    'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWd': 'Kraken',
    'rFqFJ9g7TGBD8Ed7TPDnvGKZ5pWLGrpPwoibHEt': 'Bybit',
  };
  for (const [prefix, label] of Object.entries(known)) {
    if (addr.startsWith(prefix.slice(0, 8))) return label;
  }
  // Short addr prefix as fallback
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

