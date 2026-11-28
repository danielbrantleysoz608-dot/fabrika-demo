#!/usr/bin/env bash
# Обновить игру на сервере после правок (запуск от root):  bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/update.sh
set -euo pipefail
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
BRANCH="${BRANCH:-claude/ferma-game-telegram-app-57b7fw}"
runuser -u ferma -- bash "$APP/deploy/backup.sh" || true   # копия базы перед обновлением
sudo -u ferma git -C "$ROOT/repo" fetch -q --depth 1 origin "$BRANCH"
sudo -u ferma git -C "$ROOT/repo" reset -q --hard FETCH_HEAD
sudo -u ferma "$APP/bot/.venv/bin/pip" install -q -r "$APP/bot/requirements.txt"
bash "$APP/deploy/autostart.sh" >/dev/null   # автозапуск после перезагрузки + сторож раз в 5 мин (можно повторять)
systemctl restart ferma-bot
sleep 3
systemctl is-active --quiet ferma-bot && echo "✅ Обновлено: $(sudo -u ferma git -C "$ROOT/repo" log -1 --format='%h %s')" || { echo "❌ Служба не запустилась:"; journalctl -u ferma-bot -n 30 --no-pager; exit 1; }
