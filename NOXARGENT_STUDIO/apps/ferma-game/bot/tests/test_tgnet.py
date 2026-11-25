"""Сетевые сбои Telegram: повторы, «нет прав» только по настоящему ответу Telegram, одно предупреждение о долгих сбоях."""
import sys
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import TelegramBadRequest, TelegramNetworkError
from aiogram.methods import GetChatMember, RestrictChatMember, SendMessage
from aiogram.types import Chat, ChatMemberMember, Message, User

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tgnet  # noqa: E402
from sub import SubChecker, default_needs  # noqa: E402

OWNER = 999
SSL_ERR = "Cannot connect to host api.telegram.org:443 ssl:default [[SSL: APPLICATION_DATA_AFTER_CLOSE_NOTIFY] application data after close notify]"


class Flaky(BaseSession):
    """getChatMember / restrict падают первые `fails` раз ошибкой `err`."""
    def __init__(self, fails=0, err="net"):
        super().__init__()
        self.fails, self.err, self.calls = fails, err, []

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, (GetChatMember, RestrictChatMember)) and self.fails:
            self.fails -= 1
            if self.err == "net":
                raise aiohttp.ClientOSError(1, SSL_ERR)
            if self.err == "tgnet":
                raise TelegramNetworkError(method=method, message="HTTP Client says - Request timeout error")
            raise TelegramBadRequest(method=method, message="Bad Request: member list is inaccessible")
        if isinstance(method, GetChatMember):
            return ChatMemberMember(user=User(id=method.user_id, is_bot=False, first_name="x"))
        if isinstance(method, SendMessage):
            return Message(message_id=1, date=datetime.now(timezone.utc), chat=Chat(id=method.chat_id, type="private"), text=method.text)
        return True

    async def close(self):
        pass

    async def stream_content(self, *a, **kw):  # pragma: no cover
        yield b""

    def dms(self):
        return [c.text for c in self.calls if isinstance(c, SendMessage)]

    def n(self, cls):
        return len([c for c in self.calls if isinstance(c, cls)])


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def fast_health(monkeypatch):
    clock = Clock()
    h = tgnet.Health(clock=clock)
    pauses = []

    async def no_sleep(s):
        pauses.append(s)
    h.sleep = no_sleep
    monkeypatch.setattr(tgnet, "HEALTH", h)
    h.pauses = pauses
    h.clock_obj = clock
    return h


def checker(session):
    bot = Bot("123456:TEST", session=session)
    tgnet.HEALTH.setup(bot, OWNER)
    return SubChecker(bot, default_needs(chat_id=""), True, admin_id=OWNER)


@pytest.mark.parametrize("err", ["net", "tgnet"])
async def test_network_glitch_retried_and_silent(err):
    s = Flaky(fails=2, err=err)
    ok = await checker(s).check(42)
    assert ok is True and s.n(GetChatMember) == 3   # 2 сбоя + удачная попытка
    assert tgnet.HEALTH.pauses == [1.0, 3.0]
    assert not s.dms()                                # хозяйке ничего


async def test_network_down_lets_player_in_without_messages():
    s = Flaky(fails=99)
    c = checker(s)
    assert await c.check(42) is True and s.n(GetChatMember) == 3
    assert not s.dms()
    assert await c.check(42) is True and s.n(GetChatMember) == 6  # не закэшировано — проверим снова


async def test_real_not_admin_answer_tells_owner_once():
    s = Flaky(fails=99, err="rights")
    c = checker(s)
    await c.check(42)
    await c.check(43)
    assert s.n(GetChatMember) == 2                    # ответ Telegram не повторяем
    dms = s.dms()
    assert len(dms) == 1 and "не администратор" in dms[0] and "Сделайте бота администратором" in dms[0]


async def test_unstable_notice_after_10_minutes_once_per_hour(fast_health):
    s = Flaky(fails=10 ** 6)
    c = checker(s)
    clock = fast_health.clock_obj
    for _ in range(11):                               # сбои каждую минуту 10 минут подряд
        await c.check(42)
        clock.t += 60
    dms = s.dms()
    assert len(dms) == 1 and "Связь с Telegram нестабильна" in dms[0]
    for _ in range(50):                               # ещё 50 минут сбоев — не чаще раза в час
        await c.check(42)
        clock.t += 60
    assert len(s.dms()) == 1
    clock.t += 15 * 60
    await c.check(42)
    assert len(s.dms()) == 2


async def test_success_resets_unstable_timer(fast_health):
    s = Flaky(fails=3 * 6)                            # 6 проверок подряд со сбоями (по 3 попытки)
    c = checker(s)
    clock = fast_health.clock_obj
    for _ in range(6):
        await c.check(42)
        clock.t += 60
    await c.check(42)                                 # связь вернулась
    assert fast_health.fail_since is None
    s.fails = 3 * 6
    for _ in range(6):
        await c.check(42)
        clock.t += 60
    assert not s.dms()                                # подряд меньше 10 минут — молчим


def test_classify():
    assert tgnet.is_network_error(aiohttp.ClientOSError(1, SSL_ERR))
    bad = TelegramBadRequest(method=GetChatMember(chat_id=1, user_id=1), message="Bad Request: member list is inaccessible")
    assert tgnet.is_rights_error(bad) and not tgnet.is_network_error(bad)
    assert not tgnet.is_rights_error(aiohttp.ClientOSError(1, SSL_ERR))


async def test_captcha_network_error_no_rights_message(tmp_path):
    import captcha
    from db import DB
    db = DB(tmp_path / "t.sqlite3")
    await db.open()
    cap = captcha.Captcha(db, "@predstav_chat", OWNER)
    await cap.init()
    s = Flaky(fails=99)
    bot = Bot("123456:TEST", session=s)
    r = await cap.on_join(bot, -100777, User(id=50, is_bot=False, first_name="Новичок"), "Чат")
    assert r == "neterror" and not s.dms()
    s2 = Flaky(fails=99, err="rights")
    r = await cap.on_join(Bot("123456:TEST", session=s2), -100777, User(id=51, is_bot=False, first_name="Б"), "Чат")
    assert r == "norights" and any("Блокировка пользователей" in t for t in s2.dms())
    await db.close()
