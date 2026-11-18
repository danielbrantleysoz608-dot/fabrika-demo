"""Бот «Ферма деда»: кнопка «Играть» (Telegram WebApp), магазин за звёзды, призы недели + веб-сервер игры и API.

Запуск:  python main.py            (бот + сервер)
         python main.py --clear-rating   (очистить рейтинг перед запуском)
         DEV_MODE=1 python main.py --web-only   (только сервер, без Telegram — для локального теста)
"""
import argparse
import asyncio
import logging

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.types import (BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo)
from aiohttp import web

import config
from db import DB
from shop import ShopDB, make_router, weekly_loop
from web import make_app

log = logging.getLogger("ferma")
dp = Dispatcher()
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
        [InlineKeyboardButton(text="📺 Канал «Ферма с нуля»", url=CFG.channel_url)],
    ])


@dp.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=play_keyboard())


@dp.message(Command("help"))
async def help_(message: Message) -> None:
    await message.answer(
        "Тапай по постройкам — собирай урожай, выполняй заказы и копи опыт ⭐.\n"
        "Месяц длится 15 минут, потом — событие с выбором.\n"
        "Каждое воскресенье в 20:00 (МСК) — итоги рейтинга недели и приз лучшему фермеру.\n\n"
        "Прогресс сохраняется сам. Вопросы по оплате — /paysupport", reply_markup=play_keyboard())


async def run(web_only: bool) -> None:
    db = DB(CFG.db_path)
    await db.open()
    shop = ShopDB(db)
    await shop.init()
    bot = None
    username = ""
    if not web_only:
        if not CFG.bot_token or not CFG.webapp_url.startswith("https://"):
            raise SystemExit("Нужны BOT_TOKEN и WEBAPP_URL (https://…) в .env")
        bot = Bot(CFG.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
        me = await bot.get_me()
        username = me.username or ""
        # кнопка меню рядом с полем ввода — тоже открывает игру
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="🌾 Играть", web_app=WebAppInfo(url=CFG.webapp_url + "/")))
        await bot.set_my_commands([BotCommand(command="start", description="Играть в «Ферму деда»"),
                                   BotCommand(command="help", description="Как играть"),
                                   BotCommand(command="paysupport", description="Вопросы по оплате")])
        dp.include_router(make_router(shop, CFG.admin_id, CFG.channel_url))

        @dp.message(F.text)
        async def any_text(message: Message) -> None:
            await message.answer("Жми «Играть» 👇", reply_markup=play_keyboard())
        log.info("Бот @%s запущен%s", username, " (ТЕСТОВЫЕ ЦЕНЫ: всё по 1 ⭐)" if CFG.test_prices else "")

    app = make_app(CFG, db, username, shop=shop, bot=bot)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, CFG.host, CFG.port).start()
    log.info("Веб-сервер: http://%s:%s (игра из %s)", CFG.host, CFG.port, CFG.webapp_dir)
    weekly = asyncio.create_task(weekly_loop(db, shop, bot, CFG.admin_id))
    try:
        if bot:
            await dp.start_polling(bot)
        else:
            await asyncio.Event().wait()
    finally:
        weekly.cancel()
        await runner.cleanup()
        await db.close()
        if bot:
            await bot.session.close()


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
