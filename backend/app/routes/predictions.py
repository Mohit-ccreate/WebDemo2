"""
routes/predictions.py
─────────────────────
REST endpoints for LSTM price predictions in INR.

GET  /api/predictions/{ticker}        → 7-day forecast in INR
POST /api/predictions/{ticker}/train  → trigger model (re)training
GET  /api/predictions/models/status   → list trained models + RMSE
"""

from datetime import date

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from typing import Optional

import asyncio
from app.services.data_fetcher import COMMODITIES, PREDICTION_EXCLUDED, prediction_tickers
from app.services.predictor import LSTMPredictor
from app.services.commodity_today_service import predict_all_today, predict_today_one
from app.ml.commodity_today import predict_today_sklearn
from app.routes.prices import fetcher

router = APIRouter()

_predictor = LSTMPredictor(fetcher)


def _validate_prediction_ticker(ticker: str) -> str:
    ticker = ticker.upper()
    if ticker not in COMMODITIES:
        raise HTTPException(status_code=404, detail=f"Unknown ticker: {ticker}")
    if ticker in PREDICTION_EXCLUDED:
        raise HTTPException(
            status_code=400,
            detail=f"{COMMODITIES[ticker]['name']} ({ticker}) is not available for LSTM prediction.",
        )
    return ticker


@router.get("/models/status")
async def models_status():
    """List which tickers have trained models and their saved paths."""
    trained = []
    for t in prediction_tickers():
        mp, sp = _predictor.model_paths(t)
        if mp.exists() and sp.exists():
            trained.append({
                "ticker":     t,
                "name":       COMMODITIES[t]["name"],
                "model_file": mp.name,
                "scaler_ok":  sp.exists(),
                "size_kb":    round(mp.stat().st_size / 1024, 1),
            })
    return {
        "trained_count": len(trained),
        "total_commodities": len(prediction_tickers()),
        "models": trained,
    }


@router.get("/{ticker}/ready")
async def model_ready(ticker: str):
    ticker = _validate_prediction_ticker(ticker)
    return {"ticker": ticker, "model_ready": _predictor.has_trained_model(ticker)}


@router.get("/today")
async def predict_today_all(refresh: bool = Query(False, description="Bypass 45m cache")):
    """
    Today's predicted close for all commodities (INR display units).
    Uses saved LSTM when available; otherwise trains a lightweight technical model on the fly.
    """
    try:
        return await predict_all_today(fetcher, _predictor, use_cache=not refresh)
    except Exception as e:
        print(f"[Predictions] Error in predict_today_all: {e}")
        return {
            "ok": False,
            "date": str(date.today()),
            "predictions": [],
            "error": str(e),
            "source": "error_fallback",
        }


@router.get("/{ticker}/today")
async def predict_today_single(ticker: str):
    """Today's predicted close for one commodity."""
    try:
        ticker = _validate_prediction_ticker(ticker)
        result = await predict_today_one(ticker, fetcher, _predictor)
        if not result.get("ok"):
            return {
                "ok": False,
                "ticker": ticker,
                "error": result.get("error", "Prediction failed"),
            }
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Predictions] Error in predict_today_single ({ticker}): {e}")
        return {
            "ok": False,
            "ticker": ticker,
            "error": str(e),
        }


@router.get("/{ticker}")
async def predict(
    ticker: str,
    days: int = Query(7, ge=1, le=30, description="Forecast horizon (1–30 days)"),
):
    """Return LSTM forecast using a saved model (train once via POST /train)."""
    try:
        ticker = _validate_prediction_ticker(ticker)

        result = await _predictor.predict(ticker, forecast_days=days)

        if "error" in result:
            return {"error": result["error"], "ok": False}

        # Attach sklearn today forecast when LSTM missing or as cross-check for day 1
        if days >= 1:
            try:
                await fetcher.refresh_all_prices()
                hist = await fetcher.get_historical(ticker, period="1y", interval="1d")
                sk = predict_today_sklearn(ticker, hist, fetcher)
                if sk.get("ok"):
                    result["today_prediction"] = {
                        "date": sk["prediction_date"],
                        "price_display_inr": sk["predicted_price_display"],
                        "change_pct_display": sk["change_pct"],
                        "model": sk["model"],
                        "last_price_display_inr": sk["last_price_display"],
                    }
                    # Ensure the LSTM multi-day forecast's day-1 matches the near-spot today forecast
                    if result.get("forecast") and len(result["forecast"]) > 0:
                        try:
                            day0 = result["forecast"][0]
                            # Overwrite price fields with near-spot estimate when available
                            day0["price_display_inr"] = round(float(sk.get("predicted_price_display") or day0.get("price_display_inr")), 2)
                            day0["price_inr"] = round(float(sk.get("predicted_price_inr") or day0.get("price_inr", day0.get("price_inr"))), 2)
                            # Keep the estimate's reported percentage change (do NOT recompute vs last close)
                            est_chg = sk.get("change_pct")
                            if est_chg is not None:
                                day0["change_pct_display"] = round(float(est_chg), 2)
                                day0["change_pct"] = round(float(est_chg), 2)
                        except Exception:
                            pass
                elif result.get("forecast"):
                    result["today_prediction"] = result["forecast"][0]
            except Exception as e:
                print(f"[Predictions] Non-critical error enriching today_prediction: {e}")
                if result.get("forecast"):
                    result["today_prediction"] = result["forecast"][0]

        result["prediction_date"] = date.today().isoformat()
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Predictions] Error in predict ({ticker}): {e}")
        return {"error": str(e), "ok": False}


@router.post("/{ticker}/train")
async def train_model(ticker: str, background_tasks: BackgroundTasks):
    """
    Trigger background retraining of the LSTM model for a ticker.
    Returns immediately; training happens in background (~2-5 min per ticker).
    """
    ticker = _validate_prediction_ticker(ticker)

    # _predictor.train is an async coroutine — schedule it with create_task
    background_tasks.add_task(asyncio.create_task, _predictor.train(ticker))

    return {
        "message":  f"Training started for {COMMODITIES[ticker]['name']} ({ticker})",
        "ticker":   ticker,
        "status":   "training_in_progress",
        "note":     "Training takes 2–5 minutes. Fetch /api/predictions/models/status to check.",
    }


@router.post("/train-all")
async def train_all(background_tasks: BackgroundTasks):
    """Kick off background training for ALL commodities."""
    tickers = prediction_tickers()
    # batch_train_all is async — schedule as a background coroutine
    background_tasks.add_task(asyncio.create_task, _predictor.batch_train_all(tickers))
    return {
        "message": f"Batch training started for {len(tickers)} commodities",
        "tickers": tickers,
        "status":  "training_in_progress",
        "note":    "Full training can take 30–60 minutes on CPU.",
    }