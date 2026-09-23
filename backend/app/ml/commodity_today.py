"""Today's commodity close forecast — anchored to live India display units."""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from app.ml.stock_predictor import run_price_pipeline
from app.services.data_fetcher import COMMODITIES

# Max implied daily move for "today" dashboard forecast (keeps values near spot/MCX)
MAX_DAILY_MOVE = 0.018  # ±1.8%


def get_live_baseline(fetcher, ticker: str) -> Tuple[Optional[float], str]:
    """Dashboard display price/unit (same as live table)."""
    if fetcher is None:
        return None, ""
    cached = fetcher.get_cached().get(ticker.upper(), {}) or {}
    live = cached.get("display_price")
    unit = cached.get("display_unit") or cached.get("unit") or ""
    try:
        v = float(live)
        return (v if v > 0 else None), str(unit)
    except (TypeError, ValueError):
        return None, str(unit)


def align_ohlcv_to_live(ohlcv: pd.DataFrame, live_price: float) -> pd.DataFrame:
    """Set the latest bar to the live dashboard close so features match the table."""
    if ohlcv.empty or not live_price or live_price <= 0:
        return ohlcv
    d = ohlcv.copy()
    for col in ("Open", "High", "Low", "Close"):
        if col in d.columns:
            d.iloc[-1, d.columns.get_loc(col)] = live_price
    return d


def history_to_ohlcv(hist: pd.DataFrame) -> pd.DataFrame:
    """Map fetcher history (Display/INR columns) to standard OHLCV for feature engineering."""
    if hist is None or hist.empty:
        return pd.DataFrame()
    out = pd.DataFrame(index=hist.index)
    for col in ("Open", "High", "Low", "Close"):
        disp = f"{col}_Display"
        inr = f"{col}_INR"
        if disp in hist.columns:
            out[col] = pd.to_numeric(hist[disp], errors="coerce")
        elif inr in hist.columns:
            out[col] = pd.to_numeric(hist[inr], errors="coerce")
        elif col in hist.columns:
            out[col] = pd.to_numeric(hist[col], errors="coerce")
    out["Volume"] = pd.to_numeric(
        hist["Volume"] if "Volume" in hist.columns else 0, errors="coerce"
    ).fillna(0)
    return out.dropna(subset=["Close"])


def _momentum_forecast(ohlcv: pd.DataFrame, baseline: float) -> Tuple[float, float]:
    """Today's close ≈ live spot + recent trend (small capped move)."""
    close = ohlcv["Close"].astype(float)
    rets = close.pct_change().tail(6).replace([np.inf, -np.inf], np.nan).dropna()
    momentum = float(rets.mean()) if len(rets) else 0.0
    momentum = max(-MAX_DAILY_MOVE, min(MAX_DAILY_MOVE, momentum))
    pred = float(baseline) * (1.0 + momentum)
    return pred, round(momentum * 100, 2)


def _clamp_log_return(log_ret: float) -> float:
    return max(-MAX_DAILY_MOVE, min(MAX_DAILY_MOVE, float(log_ret)))


def predict_today_sklearn(
    ticker: str,
    hist: pd.DataFrame,
    fetcher=None,
) -> Dict[str, Any]:
    """
    Predict today's close in Indian display units.
    Uses live dashboard price as baseline; forecast stays near spot (not stale Yahoo levels).
    """
    sym = ticker.upper()
    meta = COMMODITIES.get(sym, {})
    live, live_unit = get_live_baseline(fetcher, sym)

    ohlcv = history_to_ohlcv(hist)
    if len(ohlcv) < 60:
        return {
            "ok": False,
            "ticker": sym,
            "error": f"Insufficient history for {sym} ({len(ohlcv)} rows)",
        }

    if live:
        ohlcv = align_ohlcv_to_live(ohlcv, live)

    baseline = live if live else float(ohlcv["Close"].iloc[-1])

    mom_pred, mom_chg = _momentum_forecast(ohlcv, baseline)

    ml_log_ret = 0.0
    ml_pred = mom_pred
    out = run_price_pipeline(ohlcv)
    if out.get("ok"):
        ml_log_ret = _clamp_log_return(float(out.get("predicted_next_log_return") or 0))
        ml_pred = float(baseline) * math.exp(ml_log_ret)
        # Blend: mostly near-spot momentum; ML only nudges direction
        pred = 0.2 * ml_pred + 0.8 * mom_pred
    else:
        pred = mom_pred

    chg = round((pred - baseline) / baseline * 100, 2) if baseline else 0.0
    unit = live_unit or meta.get("unit", "")

    return {
        "ok": True,
        "ticker": sym,
        "name": meta.get("name", sym),
        "model": "Near-spot (live price + capped trend)",
        "prediction_date": date.today().isoformat(),
        "as_of_date": out.get("as_of_date") if out.get("ok") else str(ohlcv.index[-1].date()),
        "last_price_display": round(baseline, 2),
        "predicted_price_display": round(pred, 2),
        "change_pct": chg,
        "display_unit": unit,
        "anchored_to_live": live is not None,
        "forecast_version": 2,
    }


def lstm_result_to_today(lstm: Dict[str, Any], fetcher=None) -> Optional[Dict[str, Any]]:
    """LSTM day-1 mapped to live baseline with capped move."""
    if lstm.get("error") or not lstm.get("forecast"):
        return None
    sym = lstm.get("ticker", "")
    meta = COMMODITIES.get(sym, {})
    live, live_unit = get_live_baseline(fetcher, sym)
    model_last = float(lstm.get("last_price_display_inr") or lstm.get("last_price_inr") or 0)
    fc = lstm["forecast"][0]
    model_pred = float(fc.get("price_display_inr") or fc.get("price_inr") or 0)

    baseline = live if live else model_last
    if baseline <= 0:
        return None

    if model_last > 0:
        ratio = model_pred / model_last
        ratio = max(1 - MAX_DAILY_MOVE, min(1 + MAX_DAILY_MOVE, ratio))
        pred = baseline * ratio
    else:
        pred = baseline

    chg = round((pred - baseline) / baseline * 100, 2)
    return {
        "ok": True,
        "ticker": sym,
        "name": meta.get("name", sym),
        "model": "LSTM (live-anchored, capped)",
        "prediction_date": fc.get("date") or date.today().isoformat(),
        "last_price_display": round(baseline, 2),
        "predicted_price_display": round(pred, 2),
        "change_pct": chg,
        "display_unit": live_unit or lstm.get("display_unit") or meta.get("unit", ""),
        "confidence": lstm.get("confidence"),
        "anchored_to_live": live is not None,
        "forecast_version": 2,
    }
