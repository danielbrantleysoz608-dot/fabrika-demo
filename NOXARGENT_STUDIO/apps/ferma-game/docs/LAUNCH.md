# Как создать бота и запустить «Ферму деда»

Всего 3 части: **бот в Telegram** (5 минут) → **сервер (VPS) с доменом** (30–60 минут) → **проверка**.
Telegram открывает мини-приложения только по **https://**, поэтому нужен домен с сертификатом.

---

## Часть 1. Создать бота в @BotFather

1. В Telegram откройте **@BotFather** и нажмите «Запустить».
2. Отправьте `/newbot`.
3. Имя бота (видно в чате): например `Ферма деда`.
4. Юзернейм (латиницей, на конце `bot`): например `ferma_deda_bot`.
5. BotFather пришлёт **токен** вида `7123456789:AAH...`. Это пароль от бота: **никому не показывайте** и не выкладывайте в GitHub.
6. Необязательно, но красиво:
   - `/setuserpic` — аватарка (фермер из `avatars/ferma`);
   - `/setdescription` — «Получи ферму деда и 10 000 ₽. Дойди до миллиона за игровой год!»;
   - `/setabouttext` — «Игра по сериалу «Ферма с нуля»».
7. После запуска сервера (часть 2) можно сделать прямую ссылку на игру: `/newapp` → выбрать бота → название, описание, картинка 640×360 → **Web App URL** = ваш адрес (`https://ferma.example.ru/`) → короткое имя `play`. Ссылка будет `https://t.me/ferma_deda_bot/play`.

Кнопку «Играть» в меню бот ставит сам при запуске — в BotFather для этого ничего делать не надо.

---

## Часть 2. Сервер (VPS)

Подойдёт самый простой VPS: 1 ядро, 1 ГБ памяти, Ubuntu 22.04 или 24.04.

### 2.1. Домен
У регистратора домена создайте **A-запись**: `ferma.example.ru` → IP вашего VPS. Подождите 5–30 минут.

### 2.2. Подключиться к серверу
С ПК (Windows: «Терминал» или PowerShell):
```bash
ssh root@IP_ВАШЕГО_VPS
```

### 2.3. Установить всё нужное
```bash
apt update && apt install -y python3 python3-venv git nginx certbot python3-certbot-nginx sqlite3
adduser --system --group --home /opt/ferma-game ferma
```

### 2.4. Забрать код
```bash
cd /opt
git clone https://github.com/danielbrantleysoz608-dot/fabrika-demo.git repo
cp -r repo/NOXARGENT_STUDIO/apps/ferma-game/. /opt/ferma-game/
cd /opt/ferma-game/bot
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 2.5. Настройки
```bash
cp .env.example .env
nano .env
```
Впишите:
```
BOT_TOKEN=токен_из_BotFather
WEBAPP_URL=https://ferma.example.ru
```
Сохранить: `Ctrl+O`, `Enter`, выйти: `Ctrl+X`. Затем:
```bash
mkdir -p data && chown -R ferma:ferma /opt/ferma-game && chmod 600 .env
```

### 2.6. Автозапуск бота
```bash
cp /opt/ferma-game/deploy/ferma-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ferma-bot
systemctl status ferma-bot      # должно быть active (running)
```

### 2.7. nginx + HTTPS
```bash
cp /opt/ferma-game/deploy/nginx.conf /etc/nginx/sites-available/ferma
sed -i 's/ferma.example.ru/ВАШ_ДОМЕН/' /etc/nginx/sites-available/ferma
ln -s /etc/nginx/sites-available/ferma /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d ВАШ_ДОМЕН       # бесплатный сертификат, продлевается сам
```

### 2.8. Бэкап базы (по желанию)
```bash
crontab -e
# добавить строку:
15 4 * * * /opt/ferma-game/deploy/backup.sh
```

---

### 2.9. Очистить рейтинг перед запуском
Если на сервере уже кто-то тестировал игру, в рейтинге остались тестовые «Фермер XXXX». Убрать их (сохранения игр не трогаются):
```bash
cd /opt/ferma-game/bot && sudo -u ferma .venv/bin/python main.py --clear-rating && systemctl restart ferma-bot
```
На ПК (Windows): `.venv\Scripts\python main.py --clear-rating`.

## Часть 3. Проверка

1. В браузере: `https://ВАШ_ДОМЕН/health` → `{"ok": true, ...}`.
2. В Telegram: откройте бота → `/start` → **«🚜 Играть»**. Игра открывается на весь экран.
3. Сыграйте месяц, закройте и откройте снова — должно быть «Продолжить».

**Если что-то не так:**
- логи бота: `journalctl -u ferma-bot -n 50`;
- «Нужны BOT_TOKEN и WEBAPP_URL» — проверьте `.env` (адрес обязательно с `https://`);
- игра открывается, но не сохраняется на сервер — откройте игру именно из бота (в обычном браузере прогресс хранится только в этом браузере).

### Обновление игры
```bash
cd /opt/repo && git pull
cp -r NOXARGENT_STUDIO/apps/ferma-game/. /opt/ferma-game/
chown -R ferma:ferma /opt/ferma-game && systemctl restart ferma-bot
```
`.env` и база (`bot/data/`) при этом не затираются.

---

## Локальный тест на ПК (без сервера)

**Только игра в браузере:**
```bash
cd NOXARGENT_STUDIO/apps/ferma-game/webapp
python3 -m http.server 8080
```
Откройте `http://localhost:8080`, в DevTools (F12) включите мобильный экран. Прогресс хранится в браузере.

**Игра + сервер сохранений и рейтинга (временный id игрока, без бота):**
```bash
cd NOXARGENT_STUDIO/apps/ferma-game/bot
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DEV_MODE=1 .venv/bin/python main.py --web-only
```
Откройте `http://localhost:8080`. Рейтинг работает по временному id из браузера (переменная `ALLOW_ANON=1`, по умолчанию). Когда бот запущен — поставьте в `.env` `ALLOW_ANON=0`, и в рейтинге останутся только игроки из Telegram; их прежние результаты перенесутся на Telegram id при первом входе.

**Настоящий бот с ПК** (без VPS): нужен https-туннель, например `cloudflared tunnel --url http://localhost:8080`. Он выдаст адрес `https://….trycloudflare.com` — впишите его в `WEBAPP_URL` и запустите `python main.py`.

**Автотесты:**
```bash
cd bot && .venv/bin/pip install pytest pytest-aiohttp && .venv/bin/python -m pytest -q   # API и подпись Telegram
cd .. && node tools/sim.mjs 300                                                         # баланс экономики
```
