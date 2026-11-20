"""Проверка подписи Telegram WebApp initData.

https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class AuthError(Exception):
    pass


def validate_init_data(init_data: str, bot_token: str, ttl: int, now: float | None = None) -> dict:
    """Возвращает словарь user ({'id': ..., 'first_name': ...}) или бросает AuthError."""
    if not init_data:
        raise AuthError("no init data")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = pairs.pop("hash", None)
    if not received:
        raise AuthError("no hash")
    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise AuthError("bad hash")
    auth_date = int(pairs.get("auth_date", "0") or 0)
    if ttl and (now or time.time()) - auth_date > ttl:
        raise AuthError("init data expired")
    try:
        user = json.loads(pairs.get("user", "{}"))
    except json.JSONDecodeError as e:
        raise AuthError("bad user") from e
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise AuthError("no user id")
    return user


def sign_init_data(fields: dict, bot_token: str) -> str:
    """Собрать подписанный initData (для тестов и локальной отладки)."""
    from urllib.parse import urlencode

    check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    h = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": h})
