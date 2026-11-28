"""Сериал «Деревня деда» в боте: ник при первом входе, «Найди свой дом», заявки, «Мой дом», админка. Telegram подменён."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.base import BaseSession
from aiogram.filters import CommandStart
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendDocument, SendMessage, SendPhoto
from aiogram.types import CallbackQuery, Chat, Message, Update, User

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import village  # noqa: E402
from db import DB  # noqa: E402

ADMIN = 999
ME = User(id=501, is_bot=False, first_name="Эдуард")
VILLAGERS = [{"nick": "eduard949219", "platform": "instagram", "x": 1700, "y": 300, "number": 17, "episode": 2, "special": None},
             {"nick": "artesm1ne4ek", "platform": "tiktok", "x": 120, "y": 1400, "number": 42, "episode": 3, "special": "дом с мельницей"}]


class FakeTelegram(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls, self.mid = [], 100

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, (SendMessage, SendPhoto, SendDocument)):
            self.mid += 1
            return Message(message_id=self.mid, date=datetime.now(timezone.utc), chat=Chat(id=method.chat_id, type="private"),
                           text=getattr(method, "text", None) or "x")
        return True

    async def close(self):
        pass

    async def stream_content(self, *a, **kw):  # pragma: no cover
        yield b""

    def of(self, cls):
        return [c for c in self.calls if isinstance(c, cls)]

    def texts(self):
        return [c.text for c in self.of(SendMessage)]


def make_map(folder: Path) -> None:
    from PIL import Image, ImageDraw
    folder.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (2000, 1600), (120, 180, 90))
    d = ImageDraw.Draw(im)
    for v in VILLAGERS:
        d.rectangle((v["x"] - 30, v["y"] - 30, v["x"] + 30, v["y"] + 30), fill=(160, 90, 60))
    im.save(folder / "village_map.png")
    (folder / "villagers.json").write_text(json.dumps(VILLAGERS), encoding="utf-8")


@pytest.fixture
async def env(tmp_path):
    db = DB(tmp_path / "v.sqlite3")
    await db.open()
    vdb = village.VillageDB(db)
    await vdb.init()
    data = village.VillageData(tmp_path / "village")
    tg = FakeTelegram()
    bot = Bot("123456:TEST", session=tg)
    dp = Dispatcher()
    private = Router()
    private.message.filter(F.chat.type == "private")

    @private.message(CommandStart())  # как в main.py: сначала спросить ник (один раз), иначе — приветствие
    async def start(message):
        if await village.needs_ask(vdb, message.from_user.id):
            return await village.ask_first(message, vdb, message.from_user.id)
        await message.answer("WELCOME")
    private.include_router(village.make_router(vdb, data, ADMIN, lambda: None, "WELCOME"))

    fb = Router()  # как в main.py: «Жми Играть» — отдельным роутером ПОСЛЕ деревни

    @fb.message(F.text)
    async def fallback(message):
        await message.answer("Жми «Играть» 👇")
    private.include_router(fb)
    dp.include_router(private)
    n = {"id": 0}
    chat = Chat(id=ME.id, type="private")

    async def say(text, user=ME):
        n["id"] += 1
        await dp.feed_update(bot, Update(update_id=n["id"], message=Message(message_id=n["id"], date=datetime.now(timezone.utc),
                                                                            chat=Chat(id=user.id, type="private"), from_user=user, text=text)))

    async def press(data_, user=ME):
        n["id"] += 1
        msg = Message(message_id=5, date=datetime.now(timezone.utc), chat=chat, text="?")
        await dp.feed_update(bot, Update(update_id=n["id"], callback_query=CallbackQuery(id=str(n["id"]), from_user=user, chat_instance="c",
                                                                                            message=msg, data=data_)))
    yield type("Env", (), {"tg": tg, "vdb": vdb, "data": data, "db": db, "say": staticmethod(say), "press": staticmethod(press),
                           "dir": tmp_path / "village"})
    await db.close()


def test_normalize_nick():
    assert village.normalize_nick("@Eduard949219") == "eduard949219"
    assert village.normalize_nick("https://www.instagram.com/artesm1ne4ek/?hl=ru") == "artesm1ne4ek"
    assert village.normalize_nick("tiktok.com/@Art.Es") == "art.es"
    assert village.normalize_nick("привет") is None and village.normalize_nick("a") is None


async def test_first_start_asks_nick_once(env):
    await env.say("/start")
    assert env.tg.texts()[-1] == village.ASK_TEXT
    kb = env.tg.of(SendMessage)[-1].reply_markup.inline_keyboard
    assert [b.text for row in kb for b in row] == ["Instagram", "YouTube", "TikTok", "У меня нет аккаунта"]
    await env.say("/start")  # спросили один раз — дальше обычное приветствие
    assert env.tg.texts()[-1] == "WELCOME"


async def test_found_villager_gets_house_picture(env):
    make_map(env.dir)
    await env.say("/start")
    await env.press("vnick:instagram")
    assert "Instagram" in env.tg.of(EditMessageText)[-1].text
    await env.say("@Eduard949219")
    photo = env.tg.of(SendPhoto)[-1]
    assert photo.caption == "🏡 eduard949219, вот твой дом! Житель №17 · появился в выпуске 2"
    p = await env.vdb.profile(ME.id)
    assert p["nick"] == "eduard949219" and p["platform"] == "instagram" and not p["awaiting"]
    # картинка ~800×800, закэширована
    from PIL import Image
    import io
    png = env.data.render("eduard949219", 0)
    assert Image.open(io.BytesIO(png)).size == (800, 800)
    assert len(list((env.dir / "cache").glob("*.png"))) == 1


async def test_special_house_and_platform_from_export(env):
    make_map(env.dir)
    await env.say("/start")
    await env.press("vnick:tiktok")
    await env.say("artesm1ne4ek")
    cap = env.tg.of(SendPhoto)[-1].caption
    assert "Житель №42 · появился в выпуске 3" in cap and "дом с мельницей" in cap


async def test_unknown_nick_leaves_wish_once_and_can_change(env):
    make_map(env.dir)
    await env.say("/start")
    await env.press("vnick:youtube")
    await env.say("nobody_here_123")
    assert env.tg.texts()[-1].startswith(village.NO_HOUSE)
    await env.say("x" * 101)
    assert "до 100 символов" in env.tg.texts()[-1]
    await env.say("Домик у пруда с утками")
    assert (await env.vdb.request(ME.id))["wish"] == "Домик у пруда с утками"
    await env.say("просто текст")  # пожелание принято — обычный текст снова «Жми Играть»
    assert env.tg.texts()[-1] == "Жми «Играть» 👇"
    await env.say("/home")  # изменить заявку
    assert "Твоя заявка сейчас" in env.tg.texts()[-1]
    await env.say("Баня у реки")
    rows = await env.vdb.all_requests()
    assert len(rows) == 1 and rows[0]["wish"] == "Баня у реки" and rows[0]["nick"] == "nobody_here_123"


async def test_no_account_goes_on(env):
    await env.say("/start")
    await env.press("vnick:none")
    assert env.tg.texts()[-1] == "WELCOME"
    p = await env.vdb.profile(ME.id)
    assert p["platform"] == "none" and p["nick"] is None
    await env.say("/start")
    assert env.tg.texts()[-1] == "WELCOME"


async def test_map_not_exported_yet(env):
    await env.say("/start")
    await env.press("vnick:instagram")
    await env.say("eduard949219")
    assert "Карта посёлка обновляется" in env.tg.texts()[-1]
    assert (await env.vdb.profile(ME.id))["nick"] == "eduard949219"


async def test_admin_requests_and_top(env):
    await env.vdb.save_request(7, "petya", "tiktok", "Дом с баней")
    await env.db.conn.execute("INSERT INTO saves(user_id, data, updated_at) VALUES(7, ?, 1)", (json.dumps({"game": {"vhome": 8, "vhomeOpts": ["бассейн", "баня"]}}),))
    await env.db.conn.execute("INSERT INTO saves(user_id, data, updated_at) VALUES(8, ?, 1)", (json.dumps({"game": {"vhome": 3}}),))
    await env.db.conn.commit()
    await env.vdb.upsert(7, nick="petya", platform="tiktok", asked_at=1)
    await env.say("/village_requests")  # не админ — молчит
    await env.say("/village_top")
    assert not env.tg.of(SendDocument) and not any("Топ" in t for t in env.tg.texts())
    admin = User(id=ADMIN, is_bot=False, first_name="A")
    await env.say("/village_requests", user=admin)
    doc = env.tg.of(SendDocument)[-1]
    assert "Заявки на дома: 1" in doc.caption
    await env.say("/village_top", user=admin)
    top = env.tg.texts()[-1]
    assert top.index("@petya") < top.index("ур. 3") and "ур. 8 усадьба" in top and "бассейн, баня" in top


async def test_game_api(aiohttp_client, tmp_path):
    """API игры: ник, заявка, картинка «Мой дом» (только своего дома, с подписью initData)."""
    from dataclasses import replace
    from auth import sign_init_data
    from config import load
    from web import make_app
    token = "123456:TESTTOKEN"
    cfg = replace(load(), bot_token=token, db_path=tmp_path / "w.db", dev_mode=False)
    db = DB(cfg.db_path)
    await db.open()
    vdb = village.VillageDB(db)
    await vdb.init()
    data = village.VillageData(tmp_path / "village")
    c = await aiohttp_client(make_app(cfg, db, "ferma_test_bot", village=(vdb, data)))
    import time as _t
    h = {"X-Telegram-Init-Data": sign_init_data({"user": json.dumps({"id": 77, "first_name": "Т"}), "auth_date": str(int(_t.time()))}, token)}
    assert (await c.get("/api/village/me")).status == 401
    me = await (await c.get("/api/village/me", headers=h)).json()
    assert me["nick"] is None and me["mapReady"] is False
    assert (await c.put("/api/village/profile", json={"nick": "!!", "platform": "tiktok"}, headers=h)).status == 400
    me = await (await c.put("/api/village/profile", json={"nick": "@ArtesM1ne4ek", "platform": "tiktok"}, headers=h)).json()
    assert me["nick"] == "artesm1ne4ek" and me["villager"] is None
    assert (await c.get("/api/village/home.png?level=2", headers=h)).status == 404  # карты ещё нет
    make_map(tmp_path / "village")
    me = await (await c.get("/api/village/me", headers=h)).json()
    assert me["villager"]["number"] == 42 and me["mapReady"]
    r = await c.get("/api/village/home.png?level=2", headers=h)
    assert r.status == 200 and r.content_type == "image/png"
    assert (await c.post("/api/village/wish", json={"wish": "x" * 101}, headers=h)).status == 400
    me = await (await c.post("/api/village/wish", json={"wish": "Баня у пруда"}, headers=h)).json()
    assert me["wish"] == "Баня у пруда"
    await db.close()
