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
