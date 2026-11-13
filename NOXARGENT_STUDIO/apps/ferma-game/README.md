# Ферма деда — Telegram Mini App

Игра по сериалу «Ферма с нуля»: заброшенная ферма деда, 10 000 ₽ и цель — 1 000 000 ₽ за игровой год (12 ходов).

- **План и схема экранов:** [docs/PLAN.md](docs/PLAN.md)
- **Как создать бота и запустить:** [docs/LAUNCH.md](docs/LAUNCH.md)

## Что внутри

```
webapp/            SPA без фреймворков + Telegram WebApp SDK
  js/data.js       постройки, цены, расходы, концовки
  js/events.js     17 событий месяца (сезонные, 2 варианта)
  js/engine.js     логика игры (чистые функции, детерминированный seed)
  js/scene.js      SVG-сцена фермы, 4 сезона
  js/app.js        экраны, тапы, Telegram, сохранение
  js/api.js        сервер + localStorage
bot/               Python: aiogram 3 + aiohttp + SQLite
  main.py          бот (/start → «Играть») + веб-сервер
  web.py           API: /api/save, /api/result, раздача игры
  auth.py          проверка подписи Telegram initData
  db.py            users, saves, results (+ задел purchases)
  tests/           pytest
deploy/            systemd, nginx, бэкап
tools/sim.mjs      симуляция баланса (node tools/sim.mjs 300)
```

## Быстрый старт на ПК
```bash
cd webapp && python3 -m http.server 8080   # http://localhost:8080
```
Подробно (сервер, бот, VPS) — в [docs/LAUNCH.md](docs/LAUNCH.md).
