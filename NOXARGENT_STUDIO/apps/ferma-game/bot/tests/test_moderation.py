"""Модерация чата: команды только у админов, мут/бан/варны, антиспам ссылок от новичков.
Telegram подменён сессией, которая отвечает на запросы бота и запоминает их."""
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.base import BaseSession
from aiogram.methods import (BanChatMember, DeleteMessage, GetChat, GetChatMember, RestrictChatMember, SendMessage,
                             UnbanChatMember)
from aiogram.types import (Chat, ChatFullInfo, ChatMemberAdministrator, ChatMemberMember, ChatMemberOwner, ChatPermissions,
                           Message, Update, User)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import moderation  # noqa: E402
from db import DB  # noqa: E402

CHAT = Chat(id=-100777, type="supergroup", title="Чат фермеров", username="predstav_chat")
OTHER = Chat(id=-100888, type="supergroup", title="Чужой чат", username="other_chat")
ADMIN = User(id=1, is_bot=False, first_name="Админ")
OWNER = User(id=2, is_bot=False, first_name="Хозяйка")
BAD = User(id=10, is_bot=False, first_name="Спамер", username="spammer")
USER = User(id=11, is_bot=False, first_name="Обычный")
BOT_ID = 999


class FakeTelegram(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.admins = {ADMIN.id, OWNER.id}
        self.no_rights = False
        self.mid = 1000

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, GetChatMember):
            u = User(id=method.user_id, is_bot=False, first_name="x")
            if method.user_id == OWNER.id:
                return ChatMemberOwner(user=u, is_anonymous=False)
            if method.user_id in self.admins:
                return ChatMemberAdministrator(user=u, can_be_edited=False, is_anonymous=False, can_manage_chat=True, can_delete_messages=True,
                                               can_manage_video_chats=False, can_restrict_members=True, can_promote_members=False,
                                               can_change_info=False, can_invite_users=True, can_post_stories=False, can_edit_stories=False,
                                               can_delete_stories=False)
            return ChatMemberMember(user=u)
        if isinstance(method, (RestrictChatMember, BanChatMember)) and self.no_rights:
            from aiogram.exceptions import TelegramBadRequest
            raise TelegramBadRequest(method=method, message="Bad Request: not enough rights to restrict/demote chat member")
        if isinstance(method, SendMessage):
            self.mid += 1
            return Message(message_id=self.mid, date=datetime.now(timezone.utc), chat=Chat(id=method.chat_id, type="private") if method.chat_id > 0 else CHAT,
                           text=method.text, from_user=User(id=BOT_ID, is_bot=True, first_name="bot"))
        if isinstance(method, GetChat):
            return ChatFullInfo(id=CHAT.id, type="supergroup", accent_color_id=0, max_reaction_count=11,
                                permissions=ChatPermissions(can_send_messages=True, can_send_photos=True))
        return True

    async def close(self):
        pass

    async def stream_content(self, *a, **kw):  # pragma: no cover
        yield b""

    def of(self, cls):
        return [c for c in self.calls if isinstance(c, cls)]

    def texts(self):
        return [c.text for c in self.of(SendMessage)]


@pytest.fixture
async def env(tmp_path):
    db = DB(tmp_path / "m.sqlite3")
    await db.open()
    mod = moderation.ModDB(db)
    await mod.init()
    tg = FakeTelegram()
    bot = Bot("123456:TEST", session=tg)
    dp = Dispatcher()
    dp.include_router(moderation.make_router(mod, "@predstav_chat", OWNER.id))
    # как в main.py: игровые ответы — только в личке
    private = Router()
    private.message.filter(F.chat.type == "private")

    @private.message(F.text)
    async def any_text(message):
        await message.answer("Жми «Играть» 👇")
    dp.include_router(private)
    n = {"id": 0}

    async def send(user, text, reply_to=None, chat=CHAT, **kw):
        n["id"] += 1
        msg = Message(message_id=n["id"], date=datetime.now(timezone.utc), chat=chat, from_user=user, text=text,
                      reply_to_message=reply_to, **kw)
        await dp.feed_update(bot, Update(update_id=n["id"], message=msg))
        return msg

    yield type("Env", (), {"tg": tg, "send": staticmethod(send), "mod": mod, "db": db})
    await db.close()


def bad_msg(text="купите слона"):
    return Message(message_id=500, date=datetime.now(timezone.utc), chat=CHAT, from_user=BAD, text=text)


async def test_mute_by_admin_with_duration_and_reason(env):
    await env.send(ADMIN, "/mute 10m флуд", reply_to=bad_msg())
    r = env.tg.of(RestrictChatMember)
    assert len(r) == 1 and r[0].user_id == BAD.id and r[0].permissions.can_send_messages is False
    assert abs(r[0].until_date - (time.time() + 600)) < 5
    assert any("замучен на 10 мин" in t and "Причина: флуд" in t and "Спамер" in t for t in env.tg.texts())
    assert any(d.message_id != 500 for d in env.tg.of(DeleteMessage))  # сообщение с командой удалено


async def test_mute_default_one_hour(env):
    await env.send(ADMIN, "/mute", reply_to=bad_msg())
    assert abs(env.tg.of(RestrictChatMember)[0].until_date - (time.time() + 3600)) < 5
    assert any("на 1 ч" in t for t in env.tg.texts())


async def test_regular_user_commands_do_nothing(env):
    await env.send(USER, "/ban", reply_to=bad_msg())
    await env.send(USER, "/mute 1d", reply_to=bad_msg())
    assert not env.tg.of(BanChatMember) and not env.tg.of(RestrictChatMember)
    assert not env.tg.texts()  # бот ничего не пишет
    assert len(env.tg.of(DeleteMessage)) == 2  # их команды просто удалены


async def test_cannot_touch_admins(env):
    adm_msg = Message(message_id=501, date=datetime.now(timezone.utc), chat=CHAT, from_user=OWNER, text="hi")
    await env.send(ADMIN, "/ban", reply_to=adm_msg)
    assert not env.tg.of(BanChatMember)
    assert any("администратор" in t for t in env.tg.texts())


async def test_ban_and_unban_by_username(env):
    await env.send(BAD, "привет всем")  # бот запомнил @spammer → id
    await env.send(ADMIN, "/ban реклама", reply_to=bad_msg())
    b = env.tg.of(BanChatMember)
    assert b and b[0].user_id == BAD.id
    assert any("заблокирован" in t and "реклама" in t for t in env.tg.texts())
    await env.send(ADMIN, "/unban @spammer")
    u = env.tg.of(UnbanChatMember)
    assert u and u[0].user_id == BAD.id and u[0].only_if_banned
    await env.send(ADMIN, "/unban 12345")
    assert env.tg.of(UnbanChatMember)[-1].user_id == 12345


async def test_three_warns_mute_for_a_day(env):
    for i in range(2):
        await env.send(ADMIN, "/warn мат", reply_to=bad_msg())
    assert not env.tg.of(RestrictChatMember)
    assert await env.mod.warns(CHAT.id, BAD.id) == 2
    await env.send(ADMIN, "/unwarn", reply_to=bad_msg())
    assert await env.mod.warns(CHAT.id, BAD.id) == 1
    await env.send(ADMIN, "/warn", reply_to=bad_msg())
    await env.send(ADMIN, "/warn", reply_to=bad_msg())
    r = env.tg.of(RestrictChatMember)
    assert len(r) == 1 and abs(r[0].until_date - (time.time() + 86400)) < 5
    assert await env.mod.warns(CHAT.id, BAD.id) == 0  # после мута счётчик сброшен
    assert any("1 день" in t and "3-е предупреждение" in t for t in env.tg.texts())
    await env.send(ADMIN, "/warns", reply_to=bad_msg())
    assert any("0/3" in t for t in env.tg.texts())


async def test_unmute_restores_chat_permissions(env):
    await env.send(ADMIN, "/unmute", reply_to=bad_msg())
    r = env.tg.of(RestrictChatMember)
    assert r and r[0].permissions.can_send_messages is True


async def test_del_removes_replied_message(env):
    await env.send(ADMIN, "/del", reply_to=bad_msg())
    assert {d.message_id for d in env.tg.of(DeleteMessage)} >= {500}


async def test_no_rights_tells_admin_what_to_enable(env):
    env.tg.no_rights = True
    await env.send(ADMIN, "/mute", reply_to=bad_msg())
    dm = [c for c in env.tg.of(SendMessage) if c.chat_id in (ADMIN.id, OWNER.id)]
    assert dm and "Блокировка пользователей" in dm[0].text and "Удаление сообщений" in dm[0].text


async def test_antispam_links_from_newcomers(env):
    newbie = User(id=20, is_bot=False, first_name="Новичок")
    old = User(id=21, is_bot=False, first_name="Старожил")
    await env.send(old, "я тут давно")  # вступление не видели — считаем старым участником
    await env.send(newbie, None, new_chat_members=[newbie])
    env.tg.calls.clear()
    await env.send(newbie, "заходите на https://spam.example")
    assert env.tg.of(DeleteMessage), "ссылку новичка удалили"
    assert any("через сутки" in t for t in env.tg.texts())
    env.tg.calls.clear()
    await env.send(newbie, "смотрите t.me/somechannel")
    await env.send(newbie, "крутой магазин shop-sale.ru")
    assert len(env.tg.of(DeleteMessage)) == 2
    env.tg.calls.clear()
    await env.send(newbie, "а когда сажать помидоры?")  # без ссылки — не трогаем
    await env.send(old, "вот видео https://youtube.com/x")  # старожил — можно
    await env.send(ADMIN, None, new_chat_members=[ADMIN])
    await env.send(ADMIN, "правила: https://t.me/predstav_kanal")  # админ — можно
    assert not env.tg.of(DeleteMessage)
    # через сутки новичку уже можно
    await env.db.conn.execute("UPDATE mod_users SET joined_at=joined_at-90000 WHERE user_id=?", (newbie.id,))
    await env.db.conn.commit()
    await env.send(newbie, "https://ok.example")
    assert not env.tg.of(DeleteMessage)


async def test_other_chats_and_private_ignored(env):
    await env.send(ADMIN, "/ban", reply_to=bad_msg(), chat=OTHER)
    assert not env.tg.of(BanChatMember)
    await env.send(USER, "просто болтаю в чате")
    assert not env.tg.texts(), "в чате фермеров бот не отвечает «Жми Играть»"
    await env.send(USER, "привет", chat=Chat(id=USER.id, type="private"))
    assert env.tg.texts() == ["Жми «Играть» 👇"]


def test_parse_duration():
    p = moderation.parse_duration
    assert p("10m спам") == (600, "спам")
    assert p("1h") == (3600, "")
    assert p("1d мат и флуд") == (86400, "мат и флуд")
    assert p("2ч") == (7200, "")
    assert p("флуд") == (3600, "флуд")
    assert p("") == (3600, "")
    assert p("30") == (1800, "")
