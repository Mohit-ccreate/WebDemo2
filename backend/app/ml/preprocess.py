"""Data preprocessing for time-series OHLCV + indicators."""
from __future__ import annotations

import pandas as pd


def preprocess_ohlcv(df: pd.DataFrame, max_ffill: int = 5) -> pd.DataFrame:
    """
    Sort index, forward-fill small gaps, drop rows with invalid close.
    """
    if df is None or df.empty:
        return pd.DataFrame()
    d = df.sort_index().copy()
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col in d.columns:
            d[col] = pd.to_numeric(d[col], errors="coerce")
    d = d.ffill(limit=max_ffill)
    d = d.dropna(subset=["Close"])
    d = d[d["Close"] > 0]
    return d


def preprocess_features(feature_df: pd.DataFrame, *, require_target: bool = True) -> pd.DataFrame:
    """Drop all-NaN columns, inf -> nan. Optionally drop rows missing target (training only)."""
    if feature_df.empty:
        return feature_df
    d = feature_df.replace([float("inf"), float("-inf")], pd.NA).dropna(how="all")
    if require_target:
        target_cols = [c for c in d.columns if c.startswith("target_")]
        if target_cols:
            d = d.dropna(subset=target_cols)
    return d
