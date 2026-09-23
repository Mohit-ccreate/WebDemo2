"""Simple strategy backtests on OHLCV."""
from __future__ import annotations

from typing import Any, Dict, List, Literal

import numpy as np
import pandas as pd

from app.services.technical_indicators import rsi as rsi_series


StrategyName = Literal["buy_hold", "rsi_mean_reversion"]


def _sortino_approx(daily_returns: np.ndarray, periods: int = 252) -> float:
    """Annualized Sortino using downside deviation of negative daily returns."""
    if len(daily_returns) < 2:
        return 0.0
    downside = daily_returns[daily_returns < 0]
    if len(downside) < 2:
        return 0.0
    down_std = float(downside.std())
    if down_std < 1e-12:
        return 0.0
    return float(np.sqrt(periods) * daily_returns.mean() / down_std)


def _equity_metrics(equity: np.ndarray) -> Dict[str, float]:
    ret = np.diff(equity) / (equity[:-1] + 1e-12)
    total = (equity[-1] / equity[0] - 1.0) * 100
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / (peak + 1e-12)
    max_dd = float(dd.min() * 100)
    sharpe = float(np.sqrt(252) * ret.mean() / (ret.std() + 1e-12)) if len(ret) > 2 else 0.0
    sortino = _sortino_approx(ret) if len(ret) > 2 else 0.0
    return {
        "total_return_pct": round(total, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_approx": round(sharpe, 3),
        "sortino_approx": round(sortino, 3),
    }


def backtest(ohlcv: pd.DataFrame, strategy: StrategyName = "buy_hold", rsi_low: float = 30.0, rsi_high: float = 70.0) -> Dict[str, Any]:
    df = ohlcv.dropna(subset=["Close"]).copy()
    if len(df) < 30:
        return {"ok": False, "error": "Not enough bars for backtest"}

    close = df["Close"].values.astype(float)
    n = len(close)
    position = np.zeros(n)
    cash = np.zeros(n)
    cash[0] = 1.0  # start with 1 unit of "portfolio" in cash
    holdings = np.zeros(n)

    if strategy == "buy_hold":
        holdings[:] = cash[0] / close[0]
        cash[:] = 0.0
    elif strategy == "rsi_mean_reversion":
        rsi = rsi_series(pd.Series(close, index=df.index), 14).values
        in_pos = False
        for i in range(1, n):
            cash[i] = cash[i - 1]
            holdings[i] = holdings[i - 1]
            r = rsi[i] if not np.isnan(rsi[i]) else 50.0
            if not in_pos and r < rsi_low:
                if cash[i - 1] > 0:
                    holdings[i] = cash[i - 1] / close[i]
                    cash[i] = 0.0
                    in_pos = True
            elif in_pos and r > rsi_high:
                cash[i] = holdings[i - 1] * close[i]
                holdings[i] = 0.0
                in_pos = False
            else:
                holdings[i] = holdings[i - 1]
                cash[i] = cash[i - 1]

    equity = cash + holdings * close
    curve = [{"date": str(df.index[i]), "equity": float(equity[i])} for i in range(n)]

    rets = np.diff(equity) / (equity[:-1] + 1e-12)
    wins = (rets > 0).sum()
    losses = (rets < 0).sum()
    win_rate = float(wins / max(1, wins + losses)) * 100

    m = _equity_metrics(equity)
    m["win_rate_pct"] = round(win_rate, 1)
    return {"ok": True, "strategy": strategy, "metrics": m, "equity_curve": curve[-min(400, n) :]}
