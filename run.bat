@echo off
echo Starting Commodity Market Intelligence...

:: Start backend (use project venv so FinBERT/transformers are available)
:: HF cache lives in backend\.cache\huggingface — survives restarts after first download
start "Backend" cmd /k "cd backend && set HF_HOME=%CD%\.cache\huggingface&& set HF_HUB_CACHE=%CD%\.cache\huggingface\hub&& .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"

:: Wait 3 seconds then start frontend
timeout /t 3

:: Start frontend
start "Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Backend : http://localhost:8000
echo Frontend: http://localhost:5173
echo API Docs: http://localhost:8000/docs