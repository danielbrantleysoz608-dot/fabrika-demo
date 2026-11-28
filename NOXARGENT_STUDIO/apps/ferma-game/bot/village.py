"""Связка с сериалом «Деревня деда»: ник игрока, «Найди свой дом», заявки на дом, «Мой дом в посёлке».

Данные посёлка кладутся экспортом из сериала в bot/data/village/:
  village_map.png  — большая карта посёлка (финальное состояние выпуска)
  villagers.json   — [{"nick": "eduard949219", "platform": "instagram", "x": 1840, "y": 960,
                       "number": 17, "episode": 2, "special": null}, ...]  (x, y — пиксели карты)
Пока файлов нет, бот всё равно спрашивает ник и принимает заявки — «Найди свой дом» заработает сам, как только
файлы появятся (перечитываются при изменении, без перезапуска).

Бот: при первом входе (после обязательной подписки) — «Откуда ты нас смотришь? Напиши свой ник 👇» с кнопками
Instagram / YouTube / TikTok / «У меня нет аккаунта»; старых игроков спрашивает один раз при следующем /start.
Ник есть в посёлке — картинка 800×800 с подсвеченным домом; нет — заявка «какой дом хочешь» (до 100 символов,
одна на аккаунт, можно изменить). /home (🏡 Мой дом), /nick — сменить ник.
Хозяйке (ADMIN_ID): /village_requests — файл заявок, /village_top — топ-50 домов игроков по уровню.
Картинки рисуются один раз и кэшируются в data/village/cache (сервер 1 ядро / 1 ГБ — без нагрузки).
"""
from __future__ import annotations

import csv
import html
import io
import json
import logging
import re
import time
from pathlib import Path

from aiogram import F, Router
from aiogram.filters import Command, Filter
from aiogram.types import (BufferedInputFile, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message)
from aiohttp import web

log = logging.getLogger("ferma.village")

PLATFORMS = {"instagram": "Instagram", "youtube": "YouTube", "tiktok": "TikTok"}
NICK_RE = re.compile(r"^[a-z0-9._-]{2,30}$")
WISH_MAX = 100
CROP = 800
ASK_TEXT = "Откуда ты нас смотришь? Напиши свой ник 👇"
NO_HOUSE = "Тебя пока нет в посёлке 😢 Какой дом хочешь? Напиши — построю в следующем выпуске!"
SCHEMA = """
CREATE TABLE IF NOT EXISTS village_profiles (
    user_id    INTEGER PRIMARY KEY,
    nick       TEXT,                -- нижний регистр, без @; NULL — «У меня нет аккаунта»
    platform   TEXT,                -- instagram | youtube | tiktok | none
    asked_at   INTEGER,             -- когда спросили (спрашиваем один раз)
    awaiting   TEXT,                -- что ждём от игрока в чате: nick:<площадка> | wish
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS village_requests (
    user_id    INTEGER PRIMARY KEY, -- одна заявка на аккаунт (можно изменить)
    nick       TEXT,
    platform   TEXT,
    wish       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
"""
# уровни дома в игре (названия — для подписи на картинке и /village_top; цены и бонус — в webapp/js/data.js)
HOME_NAMES = ["нет дома", "деревянный домик", "крепкая изба", "изба с верандой", "кирпичный дом", "двухэтажный дом",
              "коттедж", "коттедж+", "усадьба", "большая усадьба", "особняк"]


def normalize_nick(text: str) -> str | None:
    """«@Eduard949219», «instagram.com/eduard949219/», « tiktok.com/@x » → «eduard949219». Неверный — None."""
    s = (text or "").strip().lower()
    s = re.sub(r"^(https?://)?(www\.)?(instagram\.com|youtube\.com|tiktok\.com|m\.youtube\.com)/", "", s)
    s = s.strip("/ ").lstrip("@").split("?")[0].split("/")[0].lstrip("@")
    return s if NICK_RE.match(s) else None


# ---------- данные посёлка (экспорт из сериала) ----------
class VillageData:
    def __init__(self, folder: Path):
        self.folder = Path(folder)
        self.map_path = self.folder / "village_map.png"
        self.json_path = self.folder / "villagers.json"
        self.cache = self.folder / "cache"
        self._stamp = None
        self.by_nick: dict[str, dict] = {}

    def _reload(self) -> None:
        stamp = (self.json_path.stat().st_mtime if self.json_path.exists() else 0,
                 self.map_path.stat().st_mtime if self.map_path.exists() else 0)
        if stamp == self._stamp:
            return
        self._stamp = stamp
        self.by_nick = {}
        if self.json_path.exists():
            try:
                for v in json.loads(self.json_path.read_text(encoding="utf-8")):
                    n = normalize_nick(str(v.get("nick", "")))
                    if n:
                        self.by_nick[n] = v
            except (ValueError, TypeError) as e:
                log.warning("villagers.json не читается: %s", e)

    @property
    def ready(self) -> bool:
        self._reload()
        return bool(self.by_nick) and self.map_path.exists()

    def find(self, nick: str | None) -> dict | None:
        if not nick:
            return None
        self._reload()
        return self.by_nick.get(nick)

    def render(self, nick: str, level: int = 0) -> bytes | None:
        """Кусок карты ~800×800: дом подсвечен, стрелка и подпись с ником (и уровнем дома в игре). Кэш на диске."""
        v = self.find(nick)
        if not v or not self.map_path.exists():
            return None
        self.cache.mkdir(parents=True, exist_ok=True)
        key = self.cache / f"{nick}-{int(level)}-{int(self._stamp[1])}.png"
        if key.exists():
            return key.read_bytes()
        from PIL import Image, ImageDraw  # тяжёлую библиотеку грузим только когда рисуем
        with Image.open(self.map_path) as im:
            im = im.convert("RGB")
            W, H = im.size
            x, y = int(v["x"]), int(v["y"])
            side = min(CROP, W, H)
            left = max(0, min(W - side, x - side // 2))
            top = max(0, min(H - side, y - side // 2))
            img = im.crop((left, top, left + side, top + side))
        hx, hy = x - left, y - top
        d = ImageDraw.Draw(img, "RGBA")
        r = max(46, side // 12)
        for k, a in ((r + 26, 60), (r + 14, 110)):  # мягкое свечение вокруг дома
            d.ellipse((hx - k, hy - k, hx + k, hy + k), outline=(255, 210, 63, a), width=10)
        d.ellipse((hx - r, hy - r, hx + r, hy + r), outline=(255, 196, 0, 255), width=7)
        # стрелка сверху (или снизу, если дом у верхнего края)
        up = hy > side * 0.33
        tip = hy - r - 8 if up else hy + r + 8
        base = tip - 120 if up else tip + 120
        d.line((hx, base, hx, tip - (22 if up else -22)), fill=(226, 59, 46, 255), width=14)
        d.polygon([(hx, tip), (hx - 26, tip - (34 if up else -34)), (hx + 26, tip - (34 if up else -34))], fill=(226, 59, 46, 255))
        # подпись
        font = _font(38)
        small = _font(26)
        label = f"@{nick}"
        sub = f"дом ур. {level} · {HOME_NAMES[min(level, 10)]}" if level else None
        tw = d.textlength(label, font=font)
        sw = d.textlength(sub, font=small) if sub else 0
        bw, bh = max(tw, sw) + 40, (98 if sub else 62)
        bx = max(10, min(side - bw - 10, hx - bw / 2))
        by = base - bh - 10 if up else base + 10
        by = max(10, min(side - bh - 10, by))
        d.rounded_rectangle((bx, by, bx + bw, by + bh), radius=18, fill=(251, 243, 227, 240), outline=(59, 42, 31, 255), width=4)
        d.text((bx + 20, by + 10), label, font=font, fill=(59, 42, 31, 255))
        if sub:
            d.text((bx + 20, by + 58), sub, font=small, fill=(47, 138, 47, 255))
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        try:
            key.write_bytes(data)
            old = sorted(self.cache.glob("*.png"), key=lambda p: p.stat().st_mtime)
            for p in old[:-500]:  # кэш не больше 500 картинок
                p.unlink(missing_ok=True)
        except OSError as e:
            log.warning("кэш картинки: %s", e)
        return data


_FONTS: dict[int, object] = {}


def _font(size: int):
    if size not in _FONTS:
        from PIL import ImageFont
        for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"):
            try:
                _FONTS[size] = ImageFont.truetype(path, size)
                break
            except OSError:
                continue
        else:
            _FONTS[size] = ImageFont.load_default(size=size)
    return _FONTS[size]


# ---------- хранилище ----------
class VillageDB:
    def __init__(self, db):
        self.db = db

    async def init(self) -> None:
        await self.db.conn.executescript(SCHEMA)
        await self.db.conn.commit()

    async def profile(self, uid: int) -> dict | None:
        async with self.db.conn.execute("SELECT * FROM village_profiles WHERE user_id=?", (uid,)) as c:
            r = await c.fetchone()
        return dict(r) if r else None

    async def upsert(self, uid: int, **kw) -> None:
        p = await self.profile(uid) or {"user_id": uid, "nick": None, "platform": None, "asked_at": None, "awaiting": None}
        p.update(kw)
        await self.db.conn.execute(
            "INSERT INTO village_profiles(user_id,nick,platform,asked_at,awaiting,updated_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET nick=excluded.nick, platform=excluded.platform, asked_at=excluded.asked_at, "
            "awaiting=excluded.awaiting, updated_at=excluded.updated_at",
            (uid, p["nick"], p["platform"], p["asked_at"], p["awaiting"], int(time.time())))
        await self.db.conn.commit()

    async def request(self, uid: int) -> dict | None:
        async with self.db.conn.execute("SELECT * FROM village_requests WHERE user_id=?", (uid,)) as c:
            r = await c.fetchone()
        return dict(r) if r else None

    async def save_request(self, uid: int, nick: str | None, platform: str | None, wish: str) -> None:
        now = int(time.time())
        await self.db.conn.execute(
            "INSERT INTO village_requests(user_id,nick,platform,wish,created_at,updated_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET nick=excluded.nick, platform=excluded.platform, wish=excluded.wish, updated_at=excluded.updated_at",
            (uid, nick, platform, wish[:WISH_MAX], now, now))
        await self.db.conn.commit()

    async def all_requests(self) -> list[dict]:
        async with self.db.conn.execute("SELECT * FROM village_requests ORDER BY updated_at DESC") as c:
            return [dict(r) for r in await c.fetchall()]

    async def home_level(self, uid: int) -> int:
        """Уровень «Моего дома» из сохранения игры."""
        async with self.db.conn.execute("SELECT data FROM saves WHERE user_id=?", (uid,)) as c:
            r = await c.fetchone()
        try:
            return int(((json.loads(r["data"]) or {}).get("game") or {}).get("vhome") or 0) if r else 0
        except (ValueError, TypeError):
            return 0

    async def top_homes(self, limit: int = 50) -> list[dict]:
        out = []
        async with self.db.conn.execute(
                "SELECT s.user_id, s.data, vp.nick, vp.platform, p.name FROM saves s "
                "LEFT JOIN village_profiles vp ON vp.user_id = s.user_id "
                "LEFT JOIN players p ON p.player_key = 'tg:' || s.user_id") as c:
            for r in await c.fetchall():
                try:
                    g = (json.loads(r["data"]) or {}).get("game") or {}
                except ValueError:
                    continue
                lvl = int(g.get("vhome") or 0)
                if lvl > 0:
                    out.append({"user_id": r["user_id"], "nick": r["nick"], "platform": r["platform"], "name": r["name"], "level": lvl,
                                "options": g.get("vhomeOpts") or [], "paid": int(g.get("vhomePaid") or 0)})
        out.sort(key=lambda x: (-x["level"], -x["paid"]))
        return out[:limit]


# ---------- тексты и клавиатуры ----------
def ask_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Instagram", callback_data="vnick:instagram"), InlineKeyboardButton(text="YouTube", callback_data="vnick:youtube"),
         InlineKeyboardButton(text="TikTok", callback_data="vnick:tiktok")],
        [InlineKeyboardButton(text="У меня нет аккаунта", callback_data="vnick:none")]])


def house_caption(nick: str, v: dict) -> str:
    cap = f"🏡 {html.escape(nick)}, вот твой дом! Житель №{v.get('number', '?')} · появился в выпуске {v.get('episode', '?')}"
    if v.get("special"):
        cap += f"\n✨ {html.escape(str(v['special']))}"
    return cap


def make_router(vdb: VillageDB, data: VillageData, admin_id: int, play_keyboard, welcome: str) -> Router:
    """Роутер для лички (подключать в private ДО fallback «Жми Играть»)."""
    r = Router(name="village")

    class Awaiting(Filter):
        """Ждём от этого игрока ник или пожелание (а не обычный текст)."""
        async def __call__(self, message: Message) -> bool:
            if not message.from_user or not message.text or message.text.startswith("/"):
                return False
            p = await vdb.profile(message.from_user.id)
            return bool(p and p.get("awaiting"))

    async def show_house(message: Message, uid: int, nick: str | None, platform: str | None) -> None:
        """После ввода ника и по кнопке «🏡 Мой дом»: дом на карте или заявка."""
        v = data.find(nick)
        if v:
            png = data.render(nick, await vdb.home_level(uid))
            if png:
                await message.answer_photo(BufferedInputFile(png, "home.png"), caption=house_caption(nick, v), reply_markup=play_keyboard())
                return
        req = await vdb.request(uid)
        await vdb.upsert(uid, awaiting="wish")
        extra = f"\n\nТвоя заявка сейчас: «{html.escape(req['wish'])}». Напиши новую — заменю." if req else ""
        if nick and not data.ready:
            extra = "\n\n(Карта посёлка обновляется — если ты уже житель, дом появится здесь чуть позже.)" + extra
        await message.answer(NO_HOUSE + extra)

    async def ask(message: Message, uid: int) -> None:
        await vdb.upsert(uid, asked_at=int(time.time()), awaiting=None)
        await message.answer(ASK_TEXT, reply_markup=ask_keyboard())

    @r.callback_query(F.data.startswith("vnick:"))
    async def choose(cq: CallbackQuery) -> None:
        plat = cq.data.split(":", 1)[1]
        uid = cq.from_user.id
        if plat == "none":
            await vdb.upsert(uid, nick=None, platform="none", awaiting=None, asked_at=int(time.time()))
            await cq.answer("Хорошо! Ник можно добавить потом — /nick")
            try:
                await cq.message.edit_text("Хорошо, без ника! Добавить его можно в любой момент — /nick 🙂")
            except Exception:  # noqa: BLE001
                pass
            await cq.message.answer(welcome, reply_markup=play_keyboard())
            return
        if plat not in PLATFORMS:
            return await cq.answer()
        await vdb.upsert(uid, platform=plat, awaiting=f"nick:{plat}", asked_at=int(time.time()))
        await cq.answer()
        try:
            await cq.message.edit_text(f"Напиши свой ник в {PLATFORMS[plat]} 👇 (можно с @ или ссылкой на профиль)")
        except Exception:  # noqa: BLE001
            await cq.message.answer(f"Напиши свой ник в {PLATFORMS[plat]} 👇")

    @r.message(Awaiting())
    async def got_text(message: Message) -> None:
        uid = message.from_user.id
        p = await vdb.profile(uid)
        aw = p["awaiting"]
        if aw.startswith("nick"):
            nick = normalize_nick(message.text)
            if not nick:
                return await message.answer("Не похоже на ник 🤔 Напиши латиницей, как в профиле: например, eduard949219.\n"
                                            "Нет аккаунта — жми кнопку ниже.", reply_markup=ask_keyboard())
            plat = aw.split(":", 1)[1] if ":" in aw else p.get("platform")
            v = data.find(nick)
            if v and not plat and v.get("platform"):
                plat = v["platform"]
            await vdb.upsert(uid, nick=nick, platform=plat, awaiting=None)
            await show_house(message, uid, nick, plat)  # нашёлся — картинка с кнопкой «Играть»; нет — просим пожелание
            return
        if aw == "wish":
            wish = " ".join(message.text.split())
            if len(wish) > WISH_MAX:
                return await message.answer(f"Чуть короче, пожалуйста — до {WISH_MAX} символов (сейчас {len(wish)}).")
            await vdb.save_request(uid, p.get("nick"), p.get("platform"), wish)
            await vdb.upsert(uid, awaiting=None)
            await message.answer(f"📝 Записал: «{html.escape(wish)}». Постараюсь построить в следующем выпуске!\n"
                                 "Передумаешь — нажми /home и напиши новое пожелание.", reply_markup=play_keyboard())

    @r.message(Command("nick"))
    async def nick_cmd(message: Message) -> None:
        p = await vdb.profile(message.from_user.id)
        now = f"Сейчас: <b>{html.escape(p['nick'])}</b> ({PLATFORMS.get(p['platform'], 'площадка не указана')}). " if p and p.get("nick") else ""
        await vdb.upsert(message.from_user.id, asked_at=int(time.time()), awaiting=None)
        await message.answer(now + ASK_TEXT, reply_markup=ask_keyboard())

    @r.message(Command("home"))
    @r.message(F.text == "🏡 Мой дом")
    async def home_cmd(message: Message) -> None:
        uid = message.from_user.id
        p = await vdb.profile(uid)
        if not p or not p.get("nick"):
            return await ask(message, uid)
        await show_house(message, uid, p["nick"], p.get("platform"))

    @r.message(Command("village_requests"))
    async def requests_cmd(message: Message) -> None:
        if not admin_id or message.from_user.id != admin_id:
            return
        rows = await vdb.all_requests()
        if not rows:
            return await message.answer("Заявок на дома пока нет.")
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["telegram_id", "ник", "площадка", "пожелание", "дата"])
        for q in rows:
            w.writerow([q["user_id"], q["nick"] or "", q["platform"] or "", q["wish"], time.strftime("%Y-%m-%d %H:%M", time.gmtime(q["updated_at"] + 3 * 3600))])
        await message.answer_document(BufferedInputFile(("﻿" + buf.getvalue()).encode("utf-8"), "village_requests.csv"),
                                      caption=f"🏡 Заявки на дома: {len(rows)}")

    @r.message(Command("village_top"))
    async def top_cmd(message: Message) -> None:
        if not admin_id or message.from_user.id != admin_id:
            return
        top = await vdb.top_homes(50)
        if not top:
            return await message.answer("Домов в игре пока никто не строил.")
        lines = [f"🏡 <b>Топ-{len(top)} домов игроков</b> (для следующего выпуска)"]
        for i, t in enumerate(top, 1):
            who = f"@{t['nick']} ({PLATFORMS.get(t['platform'], '—')})" if t["nick"] else f"{t['name'] or 'игрок'} — без ника"
            opts = f" · {', '.join(t['options'])}" if t["options"] else ""
            lines.append(f"{i}. {html.escape(who)} — ур. {t['level']} {HOME_NAMES[min(t['level'], 10)]}{html.escape(opts)}")
        text = "\n".join(lines)
        for i in range(0, len(text), 3900):
            await message.answer(text[i:i + 3900])

    return r


async def needs_ask(vdb: VillageDB, uid: int) -> bool:
    """Спрашивали ли уже ник (новых — при первом входе, старых — один раз при следующем)."""
    p = await vdb.profile(uid)
    return not p or not p.get("asked_at")


async def ask_first(message: Message, vdb: VillageDB, uid: int) -> None:
    await vdb.upsert(uid, asked_at=int(time.time()), awaiting=None)
    await message.answer(ASK_TEXT, reply_markup=ask_keyboard())


# ---------- API для игры ----------
VDB = web.AppKey("village_db", VillageDB)
VDATA = web.AppKey("village_data", VillageData)


def setup_api(app: web.Application, vdb: VillageDB, data: VillageData, current_user) -> None:
    app[VDB], app[VDATA] = vdb, data

    async def me(request: web.Request) -> dict:
        uid = int(current_user(request)["id"])
        p = await request.app[VDB].profile(uid) or {}
        v = request.app[VDATA].find(p.get("nick"))
        req = await request.app[VDB].request(uid)
        return {"nick": p.get("nick"), "platform": p.get("platform"), "villager": v, "mapReady": request.app[VDATA].ready,
                "wish": req["wish"] if req else None}

    async def get_me(request: web.Request) -> web.Response:
        return web.json_response(await me(request))

    async def put_profile(request: web.Request) -> web.Response:
        uid = int(current_user(request)["id"])
        try:
            body = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text="bad json")
        plat = body.get("platform") if body.get("platform") in (*PLATFORMS, "none") else None
        if plat == "none" or not (body.get("nick") or "").strip():
            await request.app[VDB].upsert(uid, nick=None, platform="none", awaiting=None, asked_at=int(time.time()))
        else:
            nick = normalize_nick(body.get("nick", ""))
            if not nick:
                raise web.HTTPBadRequest(text="Ник — латиницей, цифры, точка, _ или -, от 2 до 30 символов")
            await request.app[VDB].upsert(uid, nick=nick, platform=plat, awaiting=None, asked_at=int(time.time()))
        return web.json_response(await me(request))

    async def post_wish(request: web.Request) -> web.Response:
        uid = int(current_user(request)["id"])
        try:
            wish = " ".join(str((await request.json()).get("wish", "")).split())
        except ValueError:
            raise web.HTTPBadRequest(text="bad json")
        if not wish or len(wish) > WISH_MAX:
            raise web.HTTPBadRequest(text=f"Пожелание — от 1 до {WISH_MAX} символов")
        p = await request.app[VDB].profile(uid) or {}
        await request.app[VDB].save_request(uid, p.get("nick"), p.get("platform"), wish)
        return web.json_response(await me(request))

    async def home_png(request: web.Request) -> web.Response:
        uid = int(current_user(request)["id"])
        p = await request.app[VDB].profile(uid) or {}
        try:
            level = max(0, min(10, int(request.query.get("level", "0"))))
        except ValueError:
            level = 0
        png = request.app[VDATA].render(p.get("nick"), level) if p.get("nick") else None
        if not png:
            raise web.HTTPNotFound(text="дома на карте нет")
        return web.Response(body=png, content_type="image/png", headers={"Cache-Control": "private, max-age=600"})

    app.router.add_get("/api/village/me", get_me)
    app.router.add_put("/api/village/profile", put_profile)
    app.router.add_post("/api/village/wish", post_wish)
    app.router.add_get("/api/village/home.png", home_png)
