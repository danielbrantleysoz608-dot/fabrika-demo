"""Обязательная подписка: канал «Ферма с нуля» И чат фермеров. Проверка — на сервере, getChatMember.

Бот должен быть администратором и канала, и чата (права не нужны — только статус админа).
- Проверяем при входе (/start, открытие игры) и не чаще раза в 6 часов, пока подписка есть.
- Сетевой сбой (ClientOSError, таймаут, SSL) — 3 попытки с паузой; не вышло — пускаем игрока, владельцу НЕ пишем
  (о сбоях дольше 10 минут — одно сообщение, см. tgnet.py). Бот не админ (так ответил Telegram) — пускаем и один раз пишем владельцу.
- Владельцу (ADMIN_ID) проверка не нужна. Прогресс при отписке не трогаем — просто снова просим подписаться.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiohttp import web

from tgnet import is_network_error, is_rights_error, net_retry

log = logging.getLogger("ferma.sub")
OK_STATUSES = {"creator", "administrator", "member", "restricted"}
CACHE_OK = 6 * 3600      # подписан — следующая проверка через 6 часов
CACHE_NO = 5             # не подписан — перепроверяем почти сразу (нажал «Проверить»)


@dataclass(frozen=True)
class Need:
    key: str      # channel | chat
    chat: str     # @predstav_kanal
    url: str      # https://t.me/predstav_kanal
    title: str    # «📺 Канал «Ферма с нуля»»
    button: str   # «Подписаться»


def default_needs(channel_id="@predstav_kanal", channel_url="https://t.me/predstav_kanal",
                  chat_id="@predstav_chat", chat_url="https://t.me/predstav_chat") -> list[Need]:
    out = [Need("channel", channel_id, channel_url, "📺 Канал «Ферма с нуля»", "Подписаться")]
    if chat_id:
        out.append(Need("chat", chat_id, chat_url, "💬 Чат фермеров", "Вступить"))
    return out


class SubChecker:
    def __init__(self, bot, needs: list[Need] | str, required: bool, admin_id: int = 0):
        if isinstance(needs, str):  # совместимость: только канал
            needs = default_needs(channel_id=needs, chat_id="")
        self.bot, self.needs, self.required, self.admin_id = bot, needs, required, admin_id
        self.cache: dict[tuple[int, str], tuple[bool, float]] = {}
        self.warned: set[str] = set()

    async def one(self, uid: int, need: Need, fresh: bool) -> bool:
        hit = self.cache.get((uid, need.key))
        if hit and not fresh and time.time() - hit[1] < (CACHE_OK if hit[0] else CACHE_NO):
            return hit[0]
        try:
            # сетевой сбой (ClientOSError, таймаут, SSL) — 3 попытки с паузой; ответ Telegram — сразу
            m = await net_retry(lambda: self.bot.get_chat_member(chat_id=need.chat, user_id=uid), what=f"подписка {need.chat}")
            ok = m.status in OK_STATUSES and getattr(m, "is_member", True) is not False
        except Exception as e:  # noqa: BLE001 — не блокируем игрока
            if is_network_error(e):
                # связь с Telegram: хозяйке не пишем (о долгих сбоях — одно сообщение в tgnet.HEALTH), не кэшируем
                log.warning("проверка %s: сетевой сбой после повторов: %s", need.chat, e)
                return True
            log.warning("проверка %s не работает: %s", need.chat, e)
            key = need.key + (":rights" if is_rights_error(e) else ":api")
            if key not in self.warned and self.admin_id:
                self.warned.add(key)
                text = (f"⚠️ Не могу проверить подписку на {need.chat}: Telegram отвечает, что бот там не администратор.\n"
                        "Сделайте бота администратором (права не нужны). Пока игроков пускаю без этой проверки."
                        if is_rights_error(e) else
                        f"⚠️ Не могу проверить подписку на {need.chat}: Telegram ответил «{str(e)[:200]}».\n"
                        "Проверьте CHANNEL_ID / CHAT_ID в .env. Пока игроков пускаю без этой проверки.")
                try:
                    await self.bot.send_message(self.admin_id, text)
                except Exception:  # noqa: BLE001
                    pass
            return True
        self.cache[(uid, need.key)] = (ok, time.time())
        return ok

    async def status(self, uid: int, fresh: bool = False) -> dict:
        """{'ok': bool, 'items': [{key, title, url, button, ok}]}"""
        if not self.required or self.bot is None or (self.admin_id and uid == self.admin_id):
            return {"ok": True, "items": []}
        items = []
        for n in self.needs:
            items.append({"key": n.key, "title": n.title, "url": n.url, "button": n.button, "ok": await self.one(uid, n, fresh)})
        return {"ok": all(i["ok"] for i in items), "items": items}

    async def check(self, uid: int, fresh: bool = False) -> bool:
        return (await self.status(uid, fresh))["ok"]


SUB = web.AppKey("sub", SubChecker)


def setup_api(app: web.Application, sub: SubChecker, channel_url: str, current_user) -> None:
    app[SUB] = sub

    async def get_sub(request: web.Request) -> web.Response:
        user = current_user(request)
        st = await request.app[SUB].status(int(user["id"]), fresh=request.query.get("fresh") == "1")
        return web.json_response({"required": request.app[SUB].required, "ok": st["ok"], "items": st["items"],
                                  "url": channel_url, "recheckHours": CACHE_OK // 3600})

    app.router.add_get("/api/sub", get_sub)


SUB_TEXT = "🧑‍🌾 Чтобы играть — подпишись на канал и вступи в чат фермеров 🐔"


def sub_message(items: list[dict]) -> tuple[str, InlineKeyboardMarkup]:
    lines = [f"{'✅' if i['ok'] else '❌'} {i['title']}" for i in items]
    kb = [[InlineKeyboardButton(text=f"{i['button']}: {i['title']}", url=i["url"])] for i in items if not i["ok"]]
    kb.append([InlineKeyboardButton(text="🔄 Проверить подписку", callback_data="check_sub")])
    return SUB_TEXT + "\n\n" + "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=kb)


def make_router(sub: SubChecker, channel_url: str, welcome: str, play_keyboard, after_ok=None) -> Router:
    """after_ok(message, user_id) -> True, если сам ответил (например, спросил ник при первом входе)."""
    r = Router()

    @r.callback_query(F.data == "check_sub")
    async def check_sub(cb: CallbackQuery) -> None:
        st = await sub.status(cb.from_user.id, fresh=True)
        if st["ok"]:
            await cb.answer("Всё на месте — добро пожаловать на ферму! 🌾")
            if after_ok and await after_ok(cb.message, cb.from_user.id):
                return
            try:
                await cb.message.edit_text(welcome, reply_markup=play_keyboard())
            except Exception:  # noqa: BLE001
                await cb.message.answer(welcome, reply_markup=play_keyboard())
        else:
            text, kb = sub_message(st["items"])
            await cb.answer("Пока не всё: " + ", ".join(i["title"] for i in st["items"] if not i["ok"]), show_alert=True)
            try:
                await cb.message.edit_text(text, reply_markup=kb)
            except Exception:  # noqa: BLE001 — текст не изменился
                pass

    return r


async def gate(message: Message, sub: SubChecker, channel_url: str) -> bool:
    """True — можно играть. Иначе отправляет экран подписки с галочками."""
    st = await sub.status(message.from_user.id)
    if st["ok"]:
        return True
    text, kb = sub_message(st["items"])
    await message.answer(text, reply_markup=kb)
    return False
