"""Магазин за Telegram Stars и призы «Фермер недели».

Оплата: игра просит у сервера ссылку на счёт (POST /api/shop/invoice) → сервер создаёт createInvoiceLink
(валюта XTR) и запоминает счёт → Telegram присылает боту pre_checkout_query (проверяем счёт) и
successful_payment (записываем покупку по telegram_payment_charge_id — один раз, дубли игнорируются) →
игра забирает невыданные покупки (GET /api/shop/pending), применяет их, сохраняет и подтверждает
(POST /api/shop/ack). Если игра была закрыта — покупка выдаётся при следующем входе.

Купленные деньги идут в капитал и рейтинг как обычные.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import LabeledPrice, Message, PreCheckoutQuery
from aiohttp import web

from db import MSK, current_week

log = logging.getLogger("ferma.shop")

# Товары: цена в ⭐. kind: money — деньги фермы (минуты дохода, не меньше min), остальное — эффект в игре.
ITEMS: dict[str, dict] = {
    "skip":    {"stars": 15,  "title": "Ускорить месяц",            "desc": "Месяц сразу заканчивается — можно жать «Следующий месяц»."},
    "cast":    {"stars": 10,  "title": "Ещё один заброс удочки",    "desc": "Рыбалка без ожидания — закинуть удочку прямо сейчас."},
    "helper7": {"stars": 50,  "title": "Помощник Ваня на 7 дней",   "desc": "Ваня сам собирает урожай 7 дней — без найма и без зарплаты."},
    "samovar": {"stars": 75,  "title": "Дедов самовар",             "desc": "Украшение фермы, только за звёзды: +3% ко всему доходу навсегда."},
    "patron":  {"stars": 100, "title": "Поддержать автора",         "desc": "Значок «Меценат» у ника в рейтинге и открытка. Спасибо!"},
    "bag":     {"stars": 25,  "title": "Мешочек",       "kind": "money", "minutes": 30,  "min": 10_000},
    "wallet":  {"stars": 75,  "title": "Кошелёк деда",  "kind": "money", "minutes": 180, "min": 50_000},
    "chest":   {"stars": 150, "title": "Сундук",        "kind": "money", "minutes": 720, "min": 150_000},
}
MAX_MONEY = 10**16          # защита от явно испорченной суммы
INVOICE_TTL = 24 * 3600     # счёт действует сутки

SCHEMA = """
CREATE TABLE IF NOT EXISTS invoices (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    item        TEXT NOT NULL,
    stars       INTEGER NOT NULL,
    amount      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    charge_id    TEXT PRIMARY KEY,           -- telegram_payment_charge_id: одна оплата = одна выдача
    invoice_id   TEXT,
    user_id      INTEGER NOT NULL,
    item         TEXT NOT NULL,
    stars        INTEGER NOT NULL,
    amount       INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    delivered_at INTEGER,                    -- игра подтвердила, что применила покупку
    refunded_at  INTEGER
);
CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, delivered_at);
CREATE TABLE IF NOT EXISTS badges (
    player_key TEXT NOT NULL,
    badge      TEXT NOT NULL,                -- patron | silver | bronze
    until      INTEGER NOT NULL DEFAULT 0,   -- 0 = навсегда
    PRIMARY KEY (player_key, badge)
);
CREATE TABLE IF NOT EXISTS week_results (
    week       TEXT NOT NULL,
    rank       INTEGER NOT NULL,
    player_key TEXT NOT NULL,
    name       TEXT NOT NULL,
    value      INTEGER NOT NULL,
    prize      TEXT,
    status     TEXT,
    PRIMARY KEY (week, rank)
);
"""
BADGE_ICON = {"patron": "💌", "silver": "🥈", "bronze": "🥉"}


def price_of(item: str, test: bool) -> int:
    return 1 if test else ITEMS[item]["stars"]


# ---------------- База ----------------
class ShopDB:
    def __init__(self, db):
        self.db = db

    @property
    def c(self):
        return self.db.conn

    async def init(self) -> None:
        await self.c.executescript(SCHEMA)
        await self.c.commit()

    async def new_invoice(self, user_id: int, item: str, stars: int, amount: int) -> str:
        inv = uuid.uuid4().hex
        await self.c.execute("INSERT INTO invoices(id, user_id, item, stars, amount, created_at) VALUES(?,?,?,?,?,?)",
                             (inv, user_id, item, stars, amount, int(time.time())))
        await self.c.commit()
        return inv

    async def invoice(self, inv: str) -> dict | None:
        async with self.c.execute("SELECT * FROM invoices WHERE id=?", (inv,)) as cur:
            r = await cur.fetchone()
        return dict(r) if r else None

    async def record_payment(self, charge_id: str, inv: dict, stars: int) -> bool:
        """True — новая оплата, False — дубль (уже записана)."""
        cur = await self.c.execute(
            "INSERT OR IGNORE INTO payments(charge_id, invoice_id, user_id, item, stars, amount, created_at) VALUES(?,?,?,?,?,?,?)",
            (charge_id, inv["id"], inv["user_id"], inv["item"], stars, inv["amount"], int(time.time())))
        await self.c.commit()
        return cur.rowcount > 0

    async def pending(self, user_id: int) -> list[dict]:
        async with self.c.execute(
                "SELECT charge_id, item, amount, created_at FROM payments WHERE user_id=? AND delivered_at IS NULL AND refunded_at IS NULL ORDER BY created_at",
                (user_id,)) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def ack(self, user_id: int, ids: list[str]) -> int:
        now = int(time.time()); n = 0
        for cid in ids[:50]:
            cur = await self.c.execute("UPDATE payments SET delivered_at=? WHERE charge_id=? AND user_id=? AND delivered_at IS NULL",
                                       (now, str(cid), user_id))
            n += cur.rowcount
        await self.c.commit()
        return n

    async def add_badge(self, player_key: str, badge: str, until: int = 0) -> None:
        await self.c.execute("""INSERT INTO badges(player_key, badge, until) VALUES(?,?,?)
                                ON CONFLICT(player_key, badge) DO UPDATE SET until=excluded.until""", (player_key, badge, until))
        await self.c.commit()

    async def badges(self, keys: list[str]) -> dict[str, list[str]]:
        if not keys:
            return {}
        now = int(time.time())
        q = f"SELECT player_key, badge FROM badges WHERE player_key IN ({','.join('?' * len(keys))}) AND (until=0 OR until>?)"
        out: dict[str, list[str]] = {}
        async with self.c.execute(q, (*keys, now)) as cur:
            for r in await cur.fetchall():
                out.setdefault(r["player_key"], []).append(r["badge"])
        return out

    async def last_winner(self) -> dict | None:
        async with self.c.execute("SELECT week, name, value FROM week_results WHERE rank=1 ORDER BY week DESC LIMIT 1") as cur:
            r = await cur.fetchone()
        return dict(r) if r else None

    async def week_done(self, week: str) -> bool:
        async with self.c.execute("SELECT 1 FROM week_results WHERE week=? LIMIT 1", (week,)) as cur:
            return bool(await cur.fetchone())

    async def last_payment(self) -> dict | None:
        async with self.c.execute("SELECT * FROM payments WHERE refunded_at IS NULL ORDER BY created_at DESC LIMIT 1") as cur:
            r = await cur.fetchone()
        return dict(r) if r else None

    async def mark_refunded(self, charge_id: str) -> None:
        await self.c.execute("UPDATE payments SET refunded_at=? WHERE charge_id=?", (int(time.time()), charge_id))
        await self.c.commit()


# ---------------- HTTP API ----------------
SHOP = web.AppKey("shop", ShopDB)
BOT = web.AppKey("bot", object)
TEST = web.AppKey("test_prices", bool)


def setup_api(app: web.Application, shop: ShopDB, bot: Bot | None, test_prices: bool, current_user) -> None:
    app[SHOP], app[BOT], app[TEST] = shop, bot, test_prices

    async def catalog(request: web.Request) -> web.Response:
        test = request.app[TEST]
        items = {k: {**{x: v[x] for x in ("title", "kind", "minutes", "min", "desc") if x in v}, "stars": price_of(k, test)}
                 for k, v in ITEMS.items()}
        return web.json_response({"items": items, "enabled": request.app[BOT] is not None, "test": test})

    async def invoice(request: web.Request) -> web.Response:
        user = current_user(request)
        bot = request.app[BOT]
        if bot is None:
            raise web.HTTPServiceUnavailable(text="shop disabled")
        try:
            body = await request.json()
            item = str(body.get("item", ""))
            amount = int(body.get("amount", 0) or 0)
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
            raise web.HTTPBadRequest(text="bad request")
        d = ITEMS.get(item)
        if not d:
            raise web.HTTPBadRequest(text="unknown item")
        if d.get("kind") == "money":
            amount = max(d["min"], min(amount, MAX_MONEY))
            desc = f"{amount:,} ₽ на счёт фермы (≈{d['minutes'] // 60 or d['minutes']} {'ч' if d['minutes'] >= 60 else 'мин'} дохода).".replace(",", " ")
        else:
            amount, desc = 0, d["desc"]
        stars = price_of(item, request.app[TEST])
        inv = await request.app[SHOP].new_invoice(user["id"], item, stars, amount)
        link = await bot.create_invoice_link(title=d["title"], description=desc[:255], payload=inv, currency="XTR",
                                             prices=[LabeledPrice(label=d["title"], amount=stars)])
        return web.json_response({"link": link, "invoice": inv, "stars": stars, "amount": amount})

    async def pending(request: web.Request) -> web.Response:
        user = current_user(request)
        return web.json_response({"items": await request.app[SHOP].pending(user["id"])})

    async def ack(request: web.Request) -> web.Response:
        user = current_user(request)
        try:
            ids = list((await request.json()).get("ids", []))
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
            raise web.HTTPBadRequest(text="bad request")
        return web.json_response({"acked": await request.app[SHOP].ack(user["id"], ids)})

    app.router.add_get("/api/shop/catalog", catalog)
    app.router.add_post("/api/shop/invoice", invoice)
    app.router.add_get("/api/shop/pending", pending)
    app.router.add_post("/api/shop/ack", ack)


# ---------------- Бот: оплата ----------------
def make_router(shop: ShopDB, admin_id: int, channel_url: str) -> Router:
    r = Router()

    @r.pre_checkout_query()
    async def pre_checkout(q: PreCheckoutQuery) -> None:
        inv = await shop.invoice(q.invoice_payload)
        ok = bool(inv) and inv["user_id"] == q.from_user.id and q.currency == "XTR" and q.total_amount == inv["stars"] \
            and time.time() - inv["created_at"] < INVOICE_TTL
        await q.answer(ok=ok, error_message=None if ok else "Счёт устарел — откройте магазин в игре ещё раз.")

    @r.message(F.successful_payment)
    async def paid(message: Message) -> None:
        sp = message.successful_payment
        inv = await shop.invoice(sp.invoice_payload)
        if not inv:
            log.error("оплата без счёта: %s", sp.telegram_payment_charge_id)
            if admin_id:
                await message.bot.send_message(admin_id, f"⚠️ Оплата без счёта: {sp.telegram_payment_charge_id}, {sp.total_amount} ⭐, user {message.from_user.id}")
            return
        new = await shop.record_payment(sp.telegram_payment_charge_id, inv, sp.total_amount)
        if not new:
            return  # дубль уведомления — ничего не выдаём второй раз
        if inv["item"] == "patron":
            await shop.add_badge(f"tg:{inv['user_id']}", "patron")
        title = ITEMS.get(inv["item"], {}).get("title", inv["item"])
        await message.answer(f"✅ Спасибо! «{title}» — оплачено. Откройте игру: покупка уже ждёт на ферме 🌾")

    @r.message(Command("paysupport"))
    async def paysupport(message: Message) -> None:
        await message.answer(
            "💬 <b>Вопросы по оплате</b>\n\nЕсли покупка не пришла или списались звёзды — напишите нам: "
            f"{channel_url}\nУкажите время покупки и что покупали. Покупки выдаются сами при следующем входе в игру.")

    @r.message(Command("refund_last"))
    async def refund_last(message: Message) -> None:
        """Только для владельца: вернуть звёзды за последнюю покупку (для тестовых оплат)."""
        if message.from_user.id != admin_id:
            return
        p = await shop.last_payment()
        if not p:
            return await message.answer("Покупок нет.")
        try:
            await message.bot.refund_star_payment(user_id=p["user_id"], telegram_payment_charge_id=p["charge_id"])
            await shop.mark_refunded(p["charge_id"])
            await message.answer(f"Возвращено {p['stars']} ⭐ за «{p['item']}» пользователю {p['user_id']}.")
        except Exception as e:  # noqa: BLE001
            await message.answer(f"Не вышло: {e}")

    return r


# ---------------- Приз «Фермер недели» ----------------
PRIZE_MIN, PRIZE_MAX = 100, 250
MIN_AGE = 3 * 24 * 3600


def next_results_time(now: datetime) -> datetime:
    """Ближайшее воскресенье 20:00 по Москве."""
    now = now.astimezone(MSK)
    t = now.replace(hour=20, minute=0, second=0, microsecond=0) + timedelta(days=(6 - now.weekday()) % 7)
    return t if t > now else t + timedelta(days=7)


async def week_results(db, shop: ShopDB, bot: Bot | None, admin_id: int, now: float | None = None) -> list[dict]:
    """Подвести итоги недели: топ по приросту капитала, без новичков (< 3 дней). Один раз на неделю."""
    now = now or time.time()
    week = current_week(now)
    if await shop.week_done(week):
        return []
    q = """SELECT w.player_key, p.name, (w.capital - w.start_capital) AS value, p.created_at
           FROM weekly w JOIN players p USING(player_key)
           WHERE w.week=? AND w.capital > w.start_capital AND w.player_key LIKE 'tg:%' AND p.created_at <= ?
           ORDER BY value DESC, w.player_key LIMIT 3"""
    async with db.conn.execute(q, (week, int(now) - MIN_AGE)) as cur:
        top = [dict(r) for r in await cur.fetchall()]
    next_week_end = int(next_results_time(datetime.fromtimestamp(now, MSK) + timedelta(minutes=1)).timestamp())
    out = []
    for rank, row in enumerate(top, 1):
        uid = int(row["player_key"][3:])
        prize, status = None, None
        if rank == 1:
            prize, status = await send_gift(bot, uid, admin_id, row)
        else:
            await shop.add_badge(row["player_key"], "silver" if rank == 2 else "bronze", until=next_week_end)
            prize, status = ("badge", "ok")
        await db.conn.execute("INSERT OR IGNORE INTO week_results(week, rank, player_key, name, value, prize, status) VALUES(?,?,?,?,?,?,?)",
                              (week, rank, row["player_key"], row["name"], row["value"], prize, status))
        out.append({"rank": rank, **row, "prize": prize, "status": status})
        if bot:
            text = {1: "🏆 Ты — <b>Фермер недели</b>! Прирост капитала за неделю — больше всех. Лови подарок от фермы деда 🎁",
                    2: "🥈 Второе место в рейтинге недели! Значок «Фермер недели» у ника — на всю следующую неделю.",
                    3: "🥉 Третье место в рейтинге недели! Значок «Фермер недели» у ника — на всю следующую неделю."}[rank]
            try:
                await bot.send_message(uid, text)
            except Exception as e:  # noqa: BLE001 — игрок мог не писать боту
                log.info("не написать %s: %s", uid, e)
    if not top:  # пустую неделю тоже отмечаем, чтобы не считать повторно
        await db.conn.execute("INSERT OR IGNORE INTO week_results(week, rank, player_key, name, value, prize, status) VALUES(?,?,?,?,?,?,?)",
                              (week, 0, "-", "-", 0, None, "empty"))
    await db.conn.commit()
    if bot and admin_id:
        lines = [f"{r['rank']}. {r['name']} (+{r['value']:,} ₽) — {r['prize'] or ''} {r['status'] or ''}".replace(",", " ") for r in out] or ["никого"]
        try:
            await bot.send_message(admin_id, f"📊 Итоги недели {week}:\n" + "\n".join(lines))
        except Exception as e:  # noqa: BLE001
            log.warning("админу не отправить: %s", e)
    return out


async def send_gift(bot: Bot | None, uid: int, admin_id: int, row: dict) -> tuple[str, str]:
    if not bot:
        return "gift", "no-bot"
    try:
        gifts = (await bot.get_available_gifts()).gifts
        ok = [g for g in gifts if PRIZE_MIN <= g.star_count <= PRIZE_MAX]
        if not ok:
            raise RuntimeError("нет подарков за 100–250 ⭐")
        g = max(ok, key=lambda x: x.star_count)
        await bot.send_gift(user_id=uid, gift_id=g.id, text="Фермер недели! 🌾")
        return f"gift {g.star_count}⭐", "ok"
    except Exception as e:  # noqa: BLE001 — чаще всего не хватает звёзд у бота
        log.warning("подарок не отправлен: %s", e)
        if admin_id:
            try:
                await bot.send_message(admin_id, f"🎁 Не удалось отправить подарок победителю недели {row['name']} "
                                                 f"(id {uid}): {e}\nОтправьте, пожалуйста, вручную (100–250 ⭐).")
            except Exception:  # noqa: BLE001
                pass
        return "gift", "manual"


async def weekly_loop(db, shop: ShopDB, bot: Bot | None, admin_id: int) -> None:
    """Каждое воскресенье в 20:00 МСК. Если сервер был выключен — подведёт итоги после запуска (в тот же вечер)."""
    while True:
        now = datetime.now(MSK)
        t = next_results_time(now)
        # пропущенные итоги текущей недели (сервер перезапускали после 20:00 воскресенья)
        if now.weekday() == 6 and now.hour >= 20:
            await week_results(db, shop, bot, admin_id)
        await asyncio.sleep(max(30, (t - datetime.now(MSK)).total_seconds()))
        try:
            await week_results(db, shop, bot, admin_id)
        except Exception:  # noqa: BLE001
            log.exception("итоги недели")
