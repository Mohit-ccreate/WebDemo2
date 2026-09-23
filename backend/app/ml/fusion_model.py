"""Sentiment + price fusion model (lightweight Ridge on aggregated features)."""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from app.ml.features import build_feature_matrix
from app.ml.preprocess import preprocess_features


def run_fusion_pipeline(ohlcv: pd.DataFrame, daily_sentiment: pd.Series) -> Dict[str, Any]:
    """
    daily_sentiment: Series indexed by date (same tz as ohlcv), values in [-1, 1].
    Trains Ridge to predict next log return from [features, sentiment].
    """
    feat = build_feature_matrix(ohlcv)
    if feat.empty:
        return {"ok": False, "error": "No features"}

    s = daily_sentiment.reindex(feat.index).fillna(0.0).astype(float)
    feat = feat.copy()
    feat["sentiment"] = s.values

    target = "target_next_logret"
    drop_y = {target}
    cols = [c for c in feat.columns if c not in drop_y and not str(c).startswith("target_")]
    all_rows = preprocess_features(feat, require_target=False)
    train_rows = all_rows.dropna(subset=cols + [target])
    if len(train_rows) < 50:
        return {"ok": False, "error": "Insufficient aligned sentiment+price rows", "rows": len(train_rows)}

    X = train_rows[cols].values
    y = train_rows[target].values
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=False)
    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    infer_rows = all_rows.dropna(subset=cols)
    if infer_rows.empty:
        return {"ok": False, "error": "No row available for next-day inference"}
    last = infer_rows.iloc[-1]
    nxt = float(model.predict(last[cols].values.reshape(1, -1))[0])
    last_close = float(last["close"])
    as_of = infer_rows.index[-1]
    as_of_str = str(as_of.date()) if hasattr(as_of, "date") else str(as_of)

    return {
        "ok": True,
        "model": "Ridge(sentiment + technical features)",
        "metrics": {
            "rmse": float(np.sqrt(mean_squared_error(y_test, pred))),
            "r2": float(r2_score(y_test, pred)),
        },
        "coef_sentiment": (
            float(model.coef_[cols.index("sentiment")])
            if "sentiment" in cols and len(model.coef_) == len(cols)
            else None
        ),
        "as_of_date": as_of_str,
        "predicted_next_log_return": nxt,
        "predicted_next_close_est": round(last_close * float(np.exp(nxt)), 4),
        "last_close": last_close,
    }
