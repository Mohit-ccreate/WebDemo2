"""Feature engineering from OHLCV + indicator columns for ML models."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.technical_indicators import compute_all


def build_feature_matrix(ohlcv: pd.DataFrame) -> pd.DataFrame:
    """
    Merge indicators and add return-based features; target = next-day log return.
    """
    ohlcv = ohlcv.copy()
    ind = compute_all(ohlcv)
    close = ind["close"]
    log_ret = np.log(close / close.shift(1))
    ind["log_ret_1"] = log_ret
    ind["log_ret_5"] = np.log(close / close.shift(5))
    ind["vol_chg"] = ind["volume"].pct_change().replace([np.inf, -np.inf], np.nan)
    ind["target_next_logret"] = log_ret.shift(-1)
    # Skip indicator warmup (SMA50 / MACD) so ML rows are usable
    if len(ind) > 55:
        ind = ind.iloc[55:].copy()
    # Target is NaN on the latest bar (no future return yet); keep that row for inference.
    required = [c for c in ("close", "RSI", "SMA_20", "log_ret_1") if c in ind.columns]
    if required:
        ind = ind.dropna(subset=required)
    return ind
