"""Самопроверка боевого сервера. Запуск на сервере от root:
    /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/selftest.py
(с базой работает только от пользователя ferma — чтобы файлы SQLite остались его)

Проверяет по настоящему https-адресу: игра открывается, рейтинг общий для двух Telegram id,
сохранение переживает перезапуск сервера, поддельная initData отклоняется, оплата выдаётся ровно один раз,
бот достаёт до api.telegram.org. Тестовые записи после проверки удаляются.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BOT = Path(__file__).resolve().parents[1] / "bot"
sys.path.insert(0, str(BOT))
os.chdir(BOT)
from auth import sign_init_data  # noqa: E402
from config import load  # noqa: E402

CFG = load()
URL = CFG.webapp_url.rstrip("/")
U1, U2 = 900000001, 900000002          # тестовые id (таких пользователей Telegram не бывает в игре)
ok_all = True


def check(name, cond, extra=""):
    global ok_all
    ok_all &= bool(cond)
    print(("✅ " if cond else "❌ ") + name + (f" — {extra}" if extra else ""))


def http(method, path, body=None, init=None, timeout=15):
    req = urllib.request.Request(URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"X-Telegram-Init-Data": init} if init else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, r.headers, (json.loads(raw) if r.headers.get("Content-Type", "").startswith("application/json") else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def init(uid, name):
    return sign_init_data({"auth_date": str(int(time.time())), "query_id": "selftest",
                           "user": json.dumps({"id": uid, "first_name": name})}, CFG.bot_token)


def main():
    print(f"Проверяю {URL}\n")
    # 1. игра по https
    st, h, body = http("GET", "/")
    check("Игра открывается по https", st == 200 and "Ферма деда".encode() in body, f"HTTP {st}")
    st, h, _ = http("GET", "/js/app.js")
    check("Скрипты игры отдаются как JavaScript", st == 200 and "javascript" in h.get("Content-Type", ""), h.get("Content-Type", ""))
    st, _, cfgjs = http("GET", "/config.js")
    check("Магазин включён на сервере", b'"shop": true' in cfgjs)
    # 2. Telegram
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{CFG.bot_token}/getMe", timeout=15) as r:
            me = json.loads(r.read())["result"]
        check("Бот достаёт до api.telegram.org", True, "@" + me["username"])
    except Exception as e:  # noqa: BLE001
        check("Бот достаёт до api.telegram.org", False, str(e))
    # 3. поддельная initData
    fake = init(U1, "Тест").replace("hash=", "hash=00")
    st, _, _ = http("GET", "/api/save", init=fake)
    check("Поддельная initData отклоняется", st == 401, f"HTTP {st}")
    st, _, _ = http("POST", "/api/score", {"capital": 10**12}, init=None)
    check("Без Telegram в рейтинг не попасть", st == 401, f"HTTP {st}")
    # 4. общий рейтинг для двух id
    i1, i2 = init(U1, "Самопроверка-1"), init(U2, "Самопроверка-2")
    http("POST", "/api/score", {"capital": 777_001, "tier": 0, "year": 1}, init=i1)
    http("POST", "/api/score", {"capital": 777_002, "tier": 0, "year": 1}, init=i2)
    _, _, b1 = http("GET", "/api/leaderboard?period=all", init=i1)
    _, _, b2 = http("GET", "/api/leaderboard?period=all", init=i2)
    names1 = {t["name"] for t in b1["top"]}
    check("Рейтинг общий для двух игроков", {"Самопроверка-1", "Самопроверка-2"} <= names1, f"игроков в таблице: {b1['total']}")
    check("Каждый видит себя в рейтинге", b1["me"]["value"] == 777_001 and b2["me"]["value"] == 777_002)
    # 5. сохранение переживает перезапуск
    stamp = int(time.time())
    http("PUT", "/api/save", {"game": {"selftest": stamp}, "updatedAt": stamp}, init=i1)
    r = subprocess.run(["systemctl", "restart", "ferma-bot"], capture_output=True)
    restarted = r.returncode == 0
    if restarted:
        for _ in range(30):
            time.sleep(1)
            try:
                if http("GET", "/health")[0] == 200:
                    break
            except Exception:  # noqa: BLE001
                pass
    _, _, saved = http("GET", "/api/save", init=i1)
    check("Сохранение не теряется после перезапуска сервера" if restarted else "Сохранение на сервере (перезапуск — запустите проверку через sudo)",
          isinstance(saved, dict) and saved.get("game", {}).get("selftest") == stamp)
    # 6. оплата выдаётся ровно один раз (имитация successful_payment на боевой базе)
    pay = as_ferma("pay")
    _, _, p = http("GET", "/api/shop/pending", init=i1)
    got = [x for x in p["items"] if x["charge_id"] == "selftest-charge"]
    http("POST", "/api/shop/ack", {"ids": ["selftest-charge"]}, init=i1)
    _, _, p2 = http("GET", "/api/shop/pending", init=i1)
    check("Оплата записывается один раз (дубль уведомления игнорируется)", pay.get("first") and not pay.get("second"))
    check("Покупка выдаётся при входе и только один раз", len(got) == 1 and got[0]["amount"] == 12345
          and not any(x["charge_id"] == "selftest-charge" for x in p2["items"]))
    as_ferma("cleanup")
    print("(тестовые записи удалены)")
    print("\n" + ("🎉 Всё в порядке" if ok_all else "⚠️ Есть ошибки — пришлите этот вывод"))


def as_ferma(part):
    """Работа с базой — от пользователя ferma (иначе файлы SQLite станут root-овыми и бот не сможет писать)."""
    cmd = [sys.executable, __file__, "--db", part]
    import pwd
    try:
        pwd.getpwnam("ferma")
        if os.geteuid() == 0:
            cmd = ["runuser", "-u", "ferma", "--"] + cmd
    except KeyError:
        pass  # нет пользователя ferma (локальная проверка) — работаем от текущего
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode:
        print(out.stderr)
    return json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {}


async def db_pay():
    from db import DB
    from shop import ShopDB
    db = DB(CFG.db_path); await db.open()
    shop = ShopDB(db); await shop.init()
    inv = await shop.invoice(await shop.new_invoice(U1, "bag", 1, 12345))
    first = await shop.record_payment("selftest-charge", inv, 1)
    second = await shop.record_payment("selftest-charge", inv, 1)
    await db.close()
    return {"first": first, "second": second}


async def cleanup():
    from db import DB
    db = DB(CFG.db_path); await db.open()
    for uid in (U1, U2):
        for t in ("scores", "weekly", "players", "badges"):
            await db.conn.execute(f"DELETE FROM {t} WHERE player_key=?", (f"tg:{uid}",))
        for t in ("saves", "users", "payments", "invoices"):
            await db.conn.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
    await db.conn.commit(); await db.close()
    return {"ok": True}


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--db":
        print(json.dumps(asyncio.run(db_pay() if sys.argv[2] == "pay" else cleanup())))
    else:
        main()
