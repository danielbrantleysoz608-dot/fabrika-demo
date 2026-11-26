"""Разово: снять мут с тех, кто завис на капче (капчу из бота убрали). Запуск на сервере от пользователя ferma:
    sudo -u ferma /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python \
        /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/unmute_captcha.py
Берёт список из таблицы captcha_pending (саму таблицу не меняет), возвращает чату обычные права и удаляет висящие капчи.
Кого админ замутил ещё до входа (мут не истёк) — не трогает. Повторный запуск безопасен. Токен не печатается.
"""
import asyncio
import os
import sqlite3
import sys
import time
from pathlib import Path

BOT = Path(__file__).resolve().parents[1] / "bot"
sys.path.insert(0, str(BOT))
os.chdir(BOT)
from aiogram import Bot  # noqa: E402
from aiogram.types import ChatPermissions  # noqa: E402
from config import load  # noqa: E402

DEFAULT = ChatPermissions(can_send_messages=True, can_send_audios=True, can_send_documents=True, can_send_photos=True,
                          can_send_videos=True, can_send_video_notes=True, can_send_voice_notes=True, can_send_polls=True,
                          can_send_other_messages=True, can_add_web_page_previews=True)


async def main() -> None:
    cfg = load()
    con = sqlite3.connect(cfg.db_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT * FROM captcha_pending").fetchall()
    except sqlite3.OperationalError:
        print("Таблицы капчи нет — размучивать некого.")
        return
    finally:
        con.close()
    if not rows:
        print("Никто не висит в муте из-за капчи.")
        return
    bot = Bot(cfg.bot_token)
    done = skipped = failed = 0
    try:
        for p in rows:
            chat_id, uid = p["chat_id"], p["user_id"]
            if (p["muted_until"] or 0) > time.time():
                skipped += 1  # мут от админа ещё до входа — оставляем
                continue
            try:
                chat = await bot.get_chat(chat_id)
                await bot.restrict_chat_member(chat_id, uid, chat.permissions or DEFAULT)
                done += 1
            except Exception as e:  # noqa: BLE001 — вышел из чата и т.п.
                failed += 1
                print(f"  id {uid}: не получилось — {str(e)[:120]}")
            for mid in (p["msg_id"], p["join_msg_id"]):
                if mid:
                    try:
                        await bot.delete_message(chat_id, mid)
                    except Exception:  # noqa: BLE001 — уже удалено или старше 48 ч
                        pass
    finally:
        await bot.session.close()
    print(f"Размучено: {done}, оставлен мут админа: {skipped}, не получилось: {failed} (из {len(rows)}).")


asyncio.run(main())
