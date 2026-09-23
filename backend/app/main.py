import asyncio
import json
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.routes import prices, predictions, alerts, scraper, export, stocks, sentiment
from app.routes.prices import fetcher
from app.core.websocket_manager import ConnectionManager
from app.ml.sentiment_model import preload_finbert
from app.services.prediction_store import init_db

manager = ConnectionManager()
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[App] Starting up — Python {sys.executable}")
    print("[App] Fetching initial prices...")
    init_db()
    await fetcher.refresh_all_prices()

    # Preload FinBERT in background so Sentiment tab is ready without cold-start delay
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, preload_finbert)

    # 30s interval — gives each full fetch cycle time to finish
    scheduler.add_job(
        broadcast_prices,
        "interval",
        seconds=30,
        id="price_broadcast",
        max_instances=1,        # never pile up
        coalesce=True,
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="CommodityIQ API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prices.router,      prefix="/api/prices",      tags=["prices"])
app.include_router(predictions.router, prefix="/api/predictions", tags=["predictions"])
app.include_router(alerts.router,      prefix="/api/alerts",      tags=["alerts"])
app.include_router(scraper.router,     prefix="/api/scraper",     tags=["scraper"])
app.include_router(export.router,      prefix="/api/export",      tags=["export"])
app.include_router(stocks.router,     prefix="/api/stocks",      tags=["stocks"])
app.include_router(sentiment.router,  prefix="/api/sentiment",   tags=["sentiment"])


@app.websocket("/ws/prices")
async def websocket_prices(websocket: WebSocket):
    await manager.connect(websocket)
    # Send current cached data immediately on connect
    cached = fetcher.get_cached()
    if cached:
        await websocket.send_text(
            json.dumps({"type": "price_update", "data": list(cached.values())})
        )
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_prices():
    data = await fetcher.refresh_all_prices()
    if data and manager.active_connections:
        await manager.broadcast(
            json.dumps({"type": "price_update", "data": list(data.values())})
        )


@app.get("/health")
async def health():
    cached = fetcher.get_cached()
    return {
        "status": "ok",
        "currency": "INR",
        "commodities_loaded": len(cached),
        "usd_inr": fetcher._usd_inr,
        "using_fallback": fetcher._using_fallback,
    }