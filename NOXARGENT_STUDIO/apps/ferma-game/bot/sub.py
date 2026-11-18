"""Обязательная подписка на канал: и в боте (/start), и в игре (GET /api/sub).

Проверка — getChatMember(канал, user_id). Для этого бот должен быть АДМИНИСТРАТОРОМ канала
(права не нужны). Если бот ещё не админ или Telegram недоступен — не мешаем играть (пускаем) и
пишем об этом в лог и владельцу один раз, чтобы игроки не упёрлись в ошибку.
"""
from __future__ import annotations

import logging
import time

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiohttp import web

log = logging.getLogger("ferma.sub")
OK_STATUSES = {"creator", "administrator", "member", "restricted"}
CACHE_OK, CACHE_NO = 10 * 60, 5   # подписан — помним 10 минут; не подписан — перепроверяем почти сразу


class SubChecker:
    def __init__(self, bot, channel: str, required: bool, admin_id: int = 0):
        self.bot, self.channel, self.required, self.admin_id = bot, channel, required, admin_id
        self.cache: dict[int, tuple[bool, float]] = {}
        self.warned = False

    async def check(self, uid: int, fresh: bool = False) -> bool:
        if not self.required or self.bot is None:
            return True
        hit = self.cache.get(uid)
        if hit and not fresh and time.time() - hit[1] < (CACHE_OK if hit[0] else CACHE_NO):
            return hit[0]
        try:
            m = await self.bot.get_chat_member(chat_id=self.channel, user_id=uid)
            ok = m.status in OK_STATUSES and getattr(m, "is_member", True) is not False
        except Exception as e:  # noqa: BLE001 — чаще всего бот не админ канала
            log.warning("проверка подписки не работает (%s): %s", self.channel, e)
            if not self.warned and self.admin_id:
                self.warned = True
                try:
                    await self.bot.send_message(self.admin_id, f"⚠️ Не могу проверить подписку на {self.channel}: {e}\n"
                                                               "Добавьте бота администратором канала (без прав). Пока игроков пускаю без проверки.")
                except Exception:  # noqa: BLE001
                    pass
            return True
        self.cache[uid] = (ok, time.time())
        return ok


SUB = web.AppKey("sub", SubChecker)


def setup_api(app: web.Application, sub: SubChecker, channel_url: str, current_user) -> None:
    app[SUB] = sub

    async def get_sub(request: web.Request) -> web.Response:
        user = current_user(request)
        fresh = request.query.get("fresh") == "1"
        ok = await request.app[SUB].check(int(user["id"]), fresh=fresh)
        return web.json_response({"required": request.app[SUB].required, "ok": ok, "url": channel_url})

    app.router.add_get("/api/sub", get_sub)


SUB_TEXT = ("🧑‍🌾 Чтобы играть в «Ферму деда», подпишитесь на канал <b>«Ферма с нуля»</b> — "
            "там сериал, по которому сделана игра, и итоги рейтинга фермеров.\n\n"
            "Подпишитесь и нажмите «✅ Я подписался».")


def sub_keyboard(channel_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📺 Подписаться на канал", url=channel_url)],
        [InlineKeyboardButton(text="✅ Я подписался", callback_data="check_sub")],
    ])


def make_router(sub: SubChecker, channel_url: str, welcome: str, play_keyboard) -> Router:
    r = Router()

    @r.callback_query(F.data == "check_sub")
    async def check_sub(cb: CallbackQuery) -> None:
        if await sub.check(cb.from_user.id, fresh=True):
            await cb.answer("Спасибо за подписку! 🌾")
            try:
                await cb.message.edit_text(welcome, reply_markup=play_keyboard())
            except Exception:  # noqa: BLE001
                await cb.message.answer(welcome, reply_markup=play_keyboard())
        else:
            await cb.answer("Подписка пока не видна. Подпишитесь на канал и нажмите ещё раз.", show_alert=True)

    return r


async def gate(message: Message, sub: SubChecker, channel_url: str) -> bool:
    """True — можно играть. Иначе отправляет просьбу подписаться."""
    if await sub.check(message.from_user.id):
        return True
    await message.answer(SUB_TEXT, reply_markup=sub_keyboard(channel_url))
    return False
