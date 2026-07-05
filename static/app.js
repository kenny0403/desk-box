/* ═══════════════════════════════════════════
   Kenny's Desk Box — App Logic
   ═══════════════════════════════════════════ */

const API = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE + '/api' : '/api';
let priceChart = null;
let volumeChart = null;
let searchTimeout = null;

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  fetchPositions();
  setupSearch();

  // Refresh every 30s
  setInterval(fetchStatus, 30000);
  setInterval(fetchPositions, 30000);

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

  try {
    const r = await fetch(`${API}/stock/${encodeURIComponent(codeOrAlias)}`);
    if (!r.ok) {
      document.getElementById('stockPrice').textContent = '❌ Not found';
      return;
    }
    const d = await r.json();
    renderStock(d);
    renderChart(d);
    renderVolume(d);
    if (d.held && d.position) renderPosition(d.position);

    // Try backtest
    try {
      const br = await fetch(`${API}/backtest/${d.code}`);
      const bd = await br.json();
      if (bd.backtest) renderBacktest(bd.backtest, bd.ticker);
    } catch { }
  } catch (e) {
    document.getElementById('stockPrice').textContent = '❌ Error';
  }
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
}

// ─── Price Chart ───
function renderChart(d) {
  if (!d.chart || d.chart.length === 0) return;

  const dates = d.chart.map(c => c.date);
  const closes = d.chart.map(c => c.close);
  const highs = d.chart.map(c => c.high);
  const lows = d.chart.map(c => c.low);

  // Color based on trend
  const startPrice = closes[0];
  const endPrice = closes[closes.length - 1];
  const isUp = endPrice >= startPrice;
  const lineColor = isUp ? '#3fb950' : '#f85149';
  const fillColor = isUp ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)';

  const ctx = document.getElementById('priceChart').getContext('2d');

  if (priceChart) priceChart.destroy();

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Close',
        data: closes,
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }, {
        label: 'High',
        data: highs,
        borderColor: 'rgba(88,166,255,0.3)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      }, {
        label: 'Low',
        data: lows,
        borderColor: 'rgba(248,81,73,0.3)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#1c2333',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 8,
        }
      },
      scales: {
        x: {
          ticks: { color: '#6e7681', maxTicksLimit: 8, font: { size: 10 } },
          grid: { color: 'rgba(48,54,61,0.3)' },
        },
        y: {
          ticks: { color: '#6e7681', font: { size: 10 }, callback: v => '$' + v.toFixed(0) },
          grid: { color: 'rgba(48,54,61,0.3)' },
        }
      },
      interaction: { intersect: false, mode: 'index' },
    }
  });
}

// ─── Volume Chart ───
function renderVolume(d) {
  if (!d.chart || d.chart.length === 0) return;

  const dates = d.chart.map(c => c.date);
  const volumes = d.chart.map(c => c.volume);
  const colors = d.chart.map(c => c.close >= d.chart[Math.max(0, d.chart.indexOf(c) - 1)]?.close ? '#3fb950' : '#f85149');

  const ctx = document.getElementById('volumeChart').getContext('2d');
  if (volumeChart) volumeChart.destroy();

  volumeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [{
        label: 'Volume',
        data: volumes,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2333',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 8,
          callbacks: {
            label: ctx => `Vol: ${(ctx.raw / 1e6).toFixed(1)}M`
          }
        }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: {
          display: false,
          grid: { color: 'rgba(48,54,61,0.2)' },
        }
      },
    }
  });
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

// ─── Backtest ───
function renderBacktest(bt, ticker) {
  const card = document.getElementById('backtestCard');
  const details = document.getElementById('backtestDetails');
  card.classList.remove('hidden');

  let html = '';
  const fields = [
    ['Total Trades', 'total_trades'],
    ['Win Rate', 'win_rate', '%'],
    ['Avg Win', 'avg_win', '%'],
    ['Avg Loss', 'avg_loss', '%'],
    ['Max DD', 'max_drawdown', '%'],
    ['Sharpe', 'sharpe'],
    ['Total Return', 'total_return', '%'],
    ['Net P&L', 'net_pnl', '$'],
  ];

  for (const [label, key, suffix] of fields) {
    let val = bt[key];
    if (val !== undefined && val !== null) {
      if (typeof val === 'number') {
        val = val.toFixed(2);
        if (suffix === '%') val += '%';
        else if (suffix === '$') val = '$' + val;
      }
      html += `<div class="pos-detail-item">
        <span class="pos-detail-label">${label}</span>
        <span class="pos-detail-value">${val}</span>
      </div>`;
    }
  }

  if (!html) html = '<div class="loading">No backtest data for this stock</div>';
  details.innerHTML = html;
}