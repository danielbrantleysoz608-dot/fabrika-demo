# Ферма деда — Telegram Mini App

Игра по сериалу «Ферма с нуля»: заброшенная ферма деда, 10 000 ₽ и цель — 1 000 000 ₽ за игровой год (12 ходов).

- **План и схема экранов:** [docs/PLAN.md](docs/PLAN.md)
- **Как создать бота и запустить:** [docs/LAUNCH.md](docs/LAUNCH.md)
- **Музыка, звуки, шрифты — авторы и лицензии:** [CREDITS.md](CREDITS.md)

## Что внутри

```
webapp/            SPA без фреймворков + Telegram WebApp SDK
  js/data.js       постройки, цены, расходы, концовки
  js/events.js     19 событий месяца (сезонные, 2 варианта, суммы под размер фермы)
  js/engine.js     логика: реальное время, уровни, цели, капитал (чистые функции)
  js/rating.js     экран рейтинга
  js/sfx.js        звуки действий (синтез Web Audio, без файлов)
  js/music.js      фоновая музыка: 4 сезонные темы, генерируется кодом
  js/coach.js      подсказки фермера по центру экрана
  js/scene.js      SVG-сцена фермы, 4 сезона
  js/app.js        экраны, тапы, Telegram, сохранение
  js/api.js        сервер + localStorage
bot/               Python: aiogram 3 + aiohttp + SQLite
  main.py          бот (/start → «Играть») + веб-сервер
  web.py           API: сохранения, рейтинг (/api/score, /api/leaderboard), раздача игры
  auth.py          проверка подписи Telegram initData
  db.py            users, saves, results, players/scores/weekly (+ задел purchases)
  tests/           pytest
deploy/            systemd, nginx, бэкап
tools/sim.mjs      симуляция баланса: node tools/sim.mjs (trace / income)
```

## Быстрый старт на ПК
```bash
cd bot && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python main.py --web-only          # игра + рейтинг: http://localhost:8080
```
Только игра без рейтинга: `cd webapp && python3 -m http.server 8080`.
Подробно (сервер, бот, VPS) — в [docs/LAUNCH.md](docs/LAUNCH.md).
