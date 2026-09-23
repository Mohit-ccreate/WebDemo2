"""Sentiment API: FinBERT (when installed) or keyword fallback."""
from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ml.sentiment_model import (
    analyze_text,
    analyze_text_fast,
    finbert_status,
    is_finbert_loading,
)

router = APIRouter()


async def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


class SentimentBatchRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=64)


@router.post("/analyze")
async def sentiment_analyze(body: SentimentBatchRequest, fast: bool = False):
    """
    Analyze up to 32 text lines.
    ?fast=true skips FinBERT (instant keyword fallback) — use when FinBERT is not installed.
    """
    texts = [(t or "").strip() for t in body.texts[:32] if (t or "").strip()]
    if not texts:
        raise HTTPException(status_code=422, detail="No non-empty texts to analyze")

    analyze_fn = analyze_text_fast if fast else analyze_text
    results = []
    try:
        for text in texts:
            try:
                r = await _run_sync(analyze_fn, text)
            except Exception as per_text:
                r = analyze_text_fast(text)
                r["backend"] = f"fallback_after_error ({per_text!s})"
            results.append({"text": text[:500], **r})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sentiment error: {e!s}")

    backend_used = results[0].get("backend", "") if results else ""
    return {
        "results": results,
        "count": len(results),
        "model_hint": (
            "keyword_fallback (fast mode)"
            if fast or "keyword" in str(backend_used)
            else "ProsusAI/finbert when transformers+torch installed"
        ),
    }


@router.get("/health")
async def sentiment_health():
    status = finbert_status()
    if status.get("loading") or is_finbert_loading():
        return {
            "finbert": status,
            "sample": None,
            "note": "FinBERT is loading — weights load from backend/.cache/huggingface after first download",
        }
    r = await _run_sync(
        analyze_text,
        "Company beats earnings expectations with strong revenue growth.",
    )
    return {
        "sample": r,
        "finbert": status,
        "note": (
            "Restart API with backend\\.venv\\Scripts\\python.exe after: "
            "pip install -r requirements-ml.txt"
            if not status.get("available")
            else "FinBERT ready"
        ),
    }
