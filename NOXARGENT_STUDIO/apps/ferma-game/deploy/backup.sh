#!/usr/bin/env bash
# Копия базы (сохранения игроков + рейтинг + покупки). Запускается каждый день таймером ferma-backup.timer,
# можно и вручную: bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/backup.sh
# Копии: /opt/ferma/backups/ferma-ГГГГММДД-ЧЧММ.sqlite3.gz (храним 14 последних) + ferma-latest.sqlite3.gz
set -euo pipefail
ROOT=/opt/ferma
DB="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/data/ferma.sqlite3"
OUT="$ROOT/backups"
mkdir -p "$OUT"
NAME="ferma-$(date +%Y%m%d-%H%M).sqlite3"
sqlite3 "$DB" ".backup '$OUT/$NAME'"          # безопасно даже пока бот пишет в базу
gzip -f "$OUT/$NAME"
cp -f "$OUT/$NAME.gz" "$OUT/ferma-latest.sqlite3.gz"
ls -1t "$OUT"/ferma-2*.sqlite3.gz | tail -n +15 | xargs -r rm -f
echo "Копия: $OUT/$NAME.gz ($(du -h "$OUT/$NAME.gz" | cut -f1))"
