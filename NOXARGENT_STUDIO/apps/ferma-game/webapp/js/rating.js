// Рейтинг: топ-100 по капиталу фермы (деньги + постройки − долг, БЕЗ монет за Telegram Stars)
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

const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function openRating(ctx, period = 'all') {
  const { st, openLayer, layer, short, fromSplash } = ctx;
  const kind = fromSplash || layer.dataset.kind === 'rating-start' ? 'rating-start' : 'rating';
  const head = `<div class="tabs"><button data-r="all" class="${period === 'all' ? 'on' : ''}">Все время</button><button data-r="week" class="${period === 'week' ? 'on' : ''}">За неделю</button></div>`;
  openLayer(`<div class="sheet rating"><div class="grab"></div><div class="sheet-head"><h2>🏆 Рейтинг</h2><button class="x-close" data-act="${kind === 'rating-start' ? 'splash' : 'close'}">✕ Закрыть</button></div>${head}<div class="r-list"><p class="note">Загружаем…</p></div></div>`, 'sheet-wrap', true);
  layer.dataset.kind = kind;
  if (st) await submitScore(st, ctx.profile, true);
  let data;
  const myValue = period === 'week' || !st || st.phase === 'clean' ? 0 : Math.round(E.ratingCapital(st));
  try { data = await request('GET', `/api/leaderboard?period=${period}&value=${myValue}`); } catch (e) {
    layer.querySelector('.r-list').innerHTML = `<p class="note">Рейтинг недоступен: нет связи с сервером игры.<br>Локально запустите сервер: <code>python main.py --web-only</code> и откройте http://localhost:8080</p>`;
    bind(ctx, period); return;
  }
  const unit = period === 'week' ? 'за неделю' : 'капитал';
  const row = (r) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${medal(r.rank)}</span><span class="nm">${esc(r.name)}${r.year > 1 ? `<small>год ${r.year}</small>` : ''}</span><b>${period === 'week' && r.value > 0 ? '+' : ''}${short(r.value)}</b></li>`;
  // игроков мало (кроме тебя никого) — заглушка-приглашение
  const others = data.top.filter(r => !r.me);
  const top = others.length
    ? `<ol class="r-top">${data.top.map(row).join('')}</ol>`
    : `<div class="r-empty"><div class="r-empty-ico">🏆</div><b>Стань первым фермером в рейтинге!</b><span>${period === 'week' ? 'Неделя только началась — расти ферму, и попадёшь в топ недели.' : 'Расти ферму — и твоё имя будет первым в списке.'}</span></div>`;
  const meData = data.me || { rank: 1, name: null, value: myValue };
  const me = row({ ...meData, name: meData.name || playerName() || tgName() || 'Ты', me: true });
  const canRename = !tgName();
  layer.querySelector('.r-list').innerHTML = `${top}
    <div class="r-me"><div class="r-me-lbl">Твоё место · ${unit}${data.total ? ` · игроков: ${data.total}` : ''}</div><ol>${me}</ol>
    ${canRename ? `<div class="r-name"><input id="rName" maxlength="24" placeholder="Твоё имя в рейтинге" value="${esc(playerName())}"><button class="btn primary" data-r="name">ОК</button></div>` : ''}</div>
    <p class="note">Место — по капиталу фермы: деньги + постройки − долг. Покупки за Telegram Stars в рейтинг не идут.</p>`;
  bind(ctx, period);
}

function bind(ctx, period) {
  ctx.layer.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const r = b.dataset.r;
    if (r === 'name') {
      const v = ctx.layer.querySelector('#rName').value.trim().slice(0, 24);
      setPlayerName(v);
      if (ctx.st) await submitScore(ctx.st, ctx.profile, true);
      return openRating(ctx, period);
    }
    openRating(ctx, r);
  }));
}
