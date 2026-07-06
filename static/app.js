/* ═══════════════════════════════════════════
   Kenny's Desk Box — App Logic
   Lightweight Charts (TradingView) + Watchlist
   ═══════════════════════════════════════════ */

const API = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE + '/api' : '/api';
let activeChart = null;     // Lightweight Charts instance
let activeChartData = null; // Raw chart data for reference
let searchTimeout = null;
let watchlistInterval = null;
let stockRefreshInterval = null;
let currentStockCode = null;

// ─── Watchlist ───
const WATCHLIST_CODES = [
  // HK stocks
  'HK.00700','HK.01888','HK.00992','HK.07709','HK.09903',
  'HK.03317','HK.02513','HK.02631','HK.00189',
  // US Storage
  'US.MU','US.WDC','US.STX','US.SNDK',
  // Space
  'US.SPCX','US.RKLB','US.ASTS',
  // Optical
  'US.LITE','US.COHR','US.CIEN',
  // AI
  'US.NVDA','US.AMD','US.MSFT','US.GOOGL','US.META',
];

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  fetchPositions();
  fetchWatchlist();
  setupSearch();

  // Refresh intervals
  setInterval(fetchStatus, 30000);
  setInterval(fetchPositions, 30000);
  watchlistInterval = setInterval(fetchWatchlist, 60000);

  // Listen for Enter on search
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) loadStock(val);
    }
  });
});

// ─── Status ───
async function fetchStatus() {
  try {
    const r = await fetch(`${API}/status`);
    const d = await r.json();
    document.getElementById('statusFutu').className = `status-dot ${d.futu_connected ? 'green' : 'red'}`;
    document.getElementById('statusTime').textContent = d.server_time;
    document.getElementById('welcomeStatus').textContent =
      `Futu ${d.futu_connected ? '✅ Connected' : '❌ Disconnected'} • HK ${d.hk_market} • US ${d.us_market} • ${d.positions}/${d.max_positions} positions`;
  } catch { }
}

// ─── Positions Sidebar ───
async function fetchPositions() {
  try {
    const r = await fetch(`${API}/positions`);
    const d = await r.json();
    const list = document.getElementById('positionsList');
    const count = document.getElementById('posCount');
    const totalPnl = document.getElementById('totalPnl');

    count.textContent = `${d.count}/${d.max}`;

    if (d.total_pnl >= 0) { totalPnl.textContent = `+$${d.total_pnl.toFixed(2)}`; totalPnl.className = 'pnl-value positive'; }
    else { totalPnl.textContent = `-$${Math.abs(d.total_pnl).toFixed(2)}`; totalPnl.className = 'pnl-value negative'; }

    if (!d.positions || d.positions.length === 0) {
      list.innerHTML = '<div class="loading">No open positions</div>';
      return;
    }

    list.innerHTML = d.positions.map(p => {
      const code = p.code.replace('HK.', '').replace('US.', '');
      const days = Math.floor((Date.now() - new Date(p.entry_date).getTime()) / 86400000);
      const slClass = p.danger ? 'sl-danger' : (p.warning ? 'sl-warning' : '');
      const pnlClass = (p.pnl_pct || 0) >= 0 ? 'positive' : 'negative';
      return `<div class="position-item ${slClass}" onclick="loadStock('${p.code}')">
        <div class="pos-header">
          <span class="pos-code">${p.market === 'HK' ? '🇭🇰' : '🇺🇸'} ${code}</span>
          <span class="pos-pnl ${pnlClass}">${(p.pnl_pct || 0) >= 0 ? '+' : ''}${(p.pnl_pct || 0).toFixed(1)}%</span>
        </div>
        <div class="pos-details">
          <span>$${p.entry_price.toFixed(2)}</span>
          <span>D+${days}</span>
          <span>SL $${p.stop_loss.toFixed(2)}</span>
          <span>Conf ${p.confidence}</span>
        </div>
      </div>`;
    }).join('');
  } catch { }
}

// ─── Search ───
function setupSearch() {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 1) { results.classList.add('hidden'); return; }
    searchTimeout = setTimeout(() => searchStocks(q), 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) results.classList.add('hidden');
  });
}

async function searchStocks(q) {
  try {
    const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    const results = document.getElementById('searchResults');
    if (!d.results || d.results.length === 0) {
      results.classList.add('hidden');
      return;
    }
    results.innerHTML = d.results.map(s => {
      const code = s.code.replace('HK.', '').replace('US.', '');
      return `<div class="search-result-item" onclick="loadStock('${s.code}'); document.getElementById('searchResults').classList.add('hidden'); document.getElementById('searchInput').value='${code}'">
        <span class="search-result-market">${s.market === 'HK' ? '🇭🇰' : '🇺🇸'}</span>
        <span class="search-result-code">${code}</span>
        <span class="search-result-name">${s.name}</span>
      </div>`;
    }).join('');
    results.classList.remove('hidden');
  } catch { }
}

// ─── Load Stock ───
async function loadStock(codeOrAlias) {
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('stockView').classList.remove('hidden');

  // Show loading
  document.getElementById('stockPrice').textContent = 'Loading...';
  document.getElementById('signalValue').textContent = '--';

  // Clear any existing chart
  if (activeChart) {
    activeChart.remove();
    activeChart = null;
  }
  activeChartData = null;
  document.getElementById('chartContainer').innerHTML = '<div id="chartLoading" class="chart-loading">Loading chart...</div>';

  try {
    const r = await fetch(`${API}/stock/${encodeURIComponent(codeOrAlias)}`);
    if (!r.ok) {
      document.getElementById('stockPrice').textContent = '❌ Not found';
      return;
    }
    const d = await r.json();
    currentStockCode = d.code;
    renderStock(d);
    renderInteractiveChart(d);
    if (d.held && d.position) renderPosition(d.position);

    // Fetch fundamentals (Google Finance data)
    fetchFundamentals(d.code);

    // Set up stock refresh (every 60s for the detail view)
    if (stockRefreshInterval) clearInterval(stockRefreshInterval);
    stockRefreshInterval = setInterval(() => {
      if (currentStockCode) refreshStock(currentStockCode);
    }, 60000);

    // Try backtest (pre-computed first)
    try {
      const br = await fetch(`${API}/backtest/${d.code}`);
      const bd = await br.json();
      if (bd.backtest) renderBacktest(bd.backtest, bd.ticker);
      else document.getElementById('backtestCard').classList.add('hidden');
    } catch {
      document.getElementById('backtestCard').classList.add('hidden');
    }

    // Start full on-the-fly backtest (Option A)
    startFullBacktest(d.code);
  } catch (e) {
    document.getElementById('stockPrice').textContent = '❌ Error';
  }
}

// ─── Refresh current stock (lightweight) ───
async function refreshStock(code) {
  if (!code) return;
  try {
    const r = await fetch(`${API}/stock/${encodeURIComponent(code)}`);
    if (!r.ok) return;
    const d = await r.json();
    renderStock(d);
    if (d.held && d.position) renderPosition(d.position);
  } catch { }
}

// ─── Render Stock Data ───
function renderStock(d) {
  const code = d.code.replace('HK.', '').replace('US.', '');
  document.getElementById('stockMarket').textContent = d.market === 'HK' ? '🇭🇰' : '🇺🇸';
  document.getElementById('stockCode').textContent = code;
  document.getElementById('stockName').textContent = d.name;
  document.getElementById('stockPrice').textContent = `$${d.price.toFixed(2)}`;

  const changeEl = document.getElementById('stockChange');
  const chg = d.change_1d_pct;
  changeEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
  changeEl.className = `stock-change ${chg >= 0 ? 'positive' : 'negative'}`;

  // Signal badge
  const sigBadge = document.getElementById('signalBadge');
  const sig = d.signal;
  sigBadge.textContent = sig === 'BUY' ? '🟢 BUY' : sig === 'HOLD' ? '🟡 HOLD' : sig === 'SELL' ? '🔴 SELL' : '⚪ SKIP';
  sigBadge.className = `badge signal-badge ${sig.toLowerCase()}`;

  // Position badge
  const posBadge = document.getElementById('positionBadge');
  if (d.held && d.position) {
    const pnl = d.position.pnl_pct || 0;
    posBadge.textContent = `📌 Held ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
    posBadge.style.background = pnl >= 0 ? 'var(--green-bg)' : 'var(--red-bg)';
    posBadge.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    posBadge.textContent = '';
  }

  // Signal value
  const sigVal = document.getElementById('signalValue');
  sigVal.textContent = sig;
  sigVal.className = `signal-value ${sig.toLowerCase()}`;

  document.getElementById('buyProb').textContent = `${(d.buy_prob * 100).toFixed(1)}%`;
  document.getElementById('accuracy').textContent = `${(d.accuracy * 100).toFixed(1)}%`;
  document.getElementById('confidence').textContent = d.confidence.toFixed(1);

  // Price stats
  document.getElementById('chg1d').textContent = `${d.change_1d_pct >= 0 ? '+' : ''}${d.change_1d_pct.toFixed(2)}%`;
  document.getElementById('chg1d').className = `val ${d.change_1d_pct >= 0 ? 'positive' : 'negative'}`;
  document.getElementById('chg5d').textContent = `${d.change_5d_pct >= 0 ? '+' : ''}${d.change_5d_pct.toFixed(2)}%`;
  document.getElementById('chg5d').className = `val ${d.change_5d_pct >= 0 ? 'positive' : 'negative'}`;
  document.getElementById('chg20d').textContent = `${d.change_20d_pct >= 0 ? '+' : ''}${d.change_20d_pct.toFixed(2)}%`;
  document.getElementById('chg20d').className = `val ${d.change_20d_pct >= 0 ? 'positive' : 'negative'}`;
  document.getElementById('high52w').textContent = `$${d.high_52w.toFixed(2)}`;
  document.getElementById('low52w').textContent = `$${d.low_52w.toFixed(2)}`;

  // Technicals
  document.getElementById('rsi14').textContent = d.rsi_14.toFixed(1);
  document.getElementById('rsi14').className = `val ${d.rsi_14 > 70 ? 'negative' : d.rsi_14 < 30 ? 'positive' : ''}`;
  document.getElementById('rsi7').textContent = d.rsi_7.toFixed(1);
  document.getElementById('macdHist').textContent = d.macd_hist.toFixed(4);
  document.getElementById('macdHist').className = `val ${d.macd_hist >= 0 ? 'positive' : 'negative'}`;
  document.getElementById('bbPos').textContent = (d.bb_position * 100).toFixed(1) + '%';
  document.getElementById('stochK').textContent = d.stoch_k.toFixed(1);

  // MAs
  document.getElementById('ma5').textContent = `$${d.ma5.toFixed(2)}`;
  document.getElementById('ma20').textContent = `$${d.ma20.toFixed(2)}`;
  document.getElementById('ma50').textContent = d.ma50 ? `$${d.ma50.toFixed(2)}` : '--';
  document.getElementById('stopLoss').textContent = `$${d.stop_loss.toFixed(2)} (${d.stop_loss_pct.toFixed(0)}%)`;
  document.getElementById('atrPct').textContent = (d.atr_pct * 100).toFixed(2) + '%';

  // Update chart label
  document.getElementById('chartLabel').textContent = `${d.name} (${code})`;
}

// ═══════════════════════════════════════════
// INTERACTIVE CANDLESTICK CHART (Lightweight Charts)
// ═══════════════════════════════════════════

function renderInteractiveChart(d) {
  if (!d.chart || d.chart.length === 0) return;

  const container = document.getElementById('chartContainer');
  container.innerHTML = ''; // clear loading

  activeChartData = d.chart;

  // Format data for Lightweight Charts
  const candleData = d.chart.map(c => ({
    time: c.date,     // 'YYYY-MM-DD'
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  const volumeData = d.chart.map(c => ({
    time: c.date,
    value: c.volume,
    color: c.close >= (d.chart[Math.max(0, d.chart.indexOf(c) - 1)]?.close || c.open)
      ? 'rgba(63,185,80,0.4)'
      : 'rgba(248,81,73,0.4)',
  }));

  // Calculate MA lines
  const closes = d.chart.map(c => c.close);
  const dates = d.chart.map(c => c.date);
  const ma5 = calcMA(closes, 5);
  const ma20 = calcMA(closes, 20);
  const ma50 = calcMA(closes, 50);

  // Create chart
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: '#0d1117' },
      textColor: '#8b949e',
      fontSize: 11,
      fontFamily: 'JetBrains Mono, monospace',
    },
    grid: {
      vertLines: { color: '#1c2333' },
      horzLines: { color: '#1c2333' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#58a6ff', width: 1, style: LightweightCharts.LineStyle.Dashed },
      horzLine: { color: '#58a6ff', width: 1, style: LightweightCharts.LineStyle.Dashed },
    },
    rightPriceScale: {
      borderColor: '#30363d',
      scaleMargins: { top: 0.05, bottom: 0.25 },
    },
    timeScale: {
      borderColor: '#30363d',
      timeVisible: false,
      tickMarkStyle: { color: '#6e7681' },
    },
    handleScroll: { vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: false },
  });

  // Candlestick series
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#3fb950',
    downColor: '#f85149',
    borderDownColor: '#f85149',
    borderUpColor: '#3fb950',
    wickDownColor: '#f85149',
    wickUpColor: '#3fb950',
  });
  candleSeries.setData(candleData);

  // ─── TRADE SIGNALS (BUY/SELL markers) ───
  if (d.signals && (d.signals.buys.length > 0 || d.signals.sells.length > 0)) {
    const markers = [];

    // BUY markers (green arrow up, above bar)
    d.signals.buys.forEach(s => {
      markers.push({
        time: s.date,
        position: 'belowBar',
        color: '#3fb950',
        shape: 'arrowUp',
        text: 'BUY',
      });
    });

    // SELL markers (red arrow down, below bar)
    d.signals.sells.forEach(s => {
      markers.push({
        time: s.date,
        position: 'aboveBar',
        color: '#f85149',
        shape: 'arrowDown',
        text: 'SELL',
      });
    });

    try {
      candleSeries.setMarkers(markers);
    } catch (e) {
      console.warn('Markers error:', e);
    }
  }

  // MA5 line
  const ma5Series = chart.addLineSeries({
    color: '#f0883e',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'MA5',
  });
  ma5Series.setData(ma5.filter(p => p !== null).map((v, i) => ({
    time: dates[i], value: v,
  })));

  // MA20 line
  const ma20Series = chart.addLineSeries({
    color: '#58a6ff',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'MA20',
  });
  ma20Series.setData(ma20.filter(p => p !== null).map((v, i) => ({
    time: dates[i], value: v,
  })));

  // MA50 line
  const ma50Series = chart.addLineSeries({
    color: '#d29922',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'MA50',
  });
  ma50Series.setData(ma50.filter(p => p !== null).map((v, i) => ({
    time: dates[i], value: v,
  })));

  // Volume histogram (bottom pane)
  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.80, bottom: 0.02 },
  });
  volumeSeries.setData(volumeData);

  activeChart = chart;

  // Fit content
  chart.timeScale().fitContent();
}

// ─── Moving Average Helper ───
function calcMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
  }
  return result;
}

// ─── Fundamentals (Google Finance data) ───
async function fetchFundamentals(code) {
  const card = document.getElementById('fundamentalsCard');
  const grid = document.getElementById('fundamentalsGrid');
  const footer = document.getElementById('fundamentalsFooter');
  const nameEl = document.getElementById('fundamentalsName');

  // Show card with loading state
  card.classList.remove('hidden');
  grid.innerHTML = '<div class="loading">Loading fundamentals...</div>';
  footer.innerHTML = '';
  nameEl.textContent = code;

  try {
    const r = await fetch(`${API}/fundamental/${encodeURIComponent(code)}`);
    if (!r.ok) {
      grid.innerHTML = '<div class="loading">⚠️ Fundamentals data not available</div>';
      return;
    }
    const d = await r.json();

    nameEl.textContent = d.name || code;

    // Format market cap (e.g. 4.71T, 920.5B, 15.2M)
    const mc = formatMarketCap(d.market_cap);
    // Format P/E
    const pe = (d.pe_ratio !== null && d.pe_ratio !== undefined && !isNaN(d.pe_ratio))
      ? d.pe_ratio.toFixed(2) : null;
    // Format EPS
    const eps = (d.eps !== null && d.eps !== undefined && !isNaN(d.eps))
      ? `$${d.eps.toFixed(2)}` : null;
    // Format dividend yield
    const divYield = (d.dividend_yield !== null && d.dividend_yield !== undefined && !isNaN(d.dividend_yield))
      ? `${d.dividend_yield.toFixed(2)}%` : null;
    // 52W high/low
    const high52w = (d.high_52w !== null && d.high_52w !== undefined && !isNaN(d.high_52w))
      ? `$${d.high_52w.toFixed(2)}` : null;
    const low52w = (d.low_52w !== null && d.low_52w !== undefined && !isNaN(d.low_52w))
      ? `$${d.low_52w.toFixed(2)}` : null;

    // Build grid items — Chinese-friendly labels
    const items = [
      { label: '市值', value: mc, cls: 'highlight' },
      { label: '市盈率 (P/E)', value: pe, cls: '' },
      { label: '每股盈利 (EPS)', value: eps, cls: '' },
      { label: '股息率', value: divYield, cls: 'positive' },
      { label: '52週高位', value: high52w, cls: '' },
      { label: '52週低位', value: low52w, cls: '' },
      { label: '行業', value: d.industry || d.sector || null, cls: '' },
      { label: '板塊', value: d.sector || null, cls: '' },
    ];

    grid.innerHTML = items.map(it => {
      const val = it.value !== null && it.value !== undefined && it.value !== ''
        ? it.value : '—';
      const cls = (it.value === null || it.value === undefined || it.value === '') ? 'muted' : it.cls;
      return `<div class="fund-item">
        <span class="fund-label">${it.label}</span>
        <span class="fund-value ${cls}">${val}</span>
      </div>`;
    }).join('');

    // Footer: source + cached timestamp
    const src = d.source || 'Google Finance';
    let timeStr = '';
    if (d.cached_at) {
      try {
        const dt = new Date(d.cached_at);
        timeStr = dt.toLocaleString('zh-HK', { hour12: false });
      } catch {
        timeStr = d.cached_at;
      }
    }
    footer.innerHTML = `<span class="fund-source-tag">${src}</span>` +
      (timeStr ? `<span>更新於 ${timeStr}</span>` : '');

  } catch (e) {
    grid.innerHTML = '<div class="loading">⚠️ Failed to load fundamentals</div>';
  }
}

// ─── Market Cap Formatter ───
function formatMarketCap(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return null;
  const n = parseFloat(val);
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

// ─── Position Detail ───
function renderPosition(p) {
  const card = document.getElementById('positionCard');
  const details = document.getElementById('positionDetails');
  card.classList.remove('hidden');

  const days = Math.floor((Date.now() - new Date(p.entry_date).getTime()) / 86400000);
  const pnl = p.pnl_pct || 0;
  const pnlVal = p.pnl_val || 0;

  details.innerHTML = `
    <div class="pos-detail-item">
      <span class="pos-detail-label">Entry</span>
      <span class="pos-detail-value">$${p.entry_price.toFixed(2)}</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">Qty</span>
      <span class="pos-detail-value">${p.qty}</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">Cost</span>
      <span class="pos-detail-value">$${p.cost.toFixed(2)}</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">P&L</span>
      <span class="pos-detail-value" style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% (${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)})</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">Held</span>
      <span class="pos-detail-value">D+${days}</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">Stop Loss</span>
      <span class="pos-detail-value" style="color:var(--red)">$${p.stop_loss.toFixed(2)}</span>
    </div>
    <div class="pos-detail-item">
      <span class="pos-detail-label">Entry Conf</span>
      <span class="pos-detail-value">${p.confidence}</span>
    </div>
  `;
}

// ─── Full On-The-Fly Backtest (Option A) ───
let activeBacktestPollId = null;

async function startFullBacktest(code) {
  // Clear any existing poll
  if (activeBacktestPollId) {
    clearInterval(activeBacktestPollId);
    activeBacktestPollId = null;
  }

  const card = document.getElementById('backtestCard');
  const details = document.getElementById('backtestDetails');

  // Show computing state
  card.classList.remove('hidden');
  details.innerHTML = '<div class="loading" style="text-align:center;padding:20px;">🔄 Full backtest computing... (30-60s)<br><small style="color:#8b949e;">Walking forward 10 folds × 6 SVM params</small></div>';

  try {
    // Start the backtest task
    const r = await fetch(`${API}/backtest-run/${encodeURIComponent(code)}`, { method: 'POST' });
    if (!r.ok) {
      details.innerHTML = '<div class="loading">❌ Failed to start backtest</div>';
      return;
    }
    const task = await r.json();
    const taskId = task.task_id;

    // Poll every 3 seconds
    activeBacktestPollId = setInterval(async () => {
      try {
        const pr = await fetch(`${API}/backtest-run-status/${taskId}`);
        if (!pr.ok) {
          clearInterval(activeBacktestPollId);
          activeBacktestPollId = null;
          details.innerHTML = '<div class="loading">❌ Backtest task lost</div>';
          return;
        }
        const status = await pr.json();

        if (status.status === 'pending' || status.status === 'failed') {
          // Show error
          if (status.status === 'failed') {
            clearInterval(activeBacktestPollId);
            activeBacktestPollId = null;
            details.innerHTML = '<div class="loading">❌ Backtest failed: ' + (status.error || 'Unknown error') + '</div>';
            return;
          }
          // Still processing - update progress
          const progEl = details.querySelector('.loading small');
          if (progEl) progEl.textContent = status.progress || 'Processing...';
        } else if (status.status === 'completed') {
          // Done!
          clearInterval(activeBacktestPollId);
          activeBacktestPollId = null;

          if (status.result) {
            // Map fields for renderBacktest compatibility
            const bt = {
              model: status.result.model || 'SVM-rbf (grid-search)',
              acc: status.result.acc || 0,
              total_return: status.result.total_return || 0,
              sharpe: status.result.sharpe || 0,
              sortino: status.result.sortino || 0,
              calmar: status.result.calmar || 0,
              win_rate: status.result.win_rate || 0,
              profit_factor: status.result.profit_factor || 0,
              trades: status.result.trades || 0,
              max_dd: status.result.max_dd || 0,
              avg_win: status.result.avg_win || 0,
              avg_loss: status.result.avg_loss || 0,
              features: status.result.features || [],
              fundu_score: status.result.fundu_score || null,
            };
            // Show fresh badge
            renderBacktest(bt, code.replace('HK.', '').replace('US.', ''));
            // Add "fresh computed" label
            const sourceTag = document.createElement('div');
            sourceTag.style.cssText = 'text-align:center;font-size:10px;color:#58a6ff;margin-top:4px;';
            sourceTag.textContent = '⚡ Freshly computed on-the-fly';
            details.appendChild(sourceTag);
          }
        }
      } catch (e) {
        // Poll error - keep trying
      }
    }, 3000);

    // Safety timeout: stop polling after 120 seconds
    setTimeout(() => {
      if (activeBacktestPollId) {
        clearInterval(activeBacktestPollId);
        activeBacktestPollId = null;
        const progEl = details.querySelector('.loading');
        if (progEl) progEl.innerHTML = '⏱️ Backtest timed out (>120s)<br><small style="color:#8b949e;">Try again or the stock may have insufficient data</small>';
      }
    }, 120000);

  } catch (e) {
    details.innerHTML = '<div class="loading">❌ Network error starting backtest</div>';
  }
}

// ─── Backtest ───
function renderBacktest(bt, ticker) {
  const card = document.getElementById('backtestCard');
  const details = document.getElementById('backtestDetails');
  card.classList.remove('hidden');

  let html = '';

  // Model info
  html += `<div style="background:#1a1a2e;padding:6px 10px;border-radius:6px;margin-bottom:8px;font-size:11px;color:#8b949e;">
    Model: <strong style="color:#e6edf3">${bt.model || 'SVM-rbf'}</strong>
  </div>`;

  // Core metrics
  const metrics = [
    ['🎯 Accuracy', bt.acc, '%', true],
    ['📈 Total Return', bt.total_return, '%', true],
    ['📊 Sharpe Ratio', bt.sharpe, null, false],
    ['🛡️ Sortino', bt.sortino, null, false],
    ['🔥 Calmar', bt.calmar, null, false],
    ['✅ Win Rate', bt.win_rate, '%', true],
    ['💪 Profit Factor', bt.profit_factor, null, false],
    ['🔢 Total Trades', bt.trades, null, false],
    ['📉 Max DD', bt.max_dd, '%', true],
    ['💰 Avg Win', bt.avg_win, '%', true],
    ['💸 Avg Loss', bt.avg_loss, '%', true],
  ];

  for (const [label, val, fmt, pct] of metrics) {
    const num = parseFloat(val);
    if (val !== null && val !== undefined && !isNaN(num)) {
      let display = fmt === '%' ? (num * 100).toFixed(1) + '%' : num.toFixed(2);
      const cls = pct ? (num >= 0 ? 'positive' : 'negative') : '';
      html += `<div class="pos-detail-item">
        <span class="pos-detail-label">${label}</span>
        <span class="pos-detail-value ${cls}">${display}</span>
      </div>`;
    }
  }

  // Fundu Score (if available)
  if (bt.fundu_score !== null && bt.fundu_score !== undefined) {
    const fs = parseFloat(bt.fundu_score);
    html += `<div class="pos-detail-item">
      <span class="pos-detail-label">🏆 Fundu Score</span>
      <span class="pos-detail-value">${fs.toFixed(0)}/100</span>
    </div>`;
  }

  // Top features (top 5)
  if (bt.features && bt.features.length > 0) {
    html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #30363d;">
      <div style="font-size:11px;color:#8b949e;margin-bottom:4px;">🔍 Top Features</div>`;
    for (let i = 0; i < Math.min(5, bt.features.length); i++) {
      const f = bt.features[i];
      const fName = Array.isArray(f) ? f[0] : (f.name || 'feature');
      const fImp = Array.isArray(f) ? f[1] : (f.importance || 0);
      html += `<div class="pos-detail-item" style="font-size:11px;">
        <span class="pos-detail-label">${fName}</span>
        <span class="pos-detail-value">${(fImp * 100).toFixed(1)}%</span>
      </div>`;
    }
    html += `</div>`;
  }

  if (!html) html = '<div class="loading">No backtest data for this stock</div>';
  details.innerHTML = html;
}

// ═══════════════════════════════════════════
// WATCHLIST
// ═══════════════════════════════════════════

async function fetchWatchlist() {
  try {
    const r = await fetch(`${API}/watchlist`);
    const d = await r.json();
    if (!d.watchlist || d.watchlist.length === 0) return;

    document.getElementById('watchlistTime').textContent = d.time;

    const grid = document.getElementById('watchlistGrid');

    // Build a lookup for watchlist stocks we specifically track
    const tracked = new Set(WATCHLIST_CODES);

    // Filter to just our watchlist, in the right order
    const ordered = [];
    for (const code of WATCHLIST_CODES) {
      const found = d.watchlist.find(w => w.code === code);
      if (found) ordered.push(found);
    }

    if (ordered.length === 0) {
      grid.innerHTML = '<div class="loading">No watchlist data</div>';
      return;
    }

    grid.innerHTML = ordered.map(w => {
      const ticker = w.ticker;
      const chgCls = w.change_1d >= 0 ? 'wl-positive' : 'wl-negative';
      const arrow = w.change_1d >= 0 ? '▲' : '▼';
      // Determine signal color from change
      const signalColor = w.change_1d >= 2 ? 'var(--green)' : w.change_1d <= -2 ? 'var(--red)' : 'var(--text-dim)';
      return `<div class="wl-item" onclick="loadStock('${w.code}')" title="Click for details">
        <div class="wl-market">${w.market === 'HK' ? '🇭🇰' : '🇺🇸'}</div>
        <div class="wl-ticker">${ticker}</div>
        <div class="wl-price">$${w.price.toFixed(2)}</div>
        <div class="wl-change ${chgCls}">${arrow} ${w.change_1d >= 0 ? '+' : ''}${w.change_1d.toFixed(2)}%</div>
      </div>`;
    }).join('');
  } catch { }
}

// ─── Expose watchlist refresh globally ───
window.fetchWatchlist = fetchWatchlist;