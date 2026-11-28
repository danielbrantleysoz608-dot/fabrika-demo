"""Сетевые сбои Telegram: повторы, разбор ошибок, одно предупреждение хозяйке при долгих сбоях.

- net_retry(fn): 3 попытки с паузой 1 с и 3 с, если ошибка сетевая (ClientOSError, таймаут, SSL, 5xx Telegram,
  «слишком часто»). Ошибки-ответы Telegram (нет прав, нет такого чата) не повторяются — сразу наверх.
- is_network_error / is_rights_error — чтобы «нет прав» писать только когда Telegram реально так ответил.
- HEALTH: если сбои связи идут подряд больше 10 минут — одно сообщение хозяйке «Связь с Telegram нестабильна»,
  не чаще раза в час. Любой успешный запрос обнуляет счёт.
"""
from __future__ import annotations

import asyncio
import logging
import ssl
import time

import aiohttp
from aiogram.exceptions import (TelegramBadRequest, TelegramForbiddenError, TelegramNetworkError, TelegramRetryAfter,
                                TelegramServerError)

log = logging.getLogger("ferma.net")

PAUSES = (1.0, 3.0)          # 3 попытки: сразу, через 1 с, через 3 с
UNSTABLE_AFTER_S = 10 * 60
NOTICE_EVERY_S = 3600
RIGHTS_MARKERS = ("not enough rights", "chat_admin_required", "admin", "member list is inaccessible", "rights",
                  "not a member", "bot was kicked", "have no rights", "need administrator")


def is_network_error(e: BaseException) -> bool:
    if isinstance(e, (TelegramNetworkError, TelegramServerError, TelegramRetryAfter, aiohttp.ClientError,
                      asyncio.TimeoutError, TimeoutError, ssl.SSLError, ConnectionError)):
        return True
    s = str(e).lower()
    return any(k in s for k in ("ssl", "timeout", "timed out", "connection reset", "cannot connect", "server disconnected",
                                "clientoserror", "application_data_after_close_notify"))


def is_rights_error(e: BaseException) -> bool:
    """Telegram ответил, что у бота нет прав / он не админ (а не сеть)."""
    if is_network_error(e):
        return False
    if isinstance(e, TelegramForbiddenError):
        return True
    return isinstance(e, TelegramBadRequest) and any(k in str(e).lower() for k in RIGHTS_MARKERS)


class Health:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.bot = None
        self.owner_id = 0
        self.fail_since: float | None = None
        self.noticed_at = 0.0
        self.sleep = asyncio.sleep

    def setup(self, bot, owner_id: int) -> None:
        self.bot, self.owner_id = bot, owner_id

    def ok(self) -> None:
        self.fail_since = None

    async def fail(self, e: BaseException) -> None:
        now = self.clock()
        if self.fail_since is None:
            self.fail_since = now
        if now - self.fail_since >= UNSTABLE_AFTER_S and now - self.noticed_at >= NOTICE_EVERY_S and self.bot and self.owner_id:
            try:
                await self.bot.send_message(self.owner_id, "📡 Связь с Telegram нестабильна: запросы бота сбоят больше 10 минут подряд. "
                                                           "Игроков не блокирую, проверки повторю сами. "
                                                           f"Последняя ошибка: {str(e)[:150]}")
                self.noticed_at = now
            except Exception as e2:  # noqa: BLE001 — связь лежит, сообщение не ушло: попробуем при следующем сбое
                log.warning("не смог предупредить о связи: %s", e2)


HEALTH = Health()


async def net_retry(fn, *, what: str = "", health: Health | None = None):
    """fn — функция без аргументов, возвращающая корутину (например lambda: bot.get_chat_member(...))."""
    h = health or HEALTH
    last = None
    for i in range(len(PAUSES) + 1):
        try:
            res = await fn()
            h.ok()
            return res
        except Exception as e:  # noqa: BLE001
            if not is_network_error(e):
                h.ok()  # Telegram ответил — связь есть
                raise
            last = e
            if i < len(PAUSES):
                pause = min(float(getattr(e, "retry_after", 0) or 0), 5.0) or PAUSES[i]
                log.info("сетевой сбой%s (попытка %s): %s — повтор через %s с", f" {what}" if what else "", i + 1, e, pause)
                await h.sleep(pause)
    await h.fail(last)
    raise last
