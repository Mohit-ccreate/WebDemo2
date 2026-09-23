# CommodityIQ — Question bank (viva / project evaluation)

Use this with `README.md` for exam preparation. Answers are concise; expand with live demo where possible.

---

## A. Project overview

**Q1. What problem does CommodityIQ solve?**  
It aggregates commodity and stock market data, displays live INR prices, applies ML for forecasting and sentiment, and provides technical analysis, backtesting, and alerts in one web app.

**Q2. Why a three-tier architecture (React + FastAPI + ML services)?**  
Separation of concerns: UI for interaction, API for business logic and caching, ML modules for heavy compute. Easier to scale, test, and let team members work in parallel.

**Q3. What is the difference between commodity prediction and stock ML pipeline?**  
Commodities use a **sequence LSTM** on 60-day multivariate windows. Stocks use **tabular** gradient boosting on engineered indicators with a next-day log-return target.

**Q4. Name the main technologies used.**  
React, Vite, Axios, FastAPI, Uvicorn, pandas, NumPy, TensorFlow, scikit-learn, transformers (FinBERT), yfinance, APScheduler, WebSockets.

---

## B. Architecture & APIs

**Q5. How does the frontend talk to the backend?**  
HTTP REST under `/api/*` (proxied from Vite `5173` → `8000`). Live prices also use WebSocket `ws://localhost:8000/ws/prices`.

**Q6. List your main REST route groups.**  
`/api/prices`, `/api/predictions`, `/api/stocks`, `/api/sentiment`, `/api/alerts`, `/api/export`, `/api/scraper`.

**Q7. Why use WebSocket for prices instead of only polling?**  
Pushes updates every ~30s after refresh without the client hammering the server; lower latency and smoother dashboard UX.

**Q8. What external data sources do you use for commodity prices?**  
Yahoo Finance (primary), gold-api.com and metals.live for metals, multiple FX APIs for USD/INR; optional omkar.cloud with API key.

**Q9. What happens if all price APIs fail for a commodity?**  
No fake fallback price—the item is marked unavailable so users are not misled.

---

## C. Machine learning — LSTM (commodities)

**Q10. What are the LSTM input features?**  
Seven per timestep: Close, Open, High, Low, Volume (INR-adjusted where applicable), daily return %, USD/INR rate.

**Q11. What is the lookback window and forecast horizon?**  
Lookback = 60 days; default forecast = 7 days ahead.

**Q12. Why MinMaxScaler before LSTM?**  
Neural nets train better when inputs are scaled; same scaler must be applied at inference on the latest window.

**Q13. Where are trained LSTM models stored?**  
`backend/app/models/trained/{ticker}_2d_disp.keras` and matching `.pkl` scaler.

**Q14. Why is training slow but prediction fast?**  
Training runs many epochs with early stopping; prediction loads saved weights and runs one forward pass on the latest window.

---

## D. Machine learning — Stocks pipeline

**Q15. What is `target_next_logret`?**  
\(\ln(C_{t+1}/C_t)\)—the next period's log return; more stationary and symmetric than raw prices for regression.

**Q16. Which model predicts stock next-day movement in the ML pipeline?**  
`HistGradientBoostingRegressor` (scikit-learn) on technical and return features.

**Q17. How do you convert predicted log return to price?**  
\(\hat{C}_{t+1} = C_t \times e^{\hat{r}}\).

**Q18. What is the fusion model?**  
`Ridge` regression that adds a **daily sentiment** feature (from news) to technical features to predict the same log-return target.

**Q19. Why not shuffle the train/test split for stocks?**  
Time series leakage: future data must not appear in training. We use chronological split (`shuffle=False`).

**Q20. What metrics do you report for regression?**  
RMSE on log returns and R² on the test slice.

**Q21. What technical indicators are engineered?**  
RSI(14), MACD(12,26,9), Bollinger Bands(20,2), SMA 20/50, rolling support/resistance, 1- and 5-day log returns, volume change.

---

## E. Sentiment analysis (FinBERT)

**Q22. What is FinBERT and why use it for finance text?**  
BERT fine-tuned on financial corpora (ProsusAI/finbert). Better than generic sentiment for earnings, guidance, and market headlines.

**Q23. What is keyword fallback?**  
Rule-based positive/negative word counts when FinBERT is disabled, `fast=true`, or transformers/torch are missing.

**Q24. Why did sentiment show `keyword_fallback` even after code fix?**  
Backend was started with system Python instead of `backend\.venv` where `transformers` and `torch` are installed.

**Q25. What does `POST /api/sentiment/analyze?fast=true` do?**  
Skips FinBERT for speed—used for bulk news headlines on the Stocks tab.

**Q26. Can FinBERT label positive news as negative?**  
Yes—models can mispredict short or ambiguous headlines; always show `backend` label so users know which engine ran.

---

## F. Technical analysis & backtesting

**Q27. Define RSI and its typical interpretation.**  
0–100 oscillator; &lt;30 often oversold, &gt;70 overbought (mean-reversion strategies use these thresholds).

**Q28. What strategies does your backtest support?**  
`buy_hold` and `rsi_mean_reversion` (enter/exit based on RSI thresholds).

**Q29. What is max drawdown?**  
Largest peak-to-trough decline in equity curve, expressed as a percentage.

**Q30. What is the Sharpe ratio (your approximation)?**  
Risk-adjusted return: mean daily return over std dev, annualized with \(\sqrt{252}\).

**Q31. What is Sortino vs Sharpe?**  
Sortino penalizes only **downside** volatility, not upside variation.

---

## G. Data preprocessing

**Q32. What does `preprocess_ohlcv` do?**  
Sort by date, forward-fill small gaps, drop invalid/zero close prices.

**Q33. Why drop rows with NaN targets in `preprocess_features`?**  
Supervised learning needs known labels; rows without `target_*` cannot train or evaluate.

**Q34. Why was `dropna(errors="ignore")` a bug?**  
pandas `DataFrame.dropna()` has no `errors` parameter—that belongs to functions like `pd.to_numeric()`.

---

## H. Implementation & DevOps

**Q35. How do you run the project on Windows?**  
`run.bat` or manually: venv Python + uvicorn on 8000, `npm run dev` in frontend on 5173.

**Q36. What is in `requirements-ml.txt`?**  
`transformers`, `torch`, `safetensors` for FinBERT.

**Q37. What is in `_project_archive/`?**  
Old one-off fix/setup scripts not needed for production run.

**Q38. How is CORS configured?**  
FastAPI `CORSMiddleware` allows `localhost:5173` and `3000` for development.

---

## I. Limitations & ethics

**Q39. Is this system suitable for real trading?**  
No—educational prototype; data delays, model risk, and no brokerage execution or risk controls.

**Q40. What are main limitations of your LSTM?**  
Needs sufficient history, assumes patterns repeat, sensitive to regime changes and black-swan events.

**Q41. What are limitations of FinBERT on headlines?**  
Short text, sarcasm, and entity-specific context can reduce accuracy; English-centric training.

**Q42. How would you improve the project in production?**  
Model monitoring, Redis cache, auth, HTTPS, GPU inference, walk-forward validation, and compliance review.

---

## J. Team & contribution (sample answers)

**Q43. How did you divide work among five members?**  
Equal ~20% slices: ML/AI (Atharva), backend platform, frontend UX, stocks/quant module, alerts/export/auxiliary features—see README table.

**Q44. What was the most critical component?**  
End-to-end ML stack (LSTM + stock pipeline + FinBERT)—without it the project is only a price dashboard.

**Q45. Demonstrate the ML pipeline for AAPL.**  
Stocks & TA → enter AAPL → ML pipeline → show preprocessing counts, feature columns, RMSE/R², fusion block.

---

## K. Quick numerical / formula checks

**Q46. If close = 100 and predicted log return = 0.02, estimated next close?**  
\(100 \times e^{0.02} \approx 102.02\).

**Q47. If RSI = 25, what might a mean-reversion strategy do?**  
Consider oversold → buy signal (per strategy rules in `backtest.py`).

**Q48. What does R² = 0.15 imply?**  
Model explains 15% of variance in test log returns—weak but not uncommon for daily financial data.

---

## L. Troubleshooting (demo day)

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Sentiment always `keyword_fallback` | Wrong Python / missing ML deps | `pip install -r requirements-ml.txt`; restart with `.venv\Scripts\python.exe` |
| ML pipeline `dropna errors` | Old preprocess bug | Pull latest `preprocess.py` |
| LSTM "no saved model" | Never trained ticker | Train once on Predictions tab |
| Empty commodity prices | API rate limit / network | Retry; check `/health` `using_fallback` |
| Frontend cannot reach API | Backend down or wrong port | Start uvicorn on 8000 |

---

*End of question bank — align answers with your live codebase and demo script.*
