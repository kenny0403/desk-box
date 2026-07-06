# 🏦 Kenny's Desk Box

> ML-powered trading dashboard with interactive candlestick charts, backtest signals, multi-market watchlist, and **Google Finance fundamentals**.

A **Bloomberg-style** single-page trading dashboard that combines **Futu OpenAPI** real-time data, **SVM-rbf ML signals** (walk-forward validation), **Lightweight Charts** interactive candlesticks, and **Google Finance** fundamental data — all in one dark-themed web interface.

**No yfinance dependency.** All price data comes from **Futu OpenD** (HK + US stocks).

## ✨ Features

### 📊 Interactive Chart (Lightweight Charts / TradingView)
- Interactive candlestick chart with zoom, pan, crosshair
- **BUY 🟢 / SELL 🔴 markers** overlaid directly from walk-forward backtest signals
- MA5 / MA20 / MA50 moving averages
- Volume bars

### 📋 Watchlist (36 stocks)
| Market | Sector | Stocks |
|--------|--------|--------|
| 🇭🇰 HK | Core | 700 騰訊, 1888 建滔, 992 聯想, 7709 湛江, 9903 嘀嗒, 3317 訊策, 2513 智譜AI, 2631 LOC, 189 東岳 |
| 🇭🇰 HK | Extended | 388 港交所, 9988 阿里, 3690 美團, 1810 小米, 9618 京東, 1211 比亞迪, 5 匯豐, 6821 思摩爾, 3998 波司登, 9961 攜程, 2899 紫金, 669 創科, 2378 保誠, 772 閱文 |
| 🇺🇸 US | Storage | MU, WDC, STX, SNDK |
| 🇺🇸 US | Space | SPCX, RKLB, ASTS |
| 🇺🇸 US | Optical | LITE, COHR, CIEN |
| 🇺🇸 US | AI | NVDA, AMD, MSFT, GOOGL, META |
| 🇺🇸 US | Other | AVGO, SMCI, PLTR, AAPL, TSLA, AMZN, V, JPM, GS, JNJ, INTC, XOM, CVX, QQQ, SPY |

- Real-time price via Futu OpenD, 1D% change, 5D% change
- Click any stock → load interactive chart + ML signals + fundamentals
- Auto-refresh every 60s

### 🧠 ML Signals (Walk-Forward SVM-rbf)
- **Algorithm:** Train on 100 bars → predict next 10 → slide → repeat
- **Kernel:** SVM-rbf (`C=10, gamma='scale'`)
- **20 Features:** Returns (1d/5d/10d/20d), MA crossovers, RSI (7/14), MACD, Bollinger Band width/position, ATR%, Stochastic, Volume ratio, Volatility, Calendar features
- **Thresholds:** BUY≥55% probability, SELL≤35%, Conf≥27
- **Validation:** Walk-forward (not simple 80/20) with full feature engineering pipeline

### 🏢 Fundamental Data (Google Finance)
- **Market Cap** (市值) — formatted as T/B/M/K
- **P/E Ratio** (市盈率)
- **EPS** (每股盈利)
- **Dividend Yield** (股息率)
- **52-Week High / Low**
- **Sector / Industry**
- 1-hour caching to avoid rate limits
- Data source: `query1.finance.yahoo.com` (Google Finance data)

### 🔍 Search
- Fuzzy ticker search (supports `700`, `NVDA`, `9988`, `PLTR`...)
- Chinese name search (e.g. `騰訊`, `英偉達`, `美光`)
- Works with HK stocks (`HK.00700`) and US stocks (`US.NVDA`)

### 📈 Backtest Stats
- Accuracy, Sharpe Ratio, Sortino, Calmar, Max Drawdown
- Win Rate, Total Return, Buy%
- Equity curve chart (PNG)

## 🏗 Architecture

```
┌──────────────────────────────────────────────────┐
│              Browser (Chrome/Safari)              │
│  index.html → app.js → Lightweight Charts CDN    │
│                         ↕                         │
│              Cloudflare Tunnel                    │
│    https://xxx.trycloudflare.com → localhost:8000  │
└──────────────────────────────────────────────────┘
                         ↕
┌──────────────────────────────────────────────────┐
│          WSL (Ubuntu 22.04) — Port 8000           │
│  ┌─────────────────────────────────────────┐     │
│  │ FastAPI (desk_box.py)                   │     │
│  │  • /api/watchlist  → 36-stock prices   │     │
│  │  • /api/stock/{c}  → OHLC + signals    │     │
│  │  • /api/fundamental → Google Finance   │     │
│  │  • /api/search?q=  → ticker search     │     │
│  │  • /api/backtest/  → stats → PNG       │     │
│  └─────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────┐     │
│  │ Futu OpenD (Port 11111) ← PRIMARY       │     │
│  │   HK.xxxxx + US.xxxxx                   │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

- **Price Data:** Futu OpenD ONLY (no yfinance)
- **Fundamental Data:** Google Finance API
- **ML Engine:** On-the-fly SVM-rbf walk-forward (within FastAPI process)

## 🚀 Quick Start

### Prerequisites
```bash
pip install fastapi uvicorn pandas numpy scikit-learn matplotlib futu-api requests beautifulsoup4 lxml
```

### Run
```bash
# Start the FastAPI server
cd /home/kenny/.hermes/profiles/trading/scripts
python desk_box.py

# Or use the control script
bash desk_box_ctl.sh start
```

### Open in Browser
```
http://localhost:8000
```

### Cloudflare Tunnel (External Access)
```bash
cloudflared tunnel --url http://localhost:8000
```
→ Provides a public URL like `https://xxx.trycloudflare.com`

## 📁 Project Structure

```
desk_box/
├── README.md
├── static/
│   ├── index.html             ← SPA frontend (Dark theme, Lightweight Charts)
│   ├── app.js                 ← Chart logic, watchlist, signals, fundamentals, auto-refresh
│   └── styles.css             ← Bloomberg-style dark theme CSS

scripts/
├── desk_box.py                ★ Main FastAPI server (~1390 lines)
│   • /api/watchlist           Futu-powered watchlist prices + 1D/5D changes
│   • /api/stock/{code}        OHLC + ML signal + BUY/SELL markers + technicials
│   • /api/fundamental/{code}  Market cap, PE, EPS, dividend, 52w range (Google Finance)
│   • /api/search              Fuzzy ticker search with Chinese name support
│   • /api/status              Server + Futu health + market state
│   • /api/positions           Current positions from Futu trade context
│   • /api/scan                Full ML scan on all known stocks
│   • /api/backtest/{code}     Backtest metrics (Sharpe, Sortino, etc.)
│   • /api/backtest/{code}/candlestick-chart  PNG candlestick chart
│   • /api/backtest/{code}/equity-chart       Equity curve PNG
├── desk_box_candlestick.py    ← mplfinance candlestick generator
├── futu_ml_results.json       ← Pre-computed backtest data (SVM-rbf)
├── futu_ml_backtest.py        ← Full backtest engine
```

## 🔌 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/watchlist` | JSON: 36 stocks with price, 1D%, 5D%, ticker |
| `GET /api/stock/{code}` | OHLC data + ML signal + BUY/SELL markers + backtest stats |
| `GET /api/fundamental/{code}` | Google Finance: market cap, PE, EPS, dividend, 52w high/low |
| `GET /api/search?q=700` | Fuzzy ticker search (HK + US, Chinese names) |
| `GET /api/scan` | Full ML scan on all known stocks |
| `GET /api/backtest/{code}` | Full backtest metrics (Sharpe, Sortino, etc.) |
| `GET /api/backtest/{code}/candlestick-chart` | Candlestick PNG chart |
| `GET /api/backtest/{code}/equity-chart` | Equity curve PNG chart |
| `GET /api/status` | Server health + Futu connection |
| `GET /api/positions` | Current open positions |

### Ticker Format
- HK: `HK.00700`, `HK.01888`, `HK.07709` (0-padded 5 digits)
- US: `US.NVDA`, `US.PLTR`, `US.RKLB`

## 📐 ML Signal Algorithm

```
For each stock:
  1. Fetch 800+ bars OHLCV (Futu OpenD)
  2. Compute 20 features (returns, MA, RSI, MACD, BB, ATR, Stoch, Vol)
  3. Walk-forward: Train 100 bars → predict next 10 → slide 10 →
     repeat across entire history
  4. SVM-rbf (C=10, gamma='scale', probability=True)
  5. StandardScaler per window
  6. Collect BUY (prob≥55%) and SELL (prob≤35%) dates
  7. Return last 60 bars of markers for chart overlay
```

## 🎨 Theme

Bloomberg-style dark theme with custom CSS variables:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-main` | `#0d1117` | Main background |
| `--bg-card` | `#161b22` | Card backgrounds |
| `--green` | `#3fb950` | BUY / Positive |
| `--red` | `#f85149` | SELL / Negative |
| `--yellow` | `#d29922` | HOLD / Warning |
| `--blue` | `#58a6ff` | Info / Links |
| `--accent` | `#f0883e` | Logo accent |

## 🛠 Tech Stack

- **Backend:** Python 3.12, FastAPI, Uvicorn
- **ML:** scikit-learn SVM(rbf), pandas, numpy, StandardScaler
- **Charts:** Lightweight Charts (TradingView CDN)
- **Price Data:** Futu OpenAPI (HK + US real-time) — **no yfinance**
- **Fundamental Data:** Google Finance (market cap, PE, EPS, dividend, 52w range)
- **Frontend:** Vanilla JS, CSS Grid, no frameworks
- **Tunnel:** Cloudflare Tunnel (cloudflared)

## 📜 License

Internal trading tool — not for public distribution.