"""
Stocks: real-time quote, OHLCV, news, technical indicators, ML pipeline, backtest.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.ml.backtest import backtest
from app.ml.preprocess import preprocess_ohlcv
from app.ml.features import build_feature_matrix
from app.ml.stock_predictor import run_price_pipeline
from app.ml.fusion_model import run_fusion_pipeline
from app.ml.sentiment_model import analyze_text_fast
from app.services.prediction_store import get_history, record_and_resolve
from app.services.stock_data import fetch_ohlcv, fetch_quote, fetch_ticker_news
from app.services.technical_indicators import compute_all, latest_snapshot

router = APIRouter()


async def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


def _normalize_latest_snapshot(snap: dict) -> dict:
    """Map indicator DataFrame column names to API keys used by the frontend."""
    if not snap:
        return {}
    g = lambda *keys: next((snap[k] for k in keys if snap.get(k) is not None), None)
    return {
        "close": g("close", "Close"),
        "volume": g("volume", "Volume"),
        "rsi": g("rsi", "RSI"),
        "macd": g("macd", "MACD"),
        "macd_signal": g("macd_signal", "MACD_signal"),
        "macd_hist": g("macd_hist", "MACD_hist"),
        "bb_upper": g("bb_upper", "BB_upper"),
        "bb_mid": g("bb_mid", "BB_mid"),
        "bb_lower": g("bb_lower", "BB_lower"),
        "sma_20": g("sma_20", "SMA_20"),
        "sma_50": g("sma_50", "SMA_50"),
        "support": g("support"),
        "resistance": g("resistance"),
    }


def _ohlcv_to_records(df: pd.DataFrame, tail: int = 400) -> List[Dict[str, Any]]:
    if df is None or df.empty:
        return []
    d = df.tail(tail).reset_index()
    idx = d.columns[0]
    rows = []
    for _, row in d.iterrows():
        rec = {str(idx): str(row[idx])}
        for c in ["Open", "High", "Low", "Close", "Volume"]:
            if c in row:
                v = row[c]
                rec[c.lower()] = None if pd.isna(v) else float(v)
        rows.append(rec)
    return rows


def _news_with_sentiment(symbol: str, limit: int = 12) -> List[Dict[str, Any]]:
    raw = fetch_ticker_news(symbol, limit=limit)
    out = []
    for item in raw:
        title = item.get("title") or ""
        sent = analyze_text_fast(title)
        pub = item.get("published")
        if isinstance(pub, (int, float)):
            try:
                ts = datetime.utcfromtimestamp(int(pub)).strftime("%Y-%m-%d")
            except Exception:
                ts = None
        else:
            ts = None
        out.append(
            {
                **item,
                "published_day": ts,
                "sentiment_label": sent.get("label"),
                "sentiment_score": sent.get("score"),
                "sentiment_backend": sent.get("backend"),
            }
        )
    return out


def _sentiment_series_for_index(index: pd.DatetimeIndex, news_scored: List[Dict[str, Any]]) -> pd.Series:
    """Daily mean sentiment mapped to trading index; fallback to global mean."""
    scores_by_day: Dict[str, List[float]] = {}
    for n in news_scored:
        day = n.get("published_day")
        sc = n.get("sentiment_score")
        if day and sc is not None:
            scores_by_day.setdefault(day, []).append(float(sc))
    daily = {k: sum(v) / len(v) for k, v in scores_by_day.items()}
    if not daily and news_scored:
        m = sum(float(n["sentiment_score"]) for n in news_scored if n.get("sentiment_score") is not None) / max(
            1, len([n for n in news_scored if n.get("sentiment_score") is not None])
        )
        return pd.Series(float(m), index=index)
    s = pd.Series(index=index, dtype=float)
    for i in index:
        key = pd.Timestamp(i).strftime("%Y-%m-%d")
        s.loc[i] = daily.get(key, float("nan"))
    s = s.ffill()
    s = s.fillna(0.0)
    return s.astype(float)


def _run_fusion(symbol: str, period: str, *, persist: bool = True) -> Dict[str, Any]:
    """Train fusion model (Ridge + sentiment) and optionally store vs next-day actuals."""
    sym = symbol.strip().upper()
    try:
        df_raw = fetch_ohlcv(sym, period, "1d")
    except Exception as exc:
        return {"symbol": sym, "ok": False, "error": f"Could not fetch OHLCV: {exc}"}

    df = preprocess_ohlcv(df_raw)
    if len(df) < 40:
        return {
            "symbol": sym,
            "ok": False,
            "error": f"Not enough rows after preprocessing ({len(df)})",
            "rows_out": len(df),
        }

    feat = build_feature_matrix(df)
    news = _news_with_sentiment(sym, 15)
    sent_series = _sentiment_series_for_index(feat.index, news)

    try:
        fusion_out = run_fusion_pipeline(df, sent_series)
    except Exception as exc:
        fusion_out = {"ok": False, "error": str(exc)}

    prediction_history = get_history(sym)
    if fusion_out.get("ok") and persist:
        try:
            prediction_history = record_and_resolve(sym, fusion_out, df)
        except Exception as exc:
            prediction_history = {**prediction_history, "error": str(exc)}

    return {
        "symbol": sym,
        "ok": fusion_out.get("ok", False),
        "fusion": fusion_out,
        "sentiment": {"headlines_analyzed": len(news), "articles": news},
        "prediction_history": prediction_history,
        "error": fusion_out.get("error"),
    }


def _run_full_pipeline(symbol: str, period: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    try:
        df_raw = fetch_ohlcv(sym, period, "1d")
    except Exception as exc:
        return {"symbol": sym, "ok": False, "error": f"Could not fetch OHLCV: {exc}"}

    rows_in = len(df_raw)
    df = preprocess_ohlcv(df_raw)
    rows_out = len(df)
    if rows_out < 40:
        return {
            "symbol": sym,
            "ok": False,
            "error": f"Not enough rows after preprocessing ({rows_out})",
            "rows_out": rows_out,
        }

    feat = build_feature_matrix(df)
    news = _news_with_sentiment(sym, 15)
    sent_series = _sentiment_series_for_index(feat.index, news)

    try:
        price_out = run_price_pipeline(df)
    except Exception as exc:
        price_out = {"ok": False, "error": str(exc)}

    try:
        fusion_out = run_fusion_pipeline(df, sent_series)
    except Exception as exc:
        fusion_out = {"ok": False, "error": str(exc)}

    prediction_history = {"symbol": sym, "predictions": [], "forward_metrics": {}}
    if fusion_out.get("ok"):
        try:
            prediction_history = record_and_resolve(sym, fusion_out, df)
        except Exception as exc:
            prediction_history = {"symbol": sym, "error": str(exc), "predictions": []}

    return {
        "symbol": sym,
        "ok": True,
        "preprocessing": {
            "rows_in": rows_in,
            "rows_out": rows_out,
            "steps": ["sort_index", "ffill_small_gaps", "drop_invalid_close"],
        },
        "feature_engineering": {
            "rows": len(feat),
            "columns": list(feat.columns),
            "target": "target_next_logret",
        },
        "models": {
            "price_prediction": price_out,
            "sentiment": {
                "headlines_analyzed": len(news),
                "articles": news,
            },
            "sentiment_plus_price": fusion_out,
        },
        "prediction_history": prediction_history,
    }


@router.get("/{symbol}/quote")
async def stock_quote(symbol: str):
    sym = symbol.strip().upper()
    try:
        q = await _run_sync(fetch_quote, sym)
    except Exception as e:
        raise HTTPException(502, detail=str(e))
    if not q:
        raise HTTPException(404, detail=f"No data for {sym}")
    return q


@router.get("/{symbol}/ohlcv")
async def stock_ohlcv(
    symbol: str,
    period: str = Query("1y", description="1mo,3mo,6mo,1y,2y,5y,max"),
    interval: str = Query("1d", description="1d,1wk,1mo"),
):
    sym = symbol.strip().upper()
    df = await _run_sync(fetch_ohlcv, sym, period, interval)
    if df.empty:
        raise HTTPException(404, detail=f"No OHLCV for {sym}")
    return {"symbol": sym, "period": period, "interval": interval, "rows": len(df), "data": _ohlcv_to_records(df)}


@router.get("/{symbol}/indicators")
async def stock_indicators(
    symbol: str,
    period: str = Query("1y"),
    interval: str = Query("1d"),
):
    sym = symbol.strip().upper()
    df = await _run_sync(fetch_ohlcv, sym, period, interval)
    df = preprocess_ohlcv(df)
    if df.empty or len(df) < 30:
        raise HTTPException(
            404,
            detail=(
                f"Insufficient data for {sym} ({len(df)} bars). "
                "Check the symbol and that Yahoo Finance is reachable from the API server."
            ),
        )
    ind = compute_all(df)
    snap = _normalize_latest_snapshot(latest_snapshot(ind))
    tail = ind.tail(260).reset_index()
    idx_name = tail.columns[0]
    series_payload = []
    for _, row in tail.iterrows():
        series_payload.append(
            {
                "date": str(row[idx_name]),
                "rsi": float(row["RSI"]) if pd.notna(row.get("RSI")) else None,
                "macd": float(row["MACD"]) if pd.notna(row.get("MACD")) else None,
                "macd_signal": float(row["MACD_signal"]) if pd.notna(row.get("MACD_signal")) else None,
                "bb_upper": float(row["BB_upper"]) if pd.notna(row.get("BB_upper")) else None,
                "bb_mid": float(row["BB_mid"]) if pd.notna(row.get("BB_mid")) else None,
                "bb_lower": float(row["BB_lower"]) if pd.notna(row.get("BB_lower")) else None,
                "sma_20": float(row["SMA_20"]) if pd.notna(row.get("SMA_20")) else None,
                "sma_50": float(row["SMA_50"]) if pd.notna(row.get("SMA_50")) else None,
                "volume": float(row["volume"]) if pd.notna(row.get("volume")) else None,
                "support": float(row["support"]) if pd.notna(row.get("support")) else None,
                "resistance": float(row["resistance"]) if pd.notna(row.get("resistance")) else None,
                "close": float(row["close"]) if pd.notna(row.get("close")) else None,
            }
        )
    return {
        "symbol": sym,
        "latest": snap,
        "series": series_payload,
        "definitions": {
            "RSI": "14-period relative strength",
            "MACD": "12-26-9 MACD line",
            "Bollinger": "20-period, 2 std",
            "MA": "SMA 20 and SMA 50 on close",
            "Volume": "Trading volume",
            "support_resistance": "20-bar rolling min (support) / max (resistance)",
        },
    }


@router.get("/{symbol}/news")
async def stock_news(symbol: str, limit: int = Query(15, ge=1, le=40)):
    sym = symbol.strip().upper()
    items = await _run_sync(_news_with_sentiment, sym, limit)
    return {"symbol": sym, "count": len(items), "articles": items}


class BacktestBody(BaseModel):
    strategy: str = "buy_hold"
    period: str = "2y"


@router.post("/{symbol}/backtest")
async def stock_backtest(symbol: str, body: BacktestBody):
    sym = symbol.strip().upper()
    if body.strategy not in ("buy_hold", "rsi_mean_reversion"):
        raise HTTPException(400, detail="Invalid strategy")
    df = await _run_sync(fetch_ohlcv, sym, body.period, "1d")
    df = preprocess_ohlcv(df)
    if df.empty:
        raise HTTPException(404, detail="No data")
    res = await _run_sync(backtest, df, body.strategy)
    if not res.get("ok"):
        raise HTTPException(400, detail=res.get("error", "backtest failed"))
    return {"symbol": sym, **res}


@router.get("/{symbol}/predictions/history")
async def fusion_prediction_history(symbol: str, limit: int = Query(30, ge=1, le=100)):
    """Stored fusion forecasts vs realized next-day closes (when available)."""
    sym = symbol.strip().upper()
    return await _run_sync(get_history, sym, limit)


@router.get("/{symbol}/fusion")
async def stock_fusion(symbol: str, period: str = Query("1y")):
    """
    Fusion model only: Ridge on technical features + news sentiment.
    Persists forecast and resolves prior rows against next-session actuals.
    """
    sym = symbol.strip().upper()
    out = await _run_sync(_run_fusion, sym, period, persist=True)
    if not out.get("ok") and out.get("error"):
        return out
    return out


@router.get("/{symbol}/pipeline")
async def stock_pipeline(symbol: str, period: str = Query("1y")):
    """
    Full stack: preprocessing stats, feature matrix shape, price ML, sentiment per headline, fusion model.
    Trains sklearn models on the fly (~10–30s) — not FinBERT; no multi-minute wait.
    """
    sym = symbol.strip().upper()
    out = await _run_sync(_run_full_pipeline, sym, period)
    return out
