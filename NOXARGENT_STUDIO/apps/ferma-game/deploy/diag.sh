#!/usr/bin/env bash
# Диагностика «Фермы деда» (запуск от root): службы, последние логи, порт, место на диске.
#   bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/diag.sh
# Токен бота в выводе замазывается (***), .env не печатается — вывод можно пересылать.
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
PORT=$(grep -E '^PORT=' "$APP/bot/.env" 2>/dev/null | cut -d= -f2 | tr -cd '0-9'); PORT=${PORT:-8080}
mask() { sed -E 's/[0-9]{6,12}:[A-Za-z0-9_-]{25,}/***ТОКЕН***/g; s/(bot)[0-9]{6,12}:[A-Za-z0-9_-]+/\1***/g'; }
h() { printf '\n===== %s =====\n' "$*"; }

h "Время работы сервера (когда был перезапуск)"; uptime; who -b 2>/dev/null
h "Службы: включены при загрузке? работают сейчас?"
for s in ferma-bot nginx ferma-watchdog.timer ferma-backup.timer; do
  printf '%-22s автозапуск: %-9s сейчас: %s\n' "$s" "$(systemctl is-enabled "$s" 2>&1)" "$(systemctl is-active "$s" 2>&1)"
done
h "ferma-bot: статус"; systemctl --no-pager status ferma-bot 2>&1 | head -15 | mask
h "ferma-bot: лог с этой загрузки (последние 60 строк)"; journalctl -u ferma-bot -b --no-pager -n 60 2>&1 | mask
h "ferma-bot: конец лога ДО перезагрузки"; journalctl -u ferma-bot -b -1 --no-pager -n 15 2>&1 | mask
h "nginx: статус и ошибки"; systemctl --no-pager status nginx 2>&1 | head -8; tail -n 15 /var/log/nginx/error.log 2>&1 | mask
h "Кто слушает порт $PORT (игра)"; ss -ltnp 2>/dev/null | grep -E ":$PORT\b" || echo "НИКТО — сервер игры не запущен"
h "Ответ игры изнутри сервера"; curl -s -m 10 "http://127.0.0.1:$PORT/health" || echo "нет ответа"
h "Связь с Telegram"; curl -s -m 10 -o /dev/null -w 'api.telegram.org: HTTP %{http_code}\n' https://api.telegram.org/ || echo "api.telegram.org: НЕТ СВЯЗИ"
h "Диск и память"; df -h / "$ROOT" 2>/dev/null | uniq; free -m
h "Файлы игры"; ls -la "$APP/bot/.venv/bin/python" "$APP/bot/data" 2>&1 | head -8
