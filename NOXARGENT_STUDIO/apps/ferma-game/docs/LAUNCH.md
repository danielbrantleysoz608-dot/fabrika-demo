# Как создать бота и запустить «Ферму деда»

## Боевой запуск на VPS (Beget, Ubuntu 24.04) — коротко

1. Создать VPS (Ubuntu 24.04, самый дешёвый), войти: `ssh root@IP`.
2. Проверить доступ к Telegram, GitHub и Let's Encrypt (команда — в переписке/ниже в «Проверка сети»).
3. Скачать установщик и запустить (репозиторий закрытый — установщик сам создаст ключ развёртывания и попросит добавить его в GitHub):
   `bash install.sh` (файл `deploy/install.sh`). Токен бота вводится на сервере, в git не попадает (`bot/.env`, права 600).
4. Самопроверка: `/opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/bot/.venv/bin/python /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/selftest.py`
5. @BotFather → `/newapp` → @ferma_deda_bot → название, описание, обложка `deploy/cover-640x360.png`, URL `https://<IP>.sslip.io/`, короткое имя (например `farm`) → ссылка для постов `t.me/ferma_deda_bot/farm`.
6. Проверка оплаты: в `bot/.env` поставить `TEST_PRICES=1`, `systemctl restart ferma-bot`, купить что-нибудь за 1 ⭐, вернуть звёзды командой `/refund_last` (только владелец, ADMIN_ID), затем `TEST_PRICES=0` и перезапуск.

**Обновить игру после правок:** `bash /opt/ferma/repo/NOXARGENT_STUDIO/apps/ferma-game/deploy/update.sh` (копия базы делается сама).
**Логи:** `journalctl -u ferma-bot -n 50 --no-pager`. **Перезапуск:** `systemctl restart ferma-bot`.

### Проверка сети
```bash
for u in https://api.telegram.org https://github.com https://acme-v02.api.letsencrypt.org/directory; do printf '%-50s ' "$u"; curl -sS -m 15 -o /dev/null -w '%{http_code}  %{time_total}s\n' "$u" || echo "НЕТ ДОСТУПА"; done
```

### Рейтинг: неделя, месяц, всё время
* «Неделя» и «Месяц» — по приросту капитала за период (сервер), «Всё время» — по капиталу. Неделя: пн 00:00 — вс 20:00 МСК, месяц: 1-е 00:00 — последний день 20:00 МСК.
* Неделя: 1 место — подарок Telegram за 25 ⭐ (sendGift со счёта бота; не хватило звёзд — бот пишет ADMIN_ID), 2–3 — значки 🥈/🥉 на следующую неделю.
* Месяц: 1 место — NFT «PoolFloat» (t.me/nft/PoolFloat-92287): бот пишет ADMIN_ID ник, @username, id и капитал победителя — NFT передаётся вручную.
* Капитал не берётся на веру: сервер принимает не больше правдоподобного роста (6%/мин + купленные деньги), скачки пишутся в таблицу `anticheat`.
* История наград — таблица `awards` (кто, когда, что, статус). Команды владельца: `/test_results` (кто победил бы сейчас, ничего не выдаёт), `/refund_last`; для всех — `/myid`.
* ADMIN_ID задаётся только в `bot/.env`.

### Магазин за звёзды и приз недели
* Товары и цены — `bot/shop.py` (`ITEMS`). Выдача — только после `successful_payment`, по `telegram_payment_charge_id` (дубли игнорируются),
  игра забирает покупки при входе (`/api/shop/pending` → применить → сохранить → `/api/shop/ack`).
* Итоги недели — каждое воскресенье в 20:00 МСК: 1 место — подарок `sendGift` (100–250 ⭐ со счёта бота; не хватило — бот пишет владельцу),
  2–3 место — значок 🥈/🥉 на неделю. Новички (< 3 дней) приз не получают.
* `/paysupport` — куда писать по оплате (канал). `/refund_last` — вернуть последнюю покупку (только ADMIN_ID).


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

## Запуск на ПК с Windows: http://localhost:8080 (с рейтингом)

1. Установите **Python 3.11 или новее** с python.org (при установке отметьте «Add python.exe to PATH»).
2. Скачайте код ветки `claude/ferma-game-telegram-app-57b7fw`: на GitHub → кнопка **Code → Download ZIP** и распакуйте
   **в короткую папку**, например `C:\ferma` (длинные пути Windows не любит). Или: `git clone -b claude/ferma-game-telegram-app-57b7fw <адрес репозитория> C:\ferma`.
   Если папка уже есть — `cd C:\ferma` и `git pull`.
3. Откройте **PowerShell** и выполните по строчке:
   ```powershell
   cd C:\ferma\NOXARGENT_STUDIO\apps\ferma-game\bot
   py -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   $env:DEV_MODE = "1"
   .venv\Scripts\python main.py --web-only
   ```
   Появится строка `Веб-сервер: http://127.0.0.1:8080` — окно не закрывайте (остановить — Ctrl+C).
4. Откройте в Chrome **http://localhost:8080**, нажмите **F12 → значок телефона** (Ctrl+Shift+M) и выберите размер 375×812.
5. Если игра «старая» — обновите страницу без кэша: **Ctrl+F5**. Начать с нуля — «Настройки → Начать заново».

Токен бота для локального запуска не нужен. В следующий раз — только строки `cd …\bot`, `$env:DEV_MODE = "1"` и `.venv\Scripts\python main.py --web-only`.

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

## Модерация чата фермеров (@predstav_chat)
Права боту в чате (Управление → Администраторы → бот), минимум:
- **Удаление сообщений**
- **Блокировка пользователей** (нужна и для бана, и для мута)

Остальные права выключены. Чат должен быть супергруппой (публичный чат с @username — уже супергруппа).

Команды — только у администраторов чата, ответом на сообщение нарушителя:
`/mute [10m|1h|1d] [причина]` (по умолчанию 1 ч), `/unmute`, `/warn [причина]` (3 = мут на сутки), `/warns`, `/unwarn`,
`/ban [причина]`, `/unban <id|@username>`, `/del`. Сообщение с командой бот удаляет, в чат пишет одну строку.
У обычных участников команды не работают (их сообщение с командой удаляется).

Антиспам: ссылка от участника, вступившего меньше суток назад, удаляется автоматически (кто вступил до запуска бота — считается старожилом).
Журнал действий — таблица `mod_log` в базе.

## Проверка на робота при входе в чат — убрана
Новые участники заходят в чат сразу, без капчи. Таблицы `captcha_*` в базе остались, бот их не использует.
`/stats` в личке с ботом (только ADMIN_ID) — число игроков.

## Перезагрузка сервера: всё поднимается само
- Сервер игры стартует сразу, не дожидаясь Telegram; бот подключается к Telegram в фоне с повторами
  (раньше при недоступном Telegram на старте падала и игра → nginx отвечал 502).
- `deploy/autostart.sh` (запускается и из update.sh): ferma-bot и nginx включены при загрузке, Restart=always без лимита,
  сторож `ferma-watchdog.timer` — через 3 мин после загрузки и каждые 5 мин: игра не отвечает → перезапуск и сообщение
  ADMIN_ID в Telegram (не чаще раза в час), поднялась — «снова работает».
- `deploy/diag.sh` — статус служб, логи до и после перезагрузки, порт, связь с Telegram, диск (токен замазан).

## Проверка сервера и возврат потерь после обновлений
- `bash deploy/check_all.sh` (root, ничего не меняет): версия и цены на сервере, автозапуск и сторож, ответ игры,
  ошибки за сутки, рейтинг = шапка, кто потерял уровень/капитал по копиям базы.
- `deploy/repair_after_update.py [--hours 120] [--player имя] [--fix]` (от ferma): сравнивает с копиями базы
  (/opt/ferma/backups) ту же ферму; --fix создаёт компенсации (опыт не ниже прежнего + разница капитала деньгами),
  игра забирает их сама (GET /api/grants) и подтверждает сохранением; рейтинг сразу поднимается до прежнего.
- Сервер не даёт сохранению той же фермы понизить опыт (уровень никогда не падает).
- Капитал на сервере считает deploy/farm_capital.py — копия E.capital + migrate (сверено на сохранениях всех версий).

## Сериал «Деревня деда»: ник, «Найди свой дом», «Мой дом в посёлке» (bot/village.py)
- Первый вход (после обязательной подписки) и один раз у старых игроков: «Откуда ты нас смотришь? Напиши свой ник 👇»
  (Instagram / YouTube / TikTok / «У меня нет аккаунта»). /nick — сменить ник, /home или «🏡 Мой дом» — свой дом.
- Ник есть в bot/data/village/villagers.json — картинка 800×800 с домом (кэш в data/village/cache); нет — заявка
  «какой дом хочешь» (до 100 символов, одна на аккаунт, можно изменить) в таблицу village_requests.
- Игра: раздел «🏡 Мой дом в посёлке» (кнопка «Мой дом» сверху и карточка в Стройке): 10 уровней за деньги фермы
  (1 млн … 3,2 трлн), уровни 7–10 — на выбор (этаж, бассейн, баня, гараж, сад, оранжерея), +1% к доходу за уровень,
  стоимость дома входит в капитал. Ник и заявку можно менять там же (и в Настройках).
- Хозяйке: /village_requests — CSV заявок, /village_top — топ-50 домов игроков с никами.
- Экспорт из сериала кладётся в bot/data/village/ (формат — bot/data/village/README.md) и пушится в ветку; бот подхватывает сам.
