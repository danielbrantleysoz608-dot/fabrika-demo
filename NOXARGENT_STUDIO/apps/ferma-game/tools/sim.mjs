// Симуляция баланса: node tools/sim.mjs
import * as E from '../webapp/js/engine.js';
import { BUILDINGS, ENDING_ORDER } from '../webapp/js/data.js';
import { EVENT_BY_ID } from '../webapp/js/events.js';

const clone = (o) => structuredClone(o);
function fillMonth(st, collectShare) {
  for (const id of E.PRODUCERS) { const cap = E.monthlyCap(st, id); st.made[id] = cap; st.barn[id] = cap * collectShare; }
}
const strategies = {
  // «умный»: стройка по приоритету, докупка ульев, лучший вариант события (заглядывает вперёд на 1 месяц)
  smart: { order: ['coop', 'stall', 'garden', 'greenhouse', 'apiary'], late: ['cow', 'omshanik', 'stove', 'fence'], buy: true, collect: 1, choice: 'best' },
  smart70: { order: ['coop', 'stall', 'garden', 'greenhouse', 'apiary'], late: ['cow', 'omshanik', 'stove', 'fence'], buy: true, collect: .7, choice: 'best' },
  normal: { order: ['coop', 'stall', 'garden', 'fence', 'greenhouse', 'apiary', 'cow', 'omshanik', 'stove'], buy: 'some', collect: .7, choice: 'random' },
  lazy: { order: ['coop', 'stall', 'garden'], buy: false, collect: 0, choice: 'random' },
  reckless: { order: ['cow', 'coop', 'apiary', 'greenhouse'], buy: true, collect: .5, choice: 'first' },
};
function act(st, s, r) {
  let did = true;
  while (did) {
    did = false;
    for (const id of s.order) { if (!st.built[id]) { if (!E.build(st, id)) did = true; else if (s.late) break; } }
    if (s.buy === true || (s.buy === 'some' && r() < .5)) {
      if (st.month <= 4 && st.built.apiary && !E.buy(st, 'hives')) { did = true; continue; }
    }
    if (s.late && s.order.every(id => st.built[id]) && (st.month >= 5 || st.hives >= 15)) for (const id of s.late) if (!E.build(st, id)) did = true;
    if (s.buy && st.money > 30000 && st.month >= 5 && !E.buy(st, 'hens')) did = true;
  }
}
function play(seed, s, from = null, rollout = false) {
  const r = E.rng(seed * 31 + 7);
  let st = from || E.newGame(seed, 0);
  if (!from) { st.trash.forEach(t => (t.hp = 1)); st.trash.forEach(t => E.hitTrash(st, t.id)); }
  while (st.phase !== 'end') {
    act(st, s, r);
    fillMonth(st, s.collect);
    const e = E.endMonth(st);
    const opts = e.options.map((_, i) => i).filter(i => !E.optionState(st, e, i).why);
    let pick = opts[0] ?? -1;
    if (s.choice === 'random') pick = opts[Math.floor(r() * opts.length)] ?? -1;
    if (s.choice === 'best') {
      let best = -1e18;
      for (const i of opts) {
        const c = clone(st); E.choose(c, i);
        let v;
        if (rollout) v = c.phase === 'end' ? c.finalCapital : E.capital(c);
        else { const f = c.phase === 'end' ? c : play(seed, s, c, true); v = f.ending === 'sold' ? f.finalCapital * .8 : f.finalCapital; }
        if (v > best) { best = v; pick = i; }
      }
    }
    if (!opts.length) { st.money += 0; }
    E.choose(st, pick);
  }
  return st;
}
const N = +process.argv[2] || 400;
for (const [name, s] of Object.entries(strategies)) {
  const res = []; const ends = {};
  for (let seed = 1; seed <= N; seed++) { const st = play(seed, s); res.push(st.finalCapital); ends[st.ending] = (ends[st.ending] || 0) + 1; }
  res.sort((a, b) => a - b);
  const q = (p) => E.fmt(res[Math.floor(p * (res.length - 1))]);
  console.log(name.padEnd(9), 'p10', q(.1), '| med', q(.5), '| p90', q(.9), '| max', q(1), '|', ENDING_ORDER.map(k => `${k}:${ends[k] || 0}`).join(' '));
}
if (process.argv[3] === 'trace') {
  const st = play(+process.argv[4] || 1, strategies.smart);
  for (const l of st.ledger) console.log(l.m, l.income, l.expense, l.event, l.money);
  console.log(st.history.map(h => h.m + ' ' + h.t).join('\n'));
}
