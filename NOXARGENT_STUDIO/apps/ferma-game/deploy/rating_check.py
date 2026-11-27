"""Сверка рейтинга с капиталом из сохранений игроков (запуск на сервере от пользователя ferma):
    sudo -u ferma /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python \
        /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/rating_check.py [N] [--fix]
Для N игроков (по умолчанию 5, самые свежие) печатает: имя, капитал как в шапке игры (деньги + постройки − долг,
посчитан по сохранению той же формулой, что E.capital в webapp/js/engine.js), капитал в рейтинге «Всё время», разницу.
--fix — записать в рейтинг капитал из сохранения у всех игроков (сохранения и прогресс не меняются).
Токенов и личных данных, кроме имени в рейтинге, не печатает.
"""
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "bot"))
from config import load  # noqa: E402

DATA_JS = (APP / "webapp" / "js" / "data.js").read_text(encoding="utf-8")


def _num(s: str) -> float:
    return float(s.replace("_", ""))


def parse_data():
    lm = re.search(r"export const LEVEL_COST_MULT = ([\d.]+)", DATA_JS)
    level_mult = _num(lm.group(1))
    b_block = DATA_JS[DATA_JS.index("export const BUILDINGS = {"):DATA_JS.index("export const BUILD_ORDER")]
    buildings = {}
    for m in re.finditer(r"^\s{2}(\w+):\s*\{([^\n]*)", b_block, re.M):
        line = m.group(2)
        g = lambda k: re.search(rf"\b{k}: ([\d_.]+)", line)  # noqa: E731
        kind = re.search(r"kind: '(\w+)'", line)
        loc = re.search(r"loc: '(\w+)'", line)
        buildings[m.group(1)] = {"cost": _num(g("cost").group(1)), "mult": _num(g("costMult").group(1)) if g("costMult") else level_mult,
                                 "kind": kind.group(1) if kind else "", "loc": loc.group(1) if loc else "home"}
    h_block = DATA_JS[DATA_JS.index("export const HOUSE_STAGES"):DATA_JS.index("];", DATA_JS.index("export const HOUSE_STAGES"))]
    house = [_num(x) for x in re.findall(r"cost: ([\d_]+)", h_block)]
    d_block = DATA_JS[DATA_JS.index("export const DECOR = ["):DATA_JS.index("];", DATA_JS.index("export const DECOR = ["))]
    decor = {m.group(1): _num(m.group(2)) for m in re.finditer(r"id: '(\w+)'.*?cost: ([\d_]+)", d_block)}
    return buildings, house, decor


BUILDINGS, HOUSE, DECOR = parse_data()


def capital(st: dict) -> int:
    """Копия E.capital (engine.js): деньги − долг + вложенное в постройки, дом, украшения, работников, доработки."""
    v = sum(HOUSE[: int(st.get("house") or 0)])
    dec = st.get("decor") or {}
    v += sum(DECOR.get(k, 0) for k, x in dec.items() if x is True)
    v += st.get("subPaid") or 0
    v += sum((w or {}).get("spent") or 0 for w in (st.get("workers") or {}).values())
    v += sum(0 if x is True else (x or 0) for x in dec.values())
    bpaid, lock = st.get("bpaid") or {}, st.get("locK") or {}
    for bid, L in (st.get("lv") or {}).items():
        b = BUILDINGS.get(bid)
        if not b or not L:
            continue
        if b["kind"] == "once":
            v += b["cost"] * L
        elif bid in bpaid and bpaid[bid] is not None:
            v += bpaid[bid]
        else:
            p, k = b["cost"] * (lock.get(b["loc"]) or 1), b["mult"]
            for _ in range(int(L)):
                v += p
                p *= k
    return round((st.get("money") or 0) - (st.get("debt") or 0) + v)


def fmt(n: float) -> str:
    return f"{n / 1e9:.2f} млрд" if abs(n) >= 1e9 else f"{n / 1e6:.2f} млн" if abs(n) >= 1e6 else f"{round(n):,}".replace(",", " ")


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
        if fix and r["rating"] is not None and abs(r["rating"] - cap) > max(1, abs(cap) * 1e-9):
            con.execute("UPDATE scores SET capital=? WHERE player_key=?", (cap, f"tg:{r['user_id']}"))
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
