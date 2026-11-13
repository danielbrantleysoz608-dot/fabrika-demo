"""SQLite-хранилище: игроки, сохранения, результаты забегов (+ задел под покупки)."""
import json
import time
from pathlib import Path

import aiosqlite

SCHEMA = """
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY,
    first_name  TEXT,
    username    TEXT,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saves (
    user_id     INTEGER PRIMARY KEY REFERENCES users(user_id),
    data        TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);
-- Итоги забегов: основа будущего рейтинга
CREATE TABLE IF NOT EXISTS results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(user_id),
    ending      TEXT NOT NULL,
    capital     INTEGER NOT NULL,
    seed        INTEGER,
    taps        INTEGER,
    months      INTEGER,
    boosted     INTEGER NOT NULL DEFAULT 0,  -- 1 = в забеге были платные ускорения (в рейтинг не идёт)
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_capital ON results(boosted, capital DESC);
-- Задел: покупки в «Ярмарке» за Telegram Stars (в v1 не используется)
CREATE TABLE IF NOT EXISTS purchases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(user_id),
    item        TEXT NOT NULL,
    stars       INTEGER NOT NULL,
    charge_id   TEXT UNIQUE,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_user_day ON purchases(user_id, created_at);
"""

MAX_SAVE_BYTES = 256 * 1024
ENDINGS = {"millionaire", "alive", "sold", "frozen"}


class DB:
    def __init__(self, path: Path):
        self.path = path
        self.conn: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = await aiosqlite.connect(self.path)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.executescript(SCHEMA)
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()

    async def touch_user(self, user: dict) -> None:
        now = int(time.time())
        await self.conn.execute(
            """INSERT INTO users(user_id, first_name, username, created_at, last_seen) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username, last_seen=excluded.last_seen""",
            (user["id"], user.get("first_name"), user.get("username"), now, now),
        )
        await self.conn.commit()

    async def get_save(self, user_id: int) -> dict | None:
        async with self.conn.execute("SELECT data FROM saves WHERE user_id=?", (user_id,)) as cur:
            row = await cur.fetchone()
        return json.loads(row["data"]) if row else None

    async def put_save(self, user_id: int, data: dict) -> None:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(raw.encode()) > MAX_SAVE_BYTES:
            raise ValueError("save too large")
        await self.conn.execute(
            """INSERT INTO saves(user_id, data, updated_at) VALUES(?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at""",
            (user_id, raw, int(time.time())),
        )
        await self.conn.commit()

    async def add_result(self, user_id: int, r: dict) -> None:
        if r.get("ending") not in ENDINGS:
            raise ValueError("bad ending")
        await self.conn.execute(
            "INSERT INTO results(user_id, ending, capital, seed, taps, months, created_at) VALUES(?,?,?,?,?,?,?)",
            (user_id, r["ending"], int(r.get("capital", 0)), int(r.get("seed", 0)), int(r.get("taps", 0)),
             int(r.get("months", 0)), int(time.time())),
        )
        await self.conn.commit()

    async def stats(self) -> dict:
        async with self.conn.execute(
            "SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM results) r, "
            "(SELECT COUNT(*) FROM results WHERE ending='millionaire') m"
        ) as cur:
            row = await cur.fetchone()
        return {"users": row["u"], "results": row["r"], "millionaires": row["m"]}
