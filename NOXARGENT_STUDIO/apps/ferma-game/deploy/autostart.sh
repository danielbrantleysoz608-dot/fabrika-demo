#!/usr/bin/env bash
# Автозапуск «Фермы деда» после любой перезагрузки сервера + сторож раз в 5 минут (запуск от root, можно повторять):
#   bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/autostart.sh
# - ferma-bot и nginx включены при загрузке, Restart=always, без лимита перезапусков;
# - ferma-watchdog.timer: через 3 мин после загрузки и дальше каждые 5 мин проверяет игру (deploy/watchdog.sh).
set -euo pipefail
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"

# служба игры и бота: перезапуск всегда, сколько бы раз ни падала (по умолчанию systemd сдаётся после 5 падений подряд)
mkdir -p /etc/systemd/system/ferma-bot.service.d
cat > /etc/systemd/system/ferma-bot.service.d/autostart.conf <<'UNIT'
[Unit]
After=network-online.target nss-lookup.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=5
UNIT

# nginx — тоже поднимается сам, если упал
mkdir -p /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/autostart.conf <<'UNIT'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=5
UNIT

# сторож
cat > /etc/systemd/system/ferma-watchdog.service <<UNIT
[Unit]
Description=Ферма деда: проверка, что игра отвечает
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/deploy/watchdog.sh
UNIT
cat > /etc/systemd/system/ferma-watchdog.timer <<'UNIT'
[Unit]
Description=Ферма деда: проверка игры каждые 5 минут

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable -q ferma-bot nginx
systemctl enable -q --now ferma-watchdog.timer
systemctl list-unit-files ferma-backup.timer >/dev/null 2>&1 && systemctl enable -q --now ferma-backup.timer || true
systemctl is-active --quiet nginx || systemctl start nginx
systemctl is-active --quiet ferma-bot || systemctl start ferma-bot

for s in ferma-bot nginx ferma-watchdog.timer; do
  printf '%-22s автозапуск: %-8s сейчас: %s\n' "$s" "$(systemctl is-enabled "$s")" "$(systemctl is-active "$s")"
done
