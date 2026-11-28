// Сохранение прогресса: сервер (SQLite по Telegram user id) + localStorage как запасной вариант.
// Сервер принимает запросы только с подписанным Telegram initData (проверка HMAC на бэкенде).

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
// Копия сохранения в памяти устройства — СВОЯ для каждого Telegram-аккаунта (память WebView общая для всех
// аккаунтов на телефоне). Вне Telegram (браузер на ПК) — общий ключ, как раньше.
const TG_UID = tg?.initDataUnsafe?.user?.id;
const LS_KEY = TG_UID ? `ferma-deda-save-v1:tg${TG_UID}` : 'ferma-deda-save-v1';
const API = (window.FERMA_CONFIG && window.FERMA_CONFIG.apiBase) || '';
export const online = !!initData;

// Временный id игрока (для рейтинга без Telegram). В Telegram сервер берёт user id из initData,
// а этот id нужен, чтобы перенести на него рейтинг, набранный до бота.
export function playerId() {
  try {
    let id = localStorage.getItem('ferma-player-id');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('ferma-player-id', id); }
    return id;
  } catch { return 'p-nostorage-' + Math.floor(Math.random() * 1e9); }
}
export const tgName = () => tg?.initDataUnsafe?.user?.first_name || '';
export function playerName() { try { return localStorage.getItem('ferma-player-name') || ''; } catch { return ''; } }
export function setPlayerName(v) { try { localStorage.setItem('ferma-player-name', v); } catch { /* */ } }

export async function request(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData,
      'X-Player-Id': playerId(), 'X-Player-Name': encodeURIComponent(playerName()),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch { return null; }
}
function writeLocal(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* приватный режим */ }
}

// { game, album, updatedAt } — берём более свежую копию из сервера и браузера
// В Telegram прогресс принадлежит аккаунту: берём сохранение с сервера (по Telegram id из подписанного initData).
// Локальная копия этого же аккаунта нужна, только если она свежее (игра закрылась до отправки на сервер)
// или сервер недоступен. Новый аккаунт — новая ферма, даже на том же телефоне.
export async function loadSave() {
  const local = readLocal();
  if (!online) return local;
  try {
    const remote = await request('GET', '/api/save');
    if (!remote) return local && local.owner === TG_UID ? local : null;
    if (local && local.owner === TG_UID && (local.updatedAt || 0) > (remote.updatedAt || 0)) return local;
    return remote;
  } catch (e) {
    console.warn('load failed', e);
    if (local && local.owner === TG_UID) return local;
    // сервер не ответил, своей копии на устройстве нет — НЕ начинаем новую ферму (она затёрла бы настоящую)
    throw new Error('offline');
  }
}

let timer = null, pending = null;
export function save(data, { now = false } = {}) {
  data.updatedAt = Date.now();
  if (TG_UID) data.owner = TG_UID; // чья это ферма — чужую копию не подхватим
  writeLocal(data);
  if (!online) return;
  pending = data;
  clearTimeout(timer);
  timer = setTimeout(flush, now ? 0 : 4000);
}
export async function flush() {
  if (!pending || !online) return;
  const body = pending; pending = null;
  try { await request('PUT', '/api/save', body); } catch (e) { console.warn('save failed', e); pending = pending || body; }
}

// «Мой дом в посёлке» (сериал «Деревня деда»): ник, заявка, картинка дома на карте посёлка
export const village = {
  me: () => request('GET', '/api/village/me'),
  setProfile: (nick, platform) => request('PUT', '/api/village/profile', { nick, platform }),
  wish: (wish) => request('POST', '/api/village/wish', { wish }),
  async homeImage(level) { // картинка — с подписью initData, поэтому через fetch, а не <img src>
    const res = await fetch(API + `/api/village/home.png?level=${level}`, { headers: { 'X-Telegram-Init-Data': initData } });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },
};

// Компенсации после обновления баланса: [{id, xp_min, money, reason}]
export async function grants() {
  if (!online) return [];
  try { return (await request('GET', '/api/grants')).grants || []; } catch { return []; }
}

// Итог забега — для будущего рейтинга (сервер хранит, но пока не показывает)
export async function reportResult(result) {
  if (!online) return;
  try { await request('POST', '/api/result', result); } catch (e) { console.warn('result failed', e); }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ---------- Магазин за звёзды ----------
// Покупки работают только в Telegram (нужна подпись initData) и когда сервер запущен с ботом.
export const shopEnabled = () => online && !!window.FERMA_CONFIG?.shop && !!tg?.openInvoice;
export const shopApi = {
  catalog: () => request('GET', '/api/shop/catalog'),
  invoice: (item, amount) => request('POST', '/api/shop/invoice', { item, amount }),
  pending: () => request('GET', '/api/shop/pending'),
  ack: (ids) => request('POST', '/api/shop/ack', { ids }),
};
// открыть окно оплаты Telegram; status: paid | cancelled | failed | pending
export const openInvoice = (link) => new Promise((resolve) => tg.openInvoice(link, resolve));
