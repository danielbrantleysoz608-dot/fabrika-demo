#!/usr/bin/env bash
# Полная проверка сервера «Фермы деда» одной командой (запуск от root, ничего не меняет):
#   bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/check_all.sh
# Версия игры и цены на сервере, автозапуск и сторож, ошибки за сутки, ответ игры, рейтинг = шапка, кто потерял после обновлений.
# Токен бота в выводе замазан, .env не печатается.
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
PY="$APP/bot/.venv/bin/python"
PORT=$(grep -E '^PORT=' "$APP/bot/.env" 2>/dev/null | cut -d= -f2 | tr -cd '0-9'); PORT=${PORT:-8080}
mask() { sed -E 's/[0-9]{6,12}:[A-Za-z0-9_-]{25,}/***ТОКЕН***/g'; }
h() { printf '\n===== %s =====\n' "$*"; }

h "1. Какая версия на сервере и какие цены"
sudo -u ferma git -C "$ROOT/repo" log -1 --format='коммит %h от %ci: %s' | cut -c1-140
sudo -u ferma "$PY" - "$APP" <<'PYCODE'
import sys; sys.path.insert(0, sys.argv[1] + "/deploy")
import farm_capital as f
b = f.BUILDINGS["cheese"]
steep = "steep" in f.DATA_JS
price = b["cost"] * b["mult"] ** 9 * (2.5 ** 7 if steep else 1)
print(f"Сыроварня ур.9→10 на сервере: {f.fmt(price)} ({'СТАРЫЕ цены со взлётом' if steep else 'новые цены, без взлёта'})")
PYCODE

h "2. Автозапуск и сторож"
for s in ferma-bot nginx ferma-watchdog.timer; do
  printf '%-22s автозапуск: %-9s сейчас: %-9s %s\n' "$s" "$(systemctl is-enabled "$s" 2>&1)" "$(systemctl is-active "$s" 2>&1)" \
    "$( [ "${s%.timer}" = "$s" ] && echo "Restart=$(systemctl show -p Restart --value "$s")" )"
done
systemctl list-timers ferma-watchdog.timer --no-pager 2>/dev/null | sed -n 2p
journalctl -u ferma-watchdog --since "24 hours ago" --no-pager -o cat 2>/dev/null | grep -v '^$' | tail -5 | mask

h "3. Игра отвечает?"
curl -s -m 10 "http://127.0.0.1:$PORT/health" && echo
URL=$(grep -E '^WEBAPP_URL=' "$APP/bot/.env" | cut -d= -f2-); curl -s -m 15 -o /dev/null -w "снаружи ${URL%/}/ — HTTP %{http_code}\n" "${URL%/}/"

h "4. Ошибки за последние сутки (бот и сервер игры)"
journalctl -u ferma-bot --since "24 hours ago" --no-pager -o short-iso 2>/dev/null | grep -E "ERROR|Traceback|Exception|CRITICAL|exited|Failed" | tail -25 | mask
echo "перезапусков службы за сутки: $(journalctl -u ferma-bot --since '24 hours ago' --no-pager 2>/dev/null | grep -c 'Started ferma-bot')"
echo "ответов 5xx от nginx за сутки: $(awk -v d="$(date -d '24 hours ago' '+%d/%b/%Y:%H')" '$4 > "["d && $9 ~ /^5/' /var/log/nginx/access.log 2>/dev/null | wc -l)"
grep -h "$(date '+%Y/%m/%d')\|$(date -d yesterday '+%Y/%m/%d')" /var/log/nginx/error.log 2>/dev/null | tail -5 | mask

h "5. Рейтинг = шапка (5 последних игроков)"
sudo -u ferma "$PY" "$APP/deploy/rating_check.py" 5

h "6. Кто потерял уровень или капитал после обновлений (только показ)"
sudo -u ferma "$PY" "$APP/deploy/repair_after_update.py" --find "Викуша"
sudo -u ferma "$PY" "$APP/deploy/repair_after_update.py"
sudo -u ferma "$PY" "$APP/deploy/repair_after_update.py" --negatives
