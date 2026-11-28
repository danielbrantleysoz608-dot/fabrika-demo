"""Модерация чата фермеров (https://t.me/predstav_chat).

Команды работают только у администраторов чата (getChatMember: creator/administrator) и только ответом
на сообщение нарушителя (кроме /unban — по id или @username):
  /ban [причина]                /unban <id|@username>
  /mute [10m|1h|1d] [причина]   /unmute          (по умолчанию мут на 1 час)
  /warn [причина]  — 3 предупреждения = мут на 1 день;  /warns, /unwarn
  /del             — удалить сообщение
Сообщение с командой бот удаляет, в чат пишет одну короткую строку.
У обычных участников команды не работают (их сообщение с командой просто удаляется).

Антиспам: ссылки от тех, кто вступил в чат меньше суток назад, удаляются автоматически.

Боту в чате нужны права администратора (минимум): «Удаление сообщений» и «Блокировка пользователей».
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time

from aiogram import Bot, F, Router
from aiogram.enums import ChatType, MessageEntityType
from aiogram.filters import Command, CommandObject
from tgnet import is_network_error, is_rights_error
from aiogram.types import BotCommand, ChatMemberUpdated, ChatPermissions, Message, User

log = logging.getLogger("ferma.mod")

ADMIN_STATUSES = {"creator", "administrator"}
WARN_LIMIT = 3
WARN_MUTE_S = 24 * 3600
DEFAULT_MUTE_S = 3600
NEWBIE_S = 24 * 3600          # столько после вступления нельзя ссылки
ADMIN_CACHE_S = 60
LINK_RE = re.compile(r"(https?://|www\.|t\.me/|telegram\.me/|tg://)\S+|\b[\w-]+\.(ru|com|net|org|рф|io|me|su|info|xyz|top|online|site|shop|club|ly|gg)\b(/\S*)?|@\w{5,}bot\b",
                     re.IGNORECASE)
ADMIN_COMMANDS = [BotCommand(command=c, description=d) for c, d in [
    ("mute", "[10m|1h|1d] [причина] — ответом: замутить (по умолч. 1 ч)"), ("unmute", "ответом: снять мут"),
    ("warn", "[причина] — ответом: предупреждение (3 = мут на сутки)"), ("warns", "ответом: сколько предупреждений"),
    ("unwarn", "ответом: снять одно предупреждение"), ("ban", "[причина] — ответом: заблокировать"),
    ("unban", "<id|@username> — разблокировать"), ("del", "ответом: удалить сообщение")]]
NEED_RIGHTS = ("Боту не хватает прав в чате {chat}.\n"
               "Откройте чат → Управление → Администраторы → бот и включите:\n"
               "• «Удаление сообщений»\n• «Блокировка пользователей»\n"
               "Остальные права не нужны.")

SCHEMA = """
CREATE TABLE IF NOT EXISTS mod_users (
    chat_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    username   TEXT,
    name       TEXT,
    joined_at  INTEGER,          -- когда вступил (если видели вступление); NULL — был в чате раньше бота
    seen_at    INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS mod_users_name ON mod_users(chat_id, username);
CREATE TABLE IF NOT EXISTS mod_warns (
    chat_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS mod_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    admin_id   INTEGER,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    reason     TEXT,
    created_at INTEGER NOT NULL
);
"""


# ---------- разбор аргументов ----------
DUR_RE = re.compile(r"^(\d{1,4})\s*(m|min|м|мин|h|ч|d|д|w|н)?$", re.IGNORECASE)
UNIT_S = {"m": 60, "min": 60, "м": 60, "мин": 60, "h": 3600, "ч": 3600, "d": 86400, "д": 86400, "w": 604800, "н": 604800}


def parse_duration(args: str | None, default: int = DEFAULT_MUTE_S) -> tuple[int, str]:
    """'10m спам' → (600, 'спам'); 'флуд' → (3600, 'флуд'). Без единицы — минуты. Не больше 366 дней."""
    args = (args or "").strip()
    if not args:
        return default, ""
    first, _, rest = args.partition(" ")
    m = DUR_RE.match(first)
    if not m:
        return default, args
    n, unit = int(m.group(1)), (m.group(2) or "m").lower()
    return max(60, min(n * UNIT_S[unit], 366 * 86400)), rest.strip()


def human_duration(s: int) -> str:
    if s % 86400 == 0:
        d = s // 86400
        return f"{d} д" if d != 1 else "1 день"
    if s % 3600 == 0:
        return f"{s // 3600} ч"
    return f"{max(1, s // 60)} мин"


def has_link(message: Message) -> bool:
    for e in (message.entities or []) + (message.caption_entities or []):
        if e.type in (MessageEntityType.URL, MessageEntityType.TEXT_LINK):
            return True
    text = message.text or message.caption or ""
    return bool(LINK_RE.search(text))


def who(u: User | None, fallback_id: int = 0) -> str:
    if not u:
        return f"<a href=\"tg://user?id={fallback_id}\">id {fallback_id}</a>"
    name = html.escape((u.full_name or u.username or str(u.id))[:40])
    return f"<a href=\"tg://user?id={u.id}\">{name}</a>"


# ---------- хранилище ----------
class ModDB:
    def __init__(self, db):
        self.db = db

    async def init(self) -> None:
        await self.db.conn.executescript(SCHEMA)
        await self.db.conn.commit()

    async def seen(self, chat_id: int, u: User, joined: bool = False) -> None:
        now = int(time.time())
        await self.db.conn.execute(
            "INSERT INTO mod_users(chat_id,user_id,username,name,joined_at,seen_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(chat_id,user_id) DO UPDATE SET username=excluded.username, name=excluded.name, seen_at=excluded.seen_at"
            + (", joined_at=excluded.joined_at" if joined else ""),
            (chat_id, u.id, (u.username or "").lower() or None, u.full_name, now if joined else None, now))
        await self.db.conn.commit()

    async def joined_at(self, chat_id: int, user_id: int) -> int | None:
        async with self.db.conn.execute("SELECT joined_at FROM mod_users WHERE chat_id=? AND user_id=?", (chat_id, user_id)) as c:
            r = await c.fetchone()
        return r[0] if r else None

    async def find(self, chat_id: int, username: str) -> int | None:
        async with self.db.conn.execute("SELECT user_id FROM mod_users WHERE chat_id=? AND username=? ORDER BY seen_at DESC LIMIT 1",
                                        (chat_id, username.lstrip("@").lower())) as c:
            r = await c.fetchone()
        return r[0] if r else None

    async def warns(self, chat_id: int, user_id: int) -> int:
        async with self.db.conn.execute("SELECT count FROM mod_warns WHERE chat_id=? AND user_id=?", (chat_id, user_id)) as c:
            r = await c.fetchone()
        return r[0] if r else 0

    async def set_warns(self, chat_id: int, user_id: int, n: int) -> None:
        await self.db.conn.execute("INSERT INTO mod_warns(chat_id,user_id,count,updated_at) VALUES(?,?,?,?) "
                                   "ON CONFLICT(chat_id,user_id) DO UPDATE SET count=excluded.count, updated_at=excluded.updated_at",
                                   (chat_id, user_id, max(0, n), int(time.time())))
        await self.db.conn.commit()

    async def log(self, chat_id: int, admin_id: int | None, user_id: int | None, action: str, reason: str = "") -> None:
        await self.db.conn.execute("INSERT INTO mod_log(chat_id,admin_id,user_id,action,reason,created_at) VALUES(?,?,?,?,?,?)",
                                   (chat_id, admin_id, user_id, action, reason[:300], int(time.time())))
        await self.db.conn.commit()


# ---------- роутер ----------
def chat_matches(chat, target: str) -> bool:
    """Модерируем только чат фермеров (CHAT_ID = @username или числовой id). Пусто — любой групповой чат."""
    if chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return False
    if not target:
        return True
    t = target.strip()
    if t.lstrip("-").isdigit():
        return chat.id == int(t)
    return (chat.username or "").lower() == t.lstrip("@").lower()


def make_router(mod: ModDB, chat_target: str, owner_id: int = 0) -> Router:
    r = Router()
    admin_cache: dict[tuple[int, int], tuple[bool, float]] = {}
    warned_rights: set[int] = set()
    in_chat = F.func(lambda m: chat_matches(m.chat, chat_target))

    async def is_admin(bot: Bot, chat_id: int, user_id: int) -> bool:
        hit = admin_cache.get((chat_id, user_id))
        if hit and time.time() - hit[1] < ADMIN_CACHE_S:
            return hit[0]
        try:
            m = await bot.get_chat_member(chat_id, user_id)
            ok = m.status in ADMIN_STATUSES
        except Exception as e:  # noqa: BLE001
            log.warning("getChatMember: %s", e)
            ok = False
        admin_cache[(chat_id, user_id)] = (ok, time.time())
        return ok

    async def sender_is_admin(message: Message) -> bool:
        if message.sender_chat and message.sender_chat.id == message.chat.id:  # анонимный админ пишет от имени чата
            return True
        return bool(message.from_user) and await is_admin(message.bot, message.chat.id, message.from_user.id)

    async def drop(message: Message) -> None:
        try:
            await message.delete()
        except Exception:  # noqa: BLE001
            pass

    async def no_rights(message: Message, err: Exception) -> None:
        """Не хватает прав — пишем админу, который дал команду (и владельцу), что включить."""
        log.warning("нет прав в %s: %s", message.chat.id, err)
        text = NEED_RIGHTS.format(chat=html.escape(message.chat.title or str(message.chat.id))) + f"\n\nОшибка Telegram: {html.escape(str(err))[:200]}"
        sent = False
        for uid in {message.from_user.id if message.from_user else 0, owner_id} - {0}:
            try:
                await message.bot.send_message(uid, text)
                sent = True
            except Exception:  # noqa: BLE001 — админ не писал боту в личку
                pass
        if not sent and message.chat.id not in warned_rights:
            warned_rights.add(message.chat.id)
            try:
                await message.answer("⚠️ Боту не хватает прав: включите ему «Удаление сообщений» и «Блокировка пользователей».")
            except Exception:  # noqa: BLE001
                pass

    async def say(message: Message, text: str, ttl: int = 0) -> None:
        try:
            m = await message.bot.send_message(message.chat.id, text, disable_web_page_preview=True)
            if ttl:
                async def later():
                    await asyncio.sleep(ttl)
                    try:
                        await m.delete()
                    except Exception:  # noqa: BLE001
                        pass
                asyncio.create_task(later())
        except Exception as e:  # noqa: BLE001
            log.warning("не смог написать в чат: %s", e)

    async def target(message: Message) -> User | None:
        """Нарушитель — автор сообщения, на которое ответили. Админов не трогаем."""
        rep = message.reply_to_message
        if not rep or not rep.from_user or rep.from_user.is_bot and rep.from_user.id == message.bot.id:
            await say(message, "↩️ Ответьте командой на сообщение нарушителя.", ttl=10)
            return None
        if rep.sender_chat or await is_admin(message.bot, message.chat.id, rep.from_user.id):
            await say(message, "🛡 Это администратор — команда к нему не применяется.", ttl=10)
            return None
        return rep.from_user

    def mod_command(*names: str):
        """Команда модерации: только в чате фермеров, только админам; сообщение с командой удаляется."""
        def deco(fn):
            @r.message(in_chat, Command(*names, ignore_mention=True))
            async def handler(message: Message, command: CommandObject) -> None:
                if not await sender_is_admin(message):
                    await drop(message)  # у обычных участников команды не работают
                    return
                try:
                    await fn(message, command)
                except Exception as e:  # noqa: BLE001
                    if is_network_error(e):  # связь с Telegram, не права
                        log.warning("модерация: сетевой сбой: %s", e)
                        await say(message, "📡 Telegram не ответил — повторите команду через минуту.", ttl=15)
                    elif is_rights_error(e) or "can't" in str(e).lower():
                        await no_rights(message, e)
                    else:
                        log.exception("модерация: %s", e)
                        await say(message, f"⚠️ Не получилось: {html.escape(str(e))[:150]}", ttl=15)
                await drop(message)
            return fn
        return deco

    def admin_id(message: Message) -> int | None:
        return message.from_user.id if message.from_user else None

    def reason_line(reason: str) -> str:
        return f" Причина: {html.escape(reason[:200])}" if reason else ""

    async def do_mute(message: Message, u: User, seconds: int, reason: str, note: str = "") -> None:
        await message.bot.restrict_chat_member(message.chat.id, u.id, ChatPermissions(can_send_messages=False),
                                               until_date=int(time.time()) + seconds)
        await mod.log(message.chat.id, admin_id(message), u.id, "mute", reason)
        await say(message, f"🔇 {who(u)} замучен на {human_duration(seconds)}.{reason_line(reason)}{note}")

    @mod_command("ban")
    async def ban(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        reason = (command.args or "").strip()
        await message.bot.ban_chat_member(message.chat.id, u.id)
        try:
            await message.reply_to_message.delete()
        except Exception:  # noqa: BLE001
            pass
        await mod.log(message.chat.id, admin_id(message), u.id, "ban", reason)
        await say(message, f"🚫 {who(u)} заблокирован.{reason_line(reason)}")

    @mod_command("unban")
    async def unban(message: Message, command: CommandObject) -> None:
        arg = (command.args or "").strip().split()
        uid = None
        if message.reply_to_message and message.reply_to_message.from_user:
            uid = message.reply_to_message.from_user.id
        elif arg and arg[0].lstrip("-").isdigit():
            uid = int(arg[0])
        elif arg:
            uid = await mod.find(message.chat.id, arg[0])
            if not uid:
                await say(message, f"🤷 Не знаю {html.escape(arg[0])} — укажите числовой id (его видно в сообщении о бане).", ttl=20)
                return
        if not uid:
            await say(message, "Напишите: /unban 123456789 или /unban @username", ttl=15)
            return
        await message.bot.unban_chat_member(message.chat.id, uid, only_if_banned=True)
        await mod.log(message.chat.id, admin_id(message), uid, "unban")
        await say(message, f"✅ {who(None, uid)} разблокирован — может вернуться в чат.")

    @mod_command("mute")
    async def mute(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        seconds, reason = parse_duration(command.args)
        await do_mute(message, u, seconds, reason)

    @mod_command("unmute")
    async def unmute(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        chat = await message.bot.get_chat(message.chat.id)
        perms = chat.permissions or ChatPermissions(can_send_messages=True, can_send_audios=True, can_send_documents=True,
                                                    can_send_photos=True, can_send_videos=True, can_send_video_notes=True,
                                                    can_send_voice_notes=True, can_send_polls=True, can_send_other_messages=True,
                                                    can_add_web_page_previews=True)
        await message.bot.restrict_chat_member(message.chat.id, u.id, perms)
        await mod.log(message.chat.id, admin_id(message), u.id, "unmute")
        await say(message, f"🔊 {who(u)} снова может писать.")

    @mod_command("warn")
    async def warn(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        reason = (command.args or "").strip()
        n = await mod.warns(message.chat.id, u.id) + 1
        await mod.log(message.chat.id, admin_id(message), u.id, "warn", reason)
        if n >= WARN_LIMIT:
            await mod.set_warns(message.chat.id, u.id, 0)
            await do_mute(message, u, WARN_MUTE_S, reason, note=f" ({WARN_LIMIT}-е предупреждение)")
        else:
            await mod.set_warns(message.chat.id, u.id, n)
            await say(message, f"⚠️ {who(u)}, предупреждение {n}/{WARN_LIMIT}.{reason_line(reason)} На {WARN_LIMIT}-м — мут на сутки.")

    @mod_command("warns")
    async def warns(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        n = await mod.warns(message.chat.id, u.id)
        await say(message, f"📋 У {who(u)} предупреждений: {n}/{WARN_LIMIT}.", ttl=30)

    @mod_command("unwarn")
    async def unwarn(message: Message, command: CommandObject) -> None:
        u = await target(message)
        if not u:
            return
        n = max(0, await mod.warns(message.chat.id, u.id) - 1)
        await mod.set_warns(message.chat.id, u.id, n)
        await mod.log(message.chat.id, admin_id(message), u.id, "unwarn")
        await say(message, f"↩️ С {who(u)} снято одно предупреждение — теперь {n}/{WARN_LIMIT}.")

    @mod_command("del")
    async def delete(message: Message, command: CommandObject) -> None:
        rep = message.reply_to_message
        if not rep:
            await say(message, "↩️ Ответьте /del на сообщение, которое нужно удалить.", ttl=10)
            return
        await rep.delete()
        await mod.log(message.chat.id, admin_id(message), rep.from_user.id if rep.from_user else None, "del")

    # --- кто вступил и когда (для антиспама) ---
    @r.message(in_chat, F.new_chat_members)
    async def joined(message: Message) -> None:
        for u in message.new_chat_members:
            if not u.is_bot:
                await mod.seen(message.chat.id, u, joined=True)

    @r.chat_member(F.func(lambda e: chat_matches(e.chat, chat_target)))
    async def member_update(event: ChatMemberUpdated) -> None:
        was, now = event.old_chat_member.status, event.new_chat_member.status
        if was in ("left", "kicked") and now in ("member", "restricted"):
            await mod.seen(event.chat.id, event.new_chat_member.user, joined=True)

    # --- антиспам: ссылки от новичков (в чате меньше суток) ---
    @r.message(in_chat)
    async def every_message(message: Message) -> None:
        u = message.from_user
        if not u or u.is_bot or message.sender_chat:
            return
        await mod.seen(message.chat.id, u)
        if not has_link(message):
            return
        j = await mod.joined_at(message.chat.id, u.id)
        if j is None or time.time() - j >= NEWBIE_S:
            return
        if await is_admin(message.bot, message.chat.id, u.id):
            return
        try:
            await message.delete()
        except Exception as e:  # noqa: BLE001
            if is_rights_error(e):
                await no_rights(message, e)
            else:
                log.warning("антиспам: не удалил: %s", e)
            return
        await mod.log(message.chat.id, None, u.id, "antispam", (message.text or message.caption or "")[:200])
        left = int((NEWBIE_S - (time.time() - j)) // 3600) + 1
        await say(message, f"🧹 {who(u)}, ссылки в чате можно публиковать через сутки после вступления (ещё ~{left} ч).", ttl=30)

    return r
