"""Fetch stock OHLCV and quotes — yfinance with Yahoo Chart v8 fallback (same as commodities)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import pandas as pd
import requests

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
})

_PERIOD_MAP = {
    "1d": "1d",
    "5d": "5d",
    "1mo": "1mo",
    "3mo": "3mo",
    "6mo": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "10y": "10y",
    "ytd": "ytd",
    "max": "max",
}
_INTERVAL_MAP = {"1d": "1d", "1wk": "1wk", "1mo": "1mo"}


def _flatten_yahoo_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    return df


def _fetch_ohlcv_yahoo_chart(symbol: str, period: str, interval: str) -> pd.DataFrame:
    """Direct Yahoo v8 chart API — works when yfinance is blocked or returns empty."""
    sym = symbol.strip().upper()
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
    params = {
        "interval": _INTERVAL_MAP.get(interval, "1d"),
        "range": _PERIOD_MAP.get(period, "1y"),
    }
    r = SESSION.get(url, params=params, timeout=15)
    r.raise_for_status()
    payload = r.json()
    results = payload.get("chart", {}).get("result") or []
    if not results:
        return pd.DataFrame()
    res = results[0]
    q = (res.get("indicators") or {}).get("quote") or [{}]
    q = q[0] if q else {}
    ts = res.get("timestamp") or []
    if not ts:
        return pd.DataFrame()

    df = pd.DataFrame({
        "Open": q.get("open", []),
        "High": q.get("high", []),
        "Low": q.get("low", []),
        "Close": q.get("close", []),
        "Volume": q.get("volume", []),
    }, index=pd.to_datetime(ts, unit="s", utc=True))
    df.index = df.index.tz_localize(None)
    df = df.dropna(subset=["Close"])
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["Volume"] = df["Volume"].fillna(0).astype(float)
    return df[["Open", "High", "Low", "Close", "Volume"]].copy()


def _fetch_ohlcv_yfinance(symbol: str, period: str, interval: str) -> pd.DataFrame:
    import yfinance as yf

    sym = symbol.strip().upper()
    t = yf.Ticker(sym)
    df = t.history(period=period, interval=interval, auto_adjust=True)
    if df is None or df.empty:
        df = yf.download(
            sym,
            period=period,
            interval=interval,
            progress=False,
            auto_adjust=True,
            threads=False,
        )
    if df is None or df.empty:
        return pd.DataFrame()
    df = _flatten_yahoo_columns(df)
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col not in df.columns:
            return pd.DataFrame()
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df.dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index)
    if hasattr(df.index, "tz") and df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    df["Volume"] = df["Volume"].fillna(0).astype(float)
    return df


def fetch_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    sym = symbol.strip().upper()
    df = pd.DataFrame()
    for fetcher in (_fetch_ohlcv_yfinance, _fetch_ohlcv_yahoo_chart):
        try:
            df = fetcher(sym, period, interval)
            if df is not None and len(df) >= 5:
                return df
        except Exception as exc:
            print(f"[stock_data] {fetcher.__name__} {sym}: {exc}")
    return df if df is not None else pd.DataFrame()


def fetch_quote(symbol: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    info: Dict[str, Any] = {"symbol": sym}

    # Try chart meta (fast, same API as OHLCV fallback)
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
        r = SESSION.get(url, params={"interval": "1d", "range": "5d"}, timeout=10)
        res = (r.json().get("chart") or {}).get("result") or []
        if res:
            meta = res[0].get("meta") or {}
            price = meta.get("regularMarketPrice") or meta.get("previousClose")
            if price is not None:
                info["last_close"] = float(price)
                info["last_price"] = float(price)
            currency = meta.get("currency")
            if currency:
                info["currency"] = currency
    except Exception:
        pass

    try:
        import yfinance as yf

        t = yf.Ticker(sym)
        try:
            fi = t.fast_info
            if fi:
                for k in ("last_price", "previous_close", "open", "day_high", "day_low", "volume", "currency"):
                    v = getattr(fi, k, None) if hasattr(fi, k) else (fi.get(k) if hasattr(fi, "get") else None)
                    if v is not None:
                        info[k] = float(v) if isinstance(v, (int, float)) else v
        except Exception:
            pass
    except Exception:
        pass

    hist = fetch_ohlcv(sym, period="5d", interval="1d")
    if not hist.empty:
        info["last_close"] = float(hist["Close"].iloc[-1])
        info["asof"] = str(hist.index[-1].date()) if hasattr(hist.index[-1], "date") else str(hist.index[-1])
    return info


def _news_title(item: dict) -> str:
    if not item:
        return ""
    if item.get("title"):
        return str(item["title"]).strip()
    content = item.get("content")
    if isinstance(content, dict):
        for key in ("title", "summary", "description"):
            if content.get(key):
                return str(content[key]).strip()
    return ""


def _news_link(item: dict) -> str:
    if item.get("link"):
        return str(item["link"])
    content = item.get("content")
    if isinstance(content, dict):
        cu = content.get("canonicalUrl") or content.get("clickThroughUrl") or {}
        if isinstance(cu, dict) and cu.get("url"):
            return str(cu["url"])
        if isinstance(cu, str):
            return cu
    return item.get("url") or ""


def _news_published(item: dict) -> Optional[int]:
    for key in ("providerPublishTime", "pubDate", "published"):
        v = item.get(key)
        if v is not None:
            try:
                return int(v)
            except (TypeError, ValueError):
                pass
    content = item.get("content")
    if isinstance(content, dict):
        pt = content.get("pubDate") or content.get("displayTime")
        if pt is not None:
            try:
                return int(pt)
            except (TypeError, ValueError):
                pass
    return None


def fetch_ticker_news(symbol: str, limit: int = 15) -> list:
    sym = symbol.strip().upper()
    raw: List[dict] = []
    try:
        import yfinance as yf

        raw = list(yf.Ticker(sym).news or [])
    except Exception as exc:
        print(f"[stock_data] yfinance news {sym}: {exc}")

    out = []
    for item in raw[:limit]:
        title = _news_title(item)
        if not title:
            continue
        out.append(
            {
                "title": title,
                "publisher": item.get("publisher") or item.get("publisherName") or "",
                "link": _news_link(item),
                "published": _news_published(item),
            }
        )
    return out
