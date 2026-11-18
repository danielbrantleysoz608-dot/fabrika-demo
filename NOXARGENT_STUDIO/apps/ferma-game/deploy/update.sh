#!/usr/bin/env bash
# Обновить игру на сервере после правок (запуск от root):  bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/update.sh
set -euo pipefail
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
BRANCH="${BRANCH:-claude/ferma-game-telegram-app-57b7fw}"
cp "$APP/bot/data/ferma.sqlite3" "$ROOT/backup-$(date +%Y%m%d-%H%M).sqlite3" 2>/dev/null || true   # копия базы на всякий случай
ls -1t "$ROOT"/backup-*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm -f                         # храним 10 последних
sudo -u ferma git -C "$ROOT/repo" fetch -q --depth 1 origin "$BRANCH"
sudo -u ferma git -C "$ROOT/repo" reset -q --hard FETCH_HEAD
sudo -u ferma "$APP/bot/.venv/bin/pip" install -q -r "$APP/bot/requirements.txt"
systemctl restart ferma-bot
sleep 3
systemctl is-active --quiet ferma-bot && echo "✅ Обновлено: $(sudo -u ferma git -C "$ROOT/repo" log -1 --format='%h %s')" || { echo "❌ Служба не запустилась:"; journalctl -u ferma-bot -n 30 --no-pager; exit 1; }
