// Сохранение прогресса: сервер (SQLite по Telegram user id) + localStorage как запасной вариант.
// Сервер принимает запросы только с подписанным Telegram initData (проверка HMAC на бэкенде).

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
const LS_KEY = 'ferma-deda-save-v1';
const API = (window.FERMA_CONFIG && window.FERMA_CONFIG.apiBase) || '';
export const online = !!initData;

async function request(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
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
export async function loadSave() {
  const local = readLocal();
  if (!online) return local;
  try {
    const remote = await request('GET', '/api/save');
    if (remote && (!local || (remote.updatedAt || 0) >= (local.updatedAt || 0))) return remote;
  } catch (e) { console.warn('load failed', e); }
  return local;
}

let timer = null, pending = null;
export function save(data, { now = false } = {}) {
  data.updatedAt = Date.now();
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

// Итог забега — для будущего рейтинга (сервер хранит, но пока не показывает)
export async function reportResult(result) {
  if (!online) return;
  try { await request('POST', '/api/result', result); } catch (e) { console.warn('result failed', e); }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
