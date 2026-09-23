"""
routes/alerts.py
────────────────
REST endpoints for managing price alerts.

GET    /api/alerts/               → list all alerts
POST   /api/alerts/               → create new alert
DELETE /api/alerts/{id}           → delete alert
PATCH  /api/alerts/{id}/disable   → disable alert
GET    /api/alerts/notifications  → recent triggered alerts
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.services.alert_engine import alert_engine, AlertType, AlertStatus
from app.services.data_fetcher import COMMODITIES

router = APIRouter()


# ── Request schema ────────────────────────────────────────────

class CreateAlertRequest(BaseModel):
    ticker:     str         = Field(..., example="GC=F")
    alert_type: AlertType   = Field(..., example="PRICE_ABOVE")
    threshold:  float       = Field(..., example=197000.0,
                                    description="Threshold in dashboard units (e.g. ₹/10g for gold)")
    label:      Optional[str] = Field(None, example="Gold hits 1.97L")


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/")
async def list_alerts(status: Optional[AlertStatus] = None):
    """List all alerts, optionally filtered by status."""
    return {
        "alerts": alert_engine.list_alerts(status),
        "total":  len(alert_engine.list_alerts()),
    }


@router.post("/")
async def create_alert(req: CreateAlertRequest):
    """Create a new price alert. Threshold must be in INR."""
    ticker = req.ticker.upper()
    if ticker not in COMMODITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown ticker '{ticker}'. See /api/prices/ for valid tickers.",
        )

    alert = alert_engine.add_alert(
        ticker=ticker,
        alert_type=req.alert_type,
        threshold=req.threshold,
        label=req.label or "",
    )
    return {
        "message": "Alert created",
        "alert":   alert.to_dict(),
    }


@router.delete("/{alert_id}")
async def delete_alert(alert_id: str):
    """Permanently delete an alert."""
    ok = alert_engine.delete_alert(alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    return {"message": f"Alert {alert_id} deleted"}


@router.patch("/{alert_id}/disable")
async def disable_alert(alert_id: str):
    """Disable an alert without deleting it."""
    ok = alert_engine.disable_alert(alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    return {"message": f"Alert {alert_id} disabled"}


@router.get("/notifications")
async def get_notifications(limit: int = 20):
    """Return recently triggered alert notifications."""
    return {
        "notifications": alert_engine.get_notifications(limit),
        "count": len(alert_engine.get_notifications(limit)),
    }