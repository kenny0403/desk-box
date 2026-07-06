#!/home/kenny/.hermes/hermes-agent/venv/bin/python3
"""
Kenny's Desk Box 🏦 — Trading Dashboard Backend
FastAPI server connecting Futu OpenD + ML signals
Run:  python desk_box.py
"""

import sys, os, json, math, warnings, traceback, asyncio
from contextlib import asynccontextmanager
warnings.filterwarnings('ignore')

# ─── Futu import with stdout redirect ───
_saved = sys.stdout
sys.stdout = sys.stderr
import logging
logging.basicConfig(stream=sys.stderr, level=logging.ERROR, force=True)
from futu import *
sys.stdout = _saved

import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

# ═══════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════
HKT = timezone(timedelta(hours=8))
OPEND_HOST = os.environ.get('FUTU_OPEND_HOST') or '172.17.96.1'
OPEND_PORT = 11111
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(SCRIPT_DIR, '..', 'cache', 'ml_trader_state.json')
STATIC_DIR = os.path.join(SCRIPT_DIR, '..', 'desk_box', 'static')

MIN_BUY_PROB = 0.55
SELL_THRESHOLD = 0.35
MIN_CONFIDENCE = 27
MAX_POSITIONS = 5

FEATURES = [
    'ret_1d','ret_5d','ret_10d','ret_20d',
    'close_ma5','close_ma10','close_ma20','close_ma50',
    'ma5_ma20','ma10_ma50',
    'rsi_14','rsi_7',
    'macd_hist','bb_width','bb_position','atr_pct',
    'stoch_k','stoch_d',
    'vol_ratio','volatility_10',
    'dayofweek','dayofmonth'
]

# Stock name map for display
STOCK_NAMES = {
    # HK
    'HK.01888': '1888 建滔集團', 'HK.00700': '700 騰訊', 'HK.00992': '992 聯想',
    'HK.07709': '7709 湛江', 'HK.02513': '2513 智譜AI', 'HK.02631': '2631 LOC',
    'HK.09903': '9903 嘀嗒', 'HK.03317': '3317 訊策', 'HK.00189': '189 東岳',
    'HK.06821': '6821 思摩爾', 'HK.03998': '3998 波司登', 'HK.09961': '9961 攜程',
    'HK.02899': '2899 紫金', 'HK.00669': '669 創科', 'HK.02378': '2378 保誠',
    'HK.00772': '772 閱文', 'HK.00388': '388 港交所', 'HK.03690': '3690 美團',
    'HK.09988': '9988 阿里', 'HK.01810': '1810 小米', 'HK.09618': '9618 京東',
    'HK.01211': '1211 比亞迪', 'HK.00005': '5 匯豐',
    # US
    'US.NVDA': 'NVDA 英偉達', 'US.AAPL': 'AAPL 蘋果', 'US.MSFT': 'MSFT 微軟',
    'US.GOOGL': 'GOOGL 谷歌', 'US.META': 'META', 'US.AMD': 'AMD 超微',
    'US.AVGO': 'AVGO 博通', 'US.PLTR': 'PLTR', 'US.SMCI': 'SMCI 超微電腦',
    'US.MU': 'MU 美光', 'US.WDC': 'WDC 西部數據', 'US.STX': 'STX 希捷',
    'US.RKLB': 'RKLB 火箭實驗室', 'US.ASTS': 'ASTS', 'US.LITE': 'LITE 朗美通',
    'US.COHR': 'COHR 相干', 'US.CIEN': 'CIEN', 'US.XOM': 'XOM 埃克森',
    'US.CVX': 'CVX 雪佛龍', 'US.JPM': 'JPM 摩通', 'US.GS': 'GS 高盛',
    'US.V': 'V Visa', 'US.JNJ': 'JNJ 強生', 'US.INTC': 'INTC Intel',
    'US.TSLA': 'TSLA 特斯拉', 'US.QQQ': 'QQQ 納指ETF', 'US.SPY': 'SPY 標普ETF',
    'US.Amazon': 'AMZN 亞馬遜', 'US.SNDK': 'SNDK 閃迪', 'US.SPCX': 'SPCX 太空ETF',
}

STOP_LOSS_OVERRIDES = {
    'HK.07709': 0.15, 'HK.07747': 0.12, 'HK.01888': 0.08, 'HK.02513': 0.12,
    'US.AVGO': 0.08, 'US.SMCI': 0.08, 'US.MU': 0.08, 'US.AMD': 0.08, 'US.RKLB': 0.08,
}

KNOWN_STOCKS = list(STOCK_NAMES.keys())
# Extended fallback list for search
SEARCH_ALIASES = {
    '700': 'HK.00700', '騰訊': 'HK.00700', 'tencent': 'HK.00700',
    '1888': 'HK.01888', '建滔': 'HK.01888', 'kingboard': 'HK.01888',
    '992': 'HK.00992', '聯想': 'HK.00992', 'lenovo': 'HK.00992',
    '7709': 'HK.07709', '湛江': 'HK.07709',
    '2513': 'HK.02513', '智譜': 'HK.02513',
    '6821': 'HK.06821', '思摩爾': 'HK.06821',
    '3998': 'HK.03998', '波司登': 'HK.03998',
    '9961': 'HK.09961', '攜程': 'HK.09961', 'trip': 'HK.09961',
    '2899': 'HK.02899', '紫金': 'HK.02899',
    'nvda': 'US.NVDA', '英偉達': 'US.NVDA', 'nvidia': 'US.NVDA',
    'pltr': 'US.PLTR', 'palantir': 'US.PLTR',
    'rklb': 'US.RKLB', '火箭': 'US.RKLB',
    'amd': 'US.AMD', '超微': 'US.AMD',
    'mu': 'US.MU', '美光': 'US.MU', 'micron': 'US.MU',
    'avgo': 'US.AVGO', '博通': 'US.AVGO', 'broadcom': 'US.AVGO',
    'cvx': 'US.CVX', '雪佛龍': 'US.CVX', 'chevron': 'US.CVX',
    'googl': 'US.GOOGL', 'google': 'US.GOOGL',
    'msft': 'US.MSFT', '微軟': 'US.MSFT', 'microsoft': 'US.MSFT',
    'meta': 'US.META', 'facebook': 'US.META',
    'aapl': 'US.AAPL', '蘋果': 'US.AAPL', 'apple': 'US.AAPL',
    'tsla': 'US.TSLA', '特斯拉': 'US.TSLA', 'tesla': 'US.TSLA',
    'smci': 'US.SMCI', '超微電腦': 'US.SMCI',
    'cohr': 'US.COHR', '相干': 'US.COHR',
    'lite': 'US.LITE', 'lumentum': 'US.LITE',
    'cien': 'US.CIEN', 'ciena': 'US.CIEN',
    'wdc': 'US.WDC', '西部數據': 'US.WDC', 'western digital': 'US.WDC',
    'stx': 'US.STX', '希捷': 'US.STX', 'seagate': 'US.STX',
    'asts': 'US.ASTS', 'ast space': 'US.ASTS',
    'sndk': 'US.SNDK', '閃迪': 'US.SNDK', 'sandisk': 'US.SNDK',
    'spcx': 'US.SPCX', 'space': 'US.SPCX',
    'xom': 'US.XOM', '埃克森': 'US.XOM', 'exxon': 'US.XOM',
    'jpm': 'US.JPM', '摩通': 'US.JPM', 'jpmorgan': 'US.JPM',
    'intc': 'US.INTC', 'intel': 'US.INTC',
    'qqq': 'US.QQQ', '納指': 'US.QQQ',
    'spy': 'US.SPY', '標普': 'US.SPY',
}

# ═══════════════════════════════════════════
# APP LIFESPAN
# ═══════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown"""
    app.state.ctx_quote = None
    app.state.ctx_hk = None
    app.state.ctx_us = None
    app.state.last_scan_cache = {}
    app.state.last_scan_time = None
    yield
    # Cleanup
    for ctx in ['ctx_quote', 'ctx_hk', 'ctx_us']:
        c = getattr(app.state, ctx, None)
        if c:
            try:
                c.close()
            except:
                pass

app = FastAPI(title="Kenny's Desk Box", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Mount backtest images
BT_IMG_DIR = os.path.join(SCRIPT_DIR, '..', 'cache', 'backtest')
if os.path.isdir(BT_IMG_DIR):
    app.mount("/static/backtest", StaticFiles(directory=BT_IMG_DIR), name="backtest")

# Mount equity curve charts (with buy/sell markers) for direct file serving
BT_CHARTS_DIR = os.path.join(SCRIPT_DIR, '..', 'cache', 'backtest', 'charts')
if os.path.isdir(BT_CHARTS_DIR):
    app.mount("/static/equity", StaticFiles(directory=BT_CHARTS_DIR), name="equity")


def get_equity_chart_path(code):
    """Map a ticker code to its equity curve chart PNG file path.

    The charts are generated by futu_ml_backtest.py and named after the
    `display_name` field in its STOCKS list:
      - HK stocks: {code_4digit}{name}_equity.png  e.g. "0700騰訊_equity.png"
        (code is the Futu ticker with leading zeros stripped, then re-padded
         to 4 digits; name is the Chinese name with no space)
      - US stocks: {ticker}_equity.png               e.g. "MSFT_equity.png"

    Returns the absolute file path if a chart exists, else None.
    """
    orig = code.upper()
    if not orig.startswith('HK.') and not orig.startswith('US.'):
        if orig.isdigit():
            orig = f'HK.{orig.zfill(5)}'
        else:
            orig = f'US.{orig}'

    ticker = orig.replace('HK.', '').replace('US.', '')

    chart_dir = BT_CHARTS_DIR
    if not os.path.isdir(chart_dir):
        return None

    # Build the expected filename
    if orig.startswith('HK.'):
        # HK: zero-pad code to 4 digits (strip leading zeros first, then pad)
        code4 = ticker.lstrip('0').zfill(4)
        # Name part = everything after the first space in STOCK_NAMES value
        full_name = STOCK_NAMES.get(orig, '')
        name_part = full_name.split(' ', 1)[1] if ' ' in full_name else ''
        file_base = f'{code4}{name_part}'
    else:
        # US: just the ticker
        file_base = ticker

    # Try the constructed name first
    candidate = os.path.join(chart_dir, f'{file_base}_equity.png')
    if os.path.isfile(candidate):
        return candidate

    # Fallback: scan the directory for a file whose base starts with the
    # (zero-padded) HK code or exactly the US ticker, ending in _equity.png.
    try:
        for fn in os.listdir(chart_dir):
            if not fn.endswith('_equity.png'):
                continue
            base = fn[:-len('_equity.png')]
            if orig.startswith('HK.'):
                if base.startswith(code4):
                    return os.path.join(chart_dir, fn)
            else:
                if base == ticker:
                    return os.path.join(chart_dir, fn)
    except Exception:
        pass

    return None


# ═══════════════════════════════════════════
# FUTU CONNECTION
# ═══════════════════════════════════════════
def get_ctx():
    """Lazy-init Futu connections"""
    if app.state.ctx_quote is None:
        try:
            app.state.ctx_quote = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
            app.state.ctx_hk = OpenSecTradeContext(host=OPEND_HOST, port=OPEND_PORT, filter_trdmarket=TrdMarket.HK)
            app.state.ctx_us = OpenSecTradeContext(host=OPEND_HOST, port=OPEND_PORT, filter_trdmarket=TrdMarket.US)
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Futu OpenD connection failed: {e}")
    return app.state.ctx_quote, app.state.ctx_hk, app.state.ctx_us


# ═══════════════════════════════════════════
# ML ENGINE
# ═══════════════════════════════════════════
def compute_features(df):
    """Compute 22 technical indicator features"""
    df = df.copy()
    c = df['Close']
    h, l, v = df['High'], df['Low'], df['Volume']

    df['ret_1d'] = c.pct_change(1)
    df['ret_5d'] = c.pct_change(5)
    df['ret_10d'] = c.pct_change(10)
    df['ret_20d'] = c.pct_change(20)

    ma5 = c.rolling(5).mean()
    ma10 = c.rolling(10).mean()
    ma20 = c.rolling(20).mean()
    ma50 = c.rolling(50).mean()

    df['close_ma5'] = c / ma5 - 1
    df['close_ma10'] = c / ma10 - 1
    df['close_ma20'] = c / ma20 - 1
    df['close_ma50'] = c / ma50 - 1
    df['ma5_ma20'] = ma5 / ma20 - 1
    df['ma10_ma50'] = ma10 / ma50 - 1

    delta = c.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    df['rsi_14'] = 100 - (100 / (1 + gain / loss.replace(0, np.nan)))
    gain7 = delta.where(delta > 0, 0).rolling(7).mean()
    loss7 = (-delta.where(delta < 0, 0)).rolling(7).mean()
    df['rsi_7'] = 100 - (100 / (1 + gain7 / loss7.replace(0, np.nan)))

    ema12 = c.ewm(span=12).mean()
    ema26 = c.ewm(span=26).mean()
    macd = ema12 - ema26
    df['macd_hist'] = macd - macd.ewm(span=9).mean()

    bb_std = c.rolling(20).std()
    bb_mid = c.rolling(20).mean()
    bb_u = bb_mid + 2 * bb_std
    bb_d = bb_mid - 2 * bb_std
    df['bb_width'] = (bb_u - bb_d) / bb_mid
    df['bb_position'] = (c - bb_d) / (bb_u - bb_d)

    tr = np.maximum(h - l, np.maximum(abs(h - c.shift()), abs(l - c.shift())))
    df['atr_pct'] = tr.rolling(14).mean() / c

    low14 = l.rolling(14).min()
    high14 = h.rolling(14).max()
    df['stoch_k'] = 100 * (c - low14) / (high14 - low14)
    df['stoch_d'] = df['stoch_k'].rolling(3).mean()

    df['vol_ratio'] = v / v.rolling(5).mean()
    df['volatility_10'] = df['ret_1d'].rolling(10).std()
    df['dayofweek'] = df.index.dayofweek
    df['dayofmonth'] = df.index.day

    return df


def get_ml_signal(df):
    """Train SVM(rbf) on 22 features, 10-fold CV. Returns (signal, buy_prob, avg_accuracy, confidence, feature_importance)"""
    df_feat = compute_features(df).dropna()
    if len(df_feat) < 60:
        return 'SKIP', 0.5, 0, 0, {}

    X = df_feat[FEATURES].values
    y = (df_feat['ret_1d'].shift(-1) > 0).values.astype(int)
    X = X[:-1]
    y = y[:-1]

    if len(np.unique(y)) < 2 or len(X) < 50:
        return 'SKIP', 0.5, 0, 0, {}

    n_folds = min(10, len(X) // 10)
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
    fold_accs = []

    for train_idx, test_idx in skf.split(X, y):
        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X[train_idx])
        X_test_s = scaler.transform(X[test_idx])
        model = SVC(kernel='rbf', probability=True, C=10, gamma='scale', random_state=42)
        model.fit(X_train_s, y[train_idx])
        fold_accs.append(model.score(X_test_s, y[test_idx]))

    avg_acc = np.mean(fold_accs)

    scaler = StandardScaler()
    X_all_s = scaler.fit_transform(X)
    final_model = SVC(kernel='rbf', probability=True, C=10, gamma='scale', random_state=42)
    final_model.fit(X_all_s, y)

    last_x = scaler.transform(X[-1:])
    probs = final_model.predict_proba(last_x)[0]
    buy_prob = probs[1] if len(probs) > 1 else 0.5
    conf = buy_prob * avg_acc * 100

    if buy_prob >= MIN_BUY_PROB:
        signal = 'BUY'
    elif buy_prob <= SELL_THRESHOLD:
        signal = 'SELL'
    else:
        signal = 'HOLD'

    return signal, buy_prob, avg_acc, conf, {}


def get_futu_data(ctx, code, n_bars=200):
    """Fetch K_DAY data from Futu"""
    try:
        ret, data = ctx.get_cur_kline(code, n_bars, KLType.K_DAY)
        if ret != RET_OK or data is None or len(data) < 60:
            return None
        df = data.rename(columns={
            'open': 'Open', 'close': 'Close', 'high': 'High',
            'low': 'Low', 'volume': 'Volume', 'pe_ratio': 'pe'
        })
        df['time_key'] = pd.to_datetime(df['time_key'])
        df = df.set_index('time_key')
        return df
    except:
        return None


def get_rt_data(ctx, code):
    """Fetch real-time quote"""
    try:
        ret_sub, _ = ctx.subscribe([code], [SubType.QUOTE])
        if ret_sub != 0:
            return None
        ret, data = ctx.get_stock_quote([code])
        if ret != RET_OK or data is None or len(data) == 0:
            return None
        row = data.iloc[0]
        return {
            'price': float(row.get('last_price', 0)),
            'open': float(row.get('open_price', 0)),
            'high': float(row.get('high_price', 0)),
            'low': float(row.get('low_price', 0)),
            'volume': float(row.get('volume', 0)),
            'turnover': float(row.get('turnover', 0)),
            'change_pct': float(row.get('change_val', 0)) / float(row.get('last_price', 1)) * 100 if float(row.get('last_price', 0)) > 0 else 0,
            'bid_price': float(row.get('bid_price', 0)),
            'ask_price': float(row.get('ask_price', 0)),
            'bid_size': float(row.get('bid_size', 0)),
            'ask_size': float(row.get('ask_size', 0)),
        }
    except:
        return None


def get_positions():
    """Get current positions from state file"""
    try:
        with open(STATE_PATH) as f:
            state = json.load(f)
        open_positions = [p for p in state.get('positions', []) if p.get('status') == 'open']
        closed_positions = [p for p in state.get('positions', []) if p.get('status') == 'closed']
        return {
            'positions': open_positions,
            'history': closed_positions[-20:],  # last 20 closed
            'total_pnl': state.get('total_pnl', 0),
            'last_scan': state.get('last_scan', 'N/A'),
            'count': len(open_positions),
            'max': MAX_POSITIONS,
        }
    except:
        return {'positions': [], 'history': [], 'total_pnl': 0, 'last_scan': 'N/A', 'count': 0, 'max': MAX_POSITIONS}


def get_market_status():
    """Determine if HK/US market is open"""
    now = datetime.now(HKT)
    wd = now.weekday()
    if wd >= 5:
        return 'CLOSED (weekend)', 'CLOSED (weekend)'
    h = now.hour
    # HK: 09:30-16:00
    hk_open = (h >= 9 and h < 16)
    # US: 21:30-04:00 (HKT) = 09:30-16:00 ET
    us_open = (h >= 21 or h < 4)
    hk_status = 'OPEN' if hk_open else 'CLOSED'
    us_status = 'OPEN' if us_open else 'CLOSED'
    return hk_status, us_status


# ═══════════════════════════════════════════
# APIs
# ═══════════════════════════════════════════
@app.get('/')
async def root():
    """Serve the desk box frontend"""
    index_path = os.path.join(STATIC_DIR, 'index.html')
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse({'status': 'Kenny Desk Box API running', 'version': '1.0'})


@app.get('/api/status')
async def api_status():
    """System status endpoint"""
    hk_status, us_status = get_market_status()
    positions = get_positions()
    ctx_ok = app.state.ctx_quote is not None
    return {
        'status': 'ok',
        'server_time': datetime.now(HKT).strftime('%Y-%m-%d %H:%M:%S HKT'),
        'futu_connected': ctx_ok,
        'hk_market': hk_status,
        'us_market': us_status,
        'positions': positions['count'],
        'max_positions': MAX_POSITIONS,
        'last_scan': positions['last_scan'],
        'total_pnl': positions['total_pnl'],
    }


@app.get('/api/stock/{code}')
async def api_stock(code: str):
    """
    Get full stock analysis for any ticker.
    Accepts HK.00700, US.NVDA, 00700, 700, NVDA, etc.
    """
    # Normalize code
    orig = code.upper()
    if not orig.startswith('HK.') and not orig.startswith('US.'):
        # Try aliases first
        if orig.lower() in SEARCH_ALIASES:
            orig = SEARCH_ALIASES[orig.lower()]
        elif orig.isdigit():
            orig = f'HK.{orig.zfill(5)}' if len(orig) <= 5 else f'HK.{orig}'
        else:
            orig = f'US.{orig}'

    if orig not in KNOWN_STOCKS:
        # Still try — Futu might know it
        pass

    try:
        ctx_quote, _, _ = get_ctx()
        # Subscribe
        ret_sub, _ = ctx_quote.subscribe([orig], [SubType.K_DAY, SubType.QUOTE])
        if ret_sub != 0:
            # Try one more time
            ret_sub, _ = ctx_quote.subscribe([orig], [SubType.K_DAY, SubType.QUOTE])

        # Get K-line data
        df = get_futu_data(ctx_quote, orig)
        if df is None:
            raise HTTPException(status_code=404, detail=f'No data for {orig}')

        # Get real-time quote
        rt = get_rt_data(ctx_quote, orig)

        # ML signal
        signal, buy_prob, acc, conf, feat_imp = get_ml_signal(df)

        # Technical indicators (latest values)
        df_feat = compute_features(df).dropna()
        latest = {}
        if len(df_feat) > 0:
            last_row = df_feat.iloc[-1]
            for feat in ['rsi_14', 'rsi_7', 'macd_hist', 'bb_position', 'bb_width',
                         'atr_pct', 'stoch_k', 'stoch_d', 'vol_ratio', 'volatility_10',
                         'close_ma5', 'close_ma10', 'close_ma20', 'close_ma50',
                         'ma5_ma20', 'ma10_ma50']:
                latest[feat] = round(float(last_row.get(feat, 0)), 4)

        # K-line data for charting (last 60 bars)
        chart_data = []
        for idx in df.tail(60).iterrows():
            chart_data.append({
                'date': str(idx[0].strftime('%Y-%m-%d')),
                'open': float(idx[1]['Open']),
                'high': float(idx[1]['High']),
                'low': float(idx[1]['Low']),
                'close': float(idx[1]['Close']),
                'volume': float(idx[1]['Volume']),
            })

        # Current price from kline if RT not available
        current_price = rt['price'] if rt else float(df['Close'].iloc[-1])

        # Price stats
        price_change_1d = (float(df['Close'].iloc[-1]) / float(df['Close'].iloc[-2]) - 1) * 100 if len(df) >= 2 else 0
        price_change_5d = (float(df['Close'].iloc[-1]) / float(df['Close'].iloc[-5]) - 1) * 100 if len(df) >= 5 else 0
        price_change_20d = (float(df['Close'].iloc[-1]) / float(df['Close'].iloc[-20]) - 1) * 100 if len(df) >= 20 else 0

        # Moving averages
        ma5 = float(df['Close'].tail(5).mean())
        ma20 = float(df['Close'].tail(20).mean())
        ma50 = float(df['Close'].tail(50).mean()) if len(df) >= 50 else None

        # Check if held
        positions = get_positions()
        held_position = None
        for p in positions['positions']:
            if p['code'] == orig:
                held_position = p
                break

        # SL info
        sl_pct = STOP_LOSS_OVERRIDES.get(orig, 0.05)
        sl_price = round(current_price * (1 - sl_pct), 2)

        name = STOCK_NAMES.get(orig, orig)

        return {
            'code': orig,
            'name': name,
            'market': 'HK' if orig.startswith('HK') else 'US',
            'price': round(current_price, 2),
            'change_1d_pct': round(price_change_1d, 2),
            'change_5d_pct': round(price_change_5d, 2),
            'change_20d_pct': round(price_change_20d, 2),
            'high_52w': round(float(df['High'].max()), 2),
            'low_52w': round(float(df['Low'].min()), 2),
            'volume': rt['volume'] if rt else float(df['Volume'].iloc[-1]),
            'signal': signal,
            'buy_prob': round(buy_prob, 4),
            'accuracy': round(acc, 4),
            'confidence': round(conf, 2),
            'rsi_14': latest.get('rsi_14', 50),
            'rsi_7': latest.get('rsi_7', 50),
            'macd_hist': latest.get('macd_hist', 0),
            'bb_position': latest.get('bb_position', 0.5),
            'atr_pct': latest.get('atr_pct', 0),
            'stoch_k': latest.get('stoch_k', 50),
            'stoch_d': latest.get('stoch_d', 50),
            'vol_ratio': latest.get('vol_ratio', 1),
            'ma5': round(ma5, 2),
            'ma20': round(ma20, 2),
            'ma50': round(ma50, 2) if ma50 else None,
            'stop_loss': sl_price,
            'stop_loss_pct': sl_pct * 100,
            'held': held_position is not None,
            'position': held_position,
            'chart': chart_data,
            'latest_technicals': latest,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Error scanning {orig}: {str(e)}')


@app.get('/api/positions')
async def api_positions():
    """Get current positions and history"""
    return get_positions()


@app.get('/api/search')
async def api_search(q: str = Query('', description='Search term')):
    """Search stocks by code or name"""
    q = q.lower().strip()
    if not q:
        results = []
        for code, name in list(STOCK_NAMES.items())[:20]:
            results.append({'code': code, 'name': name, 'market': 'HK' if code.startswith('HK') else 'US'})
        return {'results': results}

    results = []
    for code, name in STOCK_NAMES.items():
        if q in code.lower() or q in name.lower() or q in str(code).replace('HK.', '').replace('US.', ''):
            results.append({
                'code': code,
                'name': name,
                'market': 'HK' if code.startswith('HK') else 'US',
            })
    return {'results': results[:20]}


@app.get('/api/scan')
async def api_scan():
    """
    Run a full ML scan on all known stocks.
    Returns all BUY/HOLD/SELL signals sorted by confidence.
    """
    try:
        ctx_quote, _, _ = get_ctx()
    except HTTPException:
        return {'error': 'Futu not connected', 'signals': []}

    results = []
    batch_size = 20
    all_codes = KNOWN_STOCKS

    for i in range(0, len(all_codes), batch_size):
        batch = all_codes[i:i+batch_size]
        ret, _ = ctx_quote.subscribe(batch, [SubType.K_DAY])
        if ret != 0:
            # One-by-one fallback
            for code in batch:
                r, _ = ctx_quote.subscribe([code], [SubType.K_DAY])
                if r != 0:
                    continue
                df = get_futu_data(ctx_quote, code)
                if df is None:
                    continue
                signal, bp, acc, conf, _ = get_ml_signal(df)
                price = float(df['Close'].iloc[-1])
                df_feat = compute_features(df).dropna()
                rsi = float(df_feat['rsi_14'].iloc[-1]) if len(df_feat) > 0 else 50
                results.append({
                    'code': code, 'name': STOCK_NAMES.get(code, code),
                    'signal': signal, 'buy_prob': round(bp, 3),
                    'accuracy': round(acc, 3), 'confidence': round(conf, 1),
                    'price': round(price, 2), 'rsi': round(rsi, 1),
                    'market': 'HK' if code.startswith('HK') else 'US',
                })
        else:
            for code in batch:
                df = get_futu_data(ctx_quote, code)
                if df is None:
                    continue
                signal, bp, acc, conf, _ = get_ml_signal(df)
                price = float(df['Close'].iloc[-1])
                df_feat = compute_features(df).dropna()
                rsi = float(df_feat['rsi_14'].iloc[-1]) if len(df_feat) > 0 else 50
                results.append({
                    'code': code, 'name': STOCK_NAMES.get(code, code),
                    'signal': signal, 'buy_prob': round(bp, 3),
                    'accuracy': round(acc, 3), 'confidence': round(conf, 1),
                    'price': round(price, 2), 'rsi': round(rsi, 1),
                    'market': 'HK' if code.startswith('HK') else 'US',
                })

    # Sort by confidence descending
    results.sort(key=lambda x: x['confidence'], reverse=True)
    buys = [r for r in results if r['signal'] == 'BUY']
    holds = [r for r in results if r['signal'] == 'HOLD']
    sells = [r for r in results if r['signal'] == 'SELL']
    others = [r for r in results if r['signal'] not in ('BUY', 'HOLD', 'SELL')]

    return {
        'scan_time': datetime.now(HKT).strftime('%Y-%m-%d %H:%M HKT'),
        'total': len(results),
        'buys': buys,
        'holds': holds,
        'sells': sells,
        'others': others,
    }


@app.get('/api/backtest/{code}')
async def api_backtest(code: str):
    """Get backtest results for a stock (from cached files)"""
    orig = code.upper()
    if not orig.startswith('HK.') and not orig.startswith('US.'):
        if orig.isdigit():
            orig = f'HK.{orig.zfill(5)}'
        else:
            orig = f'US.{orig}'

    # Try to find backtest results
    ticker = orig.replace('HK.', '').replace('US.', '')
    results_path = os.path.join(SCRIPT_DIR, '..', 'cache', 'backtest', 'futu_ml_results.json')

    bt_data = None
    if os.path.isfile(results_path):
        try:
            with open(results_path) as f:
                all_results = json.load(f)
            for item in all_results if isinstance(all_results, list) else all_results.get('results', []):
                if isinstance(item, dict):
                    item_code = item.get('code', item.get('ticker', '')).replace('HK.', '').replace('US.', '')
                    if item_code == ticker:
                        bt_data = item
                        break
        except:
            pass

    # Also check batch_5yr results
    batch_path = os.path.join(SCRIPT_DIR, '..', 'cache', 'backtest', 'results_5yr.json')
    if bt_data is None and os.path.isfile(batch_path):
        try:
            with open(batch_path) as f:
                batch_results = json.load(f)
            for item in batch_results if isinstance(batch_results, list) else batch_results.get('results', []):
                if isinstance(item, dict):
                    item_code = item.get('code', item.get('ticker', '')).replace('HK.', '').replace('US.', '')
                    if item_code == ticker:
                        bt_data = item
                        break
        except:
            pass

    backtest_img = None
    img_path = os.path.join(SCRIPT_DIR, '..', 'cache', 'backtest', f'{ticker}_backtest.png')
    if os.path.isfile(img_path):
        backtest_img = f'/static/backtest/{ticker}_backtest.png'

    # Equity curve chart with buy/sell markers
    equity_chart_path = get_equity_chart_path(orig)
    equity_chart_url = f'/api/backtest/{orig}/equity-chart' if equity_chart_path else None

    return {
        'code': orig,
        'ticker': ticker,
        'name': STOCK_NAMES.get(orig, orig),
        'backtest': bt_data,
        'backtest_image': backtest_img,
        'equity_chart_url': equity_chart_url,
    }


@app.get('/api/backtest/{code}/equity-chart')
async def api_backtest_equity_chart(code: str):
    """Return the equity curve chart PNG (with buy/sell entry/exit markers)
    generated by futu_ml_backtest.py. Returns 404 if not found.
    """
    chart_path = get_equity_chart_path(code)
    if chart_path and os.path.isfile(chart_path):
        return FileResponse(chart_path, media_type='image/png')
    raise HTTPException(status_code=404, detail='Equity chart not found')


# ═══════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════
if __name__ == '__main__':
    port = int(os.environ.get('DESK_BOX_PORT', 8000))
    print(f"🏦 Kenny's Desk Box starting on http://0.0.0.0:{port}")
    print(f"   Static files: {STATIC_DIR}")
    print(f"   Futu OpenD: {OPEND_HOST}:{OPEND_PORT}")
    print()
    uvicorn.run(app, host='0.0.0.0', port=port, log_level='info')