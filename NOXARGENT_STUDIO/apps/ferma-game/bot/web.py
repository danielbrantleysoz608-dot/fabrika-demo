"""HTTP: раздаёт игру (webapp/) и API сохранений.

GET  /                 — игра
GET  /config.js        — настройки фронтенда (имя бота)
GET  /api/save         — сохранение игрока      (заголовок X-Telegram-Init-Data)
PUT  /api/save         — записать сохранение
POST /api/result       — итог забега
POST /api/score        — капитал фермы для рейтинга
GET  /api/leaderboard  — топ-100 (?period=all|week) + своё место
GET  /health           — проверка живости
GET  /api/shop/catalog, POST /api/shop/invoice, GET /api/shop/pending, POST /api/shop/ack — магазин за звёзды
"""
import json
import logging
import mimetypes
import re

from aiohttp import web

from auth import AuthError, validate_init_data
from config import Config
from db import DB
from shop import SHOP

log = logging.getLogger("ferma.web")

# На Windows тип файла берётся из реестра, и .js часто отдаётся как text/plain —
# тогда браузер не запускает модули игры (пустой голубой экран). Задаём типы явно.
for _ext, _type in {".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css",
                    ".svg": "image/svg+xml", ".json": "application/json", ".html": "text/html", ".png": "image/png",
                    ".webp": "image/webp", ".woff2": "font/woff2"}.items():
    mimetypes.add_type(_type, _ext)
CFG = web.AppKey("cfg", Config)
DBK = web.AppKey("db", DB)
BOT_NAME = web.AppKey("bot_username", str)

DEV_USER = {"id": 1, "first_name": "Dev"}


def current_user(request: web.Request) -> dict:
    cfg = request.app[CFG]
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data and cfg.dev_mode:
        return DEV_USER
    try:
        return validate_init_data(init_data, cfg.bot_token, cfg.init_data_ttl)
    except AuthError as e:
        raise web.HTTPUnauthorized(text=json.dumps({"error": str(e)}), content_type="application/json")


ANON_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# невидимые символы (пустые имена в Telegram делают из них) — не считаем за имя
INVISIBLE = re.compile(r"[\s\u200b-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3164\ufeff\u115f\u1160\uffa0]+")


def clean_name(name: str | None) -> str:
    name = re.sub(r"[<>\n\r\t]", "", name or "").strip()
    return name if INVISIBLE.sub("", name) else ""


def player_identity(request: web.Request) -> tuple[str, str, str | None]:
    """Кто играет: (player_key, имя, anon_key).
    В Telegram — "tg:<id>" из подписанного initData. Без Telegram (заглушка) — "anon:<id>" из заголовка X-Player-Id.
    Переход на Telegram ничего не ломает: тот же код, просто появляется initData."""
    cfg = request.app[CFG]
    anon_id = request.headers.get("X-Player-Id", "")
    anon_key = f"anon:{anon_id}" if ANON_RE.match(anon_id) else None
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if init_data:
        user = current_user(request)
        name = clean_name(" ".join(x for x in (user.get("first_name"), (user.get("last_name") or "")[:1]) if x))
        if not name and user.get("username"):
            name = "@" + str(user["username"])[:30]
        return f"tg:{user['id']}", name, anon_key
    if cfg.allow_anon and anon_key:
        raw = request.headers.get("X-Player-Name", "")
        try:
            from urllib.parse import unquote
            raw = unquote(raw)
        except Exception:  # noqa: BLE001
            raw = ""
        name = clean_name(raw)[:24]
        return anon_key, name, None  # пустое имя — сервер оставит прежнее (или даст «Фермер XXXX»)
    raise web.HTTPUnauthorized(text=json.dumps({"error": "no identity"}), content_type="application/json")


async def post_score(request: web.Request) -> web.Response:
    key, name, anon_key = player_identity(request)
    try:
        body = await request.json()
        capital, paid = int(body.get("capital", 0)), int(body.get("paid", 0))
        tier, year = int(body.get("tier", 0)), int(body.get("year", 1))
    except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
        raise web.HTTPBadRequest(text="bad score")
    db = request.app[DBK]
    if anon_key and key.startswith("tg:"):
        await db.link_anon(anon_key, key)
    rating = await db.submit_score(key, name, capital, paid, tier, year)
    return web.json_response({"ok": True, "rating": rating})


async def get_leaderboard(request: web.Request) -> web.Response:
    period = request.query.get("period") if request.query.get("period") in ("week", "month") else "all"
    try:
        key, _, _ = player_identity(request)
    except web.HTTPUnauthorized:
        key = None
    try:
        my_value = int(request.query.get("value", "0"))
    except ValueError:
        my_value = 0
    data = await request.app[DBK].leaderboard(period, key, my_value=my_value)
    shop = request.app.get(SHOP)
    if shop:  # значки у ников (Меценат, 🥈/🥉 Фермер недели) и победитель прошлой недели
        keys = [t.pop("key") for t in data["top"]] + ([key] if key else [])
        b = await shop.badges(keys)
        for t, k in zip(data["top"], keys):
            t["badges"] = b.get(k, [])
        if data.get("me") is not None and key:
            data["me"]["badges"] = b.get(key, [])
        from shop import NFT, PRIZES, last_winners
        data["lastWinners"] = await last_winners(request.app[DBK])
        data["prizes"] = PRIZES.get(period, {})
        data["nft"] = NFT
    else:
        for t in data["top"]:
            t.pop("key", None)
    return web.json_response(data)


async def get_save(request: web.Request) -> web.Response:
    user = current_user(request)
    db = request.app[DBK]
    await db.touch_user(user)
    data = await db.get_save(user["id"])
    return web.json_response(data)


async def put_save(request: web.Request) -> web.Response:
    user = current_user(request)
    try:
        data = await request.json()
    except json.JSONDecodeError:
        raise web.HTTPBadRequest(text="bad json")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="object expected")
    try:
        await request.app[DBK].put_save(user["id"], data)
    except ValueError as e:
        raise web.HTTPRequestEntityTooLarge(max_size=0, actual_size=0, text=str(e))
    # рейтинг обновляется при каждом сохранении: капитал считает игра (та же функция, что в шапке)
    score = data.get("score")
    if isinstance(score, dict) and "capital" in score:
        try:
            key, name, _ = player_identity(request)
            await request.app[DBK].submit_score(key, name, int(score["capital"]), 0, int(score.get("tier", 0)), int(score.get("year", 1)))
        except (ValueError, TypeError) as e:
            log.warning("рейтинг из сохранения: %s", e)
    return web.Response(status=204)


async def post_result(request: web.Request) -> web.Response:
    user = current_user(request)
    try:
        await request.app[DBK].add_result(user["id"], await request.json())
    except (ValueError, TypeError, json.JSONDecodeError) as e:
        raise web.HTTPBadRequest(text=str(e))
    return web.Response(status=204)


async def config_js(request: web.Request) -> web.Response:
    cfg = {"apiBase": "", "botUsername": request.app.get(BOT_NAME, ""), "shop": SHOP in request.app}
    return web.Response(text=f"window.FERMA_CONFIG = {json.dumps(cfg)};", content_type="application/javascript",
                        headers={"Cache-Control": "no-store"})


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(request.app[CFG].webapp_dir / "index.html", headers={"Cache-Control": "no-cache"})


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, **await request.app[DBK].stats()})


@web.middleware
async def no_cache_js(request: web.Request, handler):
    resp = await handler(request)
    if request.path.endswith((".js", ".css")):
        resp.headers.setdefault("Cache-Control", "no-cache")
        # тип — явно (на Windows иначе может уйти text/plain и игра не запустится)
        if isinstance(resp, web.FileResponse):
            resp.headers["Content-Type"] = "application/javascript; charset=utf-8" if request.path.endswith(".js") else "text/css; charset=utf-8"
    return resp


def make_app(cfg: Config, db: DB, bot_username: str = "", shop=None, bot=None, sub=None) -> web.Application:
    app = web.Application(middlewares=[no_cache_js], client_max_size=512 * 1024)
    app[CFG] = cfg
    app[DBK] = db
    app[BOT_NAME] = bot_username
    app.router.add_get("/", index)
    app.router.add_get("/config.js", config_js)
    app.router.add_get("/health", health)
    app.router.add_get("/api/save", get_save)
    app.router.add_put("/api/save", put_save)
    app.router.add_post("/api/result", post_result)
    app.router.add_post("/api/score", post_score)
    app.router.add_get("/api/leaderboard", get_leaderboard)
    if shop is not None:
        from shop import setup_api
        setup_api(app, shop, bot, cfg.test_prices, current_user)
    if sub is not None:
        from sub import setup_api as setup_sub
        setup_sub(app, sub, cfg.channel_url, current_user)
    app.router.add_static("/", cfg.webapp_dir, show_index=False)
    return app
