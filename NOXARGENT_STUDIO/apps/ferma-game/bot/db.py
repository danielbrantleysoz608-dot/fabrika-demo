"""SQLite-хранилище: игроки, сохранения, результаты забегов (+ задел под покупки)."""
import json
import time
from datetime import datetime, timedelta, timezone
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

-- Рейтинг. player_key: "tg:<telegram id>" или "anon:<временный id>" (заглушка без бота).
-- capital — текущий капитал фермы (деньги + постройки − долг), включая купленные за звёзды деньги.
CREATE TABLE IF NOT EXISTS players (
    player_key  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
    player_key  TEXT PRIMARY KEY REFERENCES players(player_key),
    capital     INTEGER NOT NULL,
    tier        INTEGER NOT NULL DEFAULT 0,
    year        INTEGER NOT NULL DEFAULT 1,
    paid_coins  INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_capital ON scores(capital DESC);
-- «За неделю»: прирост капитала с начала недели (неделя — ISO, по Москве)
CREATE TABLE IF NOT EXISTS weekly (
    player_key    TEXT NOT NULL REFERENCES players(player_key),
    week          TEXT NOT NULL,
    start_capital INTEGER NOT NULL,
    capital       INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (player_key, week)
);
CREATE INDEX IF NOT EXISTS weekly_gain ON weekly(week, capital);
"""

MAX_SAVE_BYTES = 256 * 1024
MAX_CAPITAL = 10**18
MSK = timezone(timedelta(hours=3))


def current_week(now: float | None = None) -> str:
    d = datetime.fromtimestamp(now or time.time(), MSK).isocalendar()
    return f"{d.year}-W{d.week:02d}"
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

    # ---------- Рейтинг ----------
    async def paid_coins(self, player_key: str) -> int:
        """Монеты, купленные за Stars (из purchases). Пока покупок нет — 0."""
        if not player_key.startswith("tg:"):
            return 0
        async with self.conn.execute(
            "SELECT COALESCE(SUM(stars), 0) s FROM purchases WHERE user_id=? AND item LIKE 'coins%'",
            (int(player_key[3:]),),
        ) as cur:
            return int((await cur.fetchone())["s"])

    async def link_anon(self, anon_key: str, tg_key: str) -> None:
        """Игрок открыл игру из Telegram: переносим временную запись на Telegram id (если своей ещё нет)."""
        async with self.conn.execute("SELECT 1 FROM scores WHERE player_key=?", (tg_key,)) as cur:
            if await cur.fetchone():
                return
        for table in ("scores", "weekly"):
            await self.conn.execute(f"UPDATE OR IGNORE {table} SET player_key=? WHERE player_key=?", (tg_key, anon_key))
        await self.conn.commit()

    async def submit_score(self, player_key: str, name: str, capital: int, paid: int, tier: int, year: int,
                           now: float | None = None) -> int:
        """Сохраняет текущий капитал фермы для рейтинга."""
        now = int(now or time.time())
        paid = int(paid or 0)
        rating = max(0, min(int(capital), MAX_CAPITAL))  # купленные за звёзды деньги идут в рейтинг как обычные
        default = "Фермер " + player_key[-4:]
        await self.conn.execute(
            """INSERT INTO players(player_key, name, created_at, last_seen) VALUES(?,?,?,?)
               ON CONFLICT(player_key) DO UPDATE SET
                 name=CASE WHEN ? != '' THEN excluded.name ELSE players.name END, last_seen=excluded.last_seen""",
            (player_key, (name or default)[:32], now, now, name or ""))
        await self.conn.execute(
            """INSERT INTO scores(player_key, capital, tier, year, paid_coins, updated_at) VALUES(?,?,?,?,?,?)
               ON CONFLICT(player_key) DO UPDATE SET
                 capital=excluded.capital, tier=MAX(scores.tier, excluded.tier),
                 year=MAX(scores.year, excluded.year), paid_coins=excluded.paid_coins, updated_at=excluded.updated_at""",
            (player_key, rating, int(tier), int(year), paid, now))
        week = current_week(now)
        await self.conn.execute(
            """INSERT INTO weekly(player_key, week, start_capital, capital, updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(player_key, week) DO UPDATE SET capital=excluded.capital, updated_at=excluded.updated_at""",
            (player_key, week, rating, rating, now))
        await self.conn.commit()
        return rating

    async def clear_rating(self) -> int:
        """Очистить рейтинг перед запуском (тестовые игроки). Сохранения игр не трогает."""
        async with self.conn.execute("SELECT COUNT(*) c FROM players") as cur:
            n = (await cur.fetchone())["c"]
        for t in ("weekly", "scores", "players"):
            await self.conn.execute(f"DELETE FROM {t}")
        await self.conn.commit()
        return n

    async def leaderboard(self, period: str, player_key: str | None, limit: int = 100, now: float | None = None,
                          my_value: int = 0) -> dict:
        if period == "week":
            week = current_week(now)
            base = """SELECT w.player_key, p.name, (w.capital - w.start_capital) AS value, s.tier, s.year
                      FROM weekly w JOIN players p USING(player_key) LEFT JOIN scores s USING(player_key)
                      WHERE w.week = ? AND w.capital > w.start_capital"""
            args: tuple = (week,)
        else:
            base = """SELECT s.player_key, p.name, s.capital AS value, s.tier, s.year
                      FROM scores s JOIN players p USING(player_key) WHERE 1=1"""
            args = ()
        async with self.conn.execute(f"{base} ORDER BY value DESC, player_key LIMIT ?", (*args, limit)) as cur:
            rows = await cur.fetchall()
        top = [{"rank": i + 1, "name": r["name"], "value": r["value"], "tier": r["tier"] or 0, "year": r["year"] or 1,
                "me": r["player_key"] == player_key, "key": r["player_key"]} for i, r in enumerate(rows)]
        me = None
        if player_key:
            async with self.conn.execute(f"SELECT * FROM ({base}) WHERE player_key = ?", (*args, player_key)) as cur:
                mine = await cur.fetchone()
            if mine:
                async with self.conn.execute(f"SELECT COUNT(*) c FROM ({base}) WHERE value > ?", (*args, mine["value"])) as cur:
                    rank = (await cur.fetchone())["c"] + 1
                me = {"rank": rank, "name": mine["name"], "value": mine["value"], "tier": mine["tier"] or 0, "year": mine["year"] or 1}
            else:
                # игрока ещё нет в таблице (не прислал результат / за неделю пока без прироста) —
                # всё равно показываем место: сколько игроков впереди при его текущем значении
                value = max(0, int(my_value))
                async with self.conn.execute(f"SELECT COUNT(*) c FROM ({base}) WHERE value > ?", (*args, value)) as cur:
                    rank = (await cur.fetchone())["c"] + 1
                async with self.conn.execute("SELECT name FROM players WHERE player_key = ?", (player_key,)) as cur:
                    row = await cur.fetchone()
                me = {"rank": rank, "name": row["name"] if row else None, "value": value, "tier": 0, "year": 1}
        async with self.conn.execute(f"SELECT COUNT(*) c FROM ({base})", args) as cur:
            total = (await cur.fetchone())["c"]
        return {"period": period, "top": top, "me": me, "total": total}
