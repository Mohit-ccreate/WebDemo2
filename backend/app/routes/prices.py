"""
routes/prices.py
────────────────
REST endpoints for live commodity prices in INR.

GET /api/prices/                  → all commodities latest prices
GET /api/prices/{ticker}          → single commodity latest price
GET /api/prices/{ticker}/history  → OHLCV history (INR)
GET /api/prices/usd-inr           → current USD/INR exchange rate
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

import pandas as pd

from app.services.data_fetcher import DataFetcher, COMMODITIES
from app.services.price_display import usd_to_display

router = APIRouter()

# Shared fetcher instance (injected from main.py via app state or direct import)
fetcher = DataFetcher()


@router.get("/")
async def get_all_prices():
    """Return latest prices for all commodities in INR."""
    cached = fetcher.get_cached()
    if not cached:
        cached = await fetcher.refresh_all_prices()
    return {
        "currency": "INR",
        "usd_inr_rate": round(fetcher._usd_inr, 4),
        "count": len(cached),
        "data": list(cached.values()),
    }


@router.get("/usd-inr")
async def get_usd_inr():
    """Return current USD to INR exchange rate."""
    return {
        "pair": "USD/INR",
        "rate": round(fetcher._usd_inr, 4),
        "source": "Yahoo Finance (USDINR=X)",
    }


@router.get("/categories")
async def get_categories():
    """Return list of commodity categories with counts."""
    from collections import Counter
    cats = Counter(m["category"] for m in COMMODITIES.values())
    return {"categories": dict(cats)}


@router.get("/{ticker}")
async def get_price(ticker: str):
    """Return latest price for a single ticker (e.g. GC=F for Gold)."""
    ticker = ticker.upper()
    if ticker not in COMMODITIES:
        raise HTTPException(
            status_code=404,
            detail=f"Ticker '{ticker}' not found. Use /api/prices/ to list all tickers.",
        )
    cached = fetcher.get_cached()
    if ticker not in cached:
        await fetcher.refresh_all_prices()
        cached = fetcher.get_cached()

    return cached.get(ticker, {"error": "Data unavailable"})


@router.get("/{ticker}/history")
async def get_history(
    ticker: str,
    period: str = Query("6mo", description="e.g. 1mo, 3mo, 6mo, 1y, 2y, 5y"),
    interval: str = Query("1d", description="e.g. 1d, 1wk, 1mo"),
):
    """
    Return OHLCV historical data for a ticker with prices in INR.
    Useful for charting.
    """
    ticker = ticker.upper()
    if ticker not in COMMODITIES:
        raise HTTPException(status_code=404, detail=f"Unknown ticker: {ticker}")

    if not fetcher.get_cached():
        await fetcher.refresh_all_prices()

    df = await fetcher.get_historical(ticker, period=period, interval=interval)
    if df.empty:
        raise HTTPException(status_code=503, detail="Historical data unavailable")

    meta = COMMODITIES[ticker]
    cached = fetcher.get_cached().get(ticker) or {}
    du = cached.get("display_unit") or meta.get("unit", "")
    live_display = cached.get("display_price")

    # Convert DataFrame → list of dicts for JSON response
    df = df.reset_index()
    rate = float(fetcher._usd_inr)
    records = []
    for _, row in df.iterrows():
        c_raw = float(row.get("Close_INR", 0) or 0)
        o_raw = float(row.get("Open_INR", 0) or 0)
        h_raw = float(row.get("High_INR", 0) or 0)
        l_raw = float(row.get("Low_INR", 0) or 0)
        close_usd = float(row.get("Close", 0) or 0)
        if close_usd <= 0 and rate > 0:
            close_usd = c_raw / rate

        d_close = float(row["Close_Display"]) if pd.notna(row.get("Close_Display")) else usd_to_display(ticker, close_usd, rate)[0]
        d_open = float(row.get("Open_Display", d_close)) if pd.notna(row.get("Open_Display")) else usd_to_display(ticker, float(row.get("Open", 0) or 0), rate)[0]
        d_high = float(row.get("High_Display", d_close)) if pd.notna(row.get("High_Display")) else usd_to_display(ticker, float(row.get("High", 0) or 0), rate)[0]
        d_low = float(row.get("Low_Display", d_close)) if pd.notna(row.get("Low_Display")) else usd_to_display(ticker, float(row.get("Low", 0) or 0), rate)[0]

        records.append({
            "date":              str(row.get("Date", row.get("Datetime", ""))),
            "open_inr":          round(o_raw, 2),
            "high_inr":          round(h_raw, 2),
            "low_inr":           round(l_raw, 2),
            "close_inr":         round(c_raw, 2),
            "display_close_inr": round(d_close, 2),
            "display_open_inr":  round(d_open, 2),
            "display_high_inr":  round(d_high, 2),
            "display_low_inr":   round(d_low, 2),
            "volume":            int(row.get("Volume", 0)),
        })

    if records and live_display is not None:
        records[-1]["display_close_inr"] = round(float(live_display), 2)

    return {
        "ticker":        ticker,
        "name":          meta["name"],
        "currency":      "INR",
        "period":        period,
        "interval":      interval,
        "display_unit":  du,
        "live_display_price": live_display,
        "records":       records,
        "note":          "Chart uses display_*_inr (same units as dashboard). Older dates reflect past USD spot at today's FX.",
    }