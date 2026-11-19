// Симуляция баланса (реальное время).
//   node tools/sim.mjs               — таблица: время до 100 тыс … 1 млрд для 5 типов игроков
//   node tools/sim.mjs trace [часы]  — что и когда покупает средний игрок
import * as E from '../webapp/js/engine.js';
import { BUILDINGS, BUILD_ORDER, WORKERS, WORKER_ORDER } from '../webapp/js/data.js';

const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const MILESTONES = [1e5, 1e6, 1e7, 1e8, 1e9];

// Типы игроков. sessions — расписание (часы суток) для «реального» игрока.
export const PLAYERS = {
  active: { name: 'Средний: каждые 30 с', every: 30000 },
  m5: { name: 'Раз в 5 мин', every: 5 * MIN },
  m30: { name: 'Раз в 30 мин', every: 30 * MIN },
  h2: { name: 'Раз в 2 часа', every: 2 * HOUR },
  real: { name: 'Реальный: 3×15 мин в день', every: 30000, sessions: [8, 13, 20], len: 15 * MIN },
  day: { name: 'Раз в 30 мин днём, ночью спит', every: 30 * MIN, sessions: [8], len: 15 * HOUR },
};

function shop(st, now, trace, log) {
  // покупки: максимум прироста ₽/мин на рубль; копим на лучшее, если ждать < 3 мин
  // или оно заметно выгоднее (×1.3) лучшего из доступного
  for (let guard = 0; guard < 80; guard++) {
    let best = null, bestV = 0, bestAff = null, bestAffV = 0;
    for (const id of BUILD_ORDER) {
      const why = E.canBuy(st, id);
      if (why && !why.startsWith('не хватает')) continue;
      const v = E.buyValue(st, id) / E.priceOf(st, id);
      if (v > bestV) { bestV = v; best = id; }
      if (!why && v > bestAffV) { bestAffV = v; bestAff = id; }
    }
    // ремонт дома деда — тоже кандидат (+3% ко всему доходу)
    const rv = E.repairValue(st);
    if (rv > bestV && !E.canRepair(st)) { E.repairHouse(st); if (trace) log.push(`${fmtT(now).padStart(12)}  Дом деда → этап ${st.house}`); continue; }
    if (!best) break;
    let pick = best;
    if (E.canBuy(st, best)) {
      const wait = (E.priceOf(st, best) - st.money) / Math.max(1, E.totalRate(st));
      if (wait < 3 || !bestAff || bestV > 1.3 * bestAffV) break; // копим на заметно более выгодное
      pick = bestAff;
    }
    if (E.buy(st, pick)) break;
    if (trace) log.push(`${fmtT(now).padStart(12)}  ${BUILDINGS[pick].name} → ур.${st.lv[pick]}  (капитал ${E.fmt(E.capital(st))})`);
  }
}

// работники: нанимаем тех, кто окупается быстрее чем за 400 минут (помощник и водитель — для удобства, сим и так собирает сам)
function hireWorkers(st, now, trace, log) {
  for (const w of WORKER_ORDER) {
    const def = WORKERS[w];
    if (E.hired(st, w) && (def.bonus || def.all)) { // зарплата стала больше пользы — увольняем
      const c = structuredClone(st); delete c.workers[w];
      if (E.totalRate(st) - E.totalRate(c) < E.wageEstimate(st, w) / 15) { E.fire(st, w); if (trace) log.push(`${fmtT(now).padStart(12)}  Уволен: ${def.name}`); }
      continue;
    }
    if (E.canHire(st, w)) continue;
    if (!def.bonus && !def.all) continue;
    const c = structuredClone(st); c.workers = { ...(c.workers || {}), [w]: { at: now } };
    const gain = E.totalRate(c) - E.totalRate(st);
    const wagePerMin = E.wageEstimate(c, w) / 15;
    if (gain - wagePerMin > 0 && E.hirePrice(st, w) / (gain - wagePerMin) < 400) {
      E.hire(st, w, now);
      if (trace) log.push(`${fmtT(now).padStart(12)}  Нанят: ${def.name}`);
    }
  }
}

function visit(st, now, r, trace, log) {
  E.tick(st, now);
  E.claimLogin(st);
  E.collectAll(st);
  E.dailyTasks(st).forEach((t, i) => t.done && !t.claimed && E.claimDaily(st, i));
  if (st.debt && st.money >= st.debt * 1.2) E.repay(st); // кредит возвращаем, как только хватает
  // доска заказов: сдаём готовые, «зависшие» дольше 40 минут — отклоняем
  for (const { o, i } of E.activeOrders(st)) {
    if (E.orderDone(o)) E.deliverOrder(st, i, now);
    else if (now - o.at > 40 * MIN && E.orderStalled(st, o)) E.declineOrder(st, i, now); // висит из-за сезона — отказ без штрафа
  }
  hireWorkers(st, now, trace, log);
  shop(st, now, trace, log);
  if (E.monthReady(st)) {
    const e = E.endMonth(st);
    const opts = e.options.map((_, i) => i).filter(i => !E.optionState(st, e, i).why && !(e.id === 'sell_farm' && i === 0));
    // выбор как у разумного игрока: вариант, после которого через месяц капитал больше
    let pick = -1, best = -Infinity;
    for (const i of opts) {
      const c = structuredClone(st); E.choose(c, i);
      // «честный» игрок (STRAT=honest) сначала смотрит на доверие покупателей, потом на деньги
      const v = E.capital(c) + E.totalRate(c) * 15 - (c.debt ? c.debt * 0.05 : 0) + (process.env.STRAT === 'honest' ? (c.trust - st.trust) * 1e15 : 0);
      if (v > best) { best = v; pick = i; }
    }
    E.choose(st, pick);
  }
}

export function play(seed, type, { until = 1e9, maxDays = 60, trace = false } = {}) {
  const P = PLAYERS[type];
  let now = 8 * HOUR; // игра начинается в 8 утра
  const st = E.newGame(seed, now);
  st.trash.forEach(t => E.hitTrash(st, t.id));
  now += 40000; st.lastTick = now;
  const r = E.rng(seed * 97 + 1), hit = {}, log = [];
  const start = now;
  const end = start + maxDays * DAY;
  // 100 тыс — по капиталу; 1 млн и дальше — когда цель открылась (капитал + уровень фермы)
  const mark = () => { const c = E.ratingCapital(st); for (const [i, m] of MILESTONES.entries()) if (!hit[m] && (i === 0 ? c >= m : st.tier >= i)) hit[m] = now - start; };
  while (now < end && !(hit[until])) {
    if (P.sessions) {
      // внутри сессии — каждые 30 с; между сессиями — прыжок к следующей
      const dayStart = Math.floor(now / DAY) * DAY;
      const inSession = P.sessions.some(h => now >= dayStart + h * HOUR && now < dayStart + h * HOUR + P.len);
      if (inSession) { visit(st, now, r, trace, log); mark(); now += P.every; continue; }
      const next = [...P.sessions.map(h => dayStart + h * HOUR), ...P.sessions.map(h => dayStart + DAY + h * HOUR)].find(t => t > now);
      now = next; continue;
    }
    visit(st, now, r, trace, log); mark(); now += P.every;
  }
  return { hit, st, log };
}

export const fmtT = (ms) => {
  if (ms == null) return '—';
  if (ms < HOUR) return `${Math.round(ms / MIN)} мин`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} ч ${String(Math.round(ms % HOUR / MIN)).padStart(2, '0')} мин`;
  const d = ms / DAY;
  return d < 14 ? `${d.toFixed(1).replace('.', ',')} дн` : `${(d / 7).toFixed(1).replace('.', ',')} нед`;
};
const median = (a) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length > a.length / 2 ? s[Math.floor(a.length / 2)] : null; };

const arg = process.argv[2];
if (arg === 'trace') {
  const { log, st } = play(1, 'active', { until: 1e12, maxDays: (+process.argv[3] || 6) / 24, trace: true });
  console.log(log.join('\n'));
  console.log('Итог: месяц', st.month, 'капитал', E.fmt(E.capital(st)), 'доход', E.fmt(E.totalRate(st)), '/мин');
} else if (!arg || arg === 'table') {
  const N = +process.argv[3] || 12;
  const types = process.argv[4] ? process.argv[4].split(',') : Object.keys(PLAYERS);
  console.log(`Время до цели (медиана по ${N} фермам, реальное время с начала игры; цель = капитал + уровень фермы):\n`);
  console.log('Тип игрока'.padEnd(30), MILESTONES.map(m => (m >= 1e9 ? `${m / 1e9} млрд` : m >= 1e6 ? `${m / 1e6} млн` : `${m / 1e3} тыс`).padStart(11)).join(''));
  for (const t of types) {
    const runs = Array.from({ length: N }, (_, i) => play(i + 1, t, { maxDays: 90 }));
    console.log(PLAYERS[t].name.padEnd(30), MILESTONES.map(m => fmtT(median(runs.map(x => x.hit[m]))).padStart(11)).join(''));
  }
}
if (arg === 'night') {
  // «Зашёл вечером — вернулся утром»: игрок заходит раз в 30 мин с 8:00 до 23:00, ночью 9 ч не заходит.
  // Пока игра закрыта, ферма копит не больше 2 часов (OFFLINE_CAP_MS) — проверяем, сколько это даёт за ночь.
  const days = +process.argv[3] || 6;
  console.log('Ночь без игры (последний заход 23:00, утром — 08:00), медиана по 3 фермам\n');
  console.log('Ночь'.padEnd(6), 'капитал в 23:00'.padStart(16), 'утром (после сбора)'.padStart(21), 'прирост'.padStart(12), 'доход/мин'.padStart(11), 'ночь = часов дохода'.padStart(21));
  const runs = [1, 2, 3].map(seed => {
    const P = PLAYERS.day, rows = [];
    let now = 8 * HOUR;
    const st = E.newGame(seed, now); st.trash.forEach(t => E.hitTrash(st, t.id)); now += 40000; st.lastTick = now;
    const r = E.rng(seed * 97 + 1), log = [];
    for (let d = 0; d < days; d++) {
      const day0 = d * DAY;
      for (now = Math.max(now, day0 + 8 * HOUR); now < day0 + 23 * HOUR; now += P.every) visit(st, now, r, false, log);
      const eve = E.ratingCapital(st), rate = E.totalRate(st);
      now = day0 + DAY + 8 * HOUR;               // утро следующего дня
      E.tick(st, now); E.collectAll(st);
      const morn = E.ratingCapital(st);
      rows.push({ eve, morn, gain: morn - eve, rate, hours: (morn - eve) / Math.max(1, rate * 60) });
    }
    return rows;
  });
  const med = (a) => a.sort((x, y) => x - y)[1];
  const M = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + ' млрд' : v >= 1e6 ? (v / 1e6).toFixed(2) + ' млн' : Math.round(v / 1e3) + ' тыс');
  for (let d = 0; d < days; d++) {
    const g = (k) => med(runs.map(x => x[d][k]));
    console.log(String(d + 1).padEnd(6), M(g('eve')).padStart(16), M(g('morn')).padStart(21), ('+' + M(g('gain'))).padStart(12), M(g('rate')).padStart(11), g('hours').toFixed(1).padStart(21));
  }
}
if (arg === 'income') {
  for (const h of (process.argv[3] || '1,3,8,24').split(',').map(Number)) {
    const { st } = play(1, process.argv[4] || 'active', { until: 1e15, maxDays: h / 24 });
    console.log(`через ${h} ч: капитал ${E.fmt(E.capital(st))}, доход ${E.fmt(E.totalRate(st))}/мин, уровни`, JSON.stringify(st.lv));
  }
}
if (arg === 'payback') {
  // окупаемость каждого уровня в сезон (без прилавка): цена / прибавка дохода
  const st = E.newGame(1, 0);
  console.log('Окупаемость улучшения, минут (в сезон):');
  console.log('Постройка'.padEnd(22), Array.from({ length: 10 }, (_, i) => `→${i + 1}`.padStart(6)).join(''));
  for (const id of BUILD_ORDER) {
    if (BUILDINGS[id].kind !== 'prod') continue;
    const row = [];
    for (let L = 0; L < 10; L++) { st.lv[id] = L; row.push(Math.round(E.paybackMin(st, id))); }
    st.lv[id] = 0;
    console.log(BUILDINGS[id].name.padEnd(22), row.map(x => String(x).padStart(6)).join(''));
  }
  console.log('\nПрибавка за уровень, ₽/мин (огород):', Array.from({ length: 10 }, (_, L) => Math.round(E.baseIncome('garden', L + 1) - E.baseIncome('garden', L))).join(' → '));
}

// node tools/sim.mjs story [seed] [months]   (STRAT=honest — игрок, который бережёт доверие) — 30 месяцев: какие события выпали (без повторов), что выбрано, как менялось доверие
if (arg === 'story') {
  const seed = +process.argv[3] || 1, months = +process.argv[4] || 30;
  const { st } = play(seed, 'active', { until: 1e18, maxDays: (months + 1) * 15 / 1440 });
  const { EVENT_BY_ID } = await import('../webapp/js/events.js');
  const strip = (t) => String(typeof t === 'function' ? t(st) : t).replace(/<[^>]+>/g, '');
  console.log(`Ферма #${seed}: ${st.month} месяцев, капитал ${E.fmt(E.capital(st))}, доверие ${E.trustOf(st)} 🤝\n`);
  console.log('Мес.'.padEnd(5), 'Событие'.padEnd(36), '🤝'.padStart(4), ' Решение → последствия');
  for (const d of st.decisions) {
    const e = EVENT_BY_ID[d.ev];
    console.log(String(d.m + 1).padEnd(5), ((e.follow ? '↳ ' : '') + strip(e.title)).slice(0, 36).padEnd(36), String(d.trust).padStart(4), ' ' + d.opt + (d.sum ? ' → ' + d.sum : ''));
  }
  const ids = st.decisions.map(d => d.ev).filter(id => id !== 'quiet');
  console.log(`\nСобытий: ${st.decisions.length}, повторов: ${ids.length - new Set(ids).size}, продолжений сюжета: ${st.decisions.filter(d => EVENT_BY_ID[d.ev].follow).length}`);
  console.log('Флаги сюжета:', Object.entries(st.storyFlags).map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(', '));
  console.log('Навсегда:', Object.entries(st.perm).map(([k, v]) => E.effectText(k, v)).join(', ') || '—');
}
