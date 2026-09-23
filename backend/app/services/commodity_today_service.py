"""Orchestrate today's commodity price forecasts (LSTM if trained, else sklearn)."""
from __future__ import annotations

import asyncio
import time
from datetime import date
from typing import Any, Dict, List, Optional

from app.ml.commodity_today import lstm_result_to_today, predict_today_sklearn
from app.services.data_fetcher import COMMODITIES, prediction_tickers


_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
CACHE_TTL_SEC = 10 * 60  # 10 minutes (was 45 — stale wrong forecasts stuck too long)


def _sane_forecast(mapped: Dict[str, Any], live: Optional[float] = None) -> bool:
    pred = mapped.get("predicted_price_display")
    last = mapped.get("last_price_display")
    if pred is None or float(pred) <= 0:
        return False
    ref = float(live) if live and live > 0 else (float(last) if last else 0)
    if ref > 0:
        ratio = float(pred) / ref
        if ratio < 0.5 or ratio > 2.0:
            return False
    return True


async def predict_today_one(ticker: str, fetcher, lstm_predictor) -> Dict[str, Any]:
    """Single commodity: prefer saved LSTM, fallback to on-the-fly technical model."""
    from app.ml.commodity_today import get_live_baseline

    sym = ticker.upper()
    live, _ = get_live_baseline(fetcher, sym)

    hist = await fetcher.get_historical(sym, period="1y", interval="1d")
    out = predict_today_sklearn(sym, hist, fetcher)
    if out.get("ok"):
        out["source"] = "sklearn"
    return out


def clear_today_cache() -> None:
    global _cache
    _cache["at"] = 0.0
    _cache["payload"] = None


async def predict_all_today(fetcher, lstm_predictor, *, use_cache: bool = True) -> Dict[str, Any]:
    global _cache
    now = time.time()
    if not use_cache:
        clear_today_cache()
    if use_cache and _cache["payload"] and (now - _cache["at"]) < CACHE_TTL_SEC:
        return _cache["payload"]

    await fetcher.refresh_all_prices()

    tickers = prediction_tickers()
    sem = asyncio.Semaphore(4)

    async def guarded(t: str):
        async with sem:
            return await predict_today_one(t, fetcher, lstm_predictor)

    results = await asyncio.gather(*[guarded(t) for t in tickers], return_exceptions=True)
    predictions: List[Dict[str, Any]] = []
    for t, r in zip(tickers, results):
        if isinstance(r, Exception):
            predictions.append({
                "ok": False,
                "ticker": t,
                "name": COMMODITIES.get(t, {}).get("name", t),
                "error": str(r),
            })
        else:
            predictions.append(r)

    ok_count = sum(1 for p in predictions if p.get("ok"))
    payload = {
        "prediction_date": date.today().isoformat(),
        "count": len(predictions),
        "ok_count": ok_count,
        "predictions": predictions,
        "cached": False,
        "forecast_version": 2,
    }
    _cache["at"] = now
    _cache["payload"] = {**payload, "cached": True}
    return payload
