"""
unit_converter.py
Converts international commodity prices to familiar Indian units.

Gold:   $/oz  → ₹/gram, ₹/10g, ₹/oz
Silver: $/oz  → ₹/gram, ₹/kg
Crude:  $/bbl → ₹/litre, ₹/bbl
Gas:    $/MMBtu → ₹/MMBtu
Agri:   $/bushel → ₹/kg, ₹/quintal
"""

OZ_TO_G     = 31.1035          # 1 troy oz = 31.1035 grams
BBL_TO_L    = 158.987          # 1 barrel  = 158.987 litres
LB_TO_KG    = 0.453592         # 1 pound   = 0.453592 kg

# Bushel weights (kg per bushel)
BUSHEL_KG = {
    "ZW=F": 27.216,   # Wheat
    "ZC=F": 25.401,   # Corn
    "ZS=F": 27.216,   # Soybeans
    "ZO=F": 14.515,   # Oats
}

# Import duty + GST multipliers (approximate)
# Small uplift so dashboard aligns with India retail portals (Goodreturns / MCX-style).
INDIA_DISPLAY_FACTOR = {
    "GC=F": 1.042,   # ~₹1.58–1.60L / 10g
    "PL=F": 1.042,
}

# India retail uplift for silver ₹/kg (~2.85–2.90L vs ~2.55L spot+duty only)
SILVER_INDIA_RETAIL = 1.11

DUTY = {
    "metals":      1.09,    # Gold/Silver: 6% customs + 3% GST
    "base_metals": 1.03,    # Copper etc: ~3%
    "energy":      1.03,    # Crude etc
    "agricultural":1.05,    # ~5%
}

# Sanity bands for USD futures (reject bad Yahoo/API spikes)
USD_SANITY = {
    "GC=F": (2800, 5200),
    "SI=F": (18, 120),
    "PL=F": (800, 3500),
    "HG=F": (2, 15),
    "CL=F": (40, 200),
    "BZ=F": (40, 200),
}

def convert(ticker: str, price_usd: float, usd_inr: float) -> dict:
    """Return dict of price in various Indian units."""
    p    = price_usd * usd_inr   # base INR price
    out  = {}

    if ticker in ("GC=F", "PL=F"):   # Gold, Platinum ($/oz)
        duty      = DUTY["metals"]
        per_gram  = round(p / OZ_TO_G * duty, 2)
        per_10g   = round(per_gram * 10, 2)
        per_oz    = round(p * duty, 2)
        out = {
            "display_price": per_10g,
            "display_unit":  "per 10g",
            "display_label": f"₹{fmt_inr(per_10g)} /10g",
            "also":          f"₹{fmt_inr(per_gram)}/g · ₹{fmt_inr(per_oz)}/oz (intl)",
            "per_gram":      per_gram,
            "per_10g":       per_10g,
            "per_oz_inr":    per_oz,
        }

    elif ticker == "SI=F":   # Silver ($/oz)
        duty      = DUTY["metals"]
        per_gram  = round(p / OZ_TO_G * duty * SILVER_INDIA_RETAIL, 2)
        per_kg    = round(per_gram * 1000, 2)
        per_oz    = round(p * duty * SILVER_INDIA_RETAIL, 2)
        out = {
            "display_price": per_kg,
            "display_unit":  "per kg",
            "display_label": f"₹{fmt_inr(per_kg)} /kg",
            "also":          f"₹{fmt_inr(per_gram)}/g · ₹{fmt_inr(per_oz)}/oz (intl)",
            "per_gram":      per_gram,
            "per_kg":        per_kg,
            "per_oz_inr":    per_oz,
        }

    elif ticker == "HG=F":   # Copper ($/lb)
        duty     = DUTY["base_metals"]
        per_kg   = round(p / LB_TO_KG * duty, 2)
        per_lb   = round(p * duty, 2)
        out = {
            "display_price": per_kg,
            "display_unit":  "per kg",
            "display_label": f"₹{fmt_inr(per_kg)} /kg",
            "also":          f"₹{fmt_inr(per_lb)}/lb (intl)",
            "per_kg":        per_kg,
        }

    elif ticker in ("CL=F", "BZ=F"):   # Crude Oil ($/bbl)
        duty      = DUTY["energy"]
        per_litre = round(p / BBL_TO_L * duty, 2)
        per_bbl   = round(p * duty, 2)
        out = {
            "display_price": per_bbl,
            "display_unit":  "per bbl",
            "display_label": f"₹{fmt_inr(per_bbl)} /bbl",
            "also":          f"₹{per_litre:.1f}/litre (est.)",
            "per_litre":     per_litre,
            "per_bbl_inr":   per_bbl,
        }

    elif ticker in ("RB=F", "HO=F"):   # Gasoline/Heating Oil ($/gal)
        GAL_TO_L  = 3.78541
        duty      = DUTY["energy"]
        per_litre = round(p / GAL_TO_L * duty, 2)
        per_gal   = round(p * duty, 2)
        out = {
            "display_price": per_gal,
            "display_unit":  "per gal",
            "display_label": f"₹{fmt_inr(per_gal)} /gal",
            "also":          f"₹{per_litre:.1f}/litre (est.)",
            "per_litre":     per_litre,
        }

    elif ticker in BUSHEL_KG:   # Agricultural grains ($/bushel)
        duty       = DUTY["agricultural"]
        kg_per_bu  = BUSHEL_KG[ticker]
        per_bushel = round(p * duty, 2)
        per_kg     = round(p / kg_per_bu * duty, 2)
        per_quintal= round(per_kg * 100, 2)
        out = {
            "display_price": per_quintal,
            "display_unit":  "per quintal",
            "display_label": f"₹{fmt_inr(per_quintal)} /quintal",
            "also":          f"₹{fmt_inr(per_kg)}/kg · ₹{fmt_inr(per_bushel)}/bu (intl)",
            "per_kg":        per_kg,
            "per_quintal":   per_quintal,
            "per_bushel_inr":per_bushel,
        }

    elif ticker in ("KC=F", "SB=F", "CT=F", "LE=F", "HE=F"):  # $/lb commodities
        duty   = DUTY["agricultural"]
        per_kg = round(p / LB_TO_KG * duty, 2)
        per_lb = round(p * duty, 2)
        out = {
            "display_price": per_kg,
            "display_unit":  "per kg",
            "display_label": f"₹{fmt_inr(per_kg)} /kg",
            "also":          f"₹{fmt_inr(per_lb)}/lb (intl)",
            "per_kg":        per_kg,
        }

    elif ticker == "CC=F":   # Cocoa ($/MT)
        duty    = DUTY["agricultural"]
        per_kg  = round(p / 1000 * duty, 2)
        per_MT  = round(p * duty, 2)
        out = {
            "display_price": per_MT,
            "display_unit":  "per MT",
            "display_label": f"₹{fmt_inr(per_MT)} /MT",
            "also":          f"₹{fmt_inr(per_kg)}/kg",
            "per_kg":        per_kg,
        }

    elif ticker == "LB=F":   # Lumber ($/MBF)
        duty   = DUTY["agricultural"]
        per_mbf= round(p * duty, 2)
        out = {
            "display_price": per_mbf,
            "display_unit":  "per MBF",
            "display_label": f"₹{fmt_inr(per_mbf)} /MBF",
            "also":          "",
        }

    elif ticker == "NG=F":   # Natural Gas ($/MMBtu)
        duty      = DUTY["energy"]
        per_mmbtu = round(p * duty, 2)
        out = {
            "display_price": per_mmbtu,
            "display_unit":  "per MMBtu",
            "display_label": f"₹{fmt_inr(per_mmbtu)} /MMBtu",
            "also":          "",
        }

    else:
        out = {
            "display_price": round(p, 2),
            "display_unit":  "per unit",
            "display_label": f"₹{fmt_inr(round(p,2))}",
            "also":          "",
        }

    factor = INDIA_DISPLAY_FACTOR.get(ticker, 1.0)
    if factor != 1.0 and out.get("display_price"):
        dp = round(float(out["display_price"]) * factor, 2)
        out["display_price"] = dp
        unit = out.get("display_unit", "")
        out["display_label"] = f"₹{fmt_inr(dp)} {unit}".strip()

    return out


def fmt_inr(n: float) -> str:
    """Format number in Indian style: L for lakh, Cr for crore."""
    if n >= 1e7:  return f"{n/1e7:.2f}Cr"
    if n >= 1e5:  return f"{n/1e5:.2f}L"
    if n >= 1000: return f"{n:,.0f}"
    return f"{n:.2f}"