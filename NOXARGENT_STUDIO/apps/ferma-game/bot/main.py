"""Бот «Ферма деда»: кнопка «Играть» (Telegram WebApp), магазин за звёзды, призы недели + веб-сервер игры и API.

Запуск:  python main.py            (бот + сервер)
         python main.py --clear-rating   (очистить рейтинг перед запуском)
         DEV_MODE=1 python main.py --web-only   (только сервер, без Telegram — для локального теста)
"""
import argparse
import asyncio
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.types import (BotCommand, BotCommandScopeChatAdministrators, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo)
from aiohttp import web

import config
from db import DB
from shop import ShopDB, make_router, weekly_loop
import moderation
import village as village_mod
import tgnet
import sub as subscription
from web import make_app

log = logging.getLogger("ferma")
dp = Dispatcher()
# игровые команды и ответы — только в личке с ботом; в чате фермеров работает только модерация
private = Router(name="private")
private.message.filter(F.chat.type == "private")
CFG = config.load()

WELCOME = (
    "🧑‍🌾 Привет! Я фермер с дедовой фермы.\n\n"
    "Дед оставил нам ферму в запустении и 10 000 ₽. Уберём бурьян, построим курятник, "
    "соберём теплицу из дедовых окон — и дойдём до <b>первого миллиона</b>, а там и до агрохолдинга!\n\n"
    "Заказы, рыбалка, щенок, сосед Петрович и рейтинг фермеров — всё внутри. Жми «Играть» 👇"
)


def play_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🌾 Играть", web_app=WebAppInfo(url=CFG.webapp_url + "/"))],
        # кнопка канала — только когда подписка обязательна (REQUIRE_SUB=1)
        *([[InlineKeyboardButton(text="📺 Канал «Ферма с нуля»", url=CFG.channel_url)]] if CFG.require_sub else []),
    ])


SUB: subscription.SubChecker | None = None
DBH: DB | None = None
VDB: village_mod.VillageDB | None = None
VDATA = village_mod.VillageData(CFG.village_dir)


@private.message(Command("stats"))
async def stats(message: Message) -> None:
    """Сводка для хозяйки (ADMIN_ID)."""
    if not CFG.admin_id or not message.from_user or message.from_user.id != CFG.admin_id:
        await message.answer("Жми «Играть» 👇", reply_markup=play_keyboard())
        return
    lines = ["📊 <b>Статистика</b>"]
    if DBH:
        s = await DBH.stats()
        lines.append(f"Игроков в базе: <b>{s['users']}</b>")
    await message.answer("\n".join(lines))


async def ask_nick_once(message: Message, uid: int) -> bool:
    """Первый вход (или старый игрок, которого ещё не спрашивали): «Откуда ты нас смотришь? Напиши свой ник»."""
    if VDB and await village_mod.needs_ask(VDB, uid):
        await village_mod.ask_first(message, VDB, uid)
        return True
    return False


@private.message(CommandStart())
async def start(message: Message) -> None:
    if SUB and not await subscription.gate(message, SUB, CFG.channel_url):
        return  # сначала подписка на канал
    if await ask_nick_once(message, message.from_user.id):
        return
    await message.answer(WELCOME, reply_markup=play_keyboard())


@private.message(Command("help"))
async def help_(message: Message) -> None:
    await message.answer(
        "Тапай по постройкам — собирай урожай, выполняй заказы и копи опыт 🎖.\n"
        "Месяц длится 15 минут, потом — событие с выбором.\n"
        "Каждое воскресенье в 20:00 (МСК) — итоги рейтинга недели и приз лучшему фермеру.\n\n"
        "Прогресс сохраняется сам. Вопросы по оплате — /paysupport", reply_markup=play_keyboard())


async def run(web_only: bool) -> None:
    db = DB(CFG.db_path)
    await db.open()
    global DBH, VDB
    DBH = db
    VDB = village_mod.VillageDB(db)
    await VDB.init()
    shop = ShopDB(db)
    await shop.init()
    from shop import init_awards
    await init_awards(db)
    bot = None
    username = CFG.bot_username
    if not web_only:
        if not CFG.bot_token or not CFG.webapp_url.startswith("https://"):
            raise SystemExit("Нужны BOT_TOKEN и WEBAPP_URL (https://…) в .env")
        # Здесь — только то, что не ходит в сеть. Связь с Telegram — в фоне (bot_main), чтобы игра открывалась,
        # даже если после перезагрузки сервера Telegram ещё недоступен.
        bot = Bot(CFG.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
        tgnet.HEALTH.setup(bot, CFG.admin_id)  # долгие сбои связи — одно сообщение хозяйке в час
        # модерация чата фермеров (группа); всё игровое — в роутере private (только личка)
        mod = moderation.ModDB(db)
        await mod.init()
        dp.include_router(moderation.make_router(mod, CFG.chat_id, CFG.admin_id))
        private.include_router(make_router(shop, CFG.admin_id, CFG.channel_url))
        global SUB
        SUB = subscription.SubChecker(bot, subscription.default_needs(CFG.channel_id, CFG.channel_url, CFG.chat_id, CFG.chat_url),
                                      CFG.require_sub, CFG.admin_id)
        private.include_router(subscription.make_router(SUB, CFG.channel_url, WELCOME, play_keyboard, after_ok=ask_nick_once))
        private.include_router(village_mod.make_router(VDB, VDATA, CFG.admin_id, play_keyboard, WELCOME))

        # «Жми Играть» — последним, чтобы не перехватывать команды (/myid, /paysupport, /test_results…)
        fallback = Router(name="fallback")

        @fallback.message(F.text)
        async def any_text(message: Message) -> None:
            await message.answer("Жми «Играть» 👇", reply_markup=play_keyboard())
        private.include_router(fallback)
        dp.include_router(private)

    # 1) сначала игра: веб-сервер поднимается сразу, без Telegram
    app = make_app(CFG, db, username, shop=shop, bot=bot,
                   sub=SUB or subscription.SubChecker(None, CFG.channel_id, False), village=(VDB, VDATA))
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, CFG.host, CFG.port).start()
    log.info("Веб-сервер: http://%s:%s (игра из %s)", CFG.host, CFG.port, CFG.webapp_dir)
    weekly = asyncio.create_task(weekly_loop(db, shop, bot, CFG.admin_id))
    try:
        if bot:
            await bot_main(bot)   # 2) потом бот — с повторами, пока Telegram не ответит
        else:
            await asyncio.Event().wait()
    finally:
        weekly.cancel()
        await runner.cleanup()
        await db.close()
        if bot:
            await bot.session.close()


async def bot_setup(bot: Bot) -> str:
    """Первое обращение к Telegram: имя бота, кнопка меню, подсказки команд. Сеть — с повторами (tgnet)."""
    me = await tgnet.net_retry(bot.get_me, what="запуск бота")
    for what, call in [
        ("кнопка меню", lambda: bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="🌾 Играть", web_app=WebAppInfo(url=CFG.webapp_url + "/")))),
        ("команды", lambda: bot.set_my_commands([BotCommand(command="start", description="Играть в «Ферму деда»"),
                                                 BotCommand(command="myid", description="Мой Telegram id"),
                                                 BotCommand(command="home", description="🏡 Мой дом в посёлке"),
                                                 BotCommand(command="nick", description="Мой ник в соцсетях"),
                                                 BotCommand(command="help", description="Как играть"),
                                                 BotCommand(command="paysupport", description="Вопросы по оплате")])),
        ("команды модерации", lambda: bot.set_my_commands(moderation.ADMIN_COMMANDS, scope=BotCommandScopeChatAdministrators(chat_id=CFG.chat_id))
         if CFG.chat_id else asyncio.sleep(0)),
    ]:
        try:
            await tgnet.net_retry(call, what=what)
        except Exception as e:  # noqa: BLE001 — не критично (бот ещё не в чате и т.п.), игра и бот работают
            log.warning("%s: %s", what, e)
    return me.username or ""


async def bot_main(bot: Bot) -> None:
    """Бот подключается к Telegram, пока не получится (пауза растёт до 5 минут); игра всё это время открыта."""
    pause = 10
    while True:
        try:
            username = await bot_setup(bot)
            break
        except Exception as e:  # noqa: BLE001
            log.warning("Telegram недоступен при запуске бота (%s) — повтор через %s с; игра работает", e, pause)
            await asyncio.sleep(pause)
            pause = min(pause * 2, 300)
    log.info("Бот @%s запущен%s", username, " (ТЕСТОВЫЕ ЦЕНЫ: всё по 1 ⭐)" if CFG.test_prices else "")
    await dp.start_polling(bot)  # дальше сетевые сбои aiogram переживает сам (переподключается)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--web-only", action="store_true", help="только веб-сервер, без бота")
    ap.add_argument("--clear-rating", action="store_true", help="очистить рейтинг (тестовых игроков) и выйти")
    args = ap.parse_args()
    if args.clear_rating:
        async def _clear() -> None:
            db = DB(CFG.db_path); await db.open()
            n = await db.clear_rating(); await db.close()
            print(f"Рейтинг очищен: удалено игроков — {n}. Сохранения игр не тронуты.")
        asyncio.run(_clear())
        raise SystemExit(0)
    try:
        asyncio.run(run(args.web_only))
    except KeyboardInterrupt:
        pass
