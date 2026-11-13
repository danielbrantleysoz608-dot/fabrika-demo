"""Бот «Ферма деда»: кнопка «Играть» (Telegram WebApp) + веб-сервер игры и API.

Запуск:  python main.py            (бот + сервер)
         DEV_MODE=1 python main.py --web-only   (только сервер, без Telegram — для локального теста)
"""
import argparse
import asyncio
import logging

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.types import (InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo)
from aiohttp import web

import config
from db import DB
from web import make_app

log = logging.getLogger("ferma")
dp = Dispatcher()
CFG = config.load()

WELCOME = (
    "🌾 <b>Ферма деда</b>\n\n"
    "Тебе досталась заброшенная ферма деда и 10 000 ₽.\n"
    "Цель — бизнес на <b>1 000 000 ₽</b> за игровой год.\n\n"
    "Убери бурьян, построй курятник, собери теплицу из дедовых окон — "
    "и каждый месяц делай выбор, как в сериале «Ферма с нуля»."
)


def play_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🚜 Играть", web_app=WebAppInfo(url=CFG.webapp_url + "/")),
    ]])


@dp.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=play_keyboard())


@dp.message(Command("help"))
async def help_(message: Message) -> None:
    await message.answer(
        "1 игровой месяц = 1 ход. Тапай по постройкам, чтобы собирать урожай,\n"
        "в конце месяца — событие с выбором. 4 концовки, собери все открытки!\n\n"
        "Прогресс сохраняется автоматически.", reply_markup=play_keyboard())


@dp.message(F.text)
async def any_text(message: Message) -> None:
    await message.answer("Жми «Играть» 👇", reply_markup=play_keyboard())


async def run(web_only: bool) -> None:
    db = DB(CFG.db_path)
    await db.open()
    bot = None
    username = ""
    if not web_only:
        if not CFG.bot_token or not CFG.webapp_url.startswith("https://"):
            raise SystemExit("Нужны BOT_TOKEN и WEBAPP_URL (https://…) в .env")
        bot = Bot(CFG.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
        me = await bot.get_me()
        username = me.username or ""
        # кнопка меню рядом с полем ввода — тоже открывает игру
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Играть", web_app=WebAppInfo(url=CFG.webapp_url + "/")))
        log.info("Бот @%s запущен", username)

    app = make_app(CFG, db, username)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, CFG.host, CFG.port).start()
    log.info("Веб-сервер: http://%s:%s (игра из %s)", CFG.host, CFG.port, CFG.webapp_dir)
    try:
        if bot:
            await dp.start_polling(bot)
        else:
            await asyncio.Event().wait()
    finally:
        await runner.cleanup()
        await db.close()
        if bot:
            await bot.session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--web-only", action="store_true", help="только веб-сервер, без бота")
    args = ap.parse_args()
    try:
        asyncio.run(run(args.web_only))
    except KeyboardInterrupt:
        pass
