"""
scraper.py v4
Uses metalpriceapi.com free tier (no key needed for basic prices)
and frankfurter/er-api for currency conversion.
Falls back to Yahoo Finance prices from our own cache.
"""
import requests
from datetime import datetime
from typing import Dict

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
})

OZ_TO_G    = 31.1035
DUTY_GOLD  = 1.09
DUTY_SILVER= 1.09
DUTY_BASE  = 1.03


def get_metal_prices_free() -> Dict:
    """
    Try multiple free metal price sources.
    Returns dict with gold/silver prices in USD per troy oz.
    """
    # Source 1: frankfurter-based metals (XAU/XAG are currencies)
    try:
        r = SESSION.get(
            "https://api.frankfurter.app/latest?from=XAU&to=USD",
            timeout=6
        )
        if r.status_code == 200:
            usd_per_oz_gold = 1 / r.json()["rates"]["USD"]
            result = {"gold": round(usd_per_oz_gold, 2)}
            # Get silver too
            r2 = SESSION.get(
                "https://api.frankfurter.app/latest?from=XAG&to=USD",
                timeout=6
            )
            if r2.status_code == 200:
                result["silver"] = round(1 / r2.json()["rates"]["USD"], 2)
            print(f"[Scraper] frankfurter: gold=${result.get('gold')}")
            return result
    except Exception as e:
        print(f"[Scraper] frankfurter metals failed: {e}")

    # Source 3: open.er-api.com (treats XAU/XAG as currencies)
    try:
        r = SESSION.get(
            "https://open.er-api.com/v6/latest/USD",
            timeout=6
        )
        if r.status_code == 200:
            rates = r.json().get("rates", {})
            xau = rates.get("XAU")  # XAU = oz of gold per 1 USD
            xag = rates.get("XAG")  # XAG = oz of silver per 1 USD
            result = {}
            if xau and xau > 0:
                result["gold"]   = round(1 / xau, 2)
            if xag and xag > 0:
                result["silver"] = round(1 / xag, 2)
            if result.get("gold"):
                print(f"[Scraper] open.er-api: gold=${result.get('gold')}")
                return result
    except Exception as e:
        print(f"[Scraper] open.er-api metals failed: {e}")

    return {}


def get_usd_inr() -> float:
    for url, extractor in [
        ("https://open.er-api.com/v6/latest/USD",
         lambda d: d["rates"]["INR"]),
        ("https://api.frankfurter.app/latest?from=USD&to=INR",
         lambda d: d["rates"]["INR"]),
    ]:
        try:
            r = SESSION.get(url, timeout=6)
            v = float(extractor(r.json()))
            if 80 < v < 110:
                return v
        except Exception:
            pass
    return 84.5


def calc_indian(metals: Dict, usd_inr: float) -> Dict:
    result = {}
    r      = usd_inr
    gold   = metals.get("gold",      0)
    silver = metals.get("silver",    0)
    plat   = metals.get("platinum",  0)

    if gold:
        g = round(gold * r / OZ_TO_G * DUTY_GOLD, 2)
        result["gold"] = {
            "24k_per_gram": g,
            "24k_per_10g":  round(g * 10, 2),
            "22k_per_gram": round(g * 0.9167, 2),
            "22k_per_10g":  round(g * 10 * 0.9167, 2),
            "18k_per_gram": round(g * 0.75, 2),
            "18k_per_10g":  round(g * 10 * 0.75, 2),
            "intl_usd_oz":  gold,
            "change_pct":   metals.get("gold_change", 0),
            "source":       f"${gold:.2f}/oz x INR{r:.2f} / 31.1g x 1.09",
        }
    if silver:
        s = round(silver * r / OZ_TO_G * DUTY_SILVER, 2)
        result["silver"] = {
            "per_gram":    s,
            "per_10g":     round(s * 10, 2),
            "per_100g":    round(s * 100, 2),
            "per_kg":      round(s * 1000, 2),
            "intl_usd_oz": silver,
            "change_pct":  metals.get("silver_change", 0),
            "source":      f"${silver:.2f}/oz x INR{r:.2f} / 31.1g x 1.09",
        }
    if plat:
        result["platinum"] = {
            "per_gram":    round(plat * r / OZ_TO_G * DUTY_GOLD, 2),
            "per_10g":     round(plat * r / OZ_TO_G * 10 * DUTY_GOLD, 2),
            "intl_usd_oz": plat,
        }
    return result


def _metals_from_cache(cached_prices: Dict, usd_inr: float) -> Dict:
    """Use the same USD spot as the live price feed (gold-api / Yahoo)."""
    metals = {}
    if not cached_prices:
        return metals
    for yahoo, key in [("GC=F", "gold"), ("SI=F", "silver"), ("PL=F", "platinum")]:
        p = cached_prices.get(yahoo, {})
        usd = p.get("price_usd")
        if usd and float(usd) > 0:
            metals[key] = float(usd)
            metals[f"{key}_change"] = p.get("change_pct", 0)
    return metals


def scrape_all(cached_prices: Dict = None, usd_inr: float = None) -> Dict:
    if not usd_inr:
        usd_inr = get_usd_inr()

    metals = _metals_from_cache(cached_prices or {}, usd_inr)
    if not metals.get("gold"):
        print("[Scraper] No cached metals — trying frankfurter/er-api fallback")
        metals = get_metal_prices_free()

    indian = calc_indian(metals, usd_inr)

    # MCX estimates
    mcx = {}
    if indian.get("gold"):
        g = indian["gold"]
        mcx["GOLD"]      = {"price": g["24k_per_10g"],  "unit": "per 10g",  "change_pct": g["change_pct"]}
        mcx["GOLDM"]     = {"price": g["24k_per_gram"], "unit": "per 1g",   "change_pct": g["change_pct"]}
        mcx["GOLDPETAL"] = {"price": g["24k_per_gram"], "unit": "per 1g",   "change_pct": g["change_pct"]}
    if indian.get("silver"):
        s = indian["silver"]
        mcx["SILVER"]    = {"price": s["per_kg"],       "unit": "per kg",   "change_pct": s["change_pct"]}
        mcx["SILVERM"]   = {"price": s["per_kg"],       "unit": "per kg",   "change_pct": s["change_pct"]}
    if cached_prices:
        for ticker, sym, factor, unit in [
            ("HG=F", "COPPER", 1 / 0.453592 * DUTY_BASE, "per kg"),
            ("CL=F", "CRUDEOIL", DUTY_BASE, "per bbl"),
            ("BZ=F", "CRUDEOILM", DUTY_BASE, "per bbl"),
        ]:
            p = cached_prices.get(ticker, {})
            if p.get("price_usd"):
                mcx[sym] = {
                    "price":      round(p["price_usd"] * usd_inr * factor, 0),
                    "unit":       unit,
                    "change_pct": p.get("change_pct", 0),
                }

    return {
        "usd_inr":       round(usd_inr, 4),
        "metals_intl":   {k: {"price_usd": v, "change_pct": metals.get(k+"_change",0)}
                          for k, v in metals.items() if not k.endswith("_change")},
        "indian_prices": indian,
        "mcx_estimates": mcx,
        "data_quality":  "live"        if metals.get("gold") else "fallback",
        "data_source":   "metals.live / frankfurter / open.er-api",
        "note":          "Prices include ~9% import duty+GST for precious metals.",
        "timestamp":     datetime.utcnow().isoformat(),
    }