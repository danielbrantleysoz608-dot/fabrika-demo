"""Капитал и уровень фермы по сохранению — для серверных скриптов (сверка рейтинга, возврат после обновлений).

Повторяет игровые функции из webapp/js/engine.js: migrate() (только то, что влияет на капитал и опыт) → capital()
(деньги − долг + вложенное в постройки, дом, украшения, работников, доработки) и farmLevel(). Цифры берутся из
webapp/js/data.js и engine.js, чтобы не расходиться с игрой. Проверено на сохранениях всех версий экономики.
"""
import copy
import math
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DATA_JS = (APP / "webapp" / "js" / "data.js").read_text(encoding="utf-8")
ENGINE_JS = (APP / "webapp" / "js" / "engine.js").read_text(encoding="utf-8")


def _num(s: str) -> float:
    return float(s.replace("_", ""))


def _block(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i)]


LEVEL_MULT = _num(re.search(r"export const LEVEL_COST_MULT = ([\d.]+)", DATA_JS).group(1))
BUILDINGS = {}
for _m in re.finditer(r"^\s{2}(\w+):\s*\{([^\n]*)", _block(DATA_JS, "export const BUILDINGS = {", "export const BUILD_ORDER"), re.M):
    _line = _m.group(2)
    _g = lambda k: re.search(rf"\b{k}: ([\d_.]+)", _line)  # noqa: E731
    BUILDINGS[_m.group(1)] = {
        "cost": _num(_g("cost").group(1)), "mult": _num(_g("costMult").group(1)) if _g("costMult") else LEVEL_MULT,
        "kind": (re.search(r"kind: '(\w+)'", _line) or [None, ""])[1], "loc": (re.search(r"loc: '(\w+)'", _line) or [None, "home"])[1],
        "tier": int(_g("tier").group(1)) if _g("tier") else 0}
HOUSE = [_num(x) for x in re.findall(r"cost: ([\d_]+)", _block(DATA_JS, "export const HOUSE_STAGES", "];"))]
DECOR = {m.group(1): _num(m.group(2)) for m in re.finditer(r"id: '(\w+)'.*?cost: ([\d_]+)", _block(DATA_JS, "export const DECOR = [", "];"))}
LOC_TIER = {m.group(1): int(m.group(2)) for m in re.finditer(r"\{ id: '(\w+)',\s*name: '[^']*',\s*emoji: '[^']*', tier: (\d)", DATA_JS)}
OLD_ECON = {m.group(1): [_num(x) for x in m.group(2).split(",")] for m in
            re.finditer(r"(\w+): \[([\d.e,\s]+)\]", _block(ENGINE_JS, "const OLD_ECON = {", "};"))}
V3_INC = {m.group(1) for m in re.finditer(r"(\w+): \[", _block(ENGINE_JS, "const V3_INC = {", "};"))}
V3_MULT = _num(re.search(r"const V3_MULT = ([\d.]+)", ENGINE_JS).group(1))
V4_ECON = {m.group(1): [_num(x) for x in m.group(2).split(",")] for m in
           re.finditer(r"(\w+): \[([\d.e,\s]+)\]", _block(ENGINE_JS, "const V4_ECON = {", "};"))}


def xp_for_level(n: int) -> int:
    return 0 if n <= 1 else int(math.floor(30 * (n - 1) ** 1.7 + 0.5))


def migrate(game: dict) -> dict:
    """То, что делает engine.migrate() с опытом и «книжной» стоимостью построек."""
    s = copy.deepcopy(game)
    if not s.get("xpV2"):
        s["xp"] = max(s.get("xp") or 0, round((s.get("xp") or 0) * 2 + (s.get("taps") or 0)))
        s["xpV2"] = 1
    if not s.get("locK"):
        s["locK"] = {loc: 1 for loc, t in LOC_TIER.items() if t >= 1 and (s.get("tier") or 0) >= t}
    frm = s.get("econV") or 0
    lv = s.get("lv") or {}

    def k_of(bid):
        loc = BUILDINGS[bid]["loc"]
        return (s.get("locKi") or {}).get(loc) or (s.get("locK") or {}).get(loc) or 1

    bpaid = s.setdefault("bpaid", {}) if (frm < 5) else (s.get("bpaid") or {})
    if frm < 3:
        for bid, L in lv.items():
            o = OLD_ECON.get(bid)
            if not o or not L or L <= 0 or bid in bpaid:
                continue
            v, p = 0.0, o[2] * k_of(bid)
            for _ in range(int(L)):
                v += p
                p *= o[3]
            bpaid[bid] = round(v)
        s.pop("locK", None), s.pop("locKi", None)
    if frm == 3:
        for bid in V3_INC:
            L = lv.get(bid) or 0
            if L > 0 and bid not in bpaid:
                v, p = 0.0, BUILDINGS[bid]["cost"] * k_of(bid)
                for _ in range(int(L)):
                    v += p
                    p *= V3_MULT
                bpaid[bid] = round(v)
    if frm == 4:
        for bid, (_inc, _g, mult) in V4_ECON.items():
            L = lv.get(bid) or 0
            if L > 0 and mult != BUILDINGS[bid]["mult"] and bid not in bpaid:
                v, p = 0.0, BUILDINGS[bid]["cost"] * k_of(bid)
                for _ in range(int(L)):
                    v += p
                    p *= mult
                bpaid[bid] = round(v)
    s["bpaid"] = bpaid
    if (s.get("money") or 0) < 0:
        s["debt"] = (s.get("debt") or 0) + round(-s["money"])
        s["money"] = 0
    return s


def capital_raw(s: dict) -> int:
    """E.capital() по уже перенесённому сохранению."""
    v = sum(HOUSE[: int(s.get("house") or 0)])
    dec = s.get("decor") or {}
    v += sum(DECOR.get(k, 0) for k, x in dec.items() if x is True)
    v += s.get("subPaid") or 0
    v += sum((w or {}).get("spent") or 0 for w in (s.get("workers") or {}).values())
    v += sum(0 if x is True else (x or 0) for x in dec.values())
    bpaid, lock = s.get("bpaid") or {}, s.get("locK") or {}
    for bid, L in (s.get("lv") or {}).items():
        b = BUILDINGS.get(bid)
        if not b or not L:
            continue
        if b["kind"] == "once":
            v += b["cost"] * L
        elif bpaid.get(bid) is not None:
            v += bpaid[bid]
        else:
            p = b["cost"] * (lock.get(b["loc"]) or 1)
            for _ in range(int(L)):
                v += p
                p *= b["mult"]
    return round((s.get("money") or 0) - (s.get("debt") or 0) + v)


def capital(game: dict) -> int:
    return capital_raw(migrate(game))


def level(game: dict) -> int:
    xp = migrate(game).get("xp") or 0
    n = 1
    while xp >= xp_for_level(n + 1):
        n += 1
    return n


def fmt(n: float) -> str:
    return f"{n / 1e9:.2f} млрд" if abs(n) >= 1e9 else f"{n / 1e6:.2f} млн" if abs(n) >= 1e6 else f"{round(n):,}".replace(",", " ")
