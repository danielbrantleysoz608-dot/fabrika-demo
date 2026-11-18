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
    admin_id: int = 0  # Telegram id владельца: сообщения об итогах недели и подарках
    channel_url: str = "https://t.me/predstav_kanal"
    test_prices: bool = False  # все покупки по 1 ⭐ — для проверки оплаты перед запуском


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
        admin_id=int(os.getenv("ADMIN_ID", "0") or 0),
        channel_url=os.getenv("CHANNEL_URL", "https://t.me/predstav_kanal"),
        test_prices=os.getenv("TEST_PRICES", "0") == "1",
    )
