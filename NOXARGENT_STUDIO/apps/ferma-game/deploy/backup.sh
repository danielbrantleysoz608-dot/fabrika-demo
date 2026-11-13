#!/usr/bin/env bash
# Ежедневный бэкап базы (добавить в crontab: 15 4 * * * /opt/ferma-game/deploy/backup.sh)
set -euo pipefail
DB=/opt/ferma-game/bot/data/ferma.sqlite3
OUT=/opt/ferma-game/backups
mkdir -p "$OUT"
sqlite3 "$DB" ".backup '$OUT/ferma-$(date +%F).sqlite3'"
find "$OUT" -name 'ferma-*.sqlite3' -mtime +14 -delete
