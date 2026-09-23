"""Align chart/prediction figures with dashboard display units (unit_converter)."""
from __future__ import annotations

from typing import Any, Dict, Tuple

from app.services.unit_converter import convert


def live_display_price(data: Dict[str, Any]) -> float:
    """Dashboard unit price (₹/10g, ₹/kg, ₹/bbl) — not raw contract INR."""
    if not data:
        return 0.0
    dp = data.get("display_price")
    if dp is not None:
        try:
            return float(dp)
        except (TypeError, ValueError):
            pass
    try:
        return float(data.get("price_inr") or 0)
    except (TypeError, ValueError):
        return 0.0


def usd_to_display(ticker: str, price_usd: float, usd_inr: float) -> Tuple[float, str]:
    """Same logic as live dashboard prices (₹/kg, ₹/10g, quintal, etc.)."""
    try:
        p = float(price_usd)
        r = float(usd_inr)
    except (TypeError, ValueError):
        return 0.0, ""
    if p <= 0 or r <= 0:
        return 0.0, ""
    out = convert(ticker, p, r)
    dp = out.get("display_price")
    du = out.get("display_unit") or ""
    if dp is None:
        return round(p * r, 2), du
    return float(round(float(dp), 4)), str(du)


def contract_inr_to_display(ticker: str, close_inr: float, usd_inr: float) -> Tuple[float, str]:
    """Map contract Close×INR back through implied USD so convert() matches the dashboard."""
    try:
        x = float(close_inr)
        r = float(usd_inr)
    except (TypeError, ValueError):
        return 0.0, ""
    if x <= 0 or r <= 0:
        return round(x, 2), ""
    return usd_to_display(ticker, x / r, r)
