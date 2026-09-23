"""
Financial sentiment: ProsusAI FinBERT when transformers/torch available,
else keyword-based fallback (clearly labeled).

Weights are cached under backend/.cache/huggingface so they survive restarts.
The pipeline is preloaded at API startup (see main.py lifespan).
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List

_POS = re.compile(
    r"\b(beat|surge|rally|gain|upgrade|bull|growth|profit|strong|high|record|positive|soar)\b",
    re.I,
)
_NEG = re.compile(
    r"\b(miss|crash|plunge|fall|cut|downgrade|bear|loss|weak|low|lawsuit|fraud|negative|slump)\b",
    re.I,
)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_CACHE_ROOT = _BACKEND_ROOT / ".cache" / "huggingface"
_CACHE_MARKER = _CACHE_ROOT / ".finbert_downloaded"

_PIPELINE = None
_LOAD_ERROR: str | None = None
_LOADING = False
_LOAD_LOCK = threading.Lock()
_MODEL_NAME = "ProsusAI/finbert"


def _configure_hf_cache() -> None:
    """Pin Hugging Face cache inside the project (persists across app restarts)."""
    _CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    hub = str(_CACHE_ROOT / "hub")
    os.environ.setdefault("HF_HOME", str(_CACHE_ROOT))
    os.environ.setdefault("HF_HUB_CACHE", hub)


_configure_hf_cache()


def _keyword_sentiment(text: str) -> Dict[str, Any]:
    t = (text or "")[:2000]
    p, n = len(_POS.findall(t)), len(_NEG.findall(t))
    score = (p - n) / (p + n + 3)
    score = max(-1.0, min(1.0, score * 2))
    label = "positive" if score > 0.15 else "negative" if score < -0.15 else "neutral"
    return {"label": label, "score": round(score, 4), "backend": "keyword_fallback"}


def _is_permanent_load_failure(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if "no module named" in msg:
        return True
    if "disable_finbert" in msg:
        return True
    if "keras" in msg and "not yet supported" in msg:
        return True
    return False


def _load_finbert_pipeline():
    global _PIPELINE, _LOAD_ERROR, _LOADING
    if _PIPELINE is not None and _PIPELINE is not False:
        return _PIPELINE
    if _PIPELINE is False:
        return None

    disable = os.environ.get("DISABLE_FINBERT", "").lower() in ("1", "true", "yes")
    if disable:
        _LOAD_ERROR = "DISABLE_FINBERT is set"
        _PIPELINE = False  # type: ignore[assignment]
        return None

    with _LOAD_LOCK:
        if _PIPELINE is not None:
            return _PIPELINE if _PIPELINE is not False else None

        _LOADING = True
        try:
            from transformers import pipeline  # type: ignore

            cached = _CACHE_MARKER.exists()
            print(
                f"[FinBERT] Loading {_MODEL_NAME}"
                f" ({'from project cache' if cached else 'download if needed'})…"
            )
            _PIPELINE = pipeline(
                "sentiment-analysis",
                model=_MODEL_NAME,
                tokenizer=_MODEL_NAME,
                device=-1,
            )
            _LOAD_ERROR = None
            _CACHE_MARKER.parent.mkdir(parents=True, exist_ok=True)
            _CACHE_MARKER.touch()
            print("[FinBERT] Ready")
        except Exception as exc:
            if _is_permanent_load_failure(exc):
                _PIPELINE = False  # type: ignore[assignment]
            else:
                _PIPELINE = None
            _LOAD_ERROR = str(exc)
            hint = ""
            if "keras" in str(exc).lower():
                hint = " — run: backend\\.venv\\Scripts\\python.exe -m pip install tf-keras"
            print(f"[FinBERT] Load failed: {exc}{hint}")
        finally:
            _LOADING = False

    return _PIPELINE if _PIPELINE and _PIPELINE is not False else None


def preload_finbert() -> None:
    """Load FinBERT into memory (call once at API startup)."""
    _load_finbert_pipeline()


def is_finbert_loading() -> bool:
    return _LOADING


def finbert_status() -> Dict[str, Any]:
    """Whether FinBERT is loaded; error message when unavailable."""
    if _LOADING:
        return {
            "available": False,
            "loading": True,
            "model": _MODEL_NAME,
            "backend": "finbert",
            "cache_dir": str(_CACHE_ROOT),
        }
    pipe = _PIPELINE if _PIPELINE is not None else _load_finbert_pipeline()
    if pipe and pipe is not False:
        return {
            "available": True,
            "loading": False,
            "model": _MODEL_NAME,
            "backend": "finbert",
            "cache_dir": str(_CACHE_ROOT),
            "cached_on_disk": _CACHE_MARKER.exists(),
        }
    return {
        "available": False,
        "loading": False,
        "model": _MODEL_NAME,
        "backend": "keyword_fallback",
        "error": _LOAD_ERROR or "transformers/torch not installed in this Python environment",
        "cache_dir": str(_CACHE_ROOT),
        "cached_on_disk": _CACHE_MARKER.exists(),
    }


def _finbert_label_to_score(result: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not result:
        return {"label": "neutral", "score": 0.0, "backend": "finbert"}
    r0 = result[0]
    lab = str(r0.get("label", "neutral")).lower()
    s = float(r0.get("score", 0.5))
    if "pos" in lab or lab in ("label_1", "bullish"):
        score = s
    elif "neg" in lab or lab in ("label_0", "bearish"):
        score = -s
    else:
        score = 0.0
    if lab not in ("positive", "negative", "neutral"):
        lab = "positive" if score > 0.15 else "negative" if score < -0.15 else "neutral"
    return {"label": lab, "score": round(score, 4), "backend": "finbert", "raw": r0}


def analyze_text(text: str, *, use_finbert: bool = True) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {"label": "neutral", "score": 0.0, "backend": "empty"}

    if not use_finbert:
        return _keyword_sentiment(text)

    pipe = _load_finbert_pipeline()
    if pipe and pipe is not False:
        try:
            chunk = text[:2000]
            out = pipe(chunk[:512] if len(chunk) > 512 else chunk)
            return _finbert_label_to_score(out if isinstance(out, list) else [out])
        except Exception:
            pass
    return _keyword_sentiment(text)


def analyze_text_fast(text: str) -> Dict[str, Any]:
    """Keyword sentiment for bulk news (avoids FinBERT timeouts on headline loads)."""
    return analyze_text(text, use_finbert=False)


def analyze_batch(texts: List[str]) -> List[Dict[str, Any]]:
    return [analyze_text(t) for t in texts]
