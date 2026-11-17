// Логика игры v2 — чистые функции над объектом состояния. Без DOM (работает и в Node для симуляции).
// Время — реальное: продукция копится по минутам, 1 игровой месяц = MONTH_MS.
import {
  SCHEMA_VERSION, START_MONEY, SCRAP_BONUS, MONTH_MS, OFFLINE_CAP_MS, STORAGE_MIN, LEVEL_COST_MULT, UPKEEP_SHARE,
  LOAN_RATE, LEVEL_INC_MULT, STEEP_FROM, STEEP_MULT, FRESH_MIN, FRESH_BONUS, DAILY_REWARD, LOGIN_REWARD, LOGIN_DAYS, BUILDINGS, PRODUCERS, TRASH, FIELD_WEEDS, monthOf, yearOf, isWinter, goalOf, goalAchievement, maxLevel,
} from './data.js';
import { EVENTS, EVENT_BY_ID } from './events.js';

export { PRODUCERS };
export const fmt = (n) => `${Math.round(n).toLocaleString('ru-RU').replace(/[ ,]/g, ' ')} ₽`;
// 2 значащие цифры: 12 345 → 12 000
export const nice = (n) => { if (n < 100) return Math.round(n); const p = 10 ** (Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// История ограничена (сохранение не должно расти бесконечно)
const HISTORY_MAX = 150;
function addHistory(st, entry) {
  st.history.push(entry);
  if (st.history.length > HISTORY_MAX) st.history.splice(0, st.history.length - HISTORY_MAX);
}

/* ---------- Новая игра ---------- */
export function newGame(seed = (Math.random() * 2 ** 31) | 0, now = Date.now()) {
  return {
    v: SCHEMA_VERSION, seed, startedAt: now, lastTick: now,
    month: 0, monthMs: 0, phase: 'clean',   // clean → play ⇄ event
    trash: TRASH.map(t => ({ id: t.id, hp: t.hp })),
    money: START_MONEY, debt: 0,
    lv: {}, acc: {},                         // уровни построек и накопленная продукция (в ₽)
    flags: {}, mods: {}, nextMods: {},
    tier: 0,                                 // индекс текущей цели (0 = 1 млн)
    ach: {}, achNew: [],                     // открытки этой фермы + очередь «показать поздравление»
    paid: { coins: 0 },                      // задел: монеты за Telegram Stars (не идут в рейтинг)
    usedEvents: [], event: null, report: null,
    monthIncome: 0, history: [{ m: 0, t: 'Получили в наследство ферму деда и 10 000 ₽.' }],
    ledger: [], taps: 0, offline: 0,
    daily: null, login: null, tzOff: 0,
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
  const done = cleanLevel(st) >= 1;
  if (done) {
    st.phase = 'play';
    st.money += SCRAP_BONUS;
    addHistory(st, { m: st.month, t: `Убрали весь хлам. Сдали дедов металлолом: +${fmt(SCRAP_BONUS)}.` });
  }
  return { removed: t.hp <= 0, done, share: trashDef[id].hp / cleanTotal() };
}

/* ---------- Доход ---------- */
export const level = (st, id) => st.lv[id] || 0;
// доход постройки на уровне L (₽/мин без сезона и бонусов)
export const baseIncome = (id, L) => (L > 0 ? BUILDINGS[id].inc * L * LEVEL_INC_MULT ** (L - 1) : 0);

export function globalMult(st, withMods = true) {
  let k = 1;
  for (const id of ['stall', 'brand']) k *= 1 + (BUILDINGS[id].boost || 0) * level(st, id);
  if (withMods) {
    k *= st.mods.sales ?? 1;
    if (st.flags.contract) k *= 1.3;
  }
  return k;
}
export const seasonMult = (st, id, m = st.month) => BUILDINGS[id].season(((m % 12) + 12) % 12, st);
// текущая скорость, ₽/мин
export const rate = (st, id) => baseIncome(id, level(st, id)) * seasonMult(st, id) * (st.mods[id] ?? 1) * globalMult(st);
export const totalRate = (st) => PRODUCERS.reduce((a, id) => a + rate(st, id), 0);
// вместимость склада: 2 часа номинального производства
export const storageCap = (st, id) => baseIncome(id, level(st, id)) * globalMult(st, false) * 1.5 * STORAGE_MIN;
// «масштаб» экономики для событий: доход за месяц без сезонов
export const monthScale = (st) => Math.max(15000, PRODUCERS.reduce((a, id) => a + baseIncome(id, level(st, id)), 0) * globalMult(st, false) * MONTH_MS / 60000);

/* ---------- Реальное время ---------- */
export function tick(st, now = Date.now()) {
  const real = Math.max(0, now - st.lastTick);
  st.lastTick = now;
  if (st.phase === 'clean') return { changed: false, offline: 0 };
  const dt = Math.min(real, OFFLINE_CAP_MS);
  st.monthMs = Math.min(MONTH_MS, st.monthMs + real);
  newDay(st, now);
  let changed = false;
  for (const id of PRODUCERS) {
    if (!level(st, id)) continue;
    const before = Math.floor(st.acc[id] || 0);
    const add = rate(st, id) * dt / 60000;
    if (st.flags.helper) { gain(st, add); continue; } // Ваня собирает сам
    st.acc[id] = Math.min(storageCap(st, id), (st.acc[id] || 0) + add);
    if (Math.floor(st.acc[id]) !== before) changed = true;
  }
  checkGoals(st);
  return { changed, offline: real > 60000 ? dt : 0 };
}
export const ready = (st, id) => Math.floor(st.acc[id] || 0);
export const unitsReady = (st, id) => Math.floor((st.acc[id] || 0) / BUILDINGS[id].price);

function gain(st, sum) { st.money += sum; st.monthIncome += sum; }

// «Свежий сбор»: то, что созрело за последние 5 минут, идёт с бонусом +20%.
// Кто собирает часто — получает бонус почти со всего; кто заходит раз в 2 часа — ничего не теряет (склад 2 ч).
export let lastFresh = 0;
export const freshShare = (st, id) => { const a = st.acc[id] || 0; return a > 0 ? Math.min(1, rate(st, id) * FRESH_MIN / a) : 0; };
export function collect(st, id) {
  const amt = ready(st, id);
  lastFresh = 0;
  if (amt <= 0 || st.phase === 'clean') return 0;
  const fresh = Math.floor(Math.min(amt, rate(st, id) * FRESH_MIN) * FRESH_BONUS);
  st.acc[id] -= amt;
  gain(st, amt + fresh);
  lastFresh = fresh;
  st.taps++;
  dailyProgress(st, 'collect', amt + fresh);
  checkGoals(st);
  return amt + fresh;
}
export const collectAll = (st) => PRODUCERS.reduce((a, id) => a + collect(st, id), 0);

/* ---------- Ежедневное: задания дня и бонус за вход ---------- */
// день по местному времени игрока (st.tzOff — смещение в минутах, как Date#getTimezoneOffset)
export const dayKey = (st, now = Date.now()) => Math.floor((now - (st.tzOff || 0) * 60000) / 86400000);
export function dailyTasks(st) {
  const d = st.daily; if (!d) return [];
  return [
    { id: 'collect', title: 'Собери урожай 10 раз', have: Math.min(d.collects, 10), need: 10 },
    { id: 'build', title: 'Построй или улучши 1 постройку', have: Math.min(d.builds, 1), need: 1 },
    { id: 'sell', title: `Продай урожай на ${fmt(d.sellTarget)}`, have: Math.min(d.sold, d.sellTarget), need: d.sellTarget },
  ].map((t, i) => ({ ...t, done: t.have >= t.need, claimed: d.claimed[i], reward: d.reward }));
}
function newDay(st, now) {
  const day = dayKey(st, now);
  if (st.daily?.day === day) return;
  const S = monthScale(st);
  st.daily = { day, collects: 0, builds: 0, sold: 0, sellTarget: nice(S * 0.6), reward: nice(S * DAILY_REWARD), claimed: [false, false, false] };
  // бонус за вход: растёт 7 дней подряд, пропустил день — заново с 1-го
  // в первый день новой игры бонуса нет — подарок первого дня это стартовые деньги
  if (!st.login) { st.login = { day, streak: 1, pending: 0 }; return; }
  const streak = st.login.day === day - 1 ? (st.login.streak % LOGIN_DAYS) + 1 : 1;
  st.login = { day, streak, pending: nice(S * LOGIN_REWARD * streak) };
}
function dailyProgress(st, kind, amount) {
  const d = st.daily; if (!d) return;
  if (kind === 'collect') { d.collects++; d.sold += amount; }
  if (kind === 'build') d.builds += amount;
}
export function claimDaily(st, i) {
  const t = dailyTasks(st)[i];
  if (!t || !t.done || t.claimed) return 0;
  st.daily.claimed[i] = true;
  st.money += t.reward;
  addHistory(st, { m: st.month, t: `Задание дня «${t.title}»: +${fmt(t.reward)}.` });
  checkGoals(st);
  return t.reward;
}
export function claimLogin(st) {
  const p = st.login?.pending || 0;
  if (!p) return 0;
  st.login.pending = 0;
  st.money += p;
  addHistory(st, { m: st.month, t: `Бонус за вход, день ${st.login.streak}: +${fmt(p)}.` });
  checkGoals(st);
  return p;
}

/* ---------- Стройка и улучшения ---------- */
// множитель цены уровня: ×1.6 (у прилавка/марки свой), а после STEEP_FROM — круче
export const levelMult = (b, i) => (b.costMult || LEVEL_COST_MULT) * (i >= (b.steepFrom ?? STEEP_FROM) ? STEEP_MULT / LEVEL_COST_MULT : 1);
// цена перехода с уровня L на L+1
export function costAt(b, L) { let p = b.cost; for (let i = 0; i < L; i++) p *= levelMult(b, i); return p; }
export function priceOf(st, id) {
  const b = BUILDINGS[id], L = level(st, id);
  let p = costAt(b, L);
  const disc = st.flags.disc?.[id];
  if (disc) p *= 1 - disc;
  return Math.round(p);
}
// сколько стоят постройки сейчас (всё, что вложено в уровни)
export function buildingsValue(st) {
  let v = 0;
  for (const id of Object.keys(st.lv)) {
    const b = BUILDINGS[id], L = level(st, id);
    if (b.kind === 'once') { v += b.cost * L; continue; }
    let p = b.cost;
    for (let i = 0; i < L; i++) { v += p; p *= levelMult(b, i); }
  }
  return v;
}

export function canBuy(st, id) {
  const b = BUILDINGS[id];
  if (st.phase === 'clean') return 'сначала уборка';
  if (b.tier > st.tier) return `откроется после цели ${tierName(b.tier - 1)}`;
  if (b.requires && !level(st, b.requires)) return 'нужно: ' + BUILDINGS[b.requires].name;
  if (id === 'garden' && st.flags.fieldSold) return 'поле продано соседу';
  if (level(st, id) >= maxLevel(id, st.tier)) return b.kind === 'once' ? 'уже построено' : 'максимальный уровень';
  if (st.money < priceOf(st, id)) return 'не хватает ' + fmt(priceOf(st, id) - st.money);
  return null;
}
export function buy(st, id) {
  const why = canBuy(st, id);
  if (why) return why;
  const p = priceOf(st, id);
  st.money -= p;
  st.lv[id] = level(st, id) + 1;
  if (st.flags.disc?.[id]) delete st.flags.disc[id];
  dailyProgress(st, 'build', 1);
  const L = st.lv[id], b = BUILDINGS[id];
  addHistory(st, { m: st.month, t: L === 1 ? `Построили: ${b.name} (${fmt(p)}).` : `${b.name}: уровень ${L} (${fmt(p)}).` });
  checkGoals(st);
  return null;
}
const tierName = (t) => { const g = goalOf(t); return g >= 1e9 ? `${g / 1e9} млрд` : `${g / 1e6} млн`; };

// Ценность покупки для «самого выгодного»: прирост ₽/мин (в среднем по году) на рубль
export function buyValue(st, id) {
  const b = BUILDINGS[id];
  const L = level(st, id);
  const k = globalMult(st, false);
  if (b.kind === 'prod') return (baseIncome(id, L + 1) - baseIncome(id, L)) * soonSeason(st, id) * k;
  if (b.kind === 'boost') {
    const base = PRODUCERS.reduce((a, p) => a + baseIncome(p, level(st, p)) * soonSeason(st, p), 0);
    return base * k * b.boost / (1 + b.boost * L);
  }
  if (id === 'stove') return baseIncome('greenhouse', level(st, 'greenhouse')) * 1.5 * k * (isWinter(st.month + 1) ? 1 : 0.25);
  if (id === 'omshanik') return baseIncome('apiary', level(st, 'apiary')) * k * (st.month % 12 >= 6 && st.month % 12 <= 9 ? 0.5 : 0.05);
  if (id === 'fence') return PRODUCERS.reduce((a, p) => a + baseIncome(p, level(st, p)), 0) * 0.02;
  return 0;
}
// средний сезонный множитель на ближайшие 3 месяца (так рассуждает живой игрок)
function soonSeason(st, id) { let k = 0; for (let d = 0; d < 3; d++) k += BUILDINGS[id].season((st.month + d) % 12, st); return k / 3; }
function avgSeasonOf(st, id) { let k = 0; for (let m = 0; m < 12; m++) k += BUILDINGS[id].season(m, st); return k / 12; }

export function repay(st) {
  if (!st.debt) return 'долгов нет';
  if (st.money < st.debt) return 'не хватает ' + fmt(st.debt - st.money);
  st.money -= st.debt;
  addHistory(st, { m: st.month, t: `Вернули кредит ${fmt(st.debt)}.` });
  st.debt = 0;
  return null;
}

/* ---------- Сезонность построек ---------- */
// Через сколько месяцев постройка начнёт приносить (0 — уже сезон) и примерное время ожидания
export function seasonWait(st, id) {
  const b = BUILDINGS[id];
  if (b.kind !== 'prod') return null;
  for (let k = 0; k < 12; k++) {
    if (b.season((st.month + k) % 12, st) > 0) {
      return { months: k, month: (st.month + k) % 12, minutes: k ? Math.ceil(monthLeft(st) / 60000 + (k - 1) * MONTH_MS / 60000) : 0 };
    }
  }
  return { months: 12, month: st.month % 12, minutes: Infinity };
}

/* ---------- Капитал, цели, рейтинг ---------- */
export const capital = (st) => Math.round(st.money - st.debt + buildingsValue(st));
// В рейтинг идёт капитал БЕЗ монет, купленных за Telegram Stars
export const ratingCapital = (st) => Math.max(0, capital(st) - (st.paid?.coins || 0));
export const goal = (st) => goalOf(st.tier);
export const progress = (st) => Math.max(0, Math.min(1, ratingCapital(st) / goal(st)));

export function grantAch(st, id) {
  if (st.ach[id]) return false;
  st.ach[id] = { at: Date.now(), capital: capital(st), month: st.month };
  st.achNew.push(id);
  return true;
}
export function checkGoals(st) {
  let reached = false;
  while (ratingCapital(st) >= goalOf(st.tier)) {
    grantAch(st, goalAchievement(st.tier));
    addHistory(st, { m: st.month, t: `Цель достигнута: ${tierName(st.tier)}! Открыты новые постройки.` });
    st.tier++;
    reached = true;
  }
  return reached;
}

/* ---------- Месяцы и события ---------- */
export const monthLeft = (st) => Math.max(0, MONTH_MS - st.monthMs);
export const monthReady = (st) => st.phase === 'play' && monthLeft(st) <= 0;
// пропуск ожидания: половина того, что ферма заработала бы за оставшееся время (минимум 500 ₽)
export const skipCost = (st) => nice(Math.max(500, totalRate(st) * 0.5 * monthLeft(st) / 60000));
export function skipMonth(st) {
  if (st.phase !== 'play' || monthReady(st)) return 'месяц уже прошёл';
  const c = skipCost(st);
  if (st.money < c) return 'не хватает ' + fmt(c - st.money);
  st.money -= c;
  st.monthMs = MONTH_MS;
  addHistory(st, { m: st.month, t: `Поторопили время за ${fmt(c)}.` });
  return null;
}

function helpers(st, log) {
  const r = rng(st.seed ^ (st.month * 2654435761));
  const S = monthScale(st);
  const addMod = (bucket, key, v) => { bucket[key] = (bucket[key] ?? 1) * v; };
  return {
    fmt, S,
    amt: (k) => nice(S * k),
    pay: (sum, label) => { st.money -= sum; log.push({ label, amount: -sum }); },
    gain: (sum, label) => { st.money += sum; log.push({ label, amount: sum }); },
    mod: (key, v) => addMod(st.mods, key, v),
    modAll: (v) => PRODUCERS.forEach(id => addMod(st.mods, id, v)),
    next: (key, v) => addMod(st.nextMods, key, v),
    chance: (p) => r() < p,
    price: (id) => priceOf(st, id),
    lv: (id) => level(st, id),
    ach: (id) => grantAch(st, id),
    capital: () => capital(st),
    buildingsValue: () => buildingsValue(st),
  };
}
export const resolveText = (v, st) => (typeof v === 'function' ? v(st, helpers(st, [])) : v);

const eventKey = (e, st) => (e.once ? e.id : `${e.id}@${yearOf(st.month + 1)}`);
export function pickEvent(st) {
  const r = rng(st.seed + (st.month + 1) * 7919);
  const nm = (st.month + 1) % 12;
  const pool = EVENTS.filter(e => e.months.includes(nm) && (e.repeat || !st.usedEvents.includes(eventKey(e, st))) && (!e.cond || e.cond(st)));
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let x = r() * total;
  for (const e of pool) { if ((x -= e.weight) <= 0) return e; }
  return pool[pool.length - 1] || EVENT_BY_ID.quiet;
}

// «Следующий месяц»: только когда месяц прошёл. Выпадает событие нового месяца.
export function endMonth(st) {
  if (!monthReady(st)) return null;
  const e = pickEvent(st);
  st.event = e.id;
  st.phase = 'event';
  return e;
}
export function optionState(st, e, i) {
  const o = e.options[i];
  return { why: o.can ? o.can(st, helpers(st, [])) : null, desc: resolveText(o.desc, st), label: o.label, icon: o.icon };
}
export const allBlocked = (st, e) => e.options.every((o) => o.can && o.can(st, helpers(st, [])));
const PASS = { label: 'Не по карману', effect: () => 'Денег не хватило ни на один вариант.' };
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

export function choose(st, i) {
  if (st.phase !== 'event') return null;
  const e = EVENT_BY_ID[st.event];
  const o = i === -1 && allBlocked(st, e) ? PASS : e.options[i];
  if (!o || (o.can && o.can(st, helpers(st, [])))) return null;
  const report = closeMonth(st);              // итоги прошедшего месяца
  const log = [];
  const text = o.effect(st, helpers(st, log)); // событие действует на новый месяц
  st.usedEvents.push(eventKey(e, st));
  // помним события только этого года (и разовые) — иначе список растёт бесконечно
  const y = yearOf(st.month);
  st.usedEvents = st.usedEvents.filter(k => !k.includes('@') || +k.split('@')[1] >= y);
  addHistory(st, { m: st.month, t: `${stripTags(e.title)}: ${o.label.toLowerCase()}. ${text}` });
  report.event = { title: stripTags(e.title), choice: o.label, text, log };
  report.after = Math.round(st.money);
  report.capital = capital(st);
  st.event = null;
  st.phase = 'play';
  checkGoals(st);
  st.report = report;
  return report;
}

function closeMonth(st) {
  const m = st.month;
  const income = Math.round(st.monthIncome);
  const costs = [];
  if (income > 0) costs.push({ label: 'Корм, свет и налоги', amount: Math.round(income * UPKEEP_SHARE) });
  if (st.debt) costs.push({ label: 'Проценты по кредиту', amount: Math.round(st.debt * LOAN_RATE) });
  if (st.flags.helper) costs.push({ label: 'Зарплата Ване', amount: nice(monthScale(st) * 0.08) });
  const notes = [];
  if (st.flags.contract) {
    const c = st.flags.contract;
    if (income < c.min) { costs.push({ label: 'Штраф кафе', amount: c.fine }); notes.push('Кафе недовольно: выручка меньше нормы.'); }
    if (--c.left <= 0) { delete st.flags.contract; notes.push('Контракт с кафе закончился.'); }
  }
  if (st.flags.helper && --st.flags.helper.left <= 0) { delete st.flags.helper; notes.push('Ваня уехал учиться. Собирать — снова самим!'); }
  const expense = costs.reduce((a, c) => a + c.amount, 0);
  st.money -= expense;
  if (m % 12 === 9 && level(st, 'apiary') > 1 && !level(st, 'omshanik')) {
    notes.push('Без омшаника пчёлы замёрзли — пасека откатилась на 1-й уровень.');
    addHistory(st, { m, t: 'Пасека замёрзла без омшаника.' });
    st.lv.apiary = 1;
  }
  st.ledger.push({ m, income, expense, money: Math.round(st.money) });
  if (st.ledger.length > 36) st.ledger.shift();
  const report = { month: m, name: monthOf(m).name, year: yearOf(m), income, costs, expense, notes };
  st.month++;
  st.monthMs = 0;
  st.monthIncome = 0;
  st.mods = st.nextMods; st.nextMods = {};
  if (st.month === 12) grantAch(st, 'alive');
  return report;
}

/* ---------- Задания ---------- */
export function tasks(st) {
  const L = (id) => level(st, id);
  return [
    ['Убрать ферму деда', st.phase !== 'clean'],
    ['Построить курятник', L('coop') > 0],
    ['Поставить прилавок у дороги', L('stall') > 0],
    ['Защитить кур забором', L('fence') > 0],
    ['Собрать теплицу из окон деда', L('greenhouse') > 0],
    ['Завести пасеку', L('apiary') > 0],
    ['Омшаник до декабря', L('omshanik') > 0],
    ['Курятник 5-го уровня', L('coop') >= 5],
    ['Купить корову', L('cow') > 0],
    ['Капитал 100 000 ₽', capital(st) >= 100000],
    [`Цель: ${tierName(st.tier)}`, false],
  ];
}

export function migrate(save) {
  if (!save || typeof save !== 'object' || save.v !== SCHEMA_VERSION) return null;
  return save;
}
