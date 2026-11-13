// Логика игры — чистые функции над объектом состояния. Без DOM.
// Детерминированный рандом (seed) — задел для серверной проверки результата в рейтинге.
import {
  SCHEMA_VERSION, START_MONEY, GOAL, MONTHS, BUILDINGS, UNITS, PRODUCTS, COSTS, TRASH, FIELD_WEEDS,
  MONTH_FILL_SEC, UNCOLLECTED_SHARE, SCRAP_BONUS, ASSET_SHARE, HEN_VALUE, HIVE_VALUE, isWinter, isSummer,
} from './data.js';
import { EVENTS, EVENT_BY_ID } from './events.js';

export const fmt = (n) => `${Math.round(n).toLocaleString('ru-RU').replace(/[ ,]/g, ' ')} ₽`;

// mulberry32: хорошо перемешивает даже соседние seed
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Новая игра ---------- */
export function newGame(seed = (Math.random() * 2 ** 31) | 0, now = Date.now()) {
  return {
    v: SCHEMA_VERSION, seed, startedAt: now, lastTick: now,
    month: 0, phase: 'clean',              // clean → play → (event → report) → … → end
    money: START_MONEY, debt: 0, hens: 0, hives: 0,
    trash: TRASH.map(t => ({ id: t.id, hp: t.hp })),
    built: {}, made: {}, barn: {},
    flags: {}, mods: {}, nextMods: {},
    usedEvents: [], event: null, report: null,
    negMonths: 0, ending: null, finalCapital: null,
    history: [{ m: 0, t: 'Получили в наследство ферму деда и 10 000 ₽.' }],
    ledger: [], taps: 0,
  };
}

/* ---------- Уборка ---------- */
const trashDef = Object.fromEntries(TRASH.map(t => [t.id, t]));
export const cleanTotal = () => TRASH.reduce((a, t) => a + t.hp, 0);
export const cleanLevel = (st) => 1 - st.trash.reduce((a, t) => a + Math.max(0, t.hp), 0) / cleanTotal();
export const fieldClear = (st) => FIELD_WEEDS.every(id => st.trash.find(t => t.id === id).hp <= 0);

export function hitTrash(st, id) {
  const t = st.trash.find(x => x.id === id);
  if (!t || t.hp <= 0 || st.phase !== 'clean') return null;
  t.hp--; st.taps++;
  const removed = t.hp <= 0;
  const done = cleanLevel(st) >= 1;
  if (done) {
    st.phase = 'play';
    st.money += SCRAP_BONUS;
    st.history.push({ m: st.month, t: `Убрали весь хлам. Сдали дедов металлолом: +${fmt(SCRAP_BONUS)}.` });
  }
  return { removed, done, share: trashDef[id].hp / cleanTotal() };
}

/* ---------- Стройка ---------- */
export function priceOf(st, id) {
  let p = BUILDINGS[id].price;
  if (id === 'greenhouse' && st.flags.greenhouseDiscount) p -= st.flags.greenhouseDiscount;
  return p;
}

export function canBuild(st, id) {
  const b = BUILDINGS[id];
  if (st.built[id]) return 'уже построено';
  if (st.phase === 'clean') return 'сначала уборка';
  if (st.phase === 'end') return 'игра окончена';
  if (id === 'garden' && st.flags.fieldSold) return 'поле продано соседу';
  if (b.requires && !st.built[b.requires]) return 'нужно: ' + BUILDINGS[b.requires].name;
  if (st.money < priceOf(st, id)) return 'не хватает ' + fmt(priceOf(st, id) - st.money);
  return null;
}

export function build(st, id) {
  const why = canBuild(st, id);
  if (why) return why;
  st.money -= priceOf(st, id);
  st.built[id] = true;
  if (id === 'coop') st.hens += 10;
  if (id === 'apiary') st.hives += 3;
  st.history.push({ m: st.month, t: `Построили: ${BUILDINGS[id].name} (${fmt(priceOf(st, id))}).` });
  return null;
}

export function canBuy(st, kind) {
  const u = UNITS[kind];
  if (!st.built[u.requires]) return 'нужно: ' + BUILDINGS[u.requires].name;
  if (st[kind] + u.step > u.max) return 'больше не поместится';
  if (st.money < u.price) return 'не хватает ' + fmt(u.price - st.money);
  return null;
}
export function buy(st, kind) {
  const why = canBuy(st, kind);
  if (why) return why;
  const u = UNITS[kind];
  st.money -= u.price; st[kind] += u.step;
  st.history.push({ m: st.month, t: `${u.name} за ${fmt(u.price)}.` });
  return null;
}

export function repay(st) {
  if (!st.debt) return 'долгов нет';
  if (st.money < st.debt) return 'не хватает ' + fmt(st.debt - st.money);
  st.money -= st.debt;
  st.history.push({ m: st.month, t: `Вернули кредит ${fmt(st.debt)}.` });
  st.debt = 0;
  return null;
}

/* ---------- Производство ---------- */
// месячная норма продукции постройки (в единицах), без модификаторов событий
export function monthlyCap(st, id, m = st.month) {
  if (!st.built[id]) return 0;
  switch (id) {
    case 'coop': return st.hens * 25 * (isWinter(m) ? 0.5 : 1);
    case 'garden': return !st.flags.fieldSold && m >= 2 && m <= 6 ? 400 : 0;
    case 'greenhouse': return m <= 8 ? 300 : st.built.stove ? 250 : 0;
    case 'apiary': return m >= 3 && m <= 5 ? st.hives * 25 : 0;
    case 'cow': return 600;
    default: return 0;
  }
}
export function unitPrice(st, id, m = st.month) {
  if (id === 'greenhouse' && isWinter(m)) return 150; // зимние огурцы
  return PRODUCTS[id].price;
}
export const PRODUCERS = Object.keys(PRODUCTS);

// реальное время: накапливаем продукцию
export function tick(st, now = Date.now()) {
  const dt = Math.max(0, Math.min((now - st.lastTick) / 1000, MONTH_FILL_SEC * 2));
  st.lastTick = now;
  if (st.phase !== 'play') return false;
  let changed = false;
  for (const id of PRODUCERS) {
    const cap = monthlyCap(st, id);
    if (!cap) continue;
    const before = Math.floor(ready(st, id));
    st.made[id] = Math.min(cap, (st.made[id] || 0) + cap * dt / MONTH_FILL_SEC);
    if (Math.floor(ready(st, id)) !== before) changed = true;
  }
  return changed;
}
export const ready = (st, id) => Math.max(0, (st.made[id] || 0) - (st.barn[id] || 0));

export function collect(st, id) {
  const amt = Math.floor(ready(st, id));
  if (amt <= 0 || st.phase !== 'play') return 0;
  st.barn[id] = (st.barn[id] || 0) + amt;
  st.taps++;
  return amt;
}

/* ---------- Капитал ---------- */
export function capital(st) {
  let assets = 0;
  for (const id of Object.keys(st.built)) assets += BUILDINGS[id].price * ASSET_SHARE;
  return Math.round(st.money - st.debt + assets + st.hens * HEN_VALUE + st.hives * HIVE_VALUE);
}
export const progress = (st) => Math.max(0, Math.min(1, capital(st) / GOAL));

/* ---------- События ---------- */
function helpers(st, log) {
  const addMod = (bucket, key, v) => { bucket[key] = (bucket[key] ?? 1) * v; };
  return {
    fmt,
    pay: (sum, label) => { st.money -= sum; log.push({ label, amount: -sum }); },
    gain: (sum, label) => { st.money += sum; log.push({ label, amount: sum }); },
    mod: (key, v) => addMod(st.mods, key, v),
    modAll: (v) => PRODUCERS.forEach(id => addMod(st.mods, id, v)),
    next: (key, v) => addMod(st.nextMods, key, v),
    offer: (s) => Math.max(60000, Math.round(capital(s) * 1.15 / 1000) * 1000),
    sellFarm: () => { st.flags.soldFarm = Math.max(60000, Math.round(capital(st) * 1.15 / 1000) * 1000); },
  };
}

export const resolveText = (v, st) => (typeof v === 'function' ? v(st, helpers(st, [])) : v);

export function pickEvent(st) {
  const r = rng(st.seed + st.month * 7919);
  const pool = EVENTS.filter(e => e.months.includes(st.month) && (e.repeat || !st.usedEvents.includes(e.id)) && (!e.cond || e.cond(st)));
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let x = r() * total;
  for (const e of pool) { if ((x -= e.weight) <= 0) return e; }
  return pool[pool.length - 1] || EVENT_BY_ID.quiet;
}

// «Следующий месяц»: выпадает событие
export function endMonth(st) {
  if (st.phase !== 'play') return null;
  const e = pickEvent(st);
  st.event = e.id;
  st.phase = 'event';
  return e;
}

export function optionState(st, e, i) {
  const o = e.options[i];
  return { why: o.can ? o.can(st) : null, desc: resolveText(o.desc, st), label: o.label, icon: o.icon };
}

export const allBlocked = (st, e) => e.options.every(o => o.can && o.can(st));
const PASS = { label: 'Не по карману', effect: () => 'Денег не хватило ни на один вариант.' };

export function choose(st, i) {
  if (st.phase !== 'event') return null;
  const e = EVENT_BY_ID[st.event];
  const o = i === -1 && allBlocked(st, e) ? PASS : e.options[i];
  if (!o || (o.can && o.can(st))) return null;
  const log = [];
  const text = o.effect(st, helpers(st, log));
  st.usedEvents.push(e.id);
  st.history.push({ m: st.month, t: `${stripTags(e.title)}: ${o.label.toLowerCase()}. ${text}` });
  return closeMonth(st, { title: stripTags(e.title), choice: o.label, text, log });
}
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

/* ---------- Итоги месяца ---------- */
export function closeMonth(st, ev) {
  const m = st.month;
  const sales = [];
  let salesMul = st.mods.sales ?? 1;
  if (st.built.stall) salesMul *= isSummer(m) ? 1.5 : 1.25;
  if (st.flags.contract) salesMul *= 1.3;
  for (const id of PRODUCERS) {
    const cap = monthlyCap(st, id) * (st.mods[id] ?? 1);
    if (!cap) continue;
    const made = Math.min(st.made[id] || 0, cap);
    const hand = Math.min(st.barn[id] || 0, cap);
    const rest = cap - hand; // несобранное + не успевшее «вырасти» — оптом
    const share = st.flags.helper ? 1 : UNCOLLECTED_SHARE;
    const p = unitPrice(st, id);
    const sum = (hand * p + rest * p * share) * salesMul;
    sales.push({ id, qty: Math.round(cap), hand: Math.round(hand), made: Math.round(made), unit: PRODUCTS[id].unit, sum: Math.round(sum) });
  }
  const income = sales.reduce((a, s) => a + s.sum, 0);

  const costs = [];
  const add = (label, amount) => amount > 0 && costs.push({ label, amount: Math.round(amount) });
  add('Свет и налог', COSTS.base);
  if (isWinter(m)) add('Отопление дома', COSTS.heating);
  if (st.hens) add(`Корм курам (${st.hens})`, st.hens * (isWinter(m) ? COSTS.henFeedWinter : COSTS.henFeed));
  if (st.built.cow) add('Корм корове', isWinter(m) ? COSTS.cowFeedWinter : COSTS.cowFeed);
  if (monthlyCap(st, 'garden')) add('Семена', COSTS.gardenSeeds);
  if (monthlyCap(st, 'greenhouse') && !isWinter(m)) add('Теплица: рассада', COSTS.greenhouse);
  if (st.built.stove && isWinter(m)) add('Дрова для печки', COSTS.firewood);
  if (st.flags.helper) add('Зарплата Ване', COSTS.helper);
  if (st.debt) add('Проценты по кредиту', st.debt * COSTS.loanRate);
  const expense = costs.reduce((a, c) => a + c.amount, 0);

  const notes = [];
  if (st.flags.contract) {
    const c = st.flags.contract;
    if (income < c.min) { costs.push({ label: 'Штраф кафе', amount: c.fine }); notes.push('Кафе недовольно: выручка меньше нормы, штраф.'); }
    if (--c.left <= 0) { delete st.flags.contract; notes.push('Контракт с кафе закончился.'); }
  }
  const totalExpense = costs.reduce((a, c) => a + c.amount, 0);
  const before = st.money;
  st.money += income - totalExpense;

  // сезонные последствия
  if (m === 9 && st.built.apiary && !st.built.omshanik && st.hives > 0) {
    notes.push(`Без омшаника ${st.hives} ульев замёрзли…`);
    st.history.push({ m, t: 'Ульи замёрзли без омшаника.' });
    st.hives = 0;
  }

  const evSum = (ev?.log || []).reduce((a, l) => a + l.amount, 0);
  const report = {
    month: m, name: MONTHS[m].name, event: ev, sales, costs, income: Math.round(income), expense: Math.round(totalExpense),
    eventSum: evSum, before: Math.round(before - evSum), after: Math.round(st.money), notes, capital: capital(st),
  };
  st.ledger.push({ m, income: report.income, expense: report.expense, event: evSum, money: report.after, costs });

  // банкротство / продажа / конец года
  st.negMonths = st.money < 0 ? st.negMonths + 1 : 0;
  if (st.flags.soldFarm) {
    st.money = st.flags.soldFarm + income - totalExpense; st.debt = 0;
    finish(st, 'sold');
  } else if (st.negMonths >= 2) {
    finish(st, 'frozen');
  } else if (m === 11) {
    const c = capital(st);
    finish(st, c >= GOAL ? 'millionaire' : c > START_MONEY ? 'alive' : 'frozen');
  } else {
    if (st.money < 0) notes.push('Деньги в минусе! Ещё месяц — и ферма замёрзнет.');
    st.month++;
    st.mods = st.nextMods; st.nextMods = {};
    st.made = {}; st.barn = {};
    st.phase = 'play';
  }
  st.event = null;
  st.report = report;
  return report;
}

function finish(st, ending) {
  st.phase = 'end';
  st.ending = ending;
  st.finalCapital = ending === 'sold' ? Math.round(st.money) : capital(st);
  st.history.push({ m: st.month, t: `Конец игры: ${ending}. Капитал ${fmt(st.finalCapital)}.` });
}

/* ---------- Задания для тетради ---------- */
export function tasks(st) {
  return [
    ['Убрать ферму деда', st.phase !== 'clean'],
    ['Построить курятник', !!st.built.coop],
    ['Поставить прилавок у дороги', !!st.built.stall],
    ['Защитить кур забором', !!st.built.fence],
    ['Собрать теплицу из окон деда', !!st.built.greenhouse],
    ['Завести пасеку', !!st.built.apiary],
    ['Утеплить пчёл: омшаник до декабря', !!st.built.omshanik],
    ['Купить корову', !!st.built.cow],
    ['Капитал 100 000 ₽', capital(st) >= 100000],
    ['Капитал 500 000 ₽', capital(st) >= 500000],
    ['Миллион!', capital(st) >= GOAL],
  ];
}

/* ---------- Миграция сохранений ---------- */
export function migrate(save) {
  if (!save || typeof save !== 'object' || save.v !== SCHEMA_VERSION) return null;
  return save;
}
