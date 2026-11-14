"""Настройки из переменных окружения (.env)."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")


@dataclass(frozen=True)
class Config:
    bot_token: str
    webapp_url: str
    host: str
    port: int
    db_path: Path
    webapp_dir: Path
    init_data_ttl: int  # секунды
    dev_mode: bool  # разрешить запросы без Telegram (только для локального теста!)
    allow_anon: bool  # рейтинг по временному id без Telegram (заглушка, пока нет бота)


def load() -> Config:
    def path(name: str, default: str) -> Path:
        p = Path(os.getenv(name, default))
        return p if p.is_absolute() else (BASE / p).resolve()

    return Config(
        bot_token=os.getenv("BOT_TOKEN", ""),
        webapp_url=os.getenv("WEBAPP_URL", "").rstrip("/"),
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8080")),
        db_path=path("DB_PATH", "data/ferma.sqlite3"),
        webapp_dir=path("WEBAPP_DIR", "../webapp"),
        init_data_ttl=int(float(os.getenv("INIT_DATA_TTL_HOURS", "24")) * 3600),
        dev_mode=os.getenv("DEV_MODE", "0") == "1",
        allow_anon=os.getenv("ALLOW_ANON", "1") == "1",
    )
