"""
alert_engine.py
───────────────
Manages price alerts for commodities.

Alert types supported:
  • PRICE_ABOVE  — trigger when price_inr >= target
  • PRICE_BELOW  — trigger when price_inr <= target
  • CHANGE_PCT   — trigger when |change_pct| >= threshold
  • VOLATILITY   — trigger when 5-min std-dev exceeds threshold

Alerts are stored in-memory (replace with SQLite/Postgres for persistence).
"""

from datetime import datetime
from typing import Dict, List, Optional
from enum import Enum
import uuid


class AlertType(str, Enum):
    PRICE_ABOVE  = "PRICE_ABOVE"
    PRICE_BELOW  = "PRICE_BELOW"
    CHANGE_PCT   = "CHANGE_PCT"
    VOLATILITY   = "VOLATILITY"


class AlertStatus(str, Enum):
    ACTIVE    = "active"
    TRIGGERED = "triggered"
    DISABLED  = "disabled"


class Alert:
    def __init__(
        self,
        ticker: str,
        alert_type: AlertType,
        threshold: float,
        label: str = "",
    ):
        self.id          = str(uuid.uuid4())[:8]
        self.ticker      = ticker
        self.alert_type  = alert_type
        self.threshold   = threshold
        self.label       = label or f"{ticker} {alert_type.value} ₹{threshold:,.0f}"
        self.status      = AlertStatus.ACTIVE
        self.created_at  = datetime.utcnow().isoformat()
        self.triggered_at: Optional[str] = None
        self.trigger_value: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "id":            self.id,
            "ticker":        self.ticker,
            "alert_type":    self.alert_type,
            "threshold":     self.threshold,
            "label":         self.label,
            "status":        self.status,
            "created_at":    self.created_at,
            "triggered_at":  self.triggered_at,
            "trigger_value": self.trigger_value,
        }


class AlertEngine:
    """Check live prices against registered alerts and fire notifications."""

    def __init__(self):
        self._alerts: Dict[str, Alert] = {}
        self._notifications: List[dict] = []   # recent triggered alerts

    # ── CRUD ──────────────────────────────────────────────────

    def add_alert(
        self,
        ticker: str,
        alert_type: AlertType,
        threshold: float,
        label: str = "",
    ) -> Alert:
        alert = Alert(ticker, alert_type, threshold, label)
        self._alerts[alert.id] = alert
        return alert

    def get_alert(self, alert_id: str) -> Optional[Alert]:
        return self._alerts.get(alert_id)

    def list_alerts(self, status: Optional[AlertStatus] = None) -> List[dict]:
        alerts = list(self._alerts.values())
        if status:
            alerts = [a for a in alerts if a.status == status]
        return [a.to_dict() for a in alerts]

    def delete_alert(self, alert_id: str) -> bool:
        if alert_id in self._alerts:
            del self._alerts[alert_id]
            return True
        return False

    def disable_alert(self, alert_id: str) -> bool:
        if alert_id in self._alerts:
            self._alerts[alert_id].status = AlertStatus.DISABLED
            return True
        return False

    # ── Evaluation ────────────────────────────────────────────

    def evaluate(self, prices: Dict[str, dict]) -> List[dict]:
        """
        Called on every price refresh.
        Returns list of newly triggered alerts.
        """
        triggered = []

        for alert in self._alerts.values():
            if alert.status != AlertStatus.ACTIVE:
                continue

            data = prices.get(alert.ticker)
            if not data:
                continue

            from app.services.price_display import live_display_price

            price_val  = live_display_price(data)
            change_pct = abs(data.get("change_pct", 0))

            fired = False
            value = None

            if alert.alert_type == AlertType.PRICE_ABOVE and price_val >= alert.threshold:
                fired, value = True, price_val

            elif alert.alert_type == AlertType.PRICE_BELOW and price_val <= alert.threshold:
                fired, value = True, price_val

            elif alert.alert_type == AlertType.CHANGE_PCT and change_pct >= alert.threshold:
                fired, value = True, change_pct

            if fired:
                alert.status       = AlertStatus.TRIGGERED
                alert.triggered_at = datetime.utcnow().isoformat()
                alert.trigger_value = value
                note = {
                    **alert.to_dict(),
                    "commodity_name": data.get("name", alert.ticker),
                    "message": self._build_message(alert, data, value),
                }
                self._notifications.append(note)
                triggered.append(note)

        return triggered

    def get_notifications(self, limit: int = 20) -> List[dict]:
        return self._notifications[-limit:]

    # ── Helpers ───────────────────────────────────────────────

    @staticmethod
    def _build_message(alert: Alert, data: dict, value: float) -> str:
        name = data.get("name", alert.ticker)
        if alert.alert_type == AlertType.PRICE_ABOVE:
            return f"{name} crossed ₹{value:,.2f} — above your target of ₹{alert.threshold:,.2f}"
        elif alert.alert_type == AlertType.PRICE_BELOW:
            return f"{name} dropped to ₹{value:,.2f} — below your target of ₹{alert.threshold:,.2f}"
        elif alert.alert_type == AlertType.CHANGE_PCT:
            return f"{name} moved {value:.2f}% — volatility alert triggered"
        return f"{name} alert triggered at ₹{value:,.2f}"


# Shared singleton — imported by routes
alert_engine = AlertEngine()

# ── Seed some demo alerts ─────────────────────────────────────
alert_engine.add_alert("GC=F",  AlertType.PRICE_ABOVE, 197000, "Gold above ₹1,97,000")
alert_engine.add_alert("CL=F",  AlertType.PRICE_BELOW,  6700,  "Crude Oil below ₹6,700")
alert_engine.add_alert("NG=F",  AlertType.CHANGE_PCT,     2.5, "Natural Gas 2.5% move")