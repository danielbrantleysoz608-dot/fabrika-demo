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
    "boost_grow":   {"stars": 10, "title": "Бустер «Быстрый рост»", "desc": "Огород и теплица растут вдвое быстрее 30 минут (если уже идёт — ещё +30 мин)."},
    "boost_double": {"stars": 15, "title": "Бустер «×2 урожай»",   "desc": "Весь урожай фермы ×2 целых 30 минут (если уже идёт — ещё +30 мин)."},
    # товары фермы (то же можно купить в игре за ₽)
    "g_fert":        {"stars": 10, "title": "Удобрение",          "desc": "Огород, морковь, капуста и теплица +40% на 30 минут."},
    "g_feed":        {"stars": 8,  "title": "Корм для кур",       "desc": "Курятник +50% на 30 минут."},
    "g_beefeed":     {"stars": 8,  "title": "Подкормка для пчёл", "desc": "Пасека +50% на 30 минут."},
    "g_vitamins":    {"stars": 8,  "title": "Витамины для коров", "desc": "Коровы и сыроварня +50% на 30 минут."},
    "g_kit":         {"stars": 15, "title": "Набор фермера",      "desc": "Грядки, куры, пчёлы и коровы +30% на 30 минут."},
    "g_sprinklers":  {"stars": 35, "title": "Поливалки",          "desc": "Огород, морковь и капуста +15% навсегда."},
    "g_incubator":   {"stars": 45, "title": "Инкубатор",          "desc": "Курятник +20% навсегда."},
    "g_ghheat":      {"stars": 40, "title": "Подогрев теплицы",   "desc": "Теплица +20% навсегда."},
    "g_beebed":      {"stars": 50, "title": "Улей-лежак",         "desc": "Пасека +20% навсегда."},
    "g_minitractor": {"stars": 75, "title": "Мини-трактор",       "desc": "Все грядки и теплица +10% навсегда."},
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
        await self.c.executescript(SCHEMA + AWARDS_SCHEMA)
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

    @r.message(Command("myid"))
    async def myid(message: Message) -> None:
        await message.answer(f"Ваш Telegram id: <code>{message.from_user.id}</code>")

    @r.message(Command("test_results"))
    async def test_results(message: Message) -> None:
        """Только для владельца: показать, кто сейчас победил бы за неделю и месяц (ничего не выдаётся)."""
        if not admin_id or message.from_user.id != admin_id:
            return
        await init_awards(shop.db)
        for kind in ("week", "month"):
            await period_results(shop.db, shop, message.bot, admin_id, kind, dry=True)

    @r.message(Command("refund_last"))
    async def refund_last(message: Message) -> None:
        """Только для владельца: вернуть звёзды за последнюю покупку (для тестовых оплат)."""
        if not admin_id or message.from_user.id != admin_id:
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


# ---------------- Итоги недели и месяца ----------------
# Неделя: 1 место — подарок Telegram за 25 ⭐ (sendGift со счёта бота; не хватило — пишем владельцу), 2–3 — значки 🥈/🥉.
# Месяц: 1 место — NFT-подарок PoolFloat (передаёт владелец вручную: бот пишет ему, кому отдать).
WEEK_GIFT_STARS = 25
NFT = {"name": "PoolFloat", "url": "https://t.me/nft/PoolFloat-92287", "img": "https://nft.fragment.com/gift/poolfloat-92287.webp"}
PRIZES = {
    "week": {1: {"icon": "🎁", "label": "25 ⭐", "text": "Подарок Telegram за 25 ⭐"},
             2: {"icon": "🥈", "label": "значок", "text": "Значок «Фермер недели» на всю следующую неделю"},
             3: {"icon": "🥉", "label": "значок", "text": "Значок «Фермер недели» на всю следующую неделю"}},
    "month": {1: {"icon": "🎁", "label": "NFT", "text": f"NFT-подарок «{NFT['name']}»", "nft": NFT}},
}
MIN_AGE = 3 * 24 * 3600

AWARDS_SCHEMA = """
CREATE TABLE IF NOT EXISTS awards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,          -- week | month
    period     TEXT NOT NULL,          -- 2026-W47 | 2026-11
    rank       INTEGER NOT NULL,
    player_key TEXT NOT NULL,
    name       TEXT NOT NULL,
    value      INTEGER NOT NULL,       -- прирост капитала за период
    prize      TEXT,
    status     TEXT,                   -- ok | manual | no-dm | empty
    at         INTEGER NOT NULL,
    UNIQUE (kind, period, rank)
);
"""


def next_results_time(now: datetime, kind: str = "week") -> datetime:
    from db import next_end
    return next_end(kind, now.timestamp())


async def init_awards(db) -> None:
    await db.conn.executescript(AWARDS_SCHEMA)
    await db.conn.commit()


async def period_top(db, kind: str, period: str, now: float, limit: int = 3) -> list[dict]:
    """Топ по приросту капитала за период: только игроки Telegram, ферма старше 3 дней, один приз на id."""
    table, col = ("weekly", "week") if kind == "week" else ("monthly", "month")
    q = f"""SELECT t.player_key, p.name, (t.capital - t.start_capital) AS value, s.capital AS capital, p.created_at, u.username
            FROM {table} t JOIN players p USING(player_key) LEFT JOIN scores s USING(player_key)
            LEFT JOIN users u ON u.user_id = CAST(substr(t.player_key, 4) AS INTEGER)
            WHERE t.{col}=? AND t.capital > t.start_capital AND t.player_key LIKE 'tg:%' AND p.created_at <= ?
            ORDER BY value DESC, t.player_key LIMIT ?"""
    async with db.conn.execute(q, (period, int(now) - MIN_AGE, limit)) as cur:
        return [dict(r) for r in await cur.fetchall()]


async def period_done(db, kind: str, period: str) -> bool:
    async with db.conn.execute("SELECT 1 FROM awards WHERE kind=? AND period=? LIMIT 1", (kind, period)) as cur:
        return bool(await cur.fetchone())


def num(x) -> str:
    return f"{int(x or 0):,}".replace(",", " ")


def who(r: dict) -> str:
    return f"{r['name']}" + (f" (@{r['username']})" if r.get("username") else "") + f", id {r['player_key'][3:]}"


async def period_results(db, shop: ShopDB, bot, admin_id: int, kind: str, now: float | None = None, dry: bool = False) -> list[dict]:
    """Подвести итоги недели или месяца (один раз). dry=True — только показать владельцу, ничего не выдавая."""
    from db import current_month, current_week, next_end
    now = now or time.time()
    period = current_week(now) if kind == "week" else current_month(now)
    if not dry and await period_done(db, kind, period):
        return []
    top = await period_top(db, kind, period, now, 3 if kind == "week" else 1)
    out = []
    badge_until = int(next_end("week", now + 3600).timestamp())  # значок — до итогов следующей недели
    for rank, r in enumerate(top, 1):
        uid = int(r["player_key"][3:])
        prize = PRIZES[kind][rank]["text"]
        status = "dry" if dry else "ok"
        if not dry:
            if kind == "week" and rank == 1:
                status = await send_week_gift(bot, uid, admin_id, r)
            elif kind == "week":
                await shop.add_badge(r["player_key"], "silver" if rank == 2 else "bronze", until=badge_until)
            else:
                status = "manual"  # NFT передаёт владелец
                if bot and admin_id:
                    await safe_send(bot, admin_id, f"🏆 Победитель месяца {period}: {who(r)}\nПрирост за месяц: +{num(r['value'])} ₽, капитал: {num(r['capital'])} ₽\n"
                                                   f"Передайте NFT «{NFT['name']}»: {NFT['url']}")
            text = {("week", 1): "🏆 Ты — <b>Фермер недели</b>! Лови подарок от фермы деда 🎁",
                    ("week", 2): "🥈 Второе место за неделю! Значок «Фермер недели» у ника — на всю следующую неделю.",
                    ("week", 3): "🥉 Третье место за неделю! Значок «Фермер недели» у ника — на всю следующую неделю.",
                    ("month", 1): f"🏆 Ты №1 фермы за месяц! NFT-подарок «{NFT['name']}» придёт в течение 24 часов."}[(kind, rank)]
            if not await safe_send(bot, uid, text) and status == "ok":
                status = "no-dm"
            await db.conn.execute("""INSERT OR IGNORE INTO awards(kind, period, rank, player_key, name, value, prize, status, at)
                                     VALUES(?,?,?,?,?,?,?,?,?)""", (kind, period, rank, r["player_key"], r["name"], r["value"], prize, status, int(now)))
        out.append({"rank": rank, **r, "prize": prize, "status": status})
    if not dry and not top:  # пустой период тоже отмечаем, чтобы не считать повторно
        await db.conn.execute("INSERT OR IGNORE INTO awards(kind, period, rank, player_key, name, value, prize, status, at) VALUES(?,?,0,'-','-',0,NULL,'empty',?)",
                              (kind, period, int(now)))
    await db.conn.commit()
    if bot and admin_id:
        title = ("🧪 ТЕСТ (ничего не выдано) — " if dry else "📊 ") + ("итоги недели " if kind == "week" else "итоги месяца ") + period
        lines = [f"{x['rank']}. {who(x)} — +{num(x['value'])} ₽ → {x['prize']} [{x['status']}]" for x in out] or ["никого (нужен прирост и ферма старше 3 дней)"]
        await safe_send(bot, admin_id, title + "\n" + "\n".join(lines))
    return out


async def safe_send(bot, chat_id: int, text: str) -> bool:
    if not bot:
        return False
    try:
        await bot.send_message(chat_id, text)
        return True
    except Exception as e:  # noqa: BLE001 — игрок мог не писать боту / закрыть личку
        log.info("не написать %s: %s", chat_id, e)
        return False


async def send_week_gift(bot, uid: int, admin_id: int, r: dict) -> str:
    if not bot:
        return "no-bot"
    try:
        gifts = (await bot.get_available_gifts()).gifts
        ok = [g for g in gifts if g.star_count == WEEK_GIFT_STARS]
        if not ok:
            raise RuntimeError(f"нет подарков за {WEEK_GIFT_STARS} ⭐")
        await bot.send_gift(user_id=uid, gift_id=ok[0].id, text="Фермер недели! 🌾")
        return "ok"
    except Exception as e:  # noqa: BLE001 — чаще всего не хватает звёзд у бота
        log.warning("подарок не отправлен: %s", e)
        if admin_id:
            await safe_send(bot, admin_id, f"🎁 Не удалось отправить подарок за {WEEK_GIFT_STARS} ⭐ победителю недели {who(r)}: {e}\nОтправьте, пожалуйста, вручную.")
        return "manual"


async def last_winners(db) -> dict:
    out = {}
    for kind in ("week", "month"):
        async with db.conn.execute("SELECT period FROM awards WHERE kind=? AND rank>0 ORDER BY at DESC LIMIT 1", (kind,)) as cur:
            row = await cur.fetchone()
        if not row:
            continue
        async with db.conn.execute("SELECT rank, name, value FROM awards WHERE kind=? AND period=? AND rank>0 ORDER BY rank", (kind, row["period"])) as cur:
            out[kind] = {"period": row["period"], "top": [dict(x) for x in await cur.fetchall()]}
    return out


async def results_loop(db, shop: ShopDB, bot, admin_id: int) -> None:
    """Итоги: неделя — каждое воскресенье 20:00 МСК, месяц — последний день месяца 20:00 МСК.
    Если сервер был выключен в момент итогов — подводит их после запуска (пока период «заморожен»)."""
    from db import next_end, period_open
    while True:
        now = time.time()
        for kind in ("week", "month"):
            if not period_open(kind, now):  # 20:00 последнего дня прошло — итоги этого периода
                try:
                    await period_results(db, shop, bot, admin_id, kind, now)
                except Exception:  # noqa: BLE001
                    log.exception("итоги %s", kind)
        t = min(next_end(k, now).timestamp() for k in ("week", "month"))
        await asyncio.sleep(max(5, min(t - time.time() + 2, 3600)))


# совместимость со старыми тестами/вызовами
async def week_results(db, shop, bot, admin_id, now=None):
    await init_awards(db)
    return await period_results(db, shop, bot, admin_id, "week", now)


async def weekly_loop(db, shop, bot, admin_id):
    await init_awards(db)
    await results_loop(db, shop, bot, admin_id)
