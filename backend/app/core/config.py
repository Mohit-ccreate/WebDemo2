"""core/config.py — App settings loaded from .env"""
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str       = "Commodity Market Intelligence"
    debug: bool         = False
    redis_url: str      = "redis://localhost:6379"
    price_refresh_sec: int = 10        # WebSocket broadcast interval
    default_currency: str = "INR"

    class Config:
        env_file = ".env"

settings = Settings()