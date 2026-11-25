"""Проверка на робота при входе в чат фермеров (https://t.me/predstav_chat).

Новичок вступил → бот сразу запрещает ему писать и присылает в чат капчу:
  «Привет, <имя>! 🌾 Докажи, что ты не робот: нажми на 🐔 курицу» + 6 кнопок-эмодзи в случайном порядке.
- Нажимать может только сам новичок (остальным — всплывашка «Это не твоя проверка 🙂»).
- Верно → права возвращаются, капча и «X теперь в группе» удаляются, приветствие висит 60 с.
- Неверно → ещё одна попытка с новой картинкой; вторая ошибка — кик.
- 3 минуты без ответа → кик (бан и сразу разбан — можно зайти и пройти заново).
- 3 кика подряд → бан на сутки.
- Больше 5 входов за минуту (рейд) → вход закрыт на 30 минут: новичков бот сразу выводит без капчи
  (чтобы чат не засыпало капчами), хозяйке — сообщение в личку. Включить «Заявки на вступление» ботам Telegram
  не даёт — это можно сделать вручную, бот подскажет как.
- Админов чата и ADMIN_ID не проверяем; тех, кто уже был в чате, не трогаем (только новые вступления).

Состояние — в базе (captcha_*): после перезапуска бота таймеры продолжаются, никто не остаётся без прав навсегда.
Боту нужны права администратора: «Блокировка пользователей» и «Удаление сообщений».
"""
from __future__ import annotations

import asyncio
import html
import logging
import random
import secrets
import time
from collections import deque

from aiogram import Bot, F, Router
from aiogram.enums import ChatType
from tgnet import is_network_error, is_rights_error, net_retry
from aiogram.types import (CallbackQuery, ChatMemberUpdated, ChatPermissions, InlineKeyboardButton, InlineKeyboardMarkup,
                           Message, User)

log = logging.getLogger("ferma.captcha")

ANIMALS = [("🐔", "курицу"), ("🐄", "корову"), ("🐝", "пчелу"), ("🐷", "свинку"), ("🥕", "морковку"), ("🚜", "трактор")]
TIMEOUT_S = 180          # 3 минуты на ответ
RETRY_MIN_S = 60         # после ошибки — минимум минута на вторую попытку
TRIES = 2                # вторая ошибка — кик
WELCOME_TTL_S = 60
KICK_STREAK_BAN = 3      # 3 кика подряд — бан на сутки
STREAK_BAN_S = 24 * 3600
RAID_JOINS, RAID_WINDOW_S, RAID_S = 5, 60, 30 * 60
ADMIN_STATUSES = {"creator", "administrator"}
NO_PERMS = ChatPermissions(can_send_messages=False, can_send_audios=False, can_send_documents=False, can_send_photos=False,
                           can_send_videos=False, can_send_video_notes=False, can_send_voice_notes=False, can_send_polls=False,
                           can_send_other_messages=False, can_add_web_page_previews=False, can_invite_users=False,
                           can_pin_messages=False, can_change_info=False, can_manage_topics=False)
DEFAULT_PERMS = ChatPermissions(can_send_messages=True, can_send_audios=True, can_send_documents=True, can_send_photos=True,
                                can_send_videos=True, can_send_video_notes=True, can_send_voice_notes=True, can_send_polls=True,
                                can_send_other_messages=True, can_add_web_page_previews=True)
NEED_RIGHTS = ("⚠️ Проверке на робота в чате {chat} не хватает прав бота.\n"
               "Откройте чат → Управление → Администраторы → бот и включите:\n{list}\n"
               "Пока прав нет, новички заходят без проверки.")
RIGHT_NAMES = {"restrict": "• «Блокировка пользователей» (ограничить новичка и выгнать робота)",
               "delete": "• «Удаление сообщений» (убрать капчу и «X теперь в группе»)"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS captcha_pending (
    chat_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    name        TEXT,
    msg_id      INTEGER,            -- сообщение с капчей
    join_msg_id INTEGER,            -- системное «X теперь в группе»
    token       TEXT NOT NULL,      -- правильная кнопка
    tries       INTEGER NOT NULL DEFAULT 0,
    deadline    INTEGER NOT NULL,
    muted_until INTEGER NOT NULL DEFAULT 0,  -- был замучен админом до входа — после проверки мут возвращаем
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS captcha_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    result     TEXT NOT NULL,        -- pass | kick | ban | raid
    reason     TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS captcha_log_time ON captcha_log(created_at);
CREATE TABLE IF NOT EXISTS captcha_streak (
    chat_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    kicks      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS captcha_cleanup (
    chat_id   INTEGER NOT NULL,
    msg_id    INTEGER NOT NULL,
    delete_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, msg_id)
);
"""


def chat_matches(chat, target: str) -> bool:
    if chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return False
    if not target:
        return True
    t = target.strip()
    if t.lstrip("-").isdigit():
        return chat.id == int(t)
    return (chat.username or "").lower() == t.lstrip("@").lower()


def mention(user_id: int, name: str) -> str:
    return f'<a href="tg://user?id={user_id}">{html.escape((name or str(user_id))[:40])}</a>'


def challenge(user_id: int, name: str, retry: bool = False, rnd: random.Random | None = None):
    """Текст, клавиатура и токен правильной кнопки. Кнопки в случайном порядке, у каждой — случайный токен
    (по callback_data не понять, какая правильная)."""
    rnd = rnd or random.SystemRandom()
    order = ANIMALS[:]
    rnd.shuffle(order)
    emoji, word = rnd.choice(ANIMALS)
    tokens = {e: secrets.token_hex(3) for e, _ in order}
    who = mention(user_id, name)
    text = (f"Не то 🙈 Последняя попытка, {who}: нажми на {emoji} {word}" if retry
            else f"Привет, {who}! 🌾 Докажи, что ты не робот: нажми на {emoji} {word}")
    text += f"\n<i>На ответ — {TIMEOUT_S // 60} минуты.</i>" if not retry else ""
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=e, callback_data=f"cap:{user_id}:{tokens[e]}") for e, _ in order]])
    return text, kb, tokens[emoji]


class Captcha:
    def __init__(self, db, chat_target: str, owner_id: int = 0, game_bot: str = "ferma_deda_bot", clock=time.time):
        self.db = db
        self.chat_target = chat_target
        self.owner_id = owner_id
        self.game_bot = game_bot
        self.clock = clock
        self.joins: dict[int, deque] = {}
        self.raid_until: dict[int, float] = {}
        self.join_msgs: dict[tuple[int, int], int] = {}   # «X теперь в группе», пришедшее раньше капчи
        self.recent: dict[tuple[int, int], float] = {}     # защита от двойного старта (chat_member + сервисное сообщение)
        self.warned_rights: set = set()
        self.kicked: dict[tuple[int, int], float] = {}     # кого только что вывели — «X покинул группу» тоже удалим
        self.lock = asyncio.Lock()

    async def init(self) -> None:
        await self.db.conn.executescript(SCHEMA)
        await self.db.conn.commit()

    # ---------- база ----------
    async def _one(self, sql: str, args: tuple):
        async with self.db.conn.execute(sql, args) as c:
            return await c.fetchone()

    async def pending(self, chat_id: int, user_id: int):
        return await self._one("SELECT * FROM captcha_pending WHERE chat_id=? AND user_id=?", (chat_id, user_id))

    async def _log(self, chat_id: int, user_id: int, result: str, reason: str = "") -> None:
        await self.db.conn.execute("INSERT INTO captcha_log(chat_id,user_id,result,reason,created_at) VALUES(?,?,?,?,?)",
                                   (chat_id, user_id, result, reason[:200], int(self.clock())))
        await self.db.conn.commit()

    async def stats(self, hours: int = 24) -> dict:
        since = int(self.clock()) - hours * 3600
        out = {"pass": 0, "kick": 0, "ban": 0, "raid": 0}
        async with self.db.conn.execute("SELECT result, COUNT(*) FROM captcha_log WHERE created_at>=? GROUP BY result", (since,)) as c:
            for r in await c.fetchall():
                out[r[0]] = r[1]
        out["waiting"] = (await self._one("SELECT COUNT(*) FROM captcha_pending", ()))[0]
        return out

    # ---------- telegram ----------
    async def _delete(self, bot: Bot, chat_id: int, msg_id: int | None) -> None:
        if not msg_id:
            return
        try:
            await net_retry(lambda: bot.delete_message(chat_id, msg_id), what="удаление")
        except Exception as e:  # noqa: BLE001
            log.info("не удалил %s/%s: %s", chat_id, msg_id, e)
            if is_rights_error(e):
                await self.need_rights(bot, chat_id, {"delete"})

    async def need_rights(self, bot: Bot, chat_id: int, missing: set[str], title: str = "") -> None:
        """Нет прав — пишем хозяйке в личку, что включить (один раз за запуск на каждое право)."""
        new = {m for m in missing if (chat_id, m) not in self.warned_rights}
        if not new or not self.owner_id:
            return
        self.warned_rights |= {(chat_id, m) for m in new}
        text = NEED_RIGHTS.format(chat=html.escape(title or self.chat_target or str(chat_id)),
                                  list="\n".join(RIGHT_NAMES[m] for m in sorted(missing)))
        try:
            await bot.send_message(self.owner_id, text)
        except Exception as e:  # noqa: BLE001 — хозяйка не писала боту в личку
            log.warning("не смог написать хозяйке о правах: %s", e)

    async def check_rights(self, bot: Bot) -> set[str]:
        """При запуске: есть ли у бота нужные права в чате."""
        if not self.chat_target:
            return set()
        try:
            me = await net_retry(bot.get_me)
            m = await net_retry(lambda: bot.get_chat_member(self.chat_target, me.id))
        except Exception as e:  # noqa: BLE001
            log.warning("права в чате: %s", e)
            return set()
        missing = set()
        if m.status != "creator":
            if not getattr(m, "can_restrict_members", False):
                missing.add("restrict")
            if not getattr(m, "can_delete_messages", False):
                missing.add("delete")
        if missing:
            await self.need_rights(bot, 0, missing)
        return missing

    async def _kick(self, bot: Bot, chat_id: int, user_id: int, reason: str, raid: bool = False) -> str:
        """Выгнать: бан + сразу разбан (можно зайти снова). 3 кика подряд — бан на сутки."""
        """Сетевой сбой после повторов — исключение наверх (проверка остаётся, таймер попробует снова)."""
        now = int(self.clock())
        self.kicked[(chat_id, user_id)] = now
        row = await self._one("SELECT kicks FROM captcha_streak WHERE chat_id=? AND user_id=?", (chat_id, user_id))
        kicks = (row[0] if row else 0) + 1
        long_ban = kicks >= KICK_STREAK_BAN
        try:
            if long_ban:
                await net_retry(lambda: bot.ban_chat_member(chat_id, user_id, until_date=now + STREAK_BAN_S), what="бан")
            else:
                await net_retry(lambda: bot.ban_chat_member(chat_id, user_id, until_date=now + 60), what="кик")
                await net_retry(lambda: bot.unban_chat_member(chat_id, user_id, only_if_banned=True), what="разбан")
        except Exception as e:  # noqa: BLE001
            log.warning("кик %s: %s", user_id, e)
            if is_network_error(e):
                raise
            if is_rights_error(e):
                await self.need_rights(bot, chat_id, {"restrict"})
        await self.db.conn.execute("INSERT INTO captcha_streak(chat_id,user_id,kicks,updated_at) VALUES(?,?,?,?) "
                                   "ON CONFLICT(chat_id,user_id) DO UPDATE SET kicks=excluded.kicks, updated_at=excluded.updated_at",
                                   (chat_id, user_id, 0 if long_ban else kicks, now))
        await self.db.conn.commit()
        result = "ban" if long_ban else ("raid" if raid else "kick")
        await self._log(chat_id, user_id, result, reason)
        return result

    async def _finish(self, bot: Bot, p) -> None:
        await self.db.conn.execute("DELETE FROM captcha_pending WHERE chat_id=? AND user_id=?", (p["chat_id"], p["user_id"]))
        await self.db.conn.commit()
        await self._delete(bot, p["chat_id"], p["msg_id"])
        await self._delete(bot, p["chat_id"], p["join_msg_id"] or self.join_msgs.pop((p["chat_id"], p["user_id"]), None))

    # ---------- вступление ----------
    async def on_join(self, bot: Bot, chat_id: int, user: User, title: str = "", muted_until: int = 0) -> str:
        """Новый участник. Возвращает, что сделали: skip | raid | captcha | norights."""
        if user.is_bot or user.id == self.owner_id:
            return "skip"
        key = (chat_id, user.id)
        now = self.clock()
        async with self.lock:
            if self.recent.get(key, 0) > now - 10 or await self.pending(chat_id, user.id):
                return "skip"
            self.recent[key] = now
            for k in [k for k, t in self.recent.items() if t < now - 60]:
                self.recent.pop(k, None)
        try:
            m = await net_retry(lambda: bot.get_chat_member(chat_id, user.id))
            if m.status in ADMIN_STATUSES:
                return "skip"
        except Exception:  # noqa: BLE001
            pass
        # рейд: больше 5 входов за минуту — закрываем вход на 30 минут
        q = self.joins.setdefault(chat_id, deque())
        q.append(now)
        while q and q[0] < now - RAID_WINDOW_S:
            q.popleft()
        if len(q) > RAID_JOINS and self.raid_until.get(chat_id, 0) < now:
            self.raid_until[chat_id] = now + RAID_S
            await self._raid_alert(bot, chat_id, title, len(q))
        if self.raid_until.get(chat_id, 0) > now:
            try:
                await self._kick(bot, chat_id, user.id, "рейд: вход закрыт", raid=True)
            except Exception as e:  # noqa: BLE001 — сеть: пропускаем, рейд-бот всё равно без прав не напишет
                log.warning("рейд-кик не вышел: %s", e)
            await self._delete(bot, chat_id, self.join_msgs.pop(key, None))
            return "raid"
        # сразу запрещаем писать
        try:
            await net_retry(lambda: bot.restrict_chat_member(chat_id, user.id, NO_PERMS), what="ограничение новичка")
        except Exception as e:  # noqa: BLE001
            log.warning("restrict %s: %s", user.id, e)
            if is_network_error(e):
                return "neterror"  # связь: хозяйке не пишем
            if is_rights_error(e):
                await self.need_rights(bot, chat_id, {"restrict"}, title)
            return "norights"
        text, kb, token = challenge(user.id, user.full_name or user.username or "")
        sent = None
        try:
            sent = await net_retry(lambda: bot.send_message(chat_id, text, reply_markup=kb, disable_web_page_preview=True), what="капча")
        except Exception as e:  # noqa: BLE001
            log.warning("капча не отправилась: %s", e)
        await self.db.conn.execute(
            "INSERT OR REPLACE INTO captcha_pending(chat_id,user_id,name,msg_id,join_msg_id,token,tries,deadline,muted_until,created_at) "
            "VALUES(?,?,?,?,?,?,0,?,?,?)",
            (chat_id, user.id, user.full_name or user.username or "", sent.message_id if sent else None,
             self.join_msgs.pop(key, None), token, int(now) + TIMEOUT_S, muted_until, int(now)))
        await self.db.conn.commit()
        return "captcha"

    async def _raid_alert(self, bot: Bot, chat_id: int, title: str, n: int) -> None:
        log.warning("рейд в %s: %s входов за минуту", chat_id, n)
        until = time.strftime("%H:%M", time.gmtime(self.raid_until[chat_id] + 3 * 3600))  # МСК
        if self.owner_id:
            try:
                await bot.send_message(self.owner_id,
                    f"🚨 Похоже на рейд ботов в чате {html.escape(title or self.chat_target)}: {n} входов за минуту.\n"
                    f"Вход закрыт на 30 минут (до {until} МСК): новичков бот сразу выводит, без капчи.\n\n"
                    "Если боты продолжат после этого — включите вручную «Заявки на вступление»: "
                    "чат → Управление → Тип группы → «Заявки на вступление» (ботам Telegram это переключать не даёт).")
            except Exception as e:  # noqa: BLE001
                log.warning("не смог предупредить хозяйку: %s", e)

    def join_message(self, chat_id: int, user_id: int, msg_id: int) -> None:
        self.join_msgs[(chat_id, user_id)] = msg_id

    async def attach_join_message(self, chat_id: int, user_id: int, msg_id: int) -> bool:
        """«X теперь в группе» пришло после капчи — привязываем, чтобы удалить вместе с ней."""
        if await self.pending(chat_id, user_id):
            await self.db.conn.execute("UPDATE captcha_pending SET join_msg_id=? WHERE chat_id=? AND user_id=?", (msg_id, chat_id, user_id))
            await self.db.conn.commit()
            return True
        self.join_message(chat_id, user_id, msg_id)
        return False

    async def on_left(self, bot: Bot, chat_id: int, user_id: int) -> None:
        """Ушёл, не пройдя проверку — убираем капчу (без кика)."""
        p = await self.pending(chat_id, user_id)
        if p:
            await self._finish(bot, p)
            await self._log(chat_id, user_id, "left")

    # ---------- ответ ----------
    async def on_answer(self, bot: Bot, cq: CallbackQuery) -> str:
        try:
            _, uid, token = (cq.data or "").split(":", 2)
            uid = int(uid)
        except ValueError:
            await cq.answer()
            return "bad"
        if cq.from_user.id != uid:
            await cq.answer("Это не твоя проверка 🙂", show_alert=False)
            return "alien"
        chat_id = cq.message.chat.id if cq.message else 0
        p = await self.pending(chat_id, uid)
        if not p:
            await cq.answer("Проверка уже закончилась")
            return "gone"
        if token == p["token"]:
            try:
                await self._pass(bot, p)
            except Exception:  # noqa: BLE001 — сеть: права вернуть не удалось, просим нажать ещё раз
                await cq.answer("Связь с Telegram барахлит — нажми ещё раз через пару секунд 🙏", show_alert=True)
                return "neterror"
            await cq.answer("Добро пожаловать! 🌾")
            return "pass"
        tries = p["tries"] + 1
        if tries >= TRIES:
            await cq.answer("Не получилось 🙁 Можно зайти снова и попробовать ещё раз")
            try:
                await self._kick(bot, chat_id, uid, "две ошибки")
            except Exception:  # noqa: BLE001 — сеть: выгонит таймер (проверка остаётся с истёкшим сроком)
                await self.db.conn.execute("UPDATE captcha_pending SET deadline=0 WHERE chat_id=? AND user_id=?", (chat_id, uid))
                await self.db.conn.commit()
                return "kick"
            await self._finish(bot, p)
            return "kick"
        text, kb, new_token = challenge(uid, p["name"], retry=True)
        await self.db.conn.execute("UPDATE captcha_pending SET token=?, tries=?, deadline=MAX(deadline, ?) WHERE chat_id=? AND user_id=?",
                                   (new_token, tries, int(self.clock()) + RETRY_MIN_S, chat_id, uid))
        await self.db.conn.commit()
        try:
            await net_retry(lambda: bot.edit_message_text(text, chat_id=chat_id, message_id=p["msg_id"], reply_markup=kb,
                                                          disable_web_page_preview=True), what="новая картинка")
        except Exception as e:  # noqa: BLE001
            log.warning("капча не обновилась: %s", e)
        await cq.answer("Не то 🙈 Ещё одна попытка")
        return "retry"

    async def _pass(self, bot: Bot, p) -> None:
        chat_id, uid = p["chat_id"], p["user_id"]
        try:
            chat = await net_retry(lambda: bot.get_chat(chat_id))
            perms = chat.permissions or DEFAULT_PERMS
        except Exception:  # noqa: BLE001
            perms = DEFAULT_PERMS
        try:
            if p["muted_until"] and p["muted_until"] > self.clock():  # мут от админа до входа — остаётся
                await net_retry(lambda: bot.restrict_chat_member(chat_id, uid, ChatPermissions(can_send_messages=False), until_date=p["muted_until"]))
            else:
                await net_retry(lambda: bot.restrict_chat_member(chat_id, uid, perms), what="снятие ограничений")
        except Exception as e:  # noqa: BLE001
            log.warning("не снял ограничения %s: %s", uid, e)
            if is_network_error(e):
                raise  # проверка остаётся, человек нажмёт ещё раз
            if is_rights_error(e):
                await self.need_rights(bot, chat_id, {"restrict"})
        await self._finish(bot, p)
        await self.db.conn.execute("DELETE FROM captcha_streak WHERE chat_id=? AND user_id=?", (chat_id, uid))
        await self._log(chat_id, uid, "pass")
        try:
            m = await bot.send_message(chat_id, f"{mention(uid, p['name'])}, добро пожаловать на ферму! 🎮 Игра: @{self.game_bot}",
                                       disable_web_page_preview=True)
            await self.db.conn.execute("INSERT OR REPLACE INTO captcha_cleanup(chat_id,msg_id,delete_at) VALUES(?,?,?)",
                                       (chat_id, m.message_id, int(self.clock()) + WELCOME_TTL_S))
            await self.db.conn.commit()
        except Exception as e:  # noqa: BLE001
            log.warning("приветствие: %s", e)

    # ---------- таймеры ----------
    async def tick(self, bot: Bot) -> None:
        """Раз в несколько секунд: кик за молчание 3 минуты, удаление приветствий через 60 с."""
        now = int(self.clock())
        async with self.db.conn.execute("SELECT * FROM captcha_pending WHERE deadline<=?", (now,)) as c:
            expired = await c.fetchall()
        for p in expired:
            try:
                await self._kick(bot, p["chat_id"], p["user_id"], "нет ответа 3 минуты")
            except Exception as e:  # noqa: BLE001 — сеть: проверка остаётся, попробуем на следующем тике
                log.warning("таймаут-кик отложен: %s", e)
                continue
            await self._finish(bot, p)
        async with self.db.conn.execute("SELECT chat_id, msg_id FROM captcha_cleanup WHERE delete_at<=?", (now,)) as c:
            old = await c.fetchall()
        for chat_id, msg_id in old:
            await self._delete(bot, chat_id, msg_id)
            await self.db.conn.execute("DELETE FROM captcha_cleanup WHERE chat_id=? AND msg_id=?", (chat_id, msg_id))
        if old:
            await self.db.conn.commit()

    async def run(self, bot: Bot, every: float = 5) -> None:
        await self.check_rights(bot)
        while True:
            try:
                await self.tick(bot)
            except Exception as e:  # noqa: BLE001
                log.exception("капча: %s", e)
            await asyncio.sleep(every)


def is_join(event: ChatMemberUpdated) -> bool:
    old, new = event.old_chat_member, event.new_chat_member
    was_in = old.status in ("member", "administrator", "creator") or (old.status == "restricted" and getattr(old, "is_member", False))
    now_in = new.status == "member" or (new.status == "restricted" and getattr(new, "is_member", False))
    return now_in and not was_in


def make_router(cap: Captcha, mod=None) -> Router:
    """Ставить ДО роутера модерации: он перехватывает вступления (и сам отмечает их для антиспама модерации)."""
    r = Router(name="captcha")
    in_chat = F.func(lambda m: chat_matches(m.chat, cap.chat_target))

    @r.chat_member(F.func(lambda e: chat_matches(e.chat, cap.chat_target)))
    async def member(event: ChatMemberUpdated) -> None:
        u = event.new_chat_member.user
        if is_join(event):
            if mod and not u.is_bot:
                await mod.seen(event.chat.id, u, joined=True)
            old = event.old_chat_member
            muted = int(old.until_date.timestamp()) if old.status == "restricted" and not getattr(old, "can_send_messages", True) \
                and getattr(old, "until_date", None) else 0
            await cap.on_join(event.bot, event.chat.id, u, event.chat.title or "", muted_until=muted)
        elif event.new_chat_member.status in ("left", "kicked"):
            await cap.on_left(event.bot, event.chat.id, u.id)

    @r.message(in_chat, F.new_chat_members)
    async def service_join(message: Message) -> None:
        # «X теперь в группе»: удалим вместе с капчей. Если зашёл через сервисное сообщение без chat_member — тоже проверка.
        for u in message.new_chat_members:
            if u.is_bot:
                continue
            if mod:
                await mod.seen(message.chat.id, u, joined=True)
            if not await cap.attach_join_message(message.chat.id, u.id, message.message_id):
                await cap.on_join(message.bot, message.chat.id, u, message.chat.title or "")

    @r.message(in_chat, F.left_chat_member)
    async def service_left(message: Message) -> None:
        u = message.left_chat_member
        if u and cap.kicked.pop((message.chat.id, u.id), 0) > cap.clock() - 60:
            await cap._delete(message.bot, message.chat.id, message.message_id)  # «X покинул группу» после кика — тоже мусор

    @r.callback_query(F.data.startswith("cap:"))
    async def answer(cq: CallbackQuery) -> None:
        await cap.on_answer(cq.bot, cq)

    return r
