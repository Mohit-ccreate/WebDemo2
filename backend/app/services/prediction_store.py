"""Persist fusion-model forecasts and compare with realized next-session closes."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "fusion_predictions.db"


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fusion_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                as_of_date TEXT NOT NULL,
                base_close REAL NOT NULL,
                predicted_log_return REAL NOT NULL,
                predicted_close REAL NOT NULL,
                created_at TEXT NOT NULL,
                actual_close REAL,
                actual_date TEXT,
                error_abs REAL,
                error_pct REAL,
                resolved_at TEXT,
                UNIQUE(symbol, as_of_date)
            )
            """
        )
        conn.commit()


def _next_trading_close(ohlcv: pd.DataFrame, as_of_date: str) -> Optional[tuple[str, float]]:
    """Return (next_session_date, close) for the bar immediately after as_of_date."""
    if ohlcv is None or ohlcv.empty:
        return None
    d = ohlcv.sort_index()
    close_col = "Close" if "Close" in d.columns else "close"
    if close_col not in d.columns:
        return None
    as_of = pd.Timestamp(as_of_date).normalize()
    bar_dates = [pd.Timestamp(i).normalize() for i in d.index]
    try:
        pos = next(i for i, dt in enumerate(bar_dates) if dt == as_of)
    except StopIteration:
        return None
    if pos + 1 >= len(d):
        return None
    actual_date = d.index[pos + 1]
    ad = str(pd.Timestamp(actual_date).date())
    return ad, float(d.iloc[pos + 1][close_col])


def save_fusion_prediction(symbol: str, fusion: Dict[str, Any]) -> None:
    if not fusion.get("ok"):
        return
    as_of = fusion.get("as_of_date")
    if not as_of:
        return
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO fusion_predictions (
                symbol, as_of_date, base_close, predicted_log_return,
                predicted_close, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, as_of_date) DO UPDATE SET
                base_close = excluded.base_close,
                predicted_log_return = excluded.predicted_log_return,
                predicted_close = excluded.predicted_close,
                created_at = excluded.created_at
            """,
            (
                symbol.upper(),
                as_of,
                float(fusion["last_close"]),
                float(fusion["predicted_next_log_return"]),
                float(fusion["predicted_next_close_est"]),
                now,
            ),
        )
        conn.commit()


def resolve_pending(symbol: str, ohlcv: pd.DataFrame) -> int:
    """Fill actual_close for unresolved rows when the next trading day is in ohlcv."""
    init_db()
    sym = symbol.upper()
    resolved = 0
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, as_of_date, predicted_close FROM fusion_predictions
            WHERE symbol = ? AND actual_close IS NULL
            """,
            (sym,),
        ).fetchall()
        for row in rows:
            nxt = _next_trading_close(ohlcv, row["as_of_date"])
            if not nxt:
                continue
            actual_date, actual_close = nxt
            pred = float(row["predicted_close"])
            err_abs = abs(actual_close - pred)
            err_pct = (err_abs / actual_close * 100.0) if actual_close else None
            conn.execute(
                """
                UPDATE fusion_predictions SET
                    actual_close = ?, actual_date = ?,
                    error_abs = ?, error_pct = ?, resolved_at = ?
                WHERE id = ?
                """,
                (actual_close, actual_date, err_abs, err_pct, now, row["id"]),
            )
            resolved += 1
        conn.commit()
    return resolved


def get_history(symbol: str, limit: int = 30) -> Dict[str, Any]:
    init_db()
    sym = symbol.upper()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM fusion_predictions
            WHERE symbol = ?
            ORDER BY as_of_date DESC
            LIMIT ?
            """,
            (sym, limit),
        ).fetchall()
    records = [dict(r) for r in rows]
    resolved = [r for r in records if r.get("actual_close") is not None]
    mae = None
    mape = None
    if resolved:
        errs = [float(r["error_abs"]) for r in resolved if r.get("error_abs") is not None]
        pcts = [float(r["error_pct"]) for r in resolved if r.get("error_pct") is not None]
        if errs:
            mae = sum(errs) / len(errs)
        if pcts:
            mape = sum(pcts) / len(pcts)
    return {
        "symbol": sym,
        "count": len(records),
        "resolved_count": len(resolved),
        "pending_count": len(records) - len(resolved),
        "forward_metrics": {"mae": mae, "mape_pct": mape},
        "predictions": records,
    }


def record_and_resolve(symbol: str, fusion: Dict[str, Any], ohlcv: pd.DataFrame) -> Dict[str, Any]:
    save_fusion_prediction(symbol, fusion)
    newly_resolved = resolve_pending(symbol, ohlcv)
    history = get_history(symbol)
    history["newly_resolved"] = newly_resolved
    return history
