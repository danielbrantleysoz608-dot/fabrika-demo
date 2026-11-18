"""Магазин за звёзды и призы недели: счёт → оплата → выдача ровно один раз."""
import json
import sys
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth import sign_init_data  # noqa: E402
from config import load  # noqa: E402
from db import DB, current_week  # noqa: E402
from shop import ITEMS, ShopDB, make_router, week_results  # noqa: E402
from web import make_app  # noqa: E402

TOKEN = "123456:TEST-token"


def init_data(user_id=42):
    return sign_init_data({"auth_date": str(int(time.time())), "query_id": "q",
                           "user": json.dumps({"id": user_id, "first_name": f"Игрок{user_id}"})}, TOKEN)


class FakeBot:
    """Вместо Telegram: запоминает счета, подарки и сообщения."""
    def __init__(self, stars=0):
        self.links, self.sent, self.gifts, self.stars = [], [], [], stars

    async def create_invoice_link(self, **kw):
        self.links.append(kw)
        return f"https://t.me/$invoice-{kw['payload']}"

    async def send_message(self, chat_id, text, **kw):
        self.sent.append((chat_id, text))

    async def get_available_gifts(self):
        return SimpleNamespace(gifts=[SimpleNamespace(id="g50", star_count=50), SimpleNamespace(id="g150", star_count=150)])

    async def send_gift(self, user_id, gift_id, text=None):
        if self.stars < 150:
            raise RuntimeError("BALANCE_TOO_LOW")
        self.gifts.append((user_id, gift_id))


@pytest.fixture
async def env(aiohttp_client, tmp_path):
    cfg = replace(load(), bot_token=TOKEN, db_path=tmp_path / "s.db", dev_mode=False, admin_id=999,
                  webapp_dir=Path(__file__).resolve().parents[2] / "webapp")
    db = DB(cfg.db_path); await db.open()
    shop = ShopDB(db); await shop.init()
    bot = FakeBot()
    c = await aiohttp_client(make_app(cfg, db, "ferma_test_bot", shop=shop, bot=bot))
    yield SimpleNamespace(c=c, db=db, shop=shop, bot=bot, router=make_router(shop, 999, cfg.channel_url))
    await db.close()


async def pay(env, inv_id, charge, user=42, stars=None):
    """Как будто Telegram прислал successful_payment."""
    inv = await env.shop.invoice(inv_id)
    return await env.shop.record_payment(charge, inv, stars or inv["stars"])


async def test_invoice_payment_delivered_once(env):
    h = {"X-Telegram-Init-Data": init_data(42)}
    r = await (await env.c.post("/api/shop/invoice", json={"item": "wallet", "amount": 7_000_000}, headers=h)).json()
    assert r["stars"] == ITEMS["wallet"]["stars"] and r["amount"] == 7_000_000 and r["link"].startswith("https://t.me/")
    assert env.bot.links[-1]["currency"] == "XTR" and env.bot.links[-1]["prices"][0].amount == 75
    # оплата пришла дважды (повтор уведомления) — запись одна
    assert await pay(env, r["invoice"], "charge-1") is True
    assert await pay(env, r["invoice"], "charge-1") is False
    # игра была закрыта — покупка ждёт при следующем входе
    p = await (await env.c.get("/api/shop/pending", headers=h)).json()
    assert [x["charge_id"] for x in p["items"]] == ["charge-1"] and p["items"][0]["amount"] == 7_000_000
    # игра применила и подтвердила — больше не выдаётся
    a = await (await env.c.post("/api/shop/ack", json={"ids": ["charge-1"]}, headers=h)).json()
    assert a["acked"] == 1
    assert (await (await env.c.get("/api/shop/pending", headers=h)).json())["items"] == []
    # чужой игрок не видит и не может подтвердить чужую покупку
    h2 = {"X-Telegram-Init-Data": init_data(43)}
    assert (await (await env.c.get("/api/shop/pending", headers=h2)).json())["items"] == []


async def test_money_minimum_and_bad_requests(env):
    h = {"X-Telegram-Init-Data": init_data(42)}
    r = await (await env.c.post("/api/shop/invoice", json={"item": "chest", "amount": 5}, headers=h)).json()
    assert r["amount"] == 150_000                       # минимум пакета
    assert (await env.c.post("/api/shop/invoice", json={"item": "hack"}, headers=h)).status == 400
    assert (await env.c.post("/api/shop/invoice", json={"item": "skip"})).status == 401   # без Telegram — нельзя
    bad = init_data(42).replace("hash=", "hash=0")
    assert (await env.c.post("/api/shop/invoice", json={"item": "skip"}, headers={"X-Telegram-Init-Data": bad})).status == 401


async def test_pre_checkout_checks_invoice(env):
    h = {"X-Telegram-Init-Data": init_data(42)}
    r = await (await env.c.post("/api/shop/invoice", json={"item": "skip"}, headers=h)).json()
    answers = []

    class Q:
        def __init__(self, payload, uid, total):
            self.invoice_payload, self.from_user, self.currency, self.total_amount = payload, SimpleNamespace(id=uid), "XTR", total

        async def answer(self, ok, error_message=None):
            answers.append(ok)

    handler = env.router.pre_checkout_query.handlers[0].callback
    await handler(Q(r["invoice"], 42, 15))      # всё верно
    await handler(Q(r["invoice"], 43, 15))      # чужой счёт
    await handler(Q(r["invoice"], 42, 1))       # не та цена
    await handler(Q("nope", 42, 15))            # нет такого счёта
    assert answers == [True, False, False, False]


async def test_patron_badge_and_last_winner_in_rating(env):
    h = {"X-Telegram-Init-Data": init_data(42)}
    await env.c.post("/api/score", json={"capital": 500_000}, headers=h)
    await env.shop.add_badge("tg:42", "patron")
    board = await (await env.c.get("/api/leaderboard", headers=h)).json()
    assert board["top"][0]["badges"] == ["patron"] and board["me"]["badges"] == ["patron"]
    assert "key" not in board["top"][0]


async def test_week_results_rules(env):
    db, shop, bot = env.db, env.shop, env.bot
    now = time.time()
    week = current_week(now)
    old = int(now) - 10 * 86400
    # три «старых» игрока и один новичок (зарегистрирован сегодня) с самым большим приростом
    for uid, gain, created in [(1, 5_000, old), (2, 9_000, old), (3, 7_000, old), (4, 99_000, int(now))]:
        await db.conn.execute("INSERT INTO players(player_key, name, created_at, last_seen) VALUES(?,?,?,?)", (f"tg:{uid}", f"P{uid}", created, created))
        await db.conn.execute("INSERT INTO weekly(player_key, week, start_capital, capital, updated_at) VALUES(?,?,?,?,?)", (f"tg:{uid}", week, 1000, 1000 + gain, created))
    await db.conn.commit()
    res = await week_results(db, shop, bot, admin_id=999, now=now)
    assert [r["player_key"] for r in res] == ["tg:2", "tg:3", "tg:1"]    # новичок без приза
    assert res[0]["status"] == "manual"                                  # звёзд у бота нет → написали владельцу
    assert any(chat == 999 and "вручную" in text for chat, text in bot.sent)
    assert (await shop.badges(["tg:3"]))["tg:3"] == ["silver"] and (await shop.badges(["tg:1"]))["tg:1"] == ["bronze"]
    assert (await shop.last_winner())["name"] == "P2"
    # повторный запуск в ту же неделю ничего не делает
    assert await week_results(db, shop, bot, admin_id=999, now=now) == []


async def test_gift_sent_when_stars_enough(env):
    db, shop = env.db, env.shop
    bot = FakeBot(stars=500)
    now = time.time(); week = current_week(now); old = int(now) - 10 * 86400
    await db.conn.execute("INSERT INTO players(player_key, name, created_at, last_seen) VALUES('tg:7','P7',?,?)", (old, old))
    await db.conn.execute("INSERT INTO weekly(player_key, week, start_capital, capital, updated_at) VALUES('tg:7',?,1,100,?)", (week, old))
    await db.conn.commit()
    res = await week_results(db, shop, bot, admin_id=999, now=now)
    assert res[0]["status"] == "ok" and bot.gifts == [(7, "g150")]


# ---------- Обязательная подписка на канал ----------
from sub import SubChecker  # noqa: E402


class SubBot:
    def __init__(self):
        self.members, self.calls, self.sent, self.fail = set(), 0, [], False

    async def get_chat_member(self, chat_id, user_id):
        self.calls += 1
        if self.fail:
            raise RuntimeError("Bad Request: member list is inaccessible")
        return SimpleNamespace(status="member" if user_id in self.members else "left")

    async def send_message(self, chat_id, text, **kw):
        self.sent.append((chat_id, text))


async def test_subscription_api(aiohttp_client, tmp_path):
    cfg = replace(load(), bot_token=TOKEN, db_path=tmp_path / "sub.db", dev_mode=False,
                  webapp_dir=Path(__file__).resolve().parents[2] / "webapp")
    db = DB(cfg.db_path); await db.open()
    bot = SubBot()
    sub = SubChecker(bot, "@predstav_kanal", True, admin_id=999)
    c = await aiohttp_client(make_app(cfg, db, "ferma_test_bot", sub=sub))
    h = {"X-Telegram-Init-Data": init_data(42)}
    r = await (await c.get("/api/sub", headers=h)).json()
    assert r["required"] and r["ok"] is False and r["url"].startswith("https://t.me/")
    bot.members.add(42)                                     # подписался
    r = await (await c.get("/api/sub?fresh=1", headers=h)).json()
    assert r["ok"] is True
    calls = bot.calls
    await c.get("/api/sub", headers=h)                      # подписан — из кэша, без лишних запросов
    assert bot.calls == calls
    assert (await c.get("/api/sub")).status == 401          # без Telegram — нельзя
    # бот не админ канала → не мешаем играть, владельцу пишем один раз
    bot.fail = True
    r = await (await c.get("/api/sub?fresh=1", headers={"X-Telegram-Init-Data": init_data(43)})).json()
    await c.get("/api/sub?fresh=1", headers={"X-Telegram-Init-Data": init_data(44)})
    assert r["ok"] is True and len([1 for chat, _ in bot.sent if chat == 999]) == 1
    await db.close()
