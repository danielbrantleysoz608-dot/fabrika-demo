"""Кто потерял уровень или капитал после обновлений — и вернуть (запуск на сервере от пользователя ferma):
    sudo -u ferma /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python \
        /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/repair_after_update.py [--hours 120] [--player Викуша] [--fix]

Сравнивает каждого игрока сейчас с копиями базы за последние --hours часов (/opt/ferma/backups, их делает
update.sh перед каждым обновлением и таймер раз в сутки). Для каждой фермы берётся лучшее, что было в копиях
(тот же startedAt — если игрок сам начал заново, не трогаем). Уровень и капитал считаются так же, как в игре
(farm_capital.py = engine.js). Без --fix только показывает.
--fix: каждому, у кого упало, — компенсация: опыт не ниже прежнего (уровень вернётся) и разница капитала деньгами.
Игра забирает её сама при входе (или в течение 2 минут, если открыта) и пишет игроку «Вернули после обновления».
Рейтинг «Всё время» сразу поднимается до прежнего капитала. Ничего не отнимается. Повторный запуск не дублирует.
"""
import argparse
import gzip
import json
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "bot"))
import farm_capital as fc  # noqa: E402
from config import load  # noqa: E402

BACKUPS = Path(__import__("os").environ.get("FERMA_BACKUPS", "/opt/ferma/backups"))


def saves_of(db_path: Path) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    out = {}
    for uid, data, upd in con.execute("SELECT user_id, data, updated_at FROM saves"):
        try:
            g = (json.loads(data) or {}).get("game") or {}
        except ValueError:
            continue
        if g.get("phase") == "clean" or "money" not in g:
            continue
        out[uid] = {"game": g, "updated": upd}
    con.close()
    return out


def stats(g: dict) -> dict:
    m = fc.migrate(g)
    return {"lvl": fc.level(g), "cap": fc.capital(g), "xp": m.get("xp") or 0, "month": g.get("month") or 0, "started": g.get("startedAt")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=120)
    ap.add_argument("--player", default="")
    ap.add_argument("--fix", action="store_true")
    a = ap.parse_args()
    cfg = load()
    cur = saves_of(cfg.db_path)
    names = {}
    con = sqlite3.connect(cfg.db_path)
    for key, name in con.execute("SELECT player_key, name FROM players"):
        if key.startswith("tg:"):
            names[int(key[3:])] = name
    con.close()

    since = time.time() - a.hours * 3600
    files = sorted(p for p in BACKUPS.glob("ferma-2*.sqlite3.gz") if p.stat().st_mtime >= since)
    print(f"Копии базы за последние {a.hours:.0f} ч: {len(files)}")
    for p in files:
        print("  ", p.name)
    best = {}   # uid -> лучшее состояние той же фермы в копиях
    history = {}
    with tempfile.TemporaryDirectory() as tmp:
        for p in files:
            db = Path(tmp) / "b.sqlite3"
            with gzip.open(p, "rb") as src, open(db, "wb") as dst:
                shutil.copyfileobj(src, dst)
            for uid, s in saves_of(db).items():
                st = stats(s["game"])
                st["file"] = p.name
                history.setdefault(uid, []).append(st)
                if uid not in cur or st["started"] != stats(cur[uid]["game"])["started"]:
                    continue
                b = best.setdefault(uid, {"lvl": 0, "cap": 0, "xp": 0, "month": 0, "file_lvl": "", "file_cap": ""})
                if st["xp"] > b["xp"]:
                    b.update(xp=st["xp"], lvl=st["lvl"], month=max(b["month"], st["month"]), file_lvl=p.name)
                if st["cap"] > b["cap"]:
                    b.update(cap=st["cap"], file_cap=p.name)
                b["month"] = max(b["month"], st["month"])

    con = sqlite3.connect(cfg.db_path)
    con.executescript("""CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        xp_min INTEGER NOT NULL DEFAULT 0, money INTEGER NOT NULL DEFAULT 0, reason TEXT, created_at INTEGER NOT NULL, confirmed_at INTEGER);""")
    pending = {r[0] for r in con.execute("SELECT DISTINCT user_id FROM grants WHERE confirmed_at IS NULL")}
    rows = []
    for uid, s in cur.items():
        now, b = stats(s["game"]), best.get(uid)
        if not b:
            continue
        lvl_drop, cap_drop = b["lvl"] > now["lvl"], b["cap"] > now["cap"] * 1.001 + 1000
        if not (lvl_drop or cap_drop):
            continue
        cause = ("загрузилась старая копия фермы (откат)" if b["month"] > now["month"] or b["xp"] > now["xp"]
                 else "стоимость построек / цены после обновления")
        rows.append((uid, now, b, lvl_drop, cap_drop, cause))

    if a.player:
        q = a.player.lower()
        for uid, nm in names.items():
            if q in (nm or "").lower():
                print(f"\n=== {nm} (id {uid}) — по копиям базы ===")
                for h in history.get(uid, []):
                    print(f"  {h['file']}: уровень {h['lvl']}, капитал {fc.fmt(h['cap'])}, месяц {h['month']}, ферма начата {h['started']}")
                if uid in cur:
                    n = stats(cur[uid]["game"])
                    print(f"  СЕЙЧАС: уровень {n['lvl']}, капитал {fc.fmt(n['cap'])}, месяц {n['month']}, ферма начата {n['started']}")

    print(f"\nУ кого упало: {len(rows)}")
    print(f"{'Игрок':<18} {'уровень было→стало':>20} {'капитал было→стало':>32}  причина / вернул")
    fixed = 0
    for uid, now, b, lvl_drop, cap_drop, cause in sorted(rows, key=lambda r: -(r[2]['cap'] - r[1]['cap'])):
        nm = (names.get(uid) or f"id {uid}")[:18]
        give_xp = b["xp"] if lvl_drop else 0
        give_money = max(0, b["cap"] - now["cap"]) if cap_drop else 0
        note = cause
        if a.fix:
            if uid in pending:
                note += " · компенсация уже ждёт игрока"
            else:
                con.execute("INSERT INTO grants(user_id, xp_min, money, reason, created_at) VALUES(?,?,?,?,?)",
                            (uid, int(give_xp), int(give_money), cause, int(time.time())))
                con.execute("UPDATE scores SET capital=MAX(capital, ?) WHERE player_key=?", (int(b["cap"]), f"tg:{uid}"))
                fixed += 1
                note += f" · вернул: {'уровень ' + str(b['lvl']) if lvl_drop else ''}{', ' if lvl_drop and cap_drop else ''}{'+' + fc.fmt(give_money) if cap_drop else ''}"
        print(f"{nm:<18} {str(b['lvl']) + ' → ' + str(now['lvl']):>20} {fc.fmt(b['cap']) + ' → ' + fc.fmt(now['cap']):>32}  {note}")
    if a.fix:
        con.commit()
        print(f"\nКомпенсаций создано: {fixed}. Игроки получат их при входе в игру (рейтинг уже обновлён).")
    else:
        print("\nНичего не изменено. Чтобы вернуть — запустите с --fix.")
    con.close()


if __name__ == "__main__":
    main()
