import json
import sys
import time
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth import AuthError, sign_init_data, validate_init_data  # noqa: E402
from config import load  # noqa: E402
from db import DB  # noqa: E402
from web import make_app  # noqa: E402

TOKEN = "123456:TEST-token"


def init_data(user_id=42, age=0):
    return sign_init_data({"auth_date": str(int(time.time()) - age), "query_id": "q",
                           "user": json.dumps({"id": user_id, "first_name": "Внук"})}, TOKEN)


def test_valid_signature():
    assert validate_init_data(init_data(), TOKEN, 3600)["id"] == 42


def test_tampered_signature():
    bad = init_data().replace("%22id%22%3A+42", "%22id%22%3A+43")
    with pytest.raises(AuthError):
        validate_init_data(bad, TOKEN, 3600)


def test_wrong_token_and_expired():
    with pytest.raises(AuthError):
        validate_init_data(init_data(), "999:other", 3600)
    with pytest.raises(AuthError):
        validate_init_data(init_data(age=7200), TOKEN, 3600)


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    cfg = replace(load(), bot_token=TOKEN, db_path=tmp_path / "t.db", dev_mode=False,
                  webapp_dir=Path(__file__).resolve().parents[2] / "webapp")
    db = DB(cfg.db_path)
    await db.open()
    c = await aiohttp_client(make_app(cfg, db, "ferma_test_bot"))
    yield c
    await db.close()


async def test_save_roundtrip(client):
    h = {"X-Telegram-Init-Data": init_data()}
    r = await client.get("/api/save", headers=h)
    assert r.status == 200 and await r.json() is None
    save = {"game": {"v": 1, "month": 3, "money": 12345}, "album": {"alive": {"capital": 50000}}, "updatedAt": 1}
    assert (await client.put("/api/save", json=save, headers=h)).status == 204
    r = await client.get("/api/save", headers=h)
    assert (await r.json())["game"]["money"] == 12345
    # другой игрок не видит чужое сохранение
    r = await client.get("/api/save", headers={"X-Telegram-Init-Data": init_data(7)})
    assert await r.json() is None


async def test_auth_required(client):
    assert (await client.get("/api/save")).status == 401
    assert (await client.put("/api/save", json={}, headers={"X-Telegram-Init-Data": "hash=bad&user=%7B%7D"})).status == 401


async def test_result_and_health(client):
    h = {"X-Telegram-Init-Data": init_data()}
    await client.get("/api/save", headers=h)
    assert (await client.post("/api/result", json={"ending": "millionaire", "capital": 1200000}, headers=h)).status == 204
    assert (await client.post("/api/result", json={"ending": "hack", "capital": 1}, headers=h)).status == 400
    stats = await (await client.get("/health")).json()
    assert stats["results"] == 1 and stats["millionaires"] == 1


async def test_static_and_config(client):
    r = await client.get("/")
    assert r.status == 200 and "Ферма деда" in await r.text()
    assert "ferma_test_bot" in await (await client.get("/config.js")).text()
    assert (await client.get("/js/engine.js")).status == 200


async def test_too_large(client):
    h = {"X-Telegram-Init-Data": init_data()}
    r = await client.put("/api/save", data=json.dumps({"x": "a" * 300_000}), headers={**h, "Content-Type": "application/json"})
    assert r.status == 413


# ---------- Рейтинг ----------
def anon(pid, name=None):
    h = {"X-Player-Id": pid}
    if name:
        from urllib.parse import quote
        h["X-Player-Name"] = quote(name)
    return h


async def test_leaderboard_anon_ranking(client):
    for i, cap in enumerate([500_000, 120_000, 900_000]):
        r = await client.post("/api/score", json={"capital": cap, "tier": 1, "year": 1}, headers=anon(f"player-{i:04d}", f"Игрок {i}"))
        assert r.status == 200
    board = await (await client.get("/api/leaderboard", headers=anon("player-0001"))).json()
    assert [t["value"] for t in board["top"]] == [900_000, 500_000, 120_000]
    assert board["me"]["rank"] == 3 and board["me"]["name"] == "Игрок 1"
    assert board["top"][2]["me"] is True and board["total"] == 3
    # в рейтинге — текущий капитал (может и уменьшиться), а отправка без имени не стирает имя
    await client.post("/api/score", json={"capital": 50_000}, headers=anon("player-0001"))
    board = await (await client.get("/api/leaderboard", headers=anon("player-0001"))).json()
    assert board["me"]["value"] == 50_000 and board["me"]["name"] == "Игрок 1"
    # новый игрок без имени получает «Фермер XXXX»
    await client.post("/api/score", json={"capital": 1}, headers=anon("noname-7777"))
    board = await (await client.get("/api/leaderboard", headers=anon("noname-7777"))).json()
    assert board["me"]["name"] == "Фермер #7777"


async def test_bought_money_counts_in_rating(client):
    # купленные за звёзды деньги идут в капитал и рейтинг как обычные
    r = await (await client.post("/api/score", json={"capital": 1_000_000, "paid": 300_000}, headers=anon("payer-00001"))).json()
    assert r["rating"] == 1_000_000


async def test_week_gain_and_tg_link(client):
    import db as dbmod
    database = client.app[__import__("web").DBK]
    # прошлая неделя: капитал 1 млн
    t0 = 1_700_000_000
    await database.submit_score("anon:link-test-1", "Аноним", 1_000_000, 0, 0, 1, now=t0)
    # эта неделя: с 1 млн до 3 млн → прирост 2 млн
    t1 = t0 + 8 * 86400
    await database.submit_score("anon:link-test-1", "Аноним", 1_000_000, 0, 0, 1, now=t1)
    await database.submit_score("anon:link-test-1", "Аноним", 3_000_000, 0, 0, 1, now=t1 + 3600)   # за час — правдоподобно
    week = await database.leaderboard("week", "anon:link-test-1", now=t1 + 3700)
    assert week["me"]["value"] == 2_000_000 and dbmod.current_week(t1) != dbmod.current_week(t0)
    # игрок открыл игру из Telegram с тем же временным id — запись переезжает на tg id
    h = {"X-Telegram-Init-Data": init_data(77), **anon("link-test-1")}
    r = await client.post("/api/score", json={"capital": 3_500_000}, headers=h)
    assert r.status == 200
    board = await (await client.get("/api/leaderboard", headers=h)).json()
    assert board["me"]["name"] == "Внук" and board["me"]["value"] == 3_500_000
    assert all(t["name"] != "Аноним" for t in board["top"])


async def test_anon_disabled(aiohttp_client, tmp_path):
    cfg = replace(load(), bot_token=TOKEN, db_path=tmp_path / "t2.db", allow_anon=False,
                  webapp_dir=Path(__file__).resolve().parents[2] / "webapp")
    d = DB(cfg.db_path); await d.open()
    c = await aiohttp_client(make_app(cfg, d))
    assert (await c.post("/api/score", json={"capital": 1}, headers=anon("someone-123"))).status == 401
    await d.close()


async def test_me_always_has_rank_and_clear(client):
    for i, cap in enumerate([900, 500, 100]):
        await client.post("/api/score", json={"capital": cap}, headers=anon(f"ranker-{i:04d}"))
    # новичок ещё ничего не прислал — место считается по переданному значению
    b = await (await client.get("/api/leaderboard?value=600", headers=anon("newbie-0000"))).json()
    assert b["me"]["rank"] == 2 and b["me"]["value"] == 600
    # за неделю без прироста — место всё равно есть (после всех, у кого есть прирост)
    w = await (await client.get("/api/leaderboard?period=week", headers=anon("ranker-0001"))).json()
    assert w["me"]["rank"] == 1 and w["total"] == 0
    n = await client.app[__import__("web").DBK].clear_rating()
    assert n == 3
    b = await (await client.get("/api/leaderboard")).json()
    assert b["top"] == [] and b["total"] == 0
