// Симуляция баланса (реальное время).
//   node tools/sim.mjs               — таблица: время до 100 тыс … 1 млрд для 5 типов игроков
//   node tools/sim.mjs trace [часы]  — что и когда покупает средний игрок
import * as E from '../webapp/js/engine.js';
import { BUILDINGS, BUILD_ORDER } from '../webapp/js/data.js';

const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const MILESTONES = [1e5, 1e6, 1e7, 1e8, 1e9];

// Типы игроков. sessions — расписание (часы суток) для «реального» игрока.
export const PLAYERS = {
  active: { name: 'Средний: каждые 30 с', every: 30000 },
  m5: { name: 'Раз в 5 мин', every: 5 * MIN },
  m30: { name: 'Раз в 30 мин', every: 30 * MIN },
  h2: { name: 'Раз в 2 часа', every: 2 * HOUR },
  real: { name: 'Реальный: 3×15 мин в день', every: 30000, sessions: [8, 13, 20], len: 15 * MIN },
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

function visit(st, now, r, trace, log) {
  E.tick(st, now);
  E.claimLogin(st);
  E.collectAll(st);
  E.dailyTasks(st).forEach((t, i) => t.done && !t.claimed && E.claimDaily(st, i));
  if (st.debt && st.money >= st.debt * 1.2) E.repay(st); // кредит возвращаем, как только хватает
  // доска заказов: сдаём готовые, «зависшие» дольше 40 минут — отклоняем
  for (const { o, i } of E.activeOrders(st)) {
    if (E.orderDone(o)) E.deliverOrder(st, i, now);
    else if (now - o.at > 40 * MIN) E.declineOrder(st, i, now);
  }
  shop(st, now, trace, log);
  if (E.monthReady(st)) {
    const e = E.endMonth(st);
    const opts = e.options.map((_, i) => i).filter(i => !E.optionState(st, e, i).why && !(e.id === 'sell_farm' && i === 0));
    // выбор как у разумного игрока: вариант, после которого через месяц капитал больше
    let pick = -1, best = -Infinity;
    for (const i of opts) {
      const c = structuredClone(st); E.choose(c, i);
      const v = E.capital(c) + E.totalRate(c) * 15 - (c.debt ? c.debt * 0.05 : 0);
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
  const mark = () => { const c = E.ratingCapital(st); for (const m of MILESTONES) if (!hit[m] && c >= m) hit[m] = now - start; };
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
  console.log(`Время до капитала (медиана по ${N} фермам, реальное время с начала игры):\n`);
  console.log('Тип игрока'.padEnd(30), MILESTONES.map(m => (m >= 1e9 ? `${m / 1e9} млрд` : m >= 1e6 ? `${m / 1e6} млн` : `${m / 1e3} тыс`).padStart(11)).join(''));
  for (const t of types) {
    const runs = Array.from({ length: N }, (_, i) => play(i + 1, t, { maxDays: 90 }));
    console.log(PLAYERS[t].name.padEnd(30), MILESTONES.map(m => fmtT(median(runs.map(x => x.hit[m]))).padStart(11)).join(''));
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
