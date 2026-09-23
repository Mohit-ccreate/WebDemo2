r"""
diagnose.py — Run from backend folder:
  cd C:\Users\ADMIN\Desktop\commodity-predictor-atharva\backend
  python diagnose.py
"""
import sys, os
sys.path.insert(0, '.')

print("=" * 50)
print("COMMODITYIQ DIAGNOSTIC")
print("=" * 50)

# Check files exist
print("\n[1] File check:")
files = {
    'app/routes/scraper.py':    'Scraper route',
    'app/routes/export.py':     'Export route',
    'app/services/scraper.py':  'Scraper service',
    'app/routes/__init__.py':   'Routes __init__',
    'app/services/__init__.py': 'Services __init__',
}
for path, label in files.items():
    exists = os.path.exists(path)
    size   = os.path.getsize(path) if exists else 0
    status = "OK" if (exists and size > 100) else ("EMPTY" if exists else "MISSING")
    print(f"  {status:8} {label:25} ({size} bytes) — {path}")

# Check imports
print("\n[2] Import check:")
tests = [
    ('beautifulsoup4',              'from bs4 import BeautifulSoup'),
    ('openpyxl',                    'import openpyxl'),
    ('scraper service',             'from app.services.scraper import scrape_all'),
    ('scraper route',               'from app.routes.scraper import router'),
    ('export route',                'from app.routes.export import router'),
]
for label, stmt in tests:
    try:
        exec(stmt)
        print(f"  OK       {label}")
    except Exception as e:
        print(f"  FAILED   {label}: {e}")

# Check registered routes
print("\n[3] Registered API routes:")
try:
    from app.main import app
    scraper_found = False
    export_found  = False
    for route in app.routes:
        p = getattr(route, 'path', '')
        if '/scraper' in p:
            scraper_found = True
            print(f"  FOUND  {p}")
        if '/export' in p:
            export_found  = True
            print(f"  FOUND  {p}")
    if not scraper_found:
        print("  MISSING  /api/scraper routes")
    if not export_found:
        print("  MISSING  /api/export routes")
except Exception as e:
    print(f"  ERROR loading app: {e}")

print("\n" + "=" * 50)
print("Paste this output to Claude for diagnosis.")
print("=" * 50)