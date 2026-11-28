"""Кто потерял уровень или капитал после обновлений — найти и вернуть (запуск на сервере от пользователя ferma):
    PY=/opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python
    R=/opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/repair_after_update.py
    sudo -u ferma $PY $R --find Викуша                    # найти игрока по имени (чат, Telegram, рейтинг) и показать по копиям
    sudo -u ferma $PY $R --backup 20261127-0100 --backup 20261126-0100            # все, у кого упало, — только показ
    sudo -u ferma $PY $R --backup 20261127-0100 --backup 20261126-0100 --fix      # вернуть
    sudo -u ferma $PY $R --negatives [--fix-debt]          # у кого капитал меньше нуля и откуда (и списать долг)

Сравнивает текущую базу с копиями (/opt/ferma/backups; --backup — только копии с этим текстом в имени, иначе за --hours).
Уровень и капитал считаются так же, как в игре (farm_capital.py = engine.js).
- Та же ферма, а опыт/капитал меньше → компенсация: опыт не ниже прежнего (уровень вернётся) + разница капитала деньгами.
- Сейчас ДРУГАЯ ферма (startedAt другой), а прежняя была больше → это не «Начать заново», а новая ферма с устройства,
  которое не загрузило настоящую: возвращаем прежнюю ферму целиком из копии.
Компенсацию игра забирает сама (при входе или в течение 2 минут) и пишет игроку «Вернули после обновления»;
рейтинг сразу поднимается до прежнего капитала. Ничего не отнимается. Повторный запуск не дублирует.
"""
import argparse
import gzip
import json
import os
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

BACKUPS = Path(os.environ.get("FERMA_BACKUPS", "/opt/ferma/backups"))
GRANTS = """CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    xp_min INTEGER NOT NULL DEFAULT 0, money INTEGER NOT NULL DEFAULT 0, reason TEXT, created_at INTEGER NOT NULL, confirmed_at INTEGER);"""


def read_db(path: Path) -> dict:
    """{'saves': {uid: game}, 'names': {uid: set(имён)}} — имена из рейтинга, Telegram и чата фермы."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    saves, names = {}, {}
    for uid, data in con.execute("SELECT user_id, data FROM saves"):
        try:
            g = (json.loads(data) or {}).get("game") or {}
        except ValueError:
            continue
        if "money" in g:
            saves[uid] = g
    queries = ["SELECT CAST(substr(player_key, 4) AS INTEGER), name FROM players WHERE player_key LIKE 'tg:%'",
               "SELECT user_id, first_name FROM users", "SELECT user_id, '@' || username FROM users WHERE username IS NOT NULL",
               "SELECT user_id, name FROM mod_users", "SELECT user_id, '@' || username FROM mod_users WHERE username IS NOT NULL"]
    for q in queries:
        try:
            for uid, nm in con.execute(q):
                if nm:
                    names.setdefault(uid, set()).add(str(nm))
        except sqlite3.OperationalError:
            pass  # таблицы нет в старой копии
    con.close()
    return {"saves": saves, "names": names}


def st(g: dict) -> dict:
    m = fc.migrate(g)
    return {"lvl": fc.level(g), "cap": fc.capital(g), "xp": m.get("xp") or 0, "month": g.get("month") or 0, "started": g.get("startedAt"),
            "money": m.get("money") or 0, "debt": m.get("debt") or 0, "debtAuto": m.get("debtAuto") or 0, "phase": g.get("phase")}


def norm(s: str) -> str:
    tr = str.maketrans("abvgdeziklmnoprstufhcy", "абвгдезиклмнопрстуфхцы")
    return s.lower().replace("ё", "е").translate(tr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=120)
    ap.add_argument("--backup", action="append", default=[], help="часть имени копии, напр. 20261127-0100")
    ap.add_argument("--find", default="", help="найти игрока по имени (чат, Telegram, рейтинг)")
    ap.add_argument("--user", type=int, default=0, help="только этот Telegram id")
    ap.add_argument("--negatives", action="store_true", help="игроки с отрицательным капиталом")
    ap.add_argument("--fix", action="store_true", help="вернуть уровень/капитал/ферму")
    ap.add_argument("--fix-debt", action="store_true", help="с --negatives: списать долг, набежавший из-за расходов месяца")
    ap.add_argument("--cancel", default="", help="отменить ещё не полученные компенсации игрока (имя или Telegram id)")
    a = ap.parse_args()
    cfg = load()
    now_db = read_db(cfg.db_path)
    cur = now_db["saves"]

    files = sorted(BACKUPS.glob("ferma-2*.sqlite3.gz"))
    files = [p for p in files if any(b in p.name for b in a.backup)] if a.backup else [p for p in files if p.stat().st_mtime >= time.time() - a.hours * 3600]
    print("Копии базы для сравнения:", ", ".join(p.name for p in files) or "НЕТ (проверьте --backup / /opt/ferma/backups)")
    backups = []
    with tempfile.TemporaryDirectory() as tmp:
        for p in files:
            db = Path(tmp) / p.name.replace(".gz", "")
            with gzip.open(p, "rb") as src, open(db, "wb") as dst:
                shutil.copyfileobj(src, dst)
            backups.append((p.name, read_db(db)))
    names = {}
    for _, b in backups + [("now", now_db)]:
        for uid, ns in b["names"].items():
            names.setdefault(uid, set()).update(ns)
    label = lambda uid: " / ".join(sorted(names.get(uid, {f'id {uid}'})))[:40]  # noqa: E731

    # --- поиск игрока ---
    if a.find:
        q = norm(a.find)
        keys = {q, q[:4], q[:3]} if len(q) >= 4 else {q}
        hits = [uid for uid, ns in names.items() if any(k in norm(n) for n in ns for k in keys)]
        print(f"\nПоиск «{a.find}»: найдено {len(hits)}")
        for uid in hits:
            print(f"\n=== id {uid}: {label(uid)} ===")
            for fname, b in backups:
                if uid in b["saves"]:
                    s = st(b["saves"][uid])
                    print(f"  {fname}: уровень {s['lvl']}, опыт {s['xp']}, капитал {fc.fmt(s['cap'])}, месяц {s['month']}, ферма начата {s['started']}")
            if uid in cur:
                s = st(cur[uid])
                print(f"  СЕЙЧАС: уровень {s['lvl']}, опыт {s['xp']}, капитал {fc.fmt(s['cap'])}, месяц {s['month']}, ферма начата {s['started']}"
                      f"{' (уборка — новая ферма)' if s['phase'] == 'clean' else ''}")
            else:
                print("  СЕЙЧАС: сохранения нет")
        if not a.fix:
            return

    con = sqlite3.connect(cfg.db_path)
    con.executescript(GRANTS)
    for col in ("debt_off INTEGER NOT NULL DEFAULT 0", "game TEXT"):
        try:
            con.execute(f"ALTER TABLE grants ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    if a.cancel:  # отменить ещё не полученные компенсации (уже полученные отменить нельзя — они в ферме игрока)
        q = norm(a.cancel)
        uids = [int(a.cancel)] if a.cancel.isdigit() else [uid for uid, ns in names.items() if any(q in norm(n) for n in ns)]
        for uid in uids:
            got = con.execute("SELECT COUNT(*) FROM grants WHERE user_id=? AND confirmed_at IS NOT NULL", (uid,)).fetchone()[0]
            n = con.execute("DELETE FROM grants WHERE user_id=? AND confirmed_at IS NULL", (uid,)).rowcount
            print(f"{label(uid)}: отменено компенсаций {n}" + (f"; уже получено игроком раньше: {got}" if got else ""))
        con.commit()
        con.close()
        return
    pending = {r[0] for r in con.execute("SELECT DISTINCT user_id FROM grants WHERE confirmed_at IS NULL")}

    # --- отрицательный капитал ---
    if a.negatives:
        neg = [(uid, st(g)) for uid, g in cur.items() if (a.user in (0, uid)) and st(g)["cap"] < 0]
        print(f"\nКапитал меньше нуля: {len(neg)} игрок(ов)")
        print(f"{'Игрок':<40} {'капитал':>14} {'деньги':>12} {'долг':>14} {'из них на зарплаты':>20}  в копиях")
        for uid, s in sorted(neg, key=lambda x: x[1]["cap"]):
            was = [f"{fn[6:19]}: {fc.fmt(st(b['saves'][uid])['cap'])}" for fn, b in backups if uid in b["saves"]]
            print(f"{label(uid):<40} {fc.fmt(s['cap']):>14} {fc.fmt(s['money']):>12} {fc.fmt(s['debt']):>14} {fc.fmt(s['debtAuto']):>20}  {'; '.join(was)}")
            if a.fix_debt and s["debtAuto"] > 0 and uid not in pending:
                con.execute("INSERT INTO grants(user_id, debt_off, reason, created_at) VALUES(?,?,?,?)",
                            (uid, int(s["debtAuto"]), "долг из-за старых расходов месяца", int(time.time())))
                con.execute("UPDATE scores SET capital=MAX(capital, ?) WHERE player_key=?", (int(s["cap"] + s["debtAuto"]), f"tg:{uid}"))
                print("    → долг на зарплаты будет списан при входе в игру")
        con.commit()
        con.close()
        return

    # --- кто потерял уровень или капитал ---
    rows = []
    for uid, g in cur.items():
        if a.user and uid != a.user:
            continue
        now = st(g)
        best = None
        for fname, b in backups:
            og = b["saves"].get(uid)
            if not og or og.get("phase") == "clean":
                continue
            o = st(og)
            o.update(file=fname, game=og)
            if best is None or (o["xp"], o["cap"]) > (best["xp"], best["cap"]):
                best = o
        if not best:
            continue
        same = best["started"] == now["started"]
        if not same and best["xp"] <= now["xp"]:
            continue  # новая ферма уже сильнее прежней — это законное «Начать заново», не трогаем
        lvl_drop, cap_drop = best["lvl"] > now["lvl"], best["cap"] > now["cap"] * 1.001 + 1000
        if not (lvl_drop or cap_drop):
            continue
        if not same:
            cause = "другая ферма вместо прежней (устройство не загрузило настоящую)"
        elif best["xp"] > now["xp"] or best["month"] > now["month"]:
            cause = "загрузилась старая копия фермы (откат)"
        else:
            cause = "стоимость построек / цены после обновления"
        rows.append((uid, now, best, same, lvl_drop, cap_drop, cause))

    print(f"\nУ кого упал уровень или капитал: {len(rows)}  (уровень упал у {sum(1 for r in rows if r[4])})")
    print(f"{'Игрок':<40} {'уровень было→стало':>18} {'капитал было→стало':>30}  причина / вернул")
    fixed = 0
    for uid, now, b, same, lvl_drop, cap_drop, cause in sorted(rows, key=lambda r: (-int(r[4]), -(r[2]['cap'] - r[1]['cap']))):
        note = cause + f" (копия {b['file'][6:19]})"
        if a.fix:
            if uid in pending:
                note += " · компенсация уже ждёт игрока"
            else:
                if same:
                    give_money = max(0, b["cap"] - now["cap"]) if cap_drop else 0
                    con.execute("INSERT INTO grants(user_id, xp_min, money, reason, created_at) VALUES(?,?,?,?,?)",
                                (uid, int(b["xp"]) if lvl_drop else 0, int(give_money), cause, int(time.time())))
                    note += f" · вернул: {('уровень ' + str(b['lvl'])) if lvl_drop else ''}{', ' if lvl_drop and cap_drop else ''}{('+' + fc.fmt(give_money)) if cap_drop else ''}"
                else:
                    con.execute("INSERT INTO grants(user_id, game, reason, created_at) VALUES(?,?,?,?)",
                                (uid, json.dumps(b["game"], ensure_ascii=False), cause, int(time.time())))
                    note += f" · вернул прежнюю ферму целиком (уровень {b['lvl']}, капитал {fc.fmt(b['cap'])})"
                con.execute("UPDATE scores SET capital=MAX(capital, ?) WHERE player_key=?", (int(b["cap"]), f"tg:{uid}"))
                fixed += 1
        print(f"{label(uid):<40} {str(b['lvl']) + ' → ' + str(now['lvl']):>18} {fc.fmt(b['cap']) + ' → ' + fc.fmt(now['cap']):>30}  {note}")
    if a.fix:
        con.commit()
        print(f"\nКомпенсаций создано: {fixed}. Игроки получат их при входе в игру (рейтинг уже обновлён).")
    else:
        print("\nНичего не изменено. Чтобы вернуть — тот же запуск с --fix.")
    con.close()


if __name__ == "__main__":
    main()
