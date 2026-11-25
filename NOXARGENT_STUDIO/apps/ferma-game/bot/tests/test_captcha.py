"""Проверка на робота при входе в чат: правильный ответ, ошибки, таймаут 3 минуты, повторный вход после кика,
бан на сутки за 3 кика подряд, рейд, админы, нехватка прав, перезапуск бота. Telegram подменён."""
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import (AnswerCallbackQuery, BanChatMember, DeleteMessage, EditMessageText, GetChat, GetChatMember, GetMe,
                             RestrictChatMember, SendMessage, UnbanChatMember)
from aiogram.types import (CallbackQuery, Chat, ChatFullInfo, ChatMemberAdministrator, ChatMemberLeft, ChatMemberMember,
                           ChatMemberOwner, ChatMemberRestricted, ChatMemberUpdated, ChatPermissions, Message, Update, User)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import captcha  # noqa: E402
import moderation  # noqa: E402
from db import DB  # noqa: E402

CHAT = Chat(id=-100777, type="supergroup", title="Чат фермеров", username="predstav_chat")
OWNER = User(id=2, is_bot=False, first_name="Хозяйка")
ADMIN = User(id=1, is_bot=False, first_name="Админ")
NEW = User(id=50, is_bot=False, first_name="Новичок")
OTHER = User(id=51, is_bot=False, first_name="Сосед")
BOT_ID = 999


def now_dt():
    return datetime.now(timezone.utc)


class FakeTelegram(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.admins = {ADMIN.id}
        self.no_rights = False
        self.mid = 1000

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, GetMe):
            return User(id=BOT_ID, is_bot=True, first_name="bot", username="ferma_deda_bot")
        if isinstance(method, GetChatMember):
            u = User(id=method.user_id, is_bot=method.user_id == BOT_ID, first_name="x")
            if method.user_id == OWNER.id:
                return ChatMemberOwner(user=u, is_anonymous=False)
            if method.user_id in self.admins or method.user_id == BOT_ID:
                ok = not self.no_rights
                return ChatMemberAdministrator(user=u, can_be_edited=False, is_anonymous=False, can_manage_chat=True, can_delete_messages=ok,
                                               can_manage_video_chats=False, can_restrict_members=ok, can_promote_members=False,
                                               can_change_info=False, can_invite_users=True, can_post_stories=False, can_edit_stories=False,
                                               can_delete_stories=False)
            return ChatMemberMember(user=u)
        if isinstance(method, (RestrictChatMember, BanChatMember)) and self.no_rights:
            raise TelegramBadRequest(method=method, message="Bad Request: not enough rights to restrict/demote chat member")
        if isinstance(method, SendMessage):
            self.mid += 1
            chat = Chat(id=method.chat_id, type="private") if isinstance(method.chat_id, int) and method.chat_id > 0 else CHAT
            return Message(message_id=self.mid, date=now_dt(), chat=chat, text=method.text,
                           from_user=User(id=BOT_ID, is_bot=True, first_name="bot"))
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

    def texts(self, chat_id=None):
        return [c.text for c in self.of(SendMessage) if chat_id is None or c.chat_id == chat_id]


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
async def env(tmp_path):
    db = DB(tmp_path / "c.sqlite3")
    await db.open()
    mod = moderation.ModDB(db)
    await mod.init()
    clock = Clock()
    cap = captcha.Captcha(db, "@predstav_chat", OWNER.id, game_bot="ferma_deda_bot", clock=clock)
    await cap.init()
    tg = FakeTelegram()
    bot = Bot("123456:TEST", session=tg)
    dp = Dispatcher()
    dp.include_router(captcha.make_router(cap, mod))
    dp.include_router(moderation.make_router(mod, "@predstav_chat", OWNER.id))
    n = {"id": 0}

    async def feed(**kw):
        n["id"] += 1
        await dp.feed_update(bot, Update(update_id=n["id"], **kw))

    async def join(user, old=None, new=None):
        """Вступление (как приходит от Telegram: chat_member + сервисное «X теперь в группе»)."""
        old = old or ChatMemberLeft(user=user)
        new = new or ChatMemberMember(user=user)
        await feed(chat_member=ChatMemberUpdated(chat=CHAT, from_user=user, date=now_dt(), old_chat_member=old, new_chat_member=new))
        n["id"] += 1
        svc = Message(message_id=5000 + n["id"], date=now_dt(), chat=CHAT, from_user=user, new_chat_members=[user])
        await dp.feed_update(bot, Update(update_id=n["id"], message=svc))
        return svc.message_id

    async def press(user, target_uid, token):
        p = await cap.pending(CHAT.id, target_uid)
        msg = Message(message_id=p["msg_id"] if p else 1, date=now_dt(), chat=CHAT, text="капча",
                      from_user=User(id=BOT_ID, is_bot=True, first_name="bot"))
        await feed(callback_query=CallbackQuery(id=str(n["id"]), from_user=user, chat_instance="ci", message=msg,
                                                data=f"cap:{target_uid}:{token}"))

    async def right(uid):
        return (await cap.pending(CHAT.id, uid))["token"]

    yield type("Env", (), {"tg": tg, "cap": cap, "bot": bot, "clock": clock, "join": staticmethod(join), "press": staticmethod(press),
                           "right": staticmethod(right), "db": db, "feed": staticmethod(feed)})
    await db.close()


def last_captcha(tg):
    return [c for c in tg.of(SendMessage) if c.reply_markup][-1]


async def test_correct_answer_unlocks_and_cleans_up(env):
    join_msg = await env.join(NEW)
    r = env.tg.of(RestrictChatMember)
    assert len(r) == 1 and r[0].user_id == NEW.id and r[0].permissions.can_send_messages is False
    cap = last_captcha(env.tg)
    assert "Привет," in cap.text and "Новичок" in cap.text and "Докажи, что ты не робот: нажми на" in cap.text
    buttons = cap.reply_markup.inline_keyboard[0]
    assert sorted(b.text for b in buttons) == sorted(e for e, _ in captcha.ANIMALS)  # 6 кнопок
    word = [w for e, w in captcha.ANIMALS if f"{e} {w}" in cap.text]
    assert len(word) == 1  # в тексте ровно одно животное
    # чужое нажатие — всплывашка, ничего не меняется
    await env.press(OTHER, NEW.id, await env.right(NEW.id))
    assert env.tg.of(AnswerCallbackQuery)[-1].text == "Это не твоя проверка 🙂"
    assert await env.cap.pending(CHAT.id, NEW.id)
    # правильный ответ
    await env.press(NEW, NEW.id, await env.right(NEW.id))
    assert not await env.cap.pending(CHAT.id, NEW.id)
    assert env.tg.of(RestrictChatMember)[-1].permissions.can_send_messages is True
    deleted = {d.message_id for d in env.tg.of(DeleteMessage)}
    assert {cap_msg_id(env), join_msg} <= deleted  # капча и «X теперь в группе» удалены
    welcome = env.tg.texts(CHAT.id)[-1]
    assert "добро пожаловать на ферму! 🎮 Игра: @ferma_deda_bot" in welcome
    # приветствие удаляется через 60 с
    welcome_id = env.tg.mid
    env.clock.t += 59
    await env.cap.tick(env.bot)
    assert welcome_id not in {d.message_id for d in env.tg.of(DeleteMessage)}
    env.clock.t += 2
    await env.cap.tick(env.bot)
    assert welcome_id in {d.message_id for d in env.tg.of(DeleteMessage)}
    assert not env.tg.of(BanChatMember)
    assert (await env.cap.stats())["pass"] == 1


def cap_msg_id(env):
    sent = [c for c in env.tg.of(SendMessage)]
    i = [k for k, c in enumerate(sent) if c.reply_markup][0]
    return 1001 + i


async def test_one_mistake_gives_new_picture_then_pass(env):
    await env.join(NEW)
    first = await env.right(NEW.id)
    await env.press(NEW, NEW.id, "wrong0")
    e = env.tg.of(EditMessageText)
    assert len(e) == 1 and "Последняя попытка" in e[0].text and len(e[0].reply_markup.inline_keyboard[0]) == 6
    assert await env.right(NEW.id) != first  # новые токены
    assert not env.tg.of(BanChatMember)
    await env.press(NEW, NEW.id, await env.right(NEW.id))
    assert (await env.cap.stats())["pass"] == 1


async def test_two_mistakes_kick_then_can_rejoin(env):
    await env.join(NEW)
    await env.press(NEW, NEW.id, "wrong0")
    await env.press(NEW, NEW.id, "wrong1")
    assert not await env.cap.pending(CHAT.id, NEW.id)
    b, u = env.tg.of(BanChatMember), env.tg.of(UnbanChatMember)
    assert len(b) == 1 and b[0].user_id == NEW.id and len(u) == 1 and u[0].user_id == NEW.id  # кик = бан + разбан
    assert (await env.cap.stats())["kick"] == 1
    # повторный заход после кика — новая проверка
    env.clock.t += 30
    await env.join(NEW)
    assert await env.cap.pending(CHAT.id, NEW.id)
    await env.press(NEW, NEW.id, await env.right(NEW.id))
    assert (await env.cap.stats())["pass"] == 1


async def test_timeout_three_minutes_kicks(env):
    await env.join(NEW)
    env.clock.t += 179
    await env.cap.tick(env.bot)
    assert await env.cap.pending(CHAT.id, NEW.id) and not env.tg.of(BanChatMember)
    env.clock.t += 2
    await env.cap.tick(env.bot)
    assert not await env.cap.pending(CHAT.id, NEW.id)
    assert len(env.tg.of(BanChatMember)) == 1 and len(env.tg.of(UnbanChatMember)) == 1
    assert cap_msg_id(env) in {d.message_id for d in env.tg.of(DeleteMessage)}
    # нажатие по старой капче после кика
    await env.press(NEW, NEW.id, "x")
    assert env.tg.of(AnswerCallbackQuery)[-1].text == "Проверка уже закончилась"


async def test_three_kicks_in_a_row_ban_for_a_day(env):
    for i in range(3):
        env.clock.t += 20
        await env.join(NEW)
        env.clock.t += 181
        await env.cap.tick(env.bot)
    bans = env.tg.of(BanChatMember)
    assert len(bans) == 3
    assert len(env.tg.of(UnbanChatMember)) == 2  # третий раз — без разбана
    assert abs(bans[-1].until_date - (env.clock.t + 24 * 3600)) < 5
    s = await env.cap.stats()
    assert s["kick"] == 2 and s["ban"] == 1


async def test_pass_resets_kick_streak(env):
    for _ in range(2):
        env.clock.t += 20
        await env.join(NEW)
        env.clock.t += 181
        await env.cap.tick(env.bot)
    env.clock.t += 20
    await env.join(NEW)
    await env.press(NEW, NEW.id, await env.right(NEW.id))
    env.clock.t += 20
    await env.join(NEW)
    env.clock.t += 181
    await env.cap.tick(env.bot)
    assert len(env.tg.of(UnbanChatMember)) == 3  # после прохождения счёт обнулился — снова обычный кик


async def test_admins_owner_and_old_members_untouched(env):
    await env.join(ADMIN, new=ChatMemberAdministrator(user=ADMIN, can_be_edited=False, is_anonymous=False, can_manage_chat=True,
                                                      can_delete_messages=True, can_manage_video_chats=False, can_restrict_members=True,
                                                      can_promote_members=False, can_change_info=False, can_invite_users=True,
                                                      can_post_stories=False, can_edit_stories=False, can_delete_stories=False))
    await env.join(OWNER)
    # участник, который уже в чате (например, сняли мут: restricted → member) — не вступление
    await env.feed(chat_member=ChatMemberUpdated(chat=CHAT, from_user=ADMIN, date=now_dt(),
                   old_chat_member=ChatMemberRestricted(user=OTHER, is_member=True, can_send_messages=False, can_send_audios=False,
                                                        can_send_documents=False, can_send_photos=False, can_send_videos=False,
                                                        can_send_video_notes=False, can_send_voice_notes=False, can_send_polls=False,
                                                        can_send_other_messages=False, can_add_web_page_previews=False, can_change_info=False,
                                                        can_invite_users=False, can_pin_messages=False, can_manage_topics=False,
                                                        until_date=0),
                   new_chat_member=ChatMemberMember(user=OTHER)))
    await env.feed(message=Message(message_id=77, date=now_dt(), chat=CHAT, from_user=OTHER, text="всем привет"))
    assert not env.tg.of(RestrictChatMember) and not [c for c in env.tg.of(SendMessage) if c.reply_markup]


async def test_raid_closes_entry_and_tells_owner(env):
    users = [User(id=100 + i, is_bot=False, first_name=f"Бот{i}") for i in range(8)]
    for u in users:
        env.clock.t += 5
        await env.join(u)
    dm = env.tg.texts(OWNER.id)
    assert len(dm) == 1 and "рейд" in dm[0] and "30 минут" in dm[0]
    captchas = [c for c in env.tg.of(SendMessage) if c.reply_markup]
    assert len(captchas) == 5  # первые 5 — капча, дальше вход закрыт
    assert {b.user_id for b in env.tg.of(BanChatMember)} == {u.id for u in users[5:]}
    assert (await env.cap.stats())["raid"] == 3
    # через 30 минут — снова капча
    env.clock.t += 31 * 60
    await env.join(User(id=200, is_bot=False, first_name="Человек"))
    assert len([c for c in env.tg.of(SendMessage) if c.reply_markup]) == 6


async def test_no_rights_tells_owner_what_to_enable(env):
    env.tg.no_rights = True
    await env.join(NEW)
    dm = env.tg.texts(OWNER.id)
    assert dm and "Блокировка пользователей" in dm[0]
    assert not [c for c in env.tg.of(SendMessage) if c.reply_markup]
    missing = await env.cap.check_rights(env.bot)
    assert missing == {"restrict", "delete"}


async def test_restart_keeps_timers(env):
    await env.join(NEW)
    cap2 = captcha.Captcha(env.db, "@predstav_chat", OWNER.id, clock=env.clock)  # бот перезапустился
    await cap2.init()
    env.clock.t += 200
    await cap2.tick(env.bot)
    assert len(env.tg.of(BanChatMember)) == 1 and not await cap2.pending(CHAT.id, NEW.id)


async def test_leaving_removes_captcha_without_kick(env):
    await env.join(NEW)
    await env.feed(chat_member=ChatMemberUpdated(chat=CHAT, from_user=NEW, date=now_dt(),
                   old_chat_member=ChatMemberMember(user=NEW), new_chat_member=ChatMemberLeft(user=NEW)))
    assert not await env.cap.pending(CHAT.id, NEW.id) and not env.tg.of(BanChatMember)
    assert cap_msg_id(env) in {d.message_id for d in env.tg.of(DeleteMessage)}
