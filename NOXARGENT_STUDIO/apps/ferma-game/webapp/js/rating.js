// Рейтинг: топ-100 по капиталу фермы (деньги + постройки − долг; купленные за звёзды деньги — тоже)
// и вкладка «За неделю» (прирост капитала с понедельника). Своё место всегда видно внизу.
import * as E from './engine.js';
import { yearOf } from './data.js';
import { request, tgName, playerName, setPlayerName } from './api.js';

let lastSent = 0, lastValue = -1;
// отправляем капитал не чаще раза в 30 секунд (и сразу — после месяца и целей)
export async function submitScore(st, profile, force = false) {
  if (!st || st.phase === 'clean') return;
  const now = Date.now();
  const cap = E.capital(st);
  if (!force && (now - lastSent < 30000 || cap === lastValue)) return;
  lastSent = now; lastValue = cap;
  try {
    await request('POST', '/api/score', { capital: cap, paid: st.paid?.coins || 0, tier: st.tier, year: yearOf(st.month) });
  } catch { /* сервер недоступен — не страшно, отправим позже */ }
}

const BADGE = { patron: ['💌', 'Меценат'], silver: ['🥈', 'Фермер недели'], bronze: ['🥉', 'Фермер недели'] };
const badges = (list) => (list || []).filter(b => BADGE[b]).map(b => `<span class="r-badge" title="${BADGE[b][1]}">${BADGE[b][0]} ${BADGE[b][1]}</span>`).join('');
const TABS = [['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']];
const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tg = window.Telegram?.WebApp;
const openTg = (url) => (tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank'));
// «2 д 5 ч», «5 ч 12 мин», «14 мин»
function left(ts) {
  const m = Math.max(0, Math.round((ts * 1000 - Date.now()) / 60000));
  if (m >= 1440) return `${Math.floor(m / 1440)} д ${Math.floor((m % 1440) / 60)} ч`;
  if (m >= 60) return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  return m > 0 ? `${m} мин` : 'подводятся…';
}
const giftSVG = `<svg viewBox="0 0 64 64" class="gift-ico" aria-hidden="true"><g stroke="#3b2a1f" stroke-width="2.5" stroke-linejoin="round"><rect x="10" y="26" width="44" height="30" rx="3" fill="#4a90d9"/><rect x="6" y="18" width="52" height="11" rx="3" fill="#6fb0f0"/></g><path d="M32 18 v38" stroke="#ffd23f" stroke-width="7"/><path d="M32 18 q-14 -16 -18 -4 q6 6 18 4 q12 2 18 -4 q-4 -12 -18 4" fill="#ffd23f" stroke="#3b2a1f" stroke-width="2.5"/></svg>`;

function showRules(ctx, period) {
  ctx.layer.querySelector('.r-list').innerHTML = `<div class="rules">
    <p><b>Как считается место.</b> «Неделя» и «Месяц» — по <b>приросту</b> капитала за период, поэтому у новичков тоже есть шанс. «Всё время» — по капиталу фермы: деньги + постройки − долг. Капитал и прирост считает сервер игры.</p>
    <p><b>Когда итоги.</b> Неделя: с понедельника 00:00 до воскресенья 20:00 по Москве. Месяц: с 1-го числа 00:00 до последнего дня месяца 20:00 по Москве.</p>
    <p><b>Призы.</b> Месяц, 1 место — NFT-подарок «PoolFloat». Неделя, 1 место — подарок Telegram за 25 ⭐; 2 и 3 место — значки «🥈/🥉 Фермер недели» у ника на всю следующую неделю.</p>
    <p><b>Покупки.</b> Деньги фермы, купленные за звёзды, учитываются в рейтинге, как заработанные.</p>
    <p><b>Условия.</b> Участвуют игроки из Telegram, чья ферма создана не меньше 3 дней назад. Один приз на один Telegram-аккаунт за период. Чтобы получить подарок, у победителя должен быть @username или открытая личка. Организатор может снять игрока с розыгрыша за накрутку, использование ошибок игры или мультиаккаунты.</p>
  </div><button class="btn primary wide" data-r="${period}">Назад к рейтингу</button>`;
  bind(ctx, period);
}
// окно NFT-приза месяца
function showNft(ctx, nft) {
  const box = document.createElement('div');
  box.className = 'nft-modal';
  box.innerHTML = `<div class="dialog nft-dlg"><div class="nft-pic"><img src="${esc(nft.img)}" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__giftSVG))"></div>
    <h3>🎁 ${esc(nft.name)}</h3><p>NFT-подарок Telegram — <b>награда за 1 место месяца</b>.</p>
    <button class="btn primary big" data-nft="open">Посмотреть подарок</button><button class="btn wide" data-nft="close">Закрыть</button></div>`;
  window.__giftSVG = giftSVG;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nft]');
    if (b?.dataset.nft === 'open') openTg(nft.url);
    if (b || e.target === box) box.remove();
    e.stopPropagation();
  });
  ctx.layer.appendChild(box);
}

export async function openRating(ctx, period = 'week') {
  const { st, openLayer, layer, short, fromSplash } = ctx;
  const kind = fromSplash || layer.dataset.kind === 'rating-start' ? 'rating-start' : 'rating';
  const head = `<div class="tabs tabs3">${TABS.map(([k, l]) => `<button data-r="${k}" class="${period === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openLayer(`<div class="sheet rating"><div class="grab"></div><div class="sheet-head"><h2>🏆 Рейтинг</h2><button class="x-close" data-act="${kind === 'rating-start' ? 'splash' : 'close'}">✕ Закрыть</button></div>${head}<div class="r-list"><p class="note">Загружаем…</p></div></div>`, 'sheet-wrap', true);
  layer.dataset.kind = kind;
  if (st) await submitScore(st, ctx.profile, true);
  let data;
  const myValue = period !== 'all' || !st || st.phase === 'clean' ? 0 : Math.round(E.ratingCapital(st));
  try { data = await request('GET', `/api/leaderboard?period=${period}&value=${myValue}`); } catch (e) {
    layer.querySelector('.r-list').innerHTML = `<p class="note">Рейтинг временно недоступен: нет связи с сервером игры. Попробуйте чуть позже.</p>`;
    bind(ctx, period); return;
  }
  const gain = period !== 'all';
  const prizes = data.prizes || {};
  const prize = (rank) => { const p = prizes[rank]; if (!p) return ''; return p.nft ? `<button class="r-prize nft" data-nft-open="1">${giftSVG}<small>NFT</small></button>` : `<span class="r-prize">${p.icon}<small>${p.label}</small></span>`; };
  const row = (r) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${medal(r.rank)}</span><span class="nm">${esc(r.name)}${badges(r.badges)}${r.year > 1 ? `<small>год ${r.year}</small>` : ''}</span>${gain ? prize(r.rank) : ''}<b>${gain && r.value > 0 ? '+' : ''}${short(r.value)}</b></li>`;
  // заглушка «Стань первым» — только если в периоде ещё никого нет; сам игрок в таблице тоже считается
  const top = data.top.length
    ? `<ol class="r-top">${data.top.map(row).join('')}</ol>`
    : `<div class="r-empty"><div class="r-empty-ico">🏆</div><b>Стань первым фермером в рейтинге!</b><span>${gain ? 'Период только начался — расти ферму, и попадёшь в топ.' : 'Расти ферму — и твоё имя будет первым в списке.'}</span></div>`;
  const meData = data.me || { rank: 1, name: null, value: myValue };
  const me = row({ ...meData, name: meData.name || playerName() || tgName() || 'Ты', me: true });
  const meInTop = data.top.some(r => r.me);
  const canRename = !tgName();
  const timer = data.endsAt ? `<div class="r-timer">⏳ Итоги через <b data-ends="${data.endsAt}">${left(data.endsAt)}</b> · ${period === 'week' ? 'вс 20:00' : 'последний день месяца 20:00'} МСК</div>` : '';
  const plaque = period === 'month' && data.nft ? `<button class="r-plaque" data-nft-open="1"><span class="pl-pic">${giftSVG}<img src="${esc(data.nft.img)}" alt="" onerror="this.remove()"></span><span>🏆 Приз месяца — <b>NFT-подарок ${esc(data.nft.name)}</b><small>посмотреть подарок ›</small></span></button>` : '';
  const lw = data.lastWinners || {};
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const monthName = (p) => MONTHS[(+String(p).split('-')[1] || 1) - 1] || p;
  const winners = [lw.week && `Неделя: ${lw.week.top.map(w => `${medal(w.rank)} <b>${esc(w.name)}</b>`).join(' ')}`,
    lw.month && `Месяц (${monthName(lw.month.period)}): 🏆 <b>${esc(lw.month.top[0]?.name || '')}</b>`].filter(Boolean);
  const unit = { week: 'прирост за неделю', month: 'прирост за месяц', all: 'капитал' }[period];
  layer.querySelector('.r-list').innerHTML = `${timer}${plaque}
    ${winners.length ? `<div class="r-winner"><div class="rw-t">Победители прошлой недели / прошлого месяца</div>${winners.map(w => `<div>${w}</div>`).join('')}</div>` : ''}
    ${top}
    <div class="r-me"><div class="r-me-lbl">Твоё место · ${unit}${data.total ? ` · игроков: ${data.total}` : ''}</div>${meInTop && data.top.length <= 3 ? '' : `<ol>${me}</ol>`}
    ${canRename ? `<div class="r-name"><input id="rName" maxlength="24" placeholder="Твоё имя в рейтинге" value="${esc(playerName())}"><button class="btn primary" data-r="name">ОК</button></div>` : ''}</div>
    <p class="note">${gain ? 'Место — по приросту капитала за период: новички тоже могут победить.' : 'Место — по капиталу фермы: деньги + постройки − долг.'}</p>
    <button class="btn wide" data-r="rules">ℹ️ Правила</button>`;
  layer.querySelectorAll('[data-nft-open]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); showNft(ctx, data.nft || prizes[1]?.nft); }));
  // таймер тикает, пока открыта вкладка
  clearInterval(openRating.t);
  openRating.t = setInterval(() => { const el = layer.querySelector('[data-ends]'); if (!el) return clearInterval(openRating.t); el.textContent = left(+el.dataset.ends); }, 30000);
  bind(ctx, period);
}

function bind(ctx, period) {
  ctx.layer.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const r = b.dataset.r;
    if (r === 'rules') return showRules(ctx, period);
    if (r === 'name') {
      const v = ctx.layer.querySelector('#rName').value.trim().slice(0, 24);
      setPlayerName(v);
      if (ctx.st) await submitScore(ctx.st, ctx.profile, true);
      return openRating(ctx, period);
    }
    openRating(ctx, r);
  }));
}
