// Симуляция баланса v2 (реальное время).
//   node tools/sim.mjs            — средний игрок + сравнение стилей
//   node tools/sim.mjs trace      — по шагам: что и когда купил
import * as E from '../webapp/js/engine.js';
import { BUILDINGS, BUILD_ORDER, MONTH_MS } from '../webapp/js/data.js';

const MIN = 60000;
const MILESTONES = [1e5, 1e6, 1e7, 1e8, 1e9];

// игрок: tapEvery — как часто заходит и собирает (мс); smart — покупает лучшее по «доход/цена»
function play(seed, { tapEvery = 30000, hours = 14, trace = false } = {}) {
  let now = 0;
  const st = E.newGame(seed, now);
  // уборка: ~20 тапов за ~40 секунд
  st.trash.forEach(t => E.hitTrash(st, t.id));
  now += 40000; st.lastTick = now;
  const r = E.rng(seed * 97 + 1);
  const hit = {};
  const log = [];
  while (now < hours * 3600000) {
    now += tapEvery;
    E.tick(st, now);
    E.collectAll(st);
    // покупки: самое выгодное (прирост ₽/мин на рубль). Если лучшее не по карману —
    // копим на него, если ждать < 3 мин или оно заметно выгоднее (×1.3) и ждать < часа.
    for (let guard = 0; guard < 60; guard++) {
      let best = null, bestV = 0, bestAff = null, bestAffV = 0;
      for (const id of BUILD_ORDER) {
        const why = E.canBuy(st, id);
        if (why && !why.startsWith('не хватает')) continue;
        const v = E.buyValue(st, id) / E.priceOf(st, id);
        if (v > bestV) { bestV = v; best = id; }
        if (!why && v > bestAffV) { bestAffV = v; bestAff = id; }
      }
      if (!best) break;
      let pick = best;
      if (E.canBuy(st, best)) {
        const wait = (E.priceOf(st, best) - st.money) / Math.max(1, E.totalRate(st));
        if (wait < 3 || !bestAff || (bestV > 1.3 * bestAffV && wait < 60)) break; // копим на заметно более выгодное
        pick = bestAff;
      }
      if (E.buy(st, pick)) break;
      if (trace) log.push(`${(now / MIN).toFixed(1).padStart(6)} мин  ${BUILDINGS[pick].name} → ур.${st.lv[pick]}  (капитал ${E.fmt(E.capital(st))})`);
    }
    // месяц прошёл → следующий, событие: случайный доступный вариант
    if (E.monthReady(st)) {
      const e = E.endMonth(st);
      const opts = e.options.map((_, i) => i).filter(i => !E.optionState(st, e, i).why && !(e.id === 'sell_farm' && i === 0));
      E.choose(st, opts.length ? opts[Math.floor(r() * opts.length)] : -1);
    }
    const c = E.ratingCapital(st);
    for (const m of MILESTONES) if (!hit[m] && c >= m) hit[m] = now;
  }
  return { hit, st, log };
}

const fmtT = (ms) => (ms == null ? '   —   ' : ms < 3600000 ? `${Math.round(ms / MIN)} мин` : `${Math.floor(ms / 3600000)} ч ${String(Math.round(ms % 3600000 / MIN)).padStart(2, '0')} мин`);
const median = (a) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

if (process.argv[2] === 'trace') {
  const { log, st } = play(1, { trace: true, hours: +process.argv[3] || 4 });
  console.log(log.join('\n'));
  console.log('Итог: месяц', st.month, 'капитал', E.fmt(E.capital(st)));
} else if (!process.argv[2]) {
  const styles = [
    ['Средний: заходит каждые 30 с', 30000],
    ['Заходит раз в 5 мин', 300000],
    ['Заходит раз в 30 мин', 1800000],
    ['Заходит раз в 2 часа', 7200000],
  ];
  console.log('Время до капитала (медиана по 40 фермам):\n');
  console.log('Стиль игры'.padEnd(32), MILESTONES.map(m => (m >= 1e6 ? `${m / 1e6} млн` : `${m / 1e3} тыс`).padStart(12)).join(''));
  for (const [name, tap] of styles) {
    const runs = Array.from({ length: 40 }, (_, i) => play(i + 1, { tapEvery: tap, hours: 24 }));
    console.log(name.padEnd(32), MILESTONES.map(m => fmtT(median(runs.map(x => x.hit[m]))).padStart(12)).join(''));
  }
}
if (process.argv[2] === 'income') {
  // доход по постройкам каждые 10 минут
  const { st: s2 } = play(1, { hours: +process.argv[3] || 1.5 });
  for (const id of Object.keys(s2.lv).filter(i => BUILDINGS[i].kind === 'prod')) console.log(BUILDINGS[id].name.padEnd(22), 'ур.', s2.lv[id], ' доход/мин сейчас', Math.round(E.rate(s2, id)));
  console.log('месяц', s2.month, 'итого', Math.round(E.totalRate(s2)), '₽/мин, капитал', E.fmt(E.capital(s2)));
}
