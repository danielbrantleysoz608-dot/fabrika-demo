#!/usr/bin/env bash
# Установка «Фермы деда» на чистый VPS (Ubuntu 24.04), запуск от root:
#   bash install.sh
# Что делает: ставит Python/nginx/certbot, скачивает игру из закрытого репозитория (ключ развёртывания),
# создаёт .env (токен вводите сами — он никуда не уходит), служба systemd, HTTPS на <IP>.sslip.io.
set -euo pipefail
REPO="git@github.com:danielbrantleysoz608-dot/fabrika-demo.git"
BRANCH="${BRANCH:-claude/ferma-game-telegram-app-57b7fw}"
ROOT=/opt/ferma
APP="$ROOT/repo/NOXARGENT_STUDIO/apps/ferma-game"
say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }

say "1/7 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3 python3-venv python3-pip git nginx certbot python3-certbot-nginx curl sqlite3 gzip

say "2/7 Пользователь ferma"
id ferma >/dev/null 2>&1 || useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash ferma
install -d -o ferma -g ferma "$ROOT/.ssh"

say "3/7 Доступ к закрытому репозиторию (ключ развёртывания, только чтение)"
if [ ! -f "$ROOT/.ssh/id_ed25519" ] && [ -f /root/.ssh/ferma_deploy ]; then
  # ключ, который уже добавлен в GitHub на первом шаге, — отдаём пользователю ferma
  install -o ferma -g ferma -m 600 /root/.ssh/ferma_deploy "$ROOT/.ssh/id_ed25519"
  install -o ferma -g ferma -m 644 /root/.ssh/ferma_deploy.pub "$ROOT/.ssh/id_ed25519.pub"
fi
if [ ! -f "$ROOT/.ssh/id_ed25519" ]; then
  sudo -u ferma ssh-keygen -t ed25519 -N "" -C "ferma-deploy" -f "$ROOT/.ssh/id_ed25519" >/dev/null
fi
sudo -u ferma bash -c "ssh-keyscan -t ed25519 github.com >> $ROOT/.ssh/known_hosts 2>/dev/null; sort -u -o $ROOT/.ssh/known_hosts $ROOT/.ssh/known_hosts"
until sudo -u ferma git ls-remote "$REPO" >/dev/null 2>&1; do
  echo
  echo "Добавьте этот ключ в GitHub: репозиторий fabrika-demo → Settings → Deploy keys → Add deploy key"
  echo "(Title: ferma-server, галочку «Allow write access» НЕ ставить):"
  echo
  cat "$ROOT/.ssh/id_ed25519.pub"
  echo
  read -r -p "Добавили? Нажмите Enter, чтобы проверить доступ… " _
done
echo "Доступ к репозиторию есть."

say "4/7 Код игры"
if [ -d "$ROOT/repo/.git" ]; then
  sudo -u ferma git -C "$ROOT/repo" fetch -q --depth 1 origin "$BRANCH"
  sudo -u ferma git -C "$ROOT/repo" reset -q --hard FETCH_HEAD
else
  sudo -u ferma git clone -q --depth 1 -b "$BRANCH" "$REPO" "$ROOT/repo"
fi
sudo -u ferma python3 -m venv "$APP/bot/.venv"
sudo -u ferma "$APP/bot/.venv/bin/pip" install -q -r "$APP/bot/requirements.txt"

say "5/7 Настройки (.env)"
IP=$(curl -4 -s https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
ENV="$APP/bot/.env"
if [ ! -f "$ENV" ]; then
  echo "Вставьте токен бота от @BotFather (символы не видны — это нормально) и нажмите Enter:"
  read -r -s TOKEN; echo
  read -r -p "Ваш Telegram id (число от @userinfobot, можно оставить пустым): " ADMIN
  ADMIN=$(echo "$ADMIN" | tr -cd '0-9')      # только цифры: «ID: 123» → 123
  TOKEN=$(echo "$TOKEN" | tr -d '[:space:]')
  cat > "$ENV" <<CONF
BOT_TOKEN=$TOKEN
WEBAPP_URL=https://$DOMAIN
HOST=127.0.0.1
PORT=8080
DB_PATH=data/ferma.sqlite3
WEBAPP_DIR=../webapp
INIT_DATA_TTL_HOURS=24
ALLOW_ANON=0
DEV_MODE=0
ADMIN_ID=${ADMIN:-0}
CHANNEL_URL=https://t.me/predstav_kanal
TEST_PRICES=0
CONF
  chown ferma:ferma "$ENV"; chmod 600 "$ENV"
  unset TOKEN
else
  echo ".env уже есть — оставляю как есть."
fi

say "6/7 Служба ferma-bot"
cat > /etc/systemd/system/ferma-bot.service <<UNIT
[Unit]
Description=Ферма деда: бот + сервер игры
After=network-online.target
Wants=network-online.target

[Service]
User=ferma
WorkingDirectory=$APP/bot
ExecStart=$APP/bot/.venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q --now ferma-bot
systemctl restart ferma-bot

say "Ежедневная копия базы (04:00 по Москве)"
install -d -o ferma -g ferma "$ROOT/backups"
cat > /etc/systemd/system/ferma-backup.service <<UNIT
[Unit]
Description=Ферма деда: копия базы

[Service]
Type=oneshot
User=ferma
ExecStart=/bin/bash $APP/deploy/backup.sh
UNIT
cat > /etc/systemd/system/ferma-backup.timer <<UNIT
[Unit]
Description=Ферма деда: копия базы каждый день

[Timer]
OnCalendar=*-*-* 01:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable -q --now ferma-backup.timer
bash "$APP/deploy/autostart.sh"   # автозапуск после перезагрузки + сторож раз в 5 минут

say "7/7 nginx + HTTPS для $DOMAIN"
cat > /etc/nginx/sites-available/ferma <<NGX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGX
ln -sf /etc/nginx/sites-available/ferma /etc/nginx/sites-enabled/ferma
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect -q
systemctl reload nginx

sleep 3
say "Готово"
systemctl --no-pager --lines=5 status ferma-bot || true
echo
echo "Игра:  https://$DOMAIN"
echo "Проверка: $APP/bot/.venv/bin/python $APP/deploy/selftest.py"
