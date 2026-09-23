"""
Technical indicators for OHLCV series (pandas DataFrame).
RSI, MACD, Bollinger Bands, moving averages, volume, support/resistance.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _ensure_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    need = {"Open", "High", "Low", "Close", "Volume"}
    missing = need - set(df.columns)
    if missing:
        raise ValueError(f"OHLCV missing columns: {missing}")
    return df.copy()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-12)
    return (100 - (100 / (1 + rs))).rename("RSI")


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    line = ema_fast - ema_slow
    sig = line.ewm(span=signal, adjust=False).mean()
    hist = line - sig
    return pd.DataFrame({"MACD": line, "MACD_signal": sig, "MACD_hist": hist})


def bollinger_bands(close: pd.Series, period: int = 20, std_mult: float = 2.0) -> pd.DataFrame:
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return pd.DataFrame({"BB_upper": upper, "BB_mid": mid, "BB_lower": lower})


def moving_averages(close: pd.Series, windows: tuple[int, ...] = (20, 50)) -> pd.DataFrame:
    return pd.DataFrame({f"SMA_{w}": close.rolling(w).mean() for w in windows})


def support_resistance(high: pd.Series, low: pd.Series, lookback: int = 20) -> pd.DataFrame:
    """Rolling resistance (max high) and support (min low) over lookback."""
    res = high.rolling(lookback).max()
    sup = low.rolling(lookback).min()
    return pd.DataFrame({"resistance": res, "support": sup})


def compute_all(df: pd.DataFrame, rsi_period: int = 14, bb_period: int = 20) -> pd.DataFrame:
    d = _ensure_ohlcv(df)
    close, high, low, vol = d["Close"], d["High"], d["Low"], d["Volume"].astype(float)

    out = pd.DataFrame(index=d.index)
    out["close"] = close
    out["volume"] = vol
    out["RSI"] = rsi(close, rsi_period)
    macd_df = macd(close)
    for c in macd_df.columns:
        out[c] = macd_df[c]
    bb = bollinger_bands(close, bb_period)
    for c in bb.columns:
        out[c] = bb[c]
    ma = moving_averages(close, (20, 50))
    for c in ma.columns:
        out[c] = ma[c]
    sr = support_resistance(high, low, 20)
    out["support"] = sr["support"]
    out["resistance"] = sr["resistance"]
    return out


def latest_snapshot(ind_df: pd.DataFrame) -> dict:
    """Last row as JSON-friendly numbers (None for NaN)."""
    if ind_df.empty:
        return {}
    row = ind_df.iloc[-1]
    snap = {}
    for k, v in row.items():
        if pd.isna(v):
            snap[k] = None
        elif isinstance(v, (np.floating, float)):
            snap[k] = float(round(v, 6))
        else:
            snap[k] = float(v) if hasattr(v, "item") else v
    return snap
