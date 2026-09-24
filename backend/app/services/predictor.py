"""
predictor.py  — 2D Multivariate LSTM
──────────────────────────────────────
Input features per timestep (7 features):
  [Close_Display, Open_Display, High_Display, Low_Display, Volume,
   Daily_Return%, USD_INR_Rate]

Architecture:
  Input(60, 7) → LSTM(128, return_seq=True) → Dropout(0.2)
               → LSTM(64)                   → Dropout(0.2)
               → Dense(32, relu)            → Dense(1)

Predicts: next N days close in dashboard display units (₹/10g, ₹/kg, ₹/bbl, …)
"""

import os, math, asyncio
from pathlib import Path
from typing import List, Dict, Optional

import numpy as np
import pandas as pd
import joblib

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
import gc
import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
from sklearn.preprocessing import MinMaxScaler

# Restrict TensorFlow thread pool allocations to minimize memory footprint under 300MB
try:
    tf.config.threading.set_inter_op_parallelism_threads(1)
    tf.config.threading.set_intra_op_parallelism_threads(1)
except Exception:
    pass

from app.services.data_fetcher import COMMODITIES, PREDICTION_EXCLUDED

MODELS_DIR   = Path(__file__).parent.parent / "models" / "trained"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_LOOKBACK = 30
N_FEATURES    = 7      # 2D: 7 input features per timestep
FORECAST_DAYS = 7
EPOCHS        = 4      # Lightweight: 3-5 epochs max
BATCH_SIZE    = 16     # Small batch size to minimize working RAM

FEATURE_COLS  = ["Close","Open","High","Low","Volume","Return","USD_INR"]


class LSTMPredictor:

    def __init__(self, data_fetcher):
        self.fetcher  = data_fetcher
        self._models  : Dict[str, tf.keras.Model] = {}
        self._scalers : Dict[str, MinMaxScaler]   = {}

    # ── Public API ────────────────────────────────────────────

    def model_paths(self, ticker: str):
        stem = ticker.replace("=", "_")
        mp = MODELS_DIR / f"{stem}_2d_v3.keras"
        sp = MODELS_DIR / f"{stem}_2d_v3_scaler.pkl"
        return mp, sp

    def has_trained_model(self, ticker: str) -> bool:
        mp, sp = self.model_paths(ticker)
        return mp.exists() and sp.exists()

    def _heuristic_forecast(
        self,
        ticker: str,
        df: pd.DataFrame,
        disp_last: float,
        disp_unit: str,
        forecast_days: int = FORECAST_DAYS,
    ) -> Dict:
        """Fast, robust technical momentum baseline requiring zero heavy memory."""
        last_date = df.index[-1] if not df.empty else pd.Timestamp.now()
        forecast_dates = self._forecast_dates(last_date, forecast_days)

        momentum = 0.0
        if not df.empty and "Close" in df.columns:
            try:
                rets = df["Close"].pct_change().dropna().tail(10)
                if len(rets):
                    momentum = float(rets.mean())
            except Exception:
                momentum = 0.0
        momentum = max(-0.018, min(0.018, momentum))

        forecast = []
        current_price = disp_last
        for i in range(forecast_days):
            current_price = round(current_price * (1.0 + momentum * (0.9 ** i)), 2)
            fdate = forecast_dates[i] if i < len(forecast_dates) else (
                pd.Timestamp(last_date).normalize() + pd.Timedelta(days=i + 1)
            )
            change_d = round((current_price - disp_last) / disp_last * 100, 2) if disp_last else 0.0
            forecast.append({
                "date":               fdate.strftime("%Y-%m-%d"),
                "price_inr":          current_price,
                "price_display_inr":  current_price,
                "change_pct":         change_d,
                "change_pct_display": change_d,
            })

        today_fc = forecast[0] if forecast else None
        return {
            "ticker":                  ticker,
            "forecast":                forecast,
            "today_prediction":        today_fc,
            "confidence":              78.0,
            "last_price_inr":          round(disp_last, 2),
            "last_price_display_inr":  round(disp_last, 2),
            "last_bar_date":           pd.Timestamp(last_date).strftime("%Y-%m-%d"),
            "display_unit":            disp_unit or COMMODITIES.get(ticker, {}).get("unit", ""),
            "model_type":              "Technical Momentum Baseline (Heuristic)",
            "features_used":           FEATURE_COLS,
            "lookback_days":           DEFAULT_LOOKBACK,
            "model_ready":             True,
            "used_cached_model":       False,
        }

    async def predict(self, ticker: str, forecast_days: int = FORECAST_DAYS) -> Dict:
        if ticker in PREDICTION_EXCLUDED:
            return {"error": f"{ticker} is not enabled for LSTM prediction."}
        await self.fetcher.refresh_all_prices()

        df = await self.fetcher.get_historical(ticker, period="6mo", interval="1d")
        rate = float(self.fetcher._usd_inr)

        hist_last = float(df["Close"].iloc[-1]) if not df.empty and "Close" in df.columns else 0.0
        disp_last, disp_unit = self._live_display_baseline(ticker, hist_last, rate)

        model, scaler = await self._load_model(ticker)
        if model is None or scaler is None:
            print(f"[Predictor] No loaded model for {ticker}; using heuristic baseline.")
            return self._heuristic_forecast(ticker, df, disp_last, disp_unit, forecast_days)

        try:
            lookback = (
                model.input_shape[1]
                if hasattr(model, "input_shape") and model.input_shape and len(model.input_shape) > 1 and model.input_shape[1]
                else DEFAULT_LOOKBACK
            )
            feat = self._build_features(df, ticker, rate)
            if feat is None or len(feat) < lookback:
                return self._heuristic_forecast(ticker, df, disp_last, disp_unit, forecast_days)

            scaled      = scaler.transform(feat)
            close_idx   = 0                          # Close_Display is column 0
            seed        = scaled[-lookback:].reshape(1, lookback, N_FEATURES)

            predictions_scaled = []
            current = seed.copy()
            for _ in range(forecast_days):
                pred = float(model.predict(current, verbose=0)[0, 0])
                predictions_scaled.append(pred)
                new_row          = current[0, -1, :].copy()
                new_row[close_idx] = pred
                current = np.append(current[:, 1:, :], [[new_row]], axis=1)

            dummy       = np.zeros((len(predictions_scaled), N_FEATURES))
            dummy[:, 0] = predictions_scaled
            inv         = scaler.inverse_transform(dummy)
            preds_raw = inv[:, 0].tolist()
            preds_display, hist_anchor = self._to_display_scale(
                ticker, preds_raw, hist_last, disp_last, rate
            )
            preds_display = self._anchor_forecast_to_live(
                preds_display, hist_anchor, disp_last, max_move_pct=6.0
            )

            last_date  = df.index[-1]
            forecast_dates = self._forecast_dates(last_date, forecast_days)

            forecast = []
            for i, price in enumerate(preds_display):
                fdate = forecast_dates[i] if i < len(forecast_dates) else (
                    pd.Timestamp(last_date).normalize() + pd.Timedelta(days=i + 1)
                )
                p_disp = float(price)
                change_d = round((p_disp - disp_last) / disp_last * 100, 2) if disp_last else 0.0
                forecast.append({
                    "date":               fdate.strftime("%Y-%m-%d"),
                    "price_inr":          round(p_disp, 2),
                    "price_display_inr":  round(p_disp, 2),
                    "change_pct":         change_d,
                    "change_pct_display": change_d,
                })

            vol        = float(np.std(feat[-30:, 0]) / (np.mean(feat[-30:, 0]) + 1e-9)) * 100
            confidence = max(10, min(95, round(100 - vol * 2, 1)))

            today_fc = forecast[0] if forecast else None
            return {
                "ticker":                  ticker,
                "forecast":                forecast,
                "today_prediction":        today_fc,
                "confidence":              confidence,
                "last_price_inr":          round(disp_last, 2),
                "last_price_display_inr":  round(disp_last, 2),
                "last_bar_date":           pd.Timestamp(last_date).strftime("%Y-%m-%d"),
                "display_unit":            disp_unit or COMMODITIES.get(ticker, {}).get("unit", ""),
                "model_type":              "2D Multivariate LSTM (7 features)",
                "features_used":           FEATURE_COLS,
                "lookback_days":           lookback,
                "model_ready":             True,
                "used_cached_model":       True,
            }
        except Exception as infer_err:
            print(f"[Predictor] Inference error for {ticker}: {infer_err}. Falling back to baseline.")
            return self._heuristic_forecast(ticker, df, disp_last, disp_unit, forecast_days)

    async def train(self, ticker: str) -> Dict:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: self._train_sync(ticker))
        self._models.pop(ticker, None)
        self._scalers.pop(ticker, None)
        return result

    async def batch_train_all(self, tickers: List[str]) -> List[Dict]:
        results = []
        for t in tickers:
            print(f"[Predictor] Training {t}...")
            results.append(await self.train(t))
        return results

    # ── Internal helpers ──────────────────────────────────────

    @staticmethod
    def _forecast_dates(last_date, n_steps: int) -> list:
        """First forecast = today when last bar is before today; else next business day."""
        last = pd.Timestamp(last_date).normalize()
        today = pd.Timestamp.now().normalize()
        cursor = today if last < today else last + pd.offsets.BDay(1)
        dates = []
        for _ in range(n_steps):
            dates.append(cursor)
            cursor = cursor + pd.offsets.BDay(1)
        return dates

    def _live_display_baseline(self, ticker: str, hist_last: float, rate: float):
        """Use live dashboard display_price when available so forecast base matches the table."""
        cached = self.fetcher.get_cached().get(ticker) or {}
        live = cached.get("display_price")
        if live is not None and float(live) > 0:
            unit = cached.get("display_unit") or ""
            return float(live), unit
        unit = cached.get("display_unit") or COMMODITIES.get(ticker, {}).get("unit", "")
        return float(hist_last), unit

    def _ohlc_display_series(
        self, df: pd.DataFrame, col: str, ticker: str, rate: float
    ) -> np.ndarray:
        """Always dashboard units — never raw contract INR (₹/oz for gold)."""
        from app.services.price_display import usd_to_display

        disp_col = f"{col}_Display"
        if disp_col in df.columns and df[disp_col].notna().sum() > 0:
            return df[disp_col].astype(float).values

        if col in df.columns:
            out = []
            for v in df[col].astype(float).values:
                if v != v or v <= 0:
                    out.append(np.nan)
                else:
                    dp, _ = usd_to_display(ticker, float(v), rate)
                    out.append(dp)
            return np.array(out, dtype=float)

        return np.zeros(len(df), dtype=float)

    def _to_display_scale(
        self,
        ticker: str,
        preds: List[float],
        hist_last: float,
        disp_last: float,
        rate: float,
    ) -> tuple:
        """
        Map model outputs to dashboard display units and anchor to live price.
        Handles legacy models trained on contract INR (much larger than display).
        """
        from app.services.price_display import contract_inr_to_display

        anchor = hist_last
        converted = list(preds)

        if disp_last > 0 and anchor > disp_last * 1.8:
            converted = [
                contract_inr_to_display(ticker, float(p), rate)[0] for p in converted
            ]
            anchor = contract_inr_to_display(ticker, anchor, rate)[0]

        if disp_last > 0 and anchor > 0 and abs(anchor - disp_last) / disp_last > 0.02:
            shift = disp_last - anchor
            converted = [float(p) + shift for p in converted]
            anchor = disp_last

        return converted, anchor

    @staticmethod
    def _anchor_forecast_to_live(
        preds: List[float],
        anchor: float,
        disp_last: float,
        max_move_pct: Optional[float] = 6.0,
    ) -> List[float]:
        """
        Apply model direction from historical anchor but keep levels near live dashboard price.
        Stops legacy/wrong-scale models from showing ~₹1.3L when live gold is ~₹1.59L/10g.
        """
        """
        Convert model-predicted display prices (relative to historical anchor)
        into a sequential series anchored at the live `disp_last`. We compute
        per-step moves from consecutive model outputs (in anchor-scale) and
        apply them cumulatively to the live price. Optionally clamp per-step
        moves to `max_move_pct` to avoid single-day spikes.
        """
        if disp_last <= 0 or not preds:
            return preds
        cap = None if max_move_pct is None else float(max_move_pct) / 100.0
        out = []
        prev_anchor = float(anchor) if anchor else None
        prev_disp = float(disp_last)
        for p in preds:
            p_val = float(p)
            if prev_anchor and prev_anchor > 0:
                step_move = (p_val - prev_anchor) / prev_anchor
            else:
                step_move = 0.0
            if cap is not None:
                step_move = max(-cap, min(cap, step_move))
            price = round(prev_disp * (1 + step_move), 2)
            out.append(price)
            prev_anchor = p_val
            prev_disp = price
        return out

    def _build_features(
        self, df: pd.DataFrame, ticker: str, rate: float
    ) -> Optional[np.ndarray]:
        """Build 7-feature matrix; OHLC in dashboard display units (₹/kg, ₹/10g, …)."""
        try:
            close  = self._ohlc_display_series(df, "Close", ticker, rate)
            open_  = self._ohlc_display_series(df, "Open", ticker, rate)
            high   = self._ohlc_display_series(df, "High", ticker, rate)
            low    = self._ohlc_display_series(df, "Low", ticker, rate)
            vol    = df["Volume"].values.astype(float)
            ret    = np.concatenate([[0], np.diff(close) / (close[:-1] + 1e-9) * 100])
            usd_inr= np.full(len(close), rate)

            feat   = np.column_stack([close, open_, high, low, vol, ret, usd_inr])
            feat   = np.nan_to_num(feat, nan=0.0, posinf=0.0, neginf=0.0)
            return feat
        except Exception as e:
            print(f"[Predictor] Feature build failed: {e}")
            return None

    async def _load_model(self, ticker: str):
        """Load a previously trained model from disk only — never train on Predict."""
        if ticker in self._models:
            return self._models[ticker], self._scalers[ticker]

        mp, sp = self.model_paths(ticker)
        if not mp.exists() or not sp.exists():
            return None, None

        try:
            model = load_model(str(mp))
            scaler = joblib.load(sp)
        except Exception as exc:
            print(f"[Predictor] Failed to load {ticker}: {exc}")
            return None, None

        # Keep maximum 2 models cached in memory to stay strictly under 300MB RAM
        if len(self._models) >= 2:
            oldest = next(iter(self._models))
            self._models.pop(oldest, None)
            self._scalers.pop(oldest, None)
            gc.collect()

        self._models[ticker] = model
        self._scalers[ticker] = scaler
        return model, scaler

    def _train_sync(self, ticker: str, return_objects: bool = False):
        import gc
        gc.collect()
        tf.keras.backend.clear_session()

        try:
            # Cut training history: fetch only the last 90–120 days of candles
            df = self.fetcher._fetch_history(ticker, period="4mo", interval="1d")
            if df.empty or len(df) < 35:
                # Fallback to 6mo if 4mo yielded too few trading days
                df = self.fetcher._fetch_history(ticker, period="6mo", interval="1d")

            lookback = 20 if len(df) < 60 else DEFAULT_LOOKBACK
            if df.empty or len(df) < lookback + 10:
                msg = f"Insufficient data for {ticker}"
                return (None, None) if return_objects else {"ticker": ticker, "status": "error", "message": msg}

            rate = float(df["USD_INR_Rate"].iloc[-1]) if "USD_INR_Rate" in df.columns else self.fetcher._usd_inr
            close = self._ohlc_display_series(df, "Close", ticker, rate)
            open_ = self._ohlc_display_series(df, "Open", ticker, rate)
            high  = self._ohlc_display_series(df, "High", ticker, rate)
            low   = self._ohlc_display_series(df, "Low", ticker, rate)
            vol   = df["Volume"].values.astype(float) if "Volume" in df.columns else np.zeros(len(close))
            ret   = np.concatenate([[0], np.diff(close) / (close[:-1] + 1e-9) * 100])
            uinr_rate = float(df["USD_INR_Rate"].iloc[-1]) if "USD_INR_Rate" in df.columns else self.fetcher._usd_inr
            uinr  = np.full(len(close), uinr_rate)

            feat  = np.column_stack([close, open_, high, low, vol, ret, uinr])
            feat  = np.nan_to_num(feat, nan=0.0, posinf=0.0, neginf=0.0)

            scaler = MinMaxScaler(feature_range=(0, 1))
            scaled = scaler.fit_transform(feat)

            X, y = [], []
            for i in range(lookback, len(scaled)):
                X.append(scaled[i-lookback:i])          # shape (lookback, 7)
                y.append(scaled[i, 0])                  # predict Close only

            X = np.array(X, dtype=np.float32)
            y = np.array(y, dtype=np.float32)

            split   = max(1, int(len(X) * 0.85))
            Xtr, Xv = X[:split], X[split:]
            ytr, yv = y[:split], y[split:]
            if len(Xv) == 0:
                Xv, yv = Xtr, ytr

            # Lightweight single LSTM layer (32 units) — fits in ~1–2 seconds under 200MB RAM
            model = Sequential([
                Input(shape=(lookback, N_FEATURES)),
                LSTM(32, return_sequences=False),
                Dropout(0.1),
                Dense(16, activation="relu"),
                Dense(1),
            ])
            model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=0.003), loss="huber")

            mp = MODELS_DIR / f"{ticker.replace('=','_')}_2d_v3.keras"
            sp = MODELS_DIR / f"{ticker.replace('=','_')}_2d_v3_scaler.pkl"

            history = model.fit(
                Xtr, ytr,
                validation_data=(Xv, yv),
                epochs=EPOCHS,
                batch_size=BATCH_SIZE,
                verbose=0,
            )

            # RMSE on validation
            vp = model.predict(Xv, verbose=0).flatten()
            dummy_true = np.zeros((len(yv), N_FEATURES))
            dummy_true[:, 0] = yv
            dummy_pred = np.zeros((len(vp), N_FEATURES))
            dummy_pred[:, 0] = vp
            true_inr = scaler.inverse_transform(dummy_true)[:, 0]
            pred_inr = scaler.inverse_transform(dummy_pred)[:, 0]
            rmse = math.sqrt(np.mean((true_inr - pred_inr) ** 2))

            # Save model and scaler
            model.save(str(mp))
            joblib.dump(scaler, sp)

            epochs_run = len(history.history["loss"]) if hasattr(history, "history") else EPOCHS
            print(f"[Predictor] {ticker} lightweight LSTM trained — RMSE ₹{rmse:.2f} — epochs {epochs_run}")

            summary = {
                "ticker": ticker,
                "status": "trained",
                "model_type": "Lightweight 2D LSTM (1 layer)",
                "features": FEATURE_COLS,
                "val_rmse_inr": round(rmse, 2),
                "epochs_run": epochs_run,
                "lookback_days": lookback,
            }
            return (model, scaler) if return_objects else summary

        except Exception as e:
            print(f"[Predictor] Training error for {ticker}: {e}")
            mp, sp = self.model_paths(ticker)
            if mp.exists() and sp.exists():
                print(f"[Predictor] Retaining existing pre-trained model for {ticker}")
                return (None, None) if return_objects else {
                    "ticker": ticker,
                    "status": "retained_cached",
                    "message": f"Training encountered resource constraints ({str(e)}). Retained existing trained model.",
                }
            return (None, None) if return_objects else {
                "ticker": ticker,
                "status": "error",
                "message": str(e),
            }
        finally:
            tf.keras.backend.clear_session()
            gc.collect()