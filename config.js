// config.js — ALL thresholds and scoring weights in one place
// Change any value here → takes effect instantly on next scan
// You can also change these in the Settings tab of the scanner

const GEM_CONFIG = {

  // ── SCORE PENALTIES (how much each bad signal hurts) ──
  scoring: {
    rugged_liq_zero:        -100,
    rugged_price_crash_vol: -90,
    rugged_price_crash:     -80,
    rugged_active_warn:     -25,
    dying:                  -60,
    no_holder_data:         -20,
    no_market_data:         -15,
    dead_cat_severe:        -30,
    dead_cat_warn:          -15,
    fake_botted:            -50,
    pump_bonding_warn:      +0,
    pump_raydium_bonus:     +5,
    tracked_none:           -30,
    tracked_few:            -10,
    tracked_good:           +15,
    dev_zero:               +8,
    dev_acceptable:         +2,
    dev_borderline:         -20,
    dev_danger:             -45,
    fresh_wallet_each:      -20,   // per wallet, max 3
    very_fresh_wallets:     -10,
    same_slot_bundle:       -35,
    helius_snipers:         -15,
    bundle_detected:        -40,
    sniper_detected:        -15,
    insider_detected:       -25,
    other_critical_risk:    -20,
    other_warn_risk:        -5,
    volmc_massive:          +20,
    volmc_strong:           +12,
    volmc_weak:             -15,
    no_volume:              -10,
    no_holder_data_v2:      -20,
    holder_data_ok:         +5,
    txns_organic:           +5,
    txns_low:               -10,
    liq_thin:               -25,
    liq_low:                -8,
    age_fresh:              +5,
    age_old:                -5,
    holders_very_thin:      -30,
    holders_thin:           -20,
    holders_building:       -8,
    holders_good:           +5,
    already_pumped_severe:  -30,
    already_pumped_warn:    -12,
    top10_concentrated:     -30,
    top10_moderate:         -12,
    nuke_wallet:            -35,
    nuke_wallet_warn:       -12,
  },

  // ── FILTER THRESHOLDS ──
  thresholds: {
    volmcMin:       60,    // Vol/MC % — red below this
    volmcStrong:    85,    // Vol/MC % — green above this
    volmcGold:      140,   // Vol/MC % — golden glow above this
    mcMin:          0,     // Min MCap filter ($0 = off)
    mcMax:          0,     // Max MCap filter ($0 = off)
    devMax:         3,     // Max dev holding % before warning
    nukePct:        3.5,   // Single wallet % = nuke risk
    top10Warn:      40,    // Top 10 concentration % = warning
    bundleMax:      15,    // Bundle % = red flag
    txnMin:         5,     // Min 5m transactions before warning
    liqMin:         3000,  // Min liquidity $ before red flag
    whaleBuy:       12,    // SOL buy = whale alert
    whaleSell:      15,    // SOL sell = whale alert
    rugPct:         90,    // Price drop % = rugged
    minHolders:     100,   // Min holders for a real runner
    deadCatWarn:    40,    // 24h drop % + 5m pump = dead cat warning
    deadCatSevere:  70,    // 24h drop % + 5m pump = trap
  },

  // ── TOGGLE SWITCHES ──
  toggles: {
    skipRugActive:    true,   // Don't call rugged if actively trading
    fakeDetect:       true,   // Detect fake/botted charts
    minHolderRule:    true,   // Penalise low holder count
    deadCatDetect:    true,   // Warn on already-pumped tokens
    trackedWalletPenalty: true, // Penalise if no tracked wallets found
    soundAlerts:      true,   // Play sound on runner / exit signal
  }
};
