"""HTTP: раздаёт игру (webapp/) и API сохранений.

GET  /                 — игра
GET  /config.js        — настройки фронтенда (имя бота)
GET  /api/save         — сохранение игрока      (заголовок X-Telegram-Init-Data)
PUT  /api/save         — записать сохранение
POST /api/result       — итог забега (для будущего рейтинга)
GET  /health           — проверка живости
"""
import json
import logging

from aiohttp import web

from auth import AuthError, validate_init_data
from config import Config
from db import DB

log = logging.getLogger("ferma.web")
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
    return web.Response(status=204)


async def post_result(request: web.Request) -> web.Response:
    user = current_user(request)
    try:
        await request.app[DBK].add_result(user["id"], await request.json())
    except (ValueError, TypeError, json.JSONDecodeError) as e:
        raise web.HTTPBadRequest(text=str(e))
    return web.Response(status=204)


async def config_js(request: web.Request) -> web.Response:
    cfg = {"apiBase": "", "botUsername": request.app.get(BOT_NAME, "")}
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
    return resp


def make_app(cfg: Config, db: DB, bot_username: str = "") -> web.Application:
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
    app.router.add_static("/", cfg.webapp_dir, show_index=False)
    return app
