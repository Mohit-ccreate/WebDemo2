# CommodityIQ — Market Intelligence Platform

Full-stack web application for **commodity and equity market intelligence**: live prices (INR), **today’s commodity forecasts** (dashboard), LSTM multi-day forecasts, stock technical analysis, **fusion model** (sentiment + price) with stored forward validation, FinBERT sentiment, ML pipelines, backtesting, alerts, and portfolio tools.

**Team:** 5-member student project  
**Stack:** React (Vite) + FastAPI + TensorFlow + scikit-learn + FinBERT (Hugging Face)

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Project structure](#project-structure)
3. [Machine learning models](#machine-learning-models)
4. [Features (frontend modules)](#features-frontend-modules)
5. [External APIs and data sources](#external-apis-and-data-sources)
6. [REST API reference](#rest-api-reference)
7. [Key formulas and indicators](#key-formulas-and-indicators)
8. [How to run](#how-to-run)
   - [After cloning from GitHub](#after-cloning-from-github)
9. [Environment variables](#environment-variables)
10. [Team contribution (5 equal parts)](#team-contribution-5-equal-parts)

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite) — localhost:5173                        │
│  Dashboard, Predictions, Stocks & TA, Sentiment, Backtest, …    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP /api/*  +  WebSocket /ws/prices
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI backend — localhost:8000                               │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │ Routes      │ │ Services     │ │ ML (app/ml/)             │  │
│  │ prices      │ │ data_fetcher │ │ features, preprocess     │  │
│  │ predictions │ │ predictor    │ │ stock_predictor (HGBR)   │  │
│  │ stocks      │ │ stock_data   │ │ fusion_model (Ridge)     │  │
│  │ sentiment   │ │ prediction_  │ │ commodity_today (spot)   │  │
│  │ alerts      │ │ store, tech_*│ │ sentiment_model, backtest│  │
│  │             │ │ unit_convert │ │                          │  │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  Yahoo Finance      gold-api.com /        ProsusAI/finbert
  (yfinance)         metals.live / FX APIs   (transformers)
```

**Data flow (Stocks & TA → ML pipeline):**

1. Fetch OHLCV via `yfinance` → `preprocess_ohlcv` (sort, ffill gaps, valid close).
2. `build_feature_matrix` → RSI, MACD, Bollinger, SMA, log returns; **latest bar kept for inference** (target NaN on last row is OK).
3. **Price model:** `HistGradientBoostingRegressor` predicts `target_next_logret` from the **latest** feature row; implied next close = `close × exp(pred)`.
4. **Fusion model:** `Ridge` on technicals + daily sentiment (news via fast keyword scorer in pipeline; no `bfill` on sentiment).
5. **Fusion persistence:** Each successful pipeline run saves the forecast to `backend/data/fusion_predictions.db` and resolves prior rows when the next session’s close is available.
6. **Sentiment tab:** `POST /api/sentiment/analyze` with FinBERT; keyword fallback if model unavailable.

**Data flow (Dashboard → today’s commodity forecast):**

1. `refresh_all_prices()` → live `display_price` in Indian units (₹/10g gold, ₹/kg silver, etc.) with **India retail markup** where applicable.
2. `GET /api/predictions/today?refresh=true` → per ticker: align last OHLCV bar to live price, apply **near-spot** forecast (live + capped 5-day momentum, ±1.8% max daily move).
3. Dashboard **Today forecast** column and Predictions page **Today’s predicted close** banner show the same API output.

---

## Project structure

```
commodity-predictor-atharva/
├── README.md                 ← This file
├── QUESTION_BANK.md          ← Viva / exam-style Q&A
├── run.bat                   ← Start backend + frontend (Windows)
├── backend/
│   ├── app/
│   │   ├── main.py           ← FastAPI app, WebSocket, scheduler
│   │   ├── routes/           ← API endpoints
│   │   ├── services/         ← Data fetch, LSTM, indicators, prediction_store
│   │   └── ml/               ← Stock ML, fusion, commodity_today, backtest
│   ├── data/                 ← fusion_predictions.db (local, gitignored)
│   ├── requirements.txt
│   ├── requirements-ml.txt   ← transformers, torch (FinBERT)
│   ├── .cache/huggingface/   ← FinBERT weights (persist after first download)
│   └── .venv/                ← Python virtual environment
├── frontend/
│   ├── src/
│   │   ├── App.jsx           ← Routing + navigation
│   │   ├── api/client.js     ← Axios API client
│   │   └── components/       ← Pages incl. FusionModelPanel.jsx
│   └── package.json
└── _project_archive/         ← Old dev/fix scripts (not needed to run)
```

---

## Machine learning models

| Model | Library | Used for | Input | Output |
|-------|---------|----------|-------|--------|
| **2D LSTM** | TensorFlow/Keras | Multi-day commodity forecast (Predictions tab) | 60-day window × 7 features (OHLCV, return, USD/INR) | Next N days Close (display units); optional if trained |
| **Near-spot + momentum** | pandas + rules | **Today’s commodity forecast** (Dashboard, `/predictions/today`) | Live `display_price` + last 5 daily returns | Today’s close est. within ±1.8% of live |
| **HistGradientBoostingRegressor** | scikit-learn | Stock / commodity technical next-day return | Technical + return features (~17 cols) | `target_next_logret` → implied next close |
| **Ridge regression** | scikit-learn | Sentiment + price fusion (Stocks) | Features + daily sentiment (ffill + 0, no bfill) | Next log return / close from **latest** bar |
| **FinBERT** | Hugging Face `ProsusAI/finbert` | Financial sentiment (Sentiment tab) | Text (headline / custom) | positive / negative / neutral + score |
| **Keyword fallback** | Regex rules | Fusion pipeline news headlines / no GPU | Text | Label + score ∈ [-1, 1] |

### LSTM (commodities — multi-day)

- **File:** `backend/app/services/predictor.py`
- **Architecture:** `Input(60,7) → LSTM(128) → Dropout → LSTM(64) → Dropout → Dense(32) → Dense(1)`
- **Training:** Per-ticker; models saved under `backend/app/models/trained/`
- **Scaler:** `MinMaxScaler` on 7 features per timestep
- **Live anchoring:** Forecast levels scaled to dashboard `display_price`; first forecast date aligned to **today** when the last history bar is before today
- **Today slice:** Response includes `today_prediction` (first forecast day)

### Today’s commodity forecast (Dashboard)

- **Files:** `backend/app/ml/commodity_today.py`, `backend/app/services/commodity_today_service.py`
- **No training required** — runs on every `GET /api/predictions/today` (cached ~10 min; use `?refresh=true` to bypass)
- **Baseline:** Live `display_price` from `data_fetcher` (same as price table)
- **Formula:** `forecast = live × (1 + capped_mean_5d_return)` with daily move capped at ±1.8%; light blend (20%) with technical ML when available
- **Why:** Raw ML on stale Yahoo history produced ~₹1.33L gold when live/MCX is ~₹1.58–1.60L/10g; near-spot keeps dashboard forecasts aligned with Indian display units

### Stock ML pipeline & fusion

- **Files:** `backend/app/ml/features.py`, `stock_predictor.py`, `fusion_model.py`, `preprocess.py`
- **Target:** \( y_t = \ln(C_{t+1}/C_t) \) (`target_next_logret`)
- **Inference:** Latest OHLCV bar is **not** dropped for missing target; `preprocess_features(..., require_target=False)` for the last row
- **Next close estimate:** \( \hat{C}_{t+1} = C_{live} \cdot e^{\hat{y}} \) when live price is available
- **Fusion storage:** `backend/app/services/prediction_store.py` → SQLite `backend/data/fusion_predictions.db`
- **Forward validation:** On each pipeline/fusion run, unresolved rows get `actual_close` from the next trading session in OHLCV; API returns MAE / MAPE on resolved rows
- **Metrics:** RMSE, R² on held-out time-ordered test split (log return; no shuffle)

### FinBERT sentiment

- **File:** `backend/app/ml/sentiment_model.py`
- **Model card:** [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert)
- **Requires:** `pip install -r requirements-ml.txt` and backend started with `backend\.venv\Scripts\python.exe`
- **Disk cache:** Weights stored under `backend/.cache/huggingface/` (first run downloads ~400 MB; later runs reuse cache)
- **Startup:** API preloads FinBERT in the background on boot (`main.py` lifespan) so the Sentiment tab is ready sooner
- **Health:** `GET /api/sentiment/health` returns `loading: true` while the model warms up; the UI polls until `finbert.available` is true

---

## Features (frontend modules)

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Dashboard | Live commodity prices (INR), **Today forecast** column, WebSocket, **Refresh forecasts** |
| `/portfolio` | PortfolioPage | Holdings tracking |
| `/heatmap` | HeatmapPage | Category performance heatmap |
| `/mcx` | MCXPage | MCX India–focused view |
| `/predict` | PredictPage | **Today’s predicted close** + LSTM train/predict (1–30 days) |
| `/target` | PriceTargetPage | Price target analysis |
| `/compare` | ComparePage | Multi-asset comparison |
| `/seasonal` | SeasonalPage | Seasonal patterns |
| `/correlation` | CorrelationPage | Cross-commodity correlation |
| `/scraper` | ScraperPage | Web scraper utilities |
| `/export` | ExportPage | CSV/Excel export |
| `/news` | NewsPage | Market news |
| `/stocks` | StocksIndicatorsPage | Stock OHLCV, indicators, **Fusion model panel**, full **ML pipeline**, forecast vs actual table |
| `/sentiment` | SentimentQuantPage | FinBERT custom text + ticker news |
| `/backtest` | BacktestQuantPage | RSI mean-reversion / buy & hold |
| `/calendar` | MarketCalendarPage | MCX calendar |
| `/alerts` | AlertsPage | Price alerts and notifications |

---

## External APIs and data sources

| Source | Purpose | Auth |
|--------|---------|------|
| **Yahoo Finance** (`yfinance`) | Commodity & stock OHLCV, quotes | None |
| **gold-api.com** | Spot metals (USD) | None |
| **metals.live** | Metals fallback | None |
| **open.er-api.com** | USD/INR | None |
| **frankfurter.app** | FX fallback | None |
| **omkar.cloud** (optional) | Commodity quotes | `OMKAR_API_KEY` env |
| **Hugging Face Hub** | Download FinBERT weights | Optional `HF_TOKEN` |

No hardcoded commodity prices: if all sources fail, ticker shows as unavailable.

**Price quality (commodities):**

- Metals use **USD sanity bands** (e.g. gold ~$2800–5200/oz) to reject bad ticks
- **India retail markup** (~4.5% on gold/platinum display) aligns ₹/10g with portal-style quotes
- **India retail overlay** via `scraper.py` for gold/silver/platinum display units after live fetch

---

## REST API reference

Base URL: `http://localhost:8000`

| Prefix | Endpoints (summary) |
|--------|---------------------|
| `/api/prices` | `GET /` all prices, `GET /{ticker}`, `GET /{ticker}/history` |
| `/api/predictions` | `GET /today` all commodities today forecast; `GET /{ticker}/today`; `GET /{ticker}?days=`; `POST /{ticker}/train`; `GET /{ticker}/ready`; `GET /models/status` |
| `/api/stocks` | `GET /{symbol}/quote`, `/ohlcv`, `/indicators`, `/news`, **`/fusion`**, **`/predictions/history`**, `/pipeline`, `POST /{symbol}/backtest` |
| `/api/sentiment` | `POST /analyze`, `GET /health` |
| `/api/alerts` | CRUD alerts, notifications |
| `/api/export` | CSV/Excel export |
| `/api/scraper` | Scraper routes (gold, silver, mcx) |
| `/ws/prices` | WebSocket live price broadcast |
| `/health` | API health + cache stats |

Interactive docs: **http://localhost:8000/docs**

### Sentiment API example

```http
POST /api/sentiment/analyze
Content-Type: application/json

{"texts": ["Apple beats earnings expectations"]}
```

Query `?fast=true` forces keyword-only mode (used for bulk headlines).

### Today’s commodity forecasts

```http
GET /api/predictions/today?refresh=true
```

Returns `predictions[]` per ticker: `predicted_price_display`, `last_price_display`, `change_pct`, `display_unit`, `forecast_version`. Refreshes live prices first; cache TTL ~10 minutes.

```http
GET /api/predictions/GC=F/today
```

Single-commodity today forecast (same near-spot logic).

### Fusion model (stocks)

```http
GET /api/stocks/AAPL/fusion
```

Runs Ridge fusion only (faster than full pipeline); persists forecast and returns `prediction_history`.

```http
GET /api/stocks/AAPL/predictions/history?limit=30
```

Stored fusion forecasts vs realized next-session closes (`actual_close`, `error_pct`, forward MAE/MAPE).

```http
GET /api/stocks/AAPL/pipeline
```

Full pipeline: price HGBR + sentiment headlines + fusion + `prediction_history`.

---

## Key formulas and indicators

### Log return (ML target)

\[
r_t = \ln\left(\frac{C_t}{C_{t-1}}\right)
\]

### RSI (14-period, Wilder-style EMA)

\[
RS = \frac{\text{EMA}(\text{gains})}{\text{EMA}(\text{losses})}, \quad RSI = 100 - \frac{100}{1 + RS}
\]

### MACD

\[
MACD = EMA_{12}(C) - EMA_{26}(C), \quad Signal = EMA_9(MACD)
\]

### Bollinger Bands (20, 2σ)

\[
BB_{mid} = SMA_{20}(C), \quad BB_{upper/lower} = BB_{mid} \pm 2\sigma
\]

### Backtest metrics

- **Total return %:** \((E_{final}/E_{start} - 1) \times 100\)
- **Max drawdown %:** minimum of \((E - peak) / peak\)
- **Sharpe (approx):** \(\sqrt{252} \cdot \bar{r} / \sigma_r\)
- **Sortino (approx):** uses downside deviation of negative daily returns only

### INR conversion

\[
Price_{INR} = Price_{USD} \times USD\_INR
\]

(Unit adjustments per commodity in `unit_converter.py` — gold/silver/platinum include duty and optional **India retail markup**.)

### Today’s dashboard forecast (near-spot)

\[
\hat{P}_{today} = P_{live} \times \left(1 + \mathrm{clip}(\bar{r}_{5d}, -1.8\%, +1.8\%)\right)
\]

where \(P_{live}\) is `display_price` from the live price table and \(\bar{r}_{5d}\) is the mean of recent daily close returns.

### Fusion forward error (when resolved)

\[
\mathrm{error\_\%} = \frac{|\hat{P} - P_{actual}|}{P_{actual}} \times 100
\]

---

## How to run

### Prerequisites

- **Python 3.11+** (3.13 tested)
- **Node.js 18+** and npm
- Windows: use paths below; Linux/Mac: use `backend/.venv/bin/python`

### After cloning from GitHub

The repo ships **source code and config only**. Large or machine-specific files are in [`.gitignore`](.gitignore) and are recreated on your PC.

**Install once (required for everyone):**

```powershell
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

cd backend
python -m venv .venv
.\.venv\Scripts\activate          # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ml.txt
cd ..

cd frontend
npm install
cd ..

# From project root — starts backend + frontend
.\run.bat                         # Mac/Linux: see terminals in §3 below
```

Copy [`.env.example`](.env.example) to `.env` only if you use optional API keys (`OMKAR_API_KEY`, `HF_TOKEN`).

#### Do you need to train models?

| Area | Train manually? | What happens on first use |
|------|-----------------|---------------------------|
| **Dashboard, prices, Portfolio, Seasonal, Compare, Heatmap, Correlation** | No | Works after install + `run.bat` |
| **Dashboard → Today forecast** | No | Auto-loads via `GET /api/predictions/today` (~1–2 min first time; click **Refresh forecasts**) |
| **Alerts, Export, News, Scraper, MCX, Calendar** | No | Works after install + `run.bat` |
| **Stocks & TA → Fusion panel / ML pipeline** | No | **Fusion:** Run fusion or full pipeline; forecasts stored in `backend/data/fusion_predictions.db` (local) |
| **Backtest** | No | Uses historical data + rules (no saved model file) |
| **FinBERT (Sentiment)** | No | **Downloads** pretrained weights (~400 MB) to `backend/.cache/huggingface` on first run — not training |
| **Predictions (LSTM multi-day)** | **Yes, once per commodity** (optional) | Models in `backend/app/models/trained/` (not in git). **Today’s forecast does not need LSTM.** |

**Bottom line:** The app runs immediately for almost every tab. **Today’s commodity forecasts** and **stock fusion** work without training. Only **multi-day LSTM** on the Predictions tab needs a one-time train per ticker. FinBERT only needs a one-time **download**, then it loads from cache.

**Not in the repo (normal):**

- `backend/.venv/`, `frontend/node_modules/` — create with pip/npm above  
- `backend/.cache/huggingface/` — FinBERT cache after first Sentiment use  
- `backend/app/models/trained/*.keras` — LSTM files after you train  
- `backend/data/fusion_predictions.db` — fusion forecast history (created on first Stocks pipeline/fusion run)  

### 1. Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-ml.txt
```

### 2. Frontend setup

```powershell
cd frontend
npm install
```

### 3. Start (recommended)

Double-click **`run.bat`** at project root, or:

**Terminal 1 — API:**

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — UI:**

```powershell
cd frontend
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Swagger docs | http://localhost:8000/docs |

> **Important:** Use the **venv** Python for the backend so FinBERT works. System `python` without `transformers`/`torch` will show `keyword_fallback` on the Sentiment tab.

### 4. First-time LSTM (only if you use Predictions)

See [After cloning from GitHub](#after-cloning-from-github) — other tabs do not need this step.

Open **Predictions**, pick a commodity, click **Train Model** once (~2–5 min per ticker). Later predictions load the saved model from `backend/app/models/trained/`.

**Today’s forecast (no train):** Open **Dashboard** — the **Today forecast** column fills automatically. Use **Refresh forecasts** if values look stale. Gold should be near live ₹/10g (e.g. ~₹1.58–1.60L), not ~₹1.33L from old uncached ML.

**Fusion (stocks):** Open **Stocks & TA** → enter a symbol (e.g. `AAPL`) → **Run fusion** or **ML pipeline**. View **Fusion forecast vs actual** after you have run on multiple days.

### 5. FinBERT (Sentiment tab)

FinBERT only works when the backend runs with the **project venv** (includes `torch` + `transformers`). `run.bat` does this automatically and sets the Hugging Face cache to `backend\.cache\huggingface`.

| Step | Action |
|------|--------|
| **Install ML deps (once)** | `pip install -r requirements-ml.txt` inside `backend\.venv` |
| **Start app** | Use **`run.bat`** or `backend\.venv\Scripts\python.exe -m uvicorn …` (not system `python`) |
| **First launch** | Open **Sentiment** — status shows *“Loading FinBERT…”* for ~15–60 s while weights download |
| **Later launches** | Same tab should show *“FinBERT ready (ProsusAI/finbert)”* after preload (~15–30 s from disk cache) |
| **Verify** | Visit http://localhost:8000/api/sentiment/health — expect `"finbert": { "available": true, "cached_on_disk": true }` |

**If you see “FinBERT offline — keyword fallback only”:**

1. Confirm backend was started with `backend\.venv\Scripts\python.exe` (see `run.bat`).
2. Run `pip install -r requirements-ml.txt` in that venv.
3. Wait for preload to finish (check backend console for `[FinBERT] Ready`).
4. Ensure `DISABLE_FINBERT` is not set in your environment.

**Optional:** Set `HF_TOKEN` for faster Hugging Face downloads. Weights stay in `backend/.cache/huggingface` across restarts — you do **not** re-download every time.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `OMKAR_API_KEY` | Optional omkar.cloud commodity API key |
| `HF_TOKEN` | Optional Hugging Face token (higher rate limits for FinBERT download) |
| `HF_HOME` / `TRANSFORMERS_CACHE` / `HF_HUB_CACHE` | Set automatically by `run.bat` to `backend/.cache/huggingface` |
| `DISABLE_FINBERT` | Set `1` / `true` to force keyword sentiment only |

---

## Team contribution (5 equal parts)

Each member owns ~**20%** of the project. Everyone has **both backend and frontend** responsibilities (~5–6 files per layer). 

| Member | Role (~20%) | Backend | Frontend |
|--------|-------------|---------|----------|
| **Member 1** | **ML & analytics** | LSTM, stock ML, FinBERT, **`backtest.py`** | Dashboard, **Portfolio**, **Seasonal**, Predict, Sentiment, **Compare**, **Backtest** |
| **Member 2** | **Platform & prices** | `main.py`, `data_fetcher`, prices/predictions routes, WebSocket | App shell, `client.js`, WebSocket hook, `PriceChart` |
| **Member 3** | **Alerts & export** | `alerts`, `alert_engine`, `export` | Alerts, Export, News, theme/CSS |
| **Member 4** | **Stocks & indicators** | `stocks`, indicators, `stock_data` | Stocks & TA, Price Target, Heatmap |
| **Member 5** | **Scraper & market ops** | `scraper`, price **history** API usage | Correlation, Scraper, MCX, Calendar |

---

### Member 1 — ML & analytics (~20%)

**Most important slice:** all custom ML + FinBERT + Member 1’s analytics pages (including **Portfolio** and **Seasonal**).

| Feature | Backend | Frontend |
|---------|---------|----------|
| **Commodity LSTM** | `services/predictor.py` | `PredictPage.jsx` |
| **Today’s commodity forecast** | `ml/commodity_today.py`, `services/commodity_today_service.py` | `Dashboard.jsx`, `PredictPage.jsx` |
| **LSTM / today routes** | *(wired by Member 2)* `routes/predictions.py` | — |
| **Stock ML + fusion** | `ml/preprocess.py`, `features.py`, `stock_predictor.py`, `fusion_model.py`, `prediction_store.py` | `FusionModelPanel.jsx`, `StocksIndicatorsPage.jsx` |
| **FinBERT** | `ml/sentiment_model.py`, `routes/sentiment.py` | `SentimentQuantPage.jsx` |
| **Dashboard** | uses Member 2 prices + WebSocket | `Dashboard.jsx` |
| **Portfolio** | export via Member 3 `export.py` | `PortfolioPage.jsx` |
| **Seasonal** | uses `/api/prices/.../history` | `SeasonalPage.jsx` |
| **Compare** *(from Member 5)* | uses `/api/prices/.../history` | `ComparePage.jsx` |
| **Backtest** *(from Member 4)* | `ml/backtest.py` + backtest POST in `stocks.py` | `BacktestQuantPage.jsx` |

**Files to study**

| Layer | Path |
|-------|------|
| Backend | `backend/app/services/predictor.py` |
| Backend | `backend/app/ml/commodity_today.py`, `services/commodity_today_service.py` |
| Backend | `backend/app/ml/preprocess.py`, `features.py`, `stock_predictor.py`, `fusion_model.py`, `services/prediction_store.py` |
| Backend | `backend/app/ml/sentiment_model.py`, `routes/sentiment.py` |
| Backend | `backend/app/ml/backtest.py` |
| Frontend | `frontend/src/components/PredictPage.jsx`, `FusionModelPanel.jsx`, `SentimentQuantPage.jsx` |
| Frontend | `frontend/src/components/Dashboard.jsx`, `PortfolioPage.jsx`, `SeasonalPage.jsx` |
| Frontend | `frontend/src/components/ComparePage.jsx`, `BacktestQuantPage.jsx` |

**Also skim:** `backend/app/main.py` (`preload_finbert`), `routes/predictions.py`, `routes/stocks.py` (backtest POST), README §5 (FinBERT).

**FinBERT notes:** weights cached in `backend/.cache/huggingface`; `preload_finbert()` on API startup; Sentiment tab uses full FinBERT, stocks news uses `?fast=true` keyword mode in fusion.

**Viva focus:** log returns vs prices; LSTM vs near-spot today forecast; fusion storage vs holdout RMSE; FinBERT cache/preload; latest-bar inference; backtest Sharpe/drawdown.

---

### Member 2 — Platform & live prices (~20%)

| Feature | Backend | Frontend |
|---------|---------|----------|
| **FastAPI core** | `main.py`, `core/config.py` | — |
| **Live prices** | `data_fetcher.py`, `routes/prices.py`, `unit_converter.py`, `price_display.py` | — |
| **Predictions API** | `routes/predictions.py` → LSTM + today forecasts | — |
| **WebSocket** | `core/websocket_manager.py`, `/ws/prices` | `hooks/useWebSocket.js` |
| **App platform** | CORS, scheduler, `/health` | `App.jsx`, `main.jsx`, `api/client.js`, `PriceChart.jsx` |

**Files to study**

| Layer | Path |
|-------|------|
| Backend | `backend/app/main.py`, `core/config.py`, `core/websocket_manager.py` |
| Backend | `backend/app/services/data_fetcher.py`, `unit_converter.py`, `price_display.py` |
| Backend | `backend/app/routes/prices.py`, `routes/predictions.py` |
| Frontend | `frontend/src/App.jsx`, `main.jsx`, `api/client.js`, `hooks/useWebSocket.js` |
| Frontend | `frontend/src/components/PriceChart.jsx` |
| Config | `run.bat`, `frontend/vite.config.js` |

**Also skim:** `backend/app/services/predictor.py` (LSTM service interface only).

---

### Member 3 — Alerts, export & news (~20%)

| Feature | Backend | Frontend |
|---------|---------|----------|
| **Alerts** | `routes/alerts.py`, `services/alert_engine.py` | `AlertsPage.jsx`, `AlertPanel.jsx` |
| **Export** | `routes/export.py` (prices + portfolio CSV/Excel) | `ExportPage.jsx` |
| **News** | — (RSS via external API) | `NewsPage.jsx` |
| **Theme / layout** | — | `ThemeContext.jsx`, `index.css` |

**Files to study**

| Layer | Path |
|-------|------|
| Backend | `backend/app/routes/alerts.py`, `services/alert_engine.py` |
| Backend | `backend/app/routes/export.py` |
| Frontend | `frontend/src/components/AlertsPage.jsx`, `AlertPanel.jsx`, `ExportPage.jsx`, `NewsPage.jsx` |
| Frontend | `frontend/src/context/ThemeContext.jsx`, `index.css` |
| Config | `frontend/package.json` |

**Also skim:** `backend/app/services/data_fetcher.py` (prices for export), `PortfolioPage.jsx` (export payload shape).

---

### Member 4 — Stocks & indicators (~20%)

| Feature | Backend | Frontend |
|---------|---------|----------|
| **Stock data** | `services/stock_data.py` | — |
| **Indicators** | `services/technical_indicators.py` | overlays on Stocks page |
| **Stocks API** | `routes/stocks.py` (OHLCV, news, `/fusion`, `/predictions/history`, pipeline; backtest POST used by Member 1) | `StocksIndicatorsPage.jsx`, `FusionModelPanel.jsx` |
| **Price target** | uses stock quote/history APIs | `PriceTargetPage.jsx` |
| **Heatmap** *(from Member 5)* | uses `/api/prices` | `HeatmapPage.jsx` |

**Files to study**

| Layer | Path |
|-------|------|
| Backend | `backend/app/routes/stocks.py`, `services/stock_data.py`, `services/technical_indicators.py` |
| Frontend | `frontend/src/components/StocksIndicatorsPage.jsx`, `PriceTargetPage.jsx`, `HeatmapPage.jsx` |

**Also skim:** Member 1's `ml/features.py`, `stock_predictor.py`, `fusion_model.py`, `ml/backtest.py` (backtest engine owner).

---

### Member 5 — Scraper & market ops (~20%)

| Feature | Backend | Frontend |
|---------|---------|----------|
| **Scraper** | `services/scraper.py`, `routes/scraper.py` | `ScraperPage.jsx` |
| **Correlation** | `routes/prices.py` (`/history` + client-side Pearson) | `CorrelationPage.jsx` |
| **India / ops** | — | `MCXPage.jsx`, `MarketCalendarPage.jsx` |
| **QA** | — | `README.md`, `QUESTION_BANK.md`, `run.bat` smoke tests |

**Files to study**

| Layer | Path |
|-------|------|
| Backend | `backend/app/services/scraper.py`, `routes/scraper.py` |
| Backend | `backend/app/routes/prices.py` (history endpoints for correlation charts) |
| Frontend | `frontend/src/components/CorrelationPage.jsx` |
| Frontend | `frontend/src/components/ScraperPage.jsx`, `MCXPage.jsx`, `MarketCalendarPage.jsx` |

**Also skim:** `backend/app/services/data_fetcher.py`, Member 1’s `ComparePage.jsx` (compare pattern reference), full regression test across tabs.

---

## License & disclaimer

Educational project only. Market data may be delayed; predictions are not financial advice.
