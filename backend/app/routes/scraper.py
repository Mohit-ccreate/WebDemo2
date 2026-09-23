from fastapi import APIRouter
from app.services.scraper import scrape_all
import asyncio

router = APIRouter()

# Use the shared fetcher from main app (has live prices in cache)
def get_shared_fetcher():
    try:
        from app.main import fetcher
        return fetcher
    except Exception:
        try:
            from app.services.data_fetcher import DataFetcher
            return DataFetcher()
        except Exception:
            return None

@router.get("/all")
async def get_all():
    f       = get_shared_fetcher()
    cached  = f.get_cached() if f else {}
    usd_inr = f._usd_inr    if f else 84.5
    loop    = asyncio.get_event_loop()
    result  = await loop.run_in_executor(
        None, lambda: scrape_all(cached, usd_inr)
    )
    return result

@router.get("/gold")
async def get_gold():
    r = await get_all()
    return r.get("indian_prices", {}).get("gold", {})

@router.get("/silver")
async def get_silver():
    r = await get_all()
    return r.get("indian_prices", {}).get("silver", {})

@router.get("/mcx")
async def get_mcx():
    r = await get_all()
    return r.get("mcx_estimates", {})
