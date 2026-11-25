#!/usr/bin/env bash
# Сторож «Фермы деда»: раз в 5 минут (таймер ferma-watchdog.timer) проверяет, что игра отвечает.
# Не отвечает → перезапускает службу (ferma-bot или nginx), проверяет ещё раз и пишет хозяйке в Telegram (ADMIN_ID из .env).
# Пока игра лежит — напоминание не чаще раза в час; поднялась — сообщение «снова работает».
# Токен берётся из .env и никуда не печатается (передаётся curl через stdin, не в командной строке).
set -uo pipefail
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
ENV="$APP/bot/.env"
STATE=/var/lib/ferma-watchdog
mkdir -p "$STATE"
val() { grep -E "^$1=" "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r'; }
PORT=$(val PORT | tr -cd '0-9'); PORT=${PORT:-8080}
URL=$(val WEBAPP_URL); URL=${URL%/}
ADMIN=$(val ADMIN_ID | tr -cd '0-9')

tg() {  # сообщение хозяйке; токен — через stdin curl, в логах и ps его нет
  local token; token=$(val BOT_TOKEN | tr -d '[:space:]')
  [ -n "$token" ] && [ -n "$ADMIN" ] && [ "$ADMIN" != 0 ] || { echo "нет BOT_TOKEN/ADMIN_ID — сообщение не отправлено"; return 1; }
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    curl -s -m 20 -o /dev/null -w '%{http_code}' -K - --data-urlencode "chat_id=$ADMIN" --data-urlencode "text=$1" | grep -q '^200$'
}
local_ok() { curl -s -m 10 "http://127.0.0.1:$PORT/health" | grep -q '"ok": *true'; }
public_ok() { [ -z "$URL" ] && return 0; curl -s -m 15 -o /dev/null -w '%{http_code}' "$URL/" | grep -q '^200$'; }
check() { local_ok && public_ok; }

if check; then
  if [ -f "$STATE/down_since" ]; then
    mins=$(( ( $(date +%s) - $(cat "$STATE/down_since") ) / 60 ))
    tg "✅ Ферма деда снова работает (не отвечала ~${mins} мин)." && rm -f "$STATE/down_since" "$STATE/alert_at"
  fi
  exit 0
fi

# не отвечает — пробуем поднять сами
what=""
if ! local_ok; then
  what="сервер игры (ferma-bot) не отвечал — перезапустил"
  systemctl restart ferma-bot
elif ! public_ok; then
  what="nginx не пропускал к игре — перезапустил"
  systemctl restart nginx
fi
sleep 25
[ -f "$STATE/down_since" ] || date +%s > "$STATE/down_since"
if check; then
  tg "🔧 Ферма деда не отвечала: ${what}. Сейчас игра снова работает." && rm -f "$STATE/down_since" "$STATE/alert_at"
  echo "поднял: $what"
  exit 0
fi
now=$(date +%s); last=$(cat "$STATE/alert_at" 2>/dev/null || echo 0)
if [ $(( now - last )) -ge 3600 ]; then
  detail="служба ferma-bot: $(systemctl is-active ferma-bot), nginx: $(systemctl is-active nginx)"
  tg "⚠️ Ферма деда не отвечает. ${what:-Перезапуск не помог}. ${detail}. Диагностика: bash $APP/deploy/diag.sh" && echo "$now" > "$STATE/alert_at"
fi
echo "игра не отвечает: $what"
exit 1
