"""Сверка рейтинга с капиталом из сохранений игроков (запуск на сервере от пользователя ferma):
    sudo -u ferma /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python \
        /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/rating_check.py [N] [--fix]
Для N игроков (по умолчанию 5, самые свежие) печатает: имя, капитал как в шапке игры (деньги + постройки − долг,
посчитан по сохранению той же формулой, что E.capital в webapp/js/engine.js), капитал в рейтинге «Всё время», разницу.
--fix — поднять рейтинг до капитала из сохранения, где он ниже (сохранения и прогресс не меняются).
Токенов и личных данных, кроме имени в рейтинге, не печатает.
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "bot"))
from config import load  # noqa: E402

sys.path.insert(0, str(APP / "deploy"))
from farm_capital import capital, fmt  # noqa: E402  — та же формула, что E.capital в игре (проверено на всех версиях)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    n, fix = int(args[0]) if args else 5, "--fix" in sys.argv
    con = sqlite3.connect(load().db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute("""SELECT s.user_id, s.data, s.updated_at, sc.capital AS rating, p.name
                          FROM saves s LEFT JOIN scores sc ON sc.player_key = 'tg:' || s.user_id
                          LEFT JOIN players p ON p.player_key = 'tg:' || s.user_id
                          ORDER BY s.updated_at DESC""").fetchall()
    shown = fixed = 0
    print(f"{'Игрок':<20} {'в шапке (из сохранения)':>24} {'в рейтинге':>14} {'разница':>12}  сохранено")
    for r in rows:
        try:
            st = json.loads(r["data"]).get("game") or {}
        except ValueError:
            continue
        if st.get("phase") == "clean" or "money" not in st:
            continue
        cap = capital(st)
        if fix and r["rating"] is not None and cap - r["rating"] > max(1, abs(cap) * 1e-9):
            con.execute("UPDATE scores SET capital=MAX(capital, ?) WHERE player_key=?", (cap, f"tg:{r['user_id']}"))  # только поднимаем: компенсации ждут игрока
            fixed += 1
        if shown < n:
            rating = r["rating"]
            diff = "нет в рейтинге" if rating is None else ("совпадает" if abs(rating - cap) <= max(1, abs(cap) * 1e-9) else fmt(cap - rating))
            ago = int((time.time() - r["updated_at"]) / 60)
            print(f"{(r['name'] or 'игрок')[:20]:<20} {fmt(cap):>24} {fmt(rating) if rating is not None else '—':>14} {diff:>12}  {ago} мин назад")
            shown += 1
    if fix:
        con.commit()
        print(f"\nИсправлено в рейтинге: {fixed} игрок(ов). Сохранения не менялись.")
    con.close()


if __name__ == "__main__":
    main()
