// Логика игры v2 — чистые функции над объектом состояния. Без DOM (работает и в Node для симуляции).
// Время — реальное: продукция копится по минутам, 1 игровой месяц = MONTH_MS.
import {
  SCHEMA_VERSION, START_MONEY, SCRAP_BONUS, MONTH_MS, OFFLINE_CAP_MS, STORAGE_MIN, LEVEL_COST_MULT, UPKEEP_SHARE,
  LOAN_RATE, INC_GROWTH, PRODUCTS, CLIENTS, ORDER_SLOTS, ORDER_REFILL_MIN, ORDER_DECLINE_MIN, xpForLevel, XP, HOUSE_STAGES, HOUSE_BONUS, FRESH_MIN, FRESH_BONUS, DAILY_REWARD, LOGIN_REWARD, LOGIN_DAYS, BUILDINGS, PRODUCERS, TRASH, FIELD_WEEDS, monthOf, yearOf, isWinter, goalOf, goalAchievement, maxLevel,
  FISH_SPOTS, FISH, FISH_BITE_MS, FISH_REWARD_K, FAIR, LATE_MIN, LOC_INC, PRICE_MIN, CAPITAL_PAID, SETTLE, upkeepShare, DYN, LOCATIONS, CATCHUP_AFTER_MS, GOODS, SUPPLY_MIN, TRUST, PREMIUM_CLIENTS, SMALL_CLIENT, ORDER_DUE, HAPPY_HOUR, NEWBIE_MONTHS, NEWBIE_BONUS, BOOSTERS, goalLevel, DECOR, DECOR_BONUS, WORKER_UP_MULT, WORKER_MAX, DOG_PET_MS, DOG_BOOST_MS, DOG_BONUS, WORKERS, WORKER_ORDER,
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
    trust: TRUST.start, orderStreak: 0,      // доверие покупателей 🤝 и серия заказов без отказов
    storyFlags: {}, storyQueue: [],          // сюжет: решения в событиях и продолжения ({id, at: месяц})
    goods: { equip: {}, supply: {} },       // товары фермы: оборудование (навсегда) и расходники (до времени)
    perm: {}, effects: [],                   // постоянные множители ({sales: 1.15}) и временные ({key, k, until, icon, label})
    decisions: [],                           // лента решений для «Тетрадь → История»
    monthIncome: 0, history: [{ m: 0, t: 'Получили в наследство ферму деда и 10 000 ₽.' }],
    ledger: [], taps: 0, offline: 0,
    daily: null, login: null, tzOff: 0,
    xp: 0, xpV2: 1, lvlSeen: 1,                       // опыт фермы (⭐) и последний показанный уровень
    orders: [], big: null,                   // доска заказов: 3 обычных + большой заказ дня
    house: 0,                                // сколько этапов ремонта дома деда сделано (0…5)
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
// доход на уровне L: inc + inc·g + inc·g² + … — каждый уровень прибавляет больше предыдущего
// масштаб поздней локации (1 — Ферма деда, Река и луг и старые сохранения)
export const locK = (st, id) => (st?.locK?.[BUILDINGS[id]?.loc]) || 1;
// «живые» постройки (Река и луг и дальше): доход — сумма прибавок от покупок (st.binc), цена — минуты текущего дохода
export const isDyn = (id) => (BUILDINGS[id]?.tier || 0) >= 1 && BUILDINGS[id]?.kind !== 'once';
export const dynPayback = (st) => DYN.payback[Math.min(st.tier || 0, DYN.payback.length - 1)];
const classicInc = (st, id, L) => baseIncome(id, L) * (st?.locKi?.[BUILDINGS[id]?.loc] || locK(st, id));
// доход постройки на уровне L: текущий — из st.binc (у старых сохранений — по прежней формуле), следующий — + цена/окупаемость
export function incOf(st, id, L) {
  if (!st || !isDyn(id) || BUILDINGS[id].kind !== 'prod') return classicInc(st, id, L);
  const cur = level(st, id), now = st.binc?.[id] ?? classicInc(st, id, cur);
  if (L <= cur) return L === cur ? now : now * L / Math.max(1, cur);
  return now + (L - cur) * dynPrice(st, id) / (dynPayback(st) * globalMult(st, false));
}
export const baseIncome = (id, L) => { const g = BUILDINGS[id].incGrowth || INC_GROWTH; return L > 0 ? BUILDINGS[id].inc * (g ** L - 1) / (g - 1) : 0; };
// окупаемость следующего уровня (минуты, в сезон)
export function paybackMin(st, id) {
  const L = level(st, id), d = (incOf(st, id, L + 1) - incOf(st, id, L)) * globalMult(st, false);
  return d > 0 ? priceOf(st, id) / d : Infinity;
}

export function globalMult(st, withMods = true) {
  let k = 1;
  for (const id of ['stall', 'brand']) k *= 1 + (BUILDINGS[id].boost || 0) * level(st, id);
  k *= 1 + HOUSE_BONUS * (st.house || 0);  // ремонт дома деда: +3% за этап
  if (hired(st, 'seller')) k *= 1 + WORKERS.seller.all * wLv(st, 'seller'); // продавец на прилавке (+10% за уровень)
  k *= 1 + DECOR_BONUS * decorCount(st);    // украшения фермы
  if (st.paid?.samovar) k *= 1.03;          // «Дедов самовар» (за звёзды)
  if ((st.month || 0) < NEWBIE_MONTHS) k *= NEWBIE_BONUS; // первые 3 месяца — доход ×1.5
  if (withMods) {
    k *= effMod(st, 'sales') * trustMult(st);  // события и решения + доверие покупателей
    if (st.dog?.boostUntil > (st.lastTick || 0)) k *= 1 + DOG_BONUS; // погладили щенка: +10% на 30 мин
    if (isHappyHour(st.lastTick || Date.now())) k *= 1 + HAPPY_HOUR.bonus; // счастливый час 18–19 МСК
    if (st.flags.contract) k *= 1.3;
  }
  return k;
}
export const seasonMult = (st, id, m = st.month) => {
  const k = BUILDINGS[id].season(((m % 12) + 12) % 12, st);
  if (id === 'coop' && hired(st, 'henwife')) return Math.max(k, 1); // птичница: зимой куры несутся как летом
  return k;
};
// бонус работников к постройке (птичница, пасечник, доярка)
export const workerMult = (st, id) => { let k = 1; for (const w of WORKER_ORDER) if (hired(st, w) && WORKERS[w].bonus?.[id]) k *= 1 + WORKERS[w].bonus[id] * (1 + 0.6 * (wLv(st, w) - 1)); return k; };
// текущая скорость, ₽/мин
export const rate = (st, id) => incOf(st, id, level(st, id)) * seasonMult(st, id) * workerMult(st, id) * boostMult(st, id) * effMod(st, id) * globalMult(st);

/* ---------- Эффекты решений и доверие ---------- */
// множитель по ключу (sales или id постройки): на этот месяц (mods) × навсегда (perm) × временные (effects, до месяца until)
export function effMod(st, key) {
  let k = (st.mods?.[key] ?? 1) * (st.perm?.[key] ?? 1);
  for (const e of st.effects || []) if (e.key === key && e.until > st.month) k *= e.k;
  // товары фермы: оборудование — навсегда, расходники — пока не кончились
  const g = st.goods;
  if (g) {
    const now = st.lastTick || Date.now();
    for (const id in g.equip || {}) if (GOODS[id]?.keys.includes(key)) k *= GOODS[id].k;
    for (const id in g.supply || {}) if (g.supply[id] > now && GOODS[id]?.keys.includes(key)) k *= GOODS[id].k;
  }
  return k;
}

/* ---------- Товары фермы (за ₽ или за ⭐) ---------- */
export const goodPrice = (st, id) => nice(Math.max(500, perMin(st) * GOODS[id].mins));
export const supplyLeft = (st, id, now = st.lastTick || Date.now()) => Math.max(0, (st.goods?.supply?.[id] || 0) - now);
export const hasEquip = (st, id) => !!st.goods?.equip?.[id] || (id === 'sprinklers' && !!st.storyFlags?.sprinklers);
// почему нельзя купить (null — можно)
export function goodBlocked(st, id) {
  const g = GOODS[id];
  if (!g) return 'нет такого товара';
  if (st.phase === 'clean') return 'сначала уборка';
  if (g.kind === 'equip' && hasEquip(st, id)) return 'уже стоит на ферме';
  if (g.needs.length && !g.needs.some(b => level(st, b) > 0)) return `нужна постройка: ${g.needs.map(b => BUILDINGS[b].name.toLowerCase()).join(' или ')}`;
  return null;
}
// купить товар: pay = 'rub' (с проверкой денег) или 'stars' (уже оплачено звёздами)
export function buyGood(st, id, pay = 'rub', now = Date.now()) {
  const why = goodBlocked(st, id); if (why) return why;
  const g = GOODS[id], price = goodPrice(st, id);
  if (pay === 'rub') { if (st.money < price) return 'не хватает ' + fmt(price - st.money); st.money -= price; }
  st.goods ||= { equip: {}, supply: {} };
  if (g.kind === 'equip') {
    st.goods.equip[id] = now;
    if (id === 'sprinklers') st.storyFlags.sprinklers = true; // видно на огороде (как после события «Засуха»)
  } else st.goods.supply[id] = Math.max(now, st.goods.supply[id] || 0) + SUPPLY_MIN * 60000;
  addHistory(st, { m: st.month, t: `${g.e} ${g.name}${pay === 'rub' ? ` за ${fmt(price)}` : ' за ⭐'}: ${g.d.toLowerCase()}.` });
  return null;
}
// действующие временные эффекты (для панели): сколько месяцев осталось, включая текущий
export const activeEffects = (st) => (st.effects || []).filter(e => e.until > st.month).map(e => ({ ...e, months: e.until - st.month }));
// доверие 0…100 → цена продажи: 0 → −20%, 50 → как есть, 100 → +30%
export const trustOf = (st) => Math.round(st.trust ?? TRUST.start);
export function trustMult(st) { const t = st.trust ?? TRUST.start; return t < 50 ? 0.8 + 0.2 * t / 50 : 1 + 0.3 * (t - 50) / 50; }
export function addTrust(st, n) {
  const before = st.trust ?? TRUST.start;
  st.trust = Math.max(0, Math.min(100, before + n));
  return st.trust - before;
}
// изменение доверия с дневным пределом (свежий сбор / перестоявший урожай)
function trustDaily(st, key, n, cap, now) {
  const day = dayKey(st, now);
  const t = st.trustDay && st.trustDay.day === day ? st.trustDay : (st.trustDay = { day });
  const used = t[key] || 0;
  const add = cap > 0 ? Math.min(n, cap - used) : Math.max(n, cap - used);
  if (cap > 0 ? add <= 0 : add >= 0) return 0;
  t[key] = used + add;
  return addTrust(st, add);
}

/* ---------- Счастливый час и бустеры ---------- */
const mskHour = (ms) => new Date(ms + 3 * 3600000).getUTCHours();
export const isHappyHour = (ms = Date.now()) => { const h = mskHour(ms); return h >= HAPPY_HOUR.from && h < HAPPY_HOUR.to; };
// сколько мс до конца (если идёт) или до начала (если нет) счастливого часа
export function happyHourInfo(ms = Date.now()) {
  const d = new Date(ms + 3 * 3600000);
  const dayStart = ms - (d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds());
  let start = dayStart + HAPPY_HOUR.from * 3600000, end = dayStart + HAPPY_HOUR.to * 3600000;
  if (ms >= end) { start += 86400000; end += 86400000; }
  return { on: ms >= start && ms < end, left: Math.max(0, end - ms), startsIn: Math.max(0, start - ms), day: Math.floor(start / 86400000) };
}
export const boostLeft = (st, kind, ms = st.lastTick || Date.now()) => Math.max(0, (st.boost?.[kind] || 0) - ms);
export function boostMult(st, id) {
  const ms = st.lastTick || Date.now();
  let k = 1;
  if (boostLeft(st, 'double', ms) > 0) k *= 2;
  if (boostLeft(st, 'grow', ms) > 0 && BOOSTERS.grow.ids.includes(id)) k *= 2;
  return k;
}
// включить бустер: 30 минут, если уже идёт — ещё +30 минут
export function activateBooster(st, kind, now = Date.now(), source = '') {
  const b = BOOSTERS[kind]; if (!b) return null;
  if (!st.boost) st.boost = {};
  st.boost[kind] = Math.max(now, st.boost[kind] || 0) + b.min * 60000;
  addHistory(st, { m: st.month, t: `${b.emoji} Бустер «${b.name}» на ${b.min} мин${source ? ' — ' + source : ''}.` });
  return st.boost[kind];
}
export const totalRate = (st) => PRODUCERS.reduce((a, id) => a + rate(st, id), 0);
// вместимость склада: 2 часа номинального производства
export const storageCap = (st, id) => incOf(st, id, level(st, id)) * globalMult(st, false) * 1.5 * STORAGE_MIN;
// «масштаб» экономики для событий: доход за месяц без сезонов
// доход фермы в минуту для наград и цен: текущий, но не меньше половины номинального (зимой не обесценивается)
export const perMin = (st) => Math.max(totalRate(st), PRODUCERS.reduce((a, id) => a + incOf(st, id, level(st, id)), 0) * globalMult(st, false) * 0.5, 30);
export const monthScale = (st) => Math.max(15000, PRODUCERS.reduce((a, id) => a + incOf(st, id, level(st, id)), 0) * globalMult(st, false) * MONTH_MS / 60000);

/* ---------- Реальное время ---------- */
export function tick(st, now = Date.now()) {
  const real = Math.max(0, now - st.lastTick);
  st.lastTick = now;
  if (st.phase === 'clean') return { changed: false, offline: 0 };
  st.playMs = (st.playMs || 0) + Math.min(real, 60000); // время в игре (офлайн не считается) — для соседа
  logCapital(st, now, real);
  markCapital(st, now);
  const dt = Math.min(real, OFFLINE_CAP_MS);
  st.monthMs = Math.min(MONTH_MS, st.monthMs + real);
  newDay(st, now);
  refillOrders(st, now);
  accrueOrders(st, dt);
  let changed = false;
  for (const id of PRODUCERS) {
    if (!level(st, id)) continue;
    const before = Math.floor(st.acc[id] || 0);
    const add = rate(st, id) * dt / 60000;
    st.acc[id] = Math.min(storageCap(st, id), (st.acc[id] || 0) + add);
    if (Math.floor(st.acc[id]) !== before) changed = true;
  }
  const auto = workersTick(st, now);
  if (auto.collected) changed = true;
  checkGoals(st);
  return { changed, offline: real > 60000 ? dt : 0, auto };
}
export const ready = (st, id) => Math.floor(st.acc[id] || 0);
export const unitsReady = (st, id) => Math.floor((st.acc[id] || 0) / BUILDINGS[id].price);

function gain(st, sum) { st.money += sum; st.monthIncome += sum; }

// «Свежий сбор»: то, что созрело за последние 5 минут, идёт с бонусом +20%.
// Кто собирает часто — получает бонус почти со всего; кто заходит раз в 2 часа — ничего не теряет (склад 2 ч).
export let lastFresh = 0;
export let lastReserved = { units: 0, value: 0 };
export const freshShare = (st, id) => { const a = st.acc[id] || 0; return a > 0 ? Math.min(1, rate(st, id) * FRESH_MIN / a) : 0; };
export let lastXp = 0; // опыт за последний сбор (для всплывающего «+N ⭐»)
export function collect(st, id, auto = false) {
  const amt = ready(st, id);
  lastFresh = 0; lastReserved = { units: 0, value: 0 };
  if (amt <= 0 || st.phase === 'clean' || unitsReady(st, id) < 1) return 0; // собирается только созревшее (пузырь над постройкой)
  // доверие: собрал до переполнения пузыря — урожай свежий; пузырь был полон — урожай перестоял
  const now = st.lastTick || Date.now();
  if ((st.acc[id] || 0) >= storageCap(st, id) * 0.995) trustDaily(st, 'spoil', TRUST.spoil, TRUST.spoilDay, now);
  else if (!auto) trustDaily(st, 'fresh', TRUST.fresh, TRUST.freshDay, now);
  const fresh = Math.floor(Math.min(amt, rate(st, id) * FRESH_MIN) * FRESH_BONUS);
  st.acc[id] -= amt;
  // часть урожая, нужная для заказов на доске, откладывается в амбар — остальное продаётся на прилавке
  const reserved = reserveForOrders(st, BUILDINGS[id].product, Math.floor((amt + fresh) / productPrice(BUILDINGS[id].product)));
  lastReserved = reserved;
  gain(st, amt + fresh - reserved.value);
  lastFresh = fresh;
  lastXp = 0;
  if (!auto) { st.taps++; dailyProgress(st, 'collect', amt + fresh); if (st.taps % XP.collectEvery === 0) lastXp = addXp(st, XP.collect); }
  else if (st.daily) st.daily.sold += amt + fresh;
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
    { id: 'fish', title: 'Поймай 2 рыбы', have: Math.min(d.fish || 0, 2), need: 2 },
  ].map((t, i) => ({ ...t, done: t.have >= t.need, claimed: d.claimed[i], reward: d.reward }));
}
function newDay(st, now) {
  const day = dayKey(st, now);
  if (st.daily?.day === day) return;
  const S = monthScale(st);
  st.daily = { day, collects: 0, builds: 0, sold: 0, sellTarget: nice(S * 0.6), reward: nice(S * DAILY_REWARD), fish: 0, claimed: [false, false, false, false] };
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
  addXp(st, XP.daily);
  if (i === 1) activateBooster(st, 'grow', st.lastTick || Date.now(), 'за задание дня');
  if (i === 3) activateBooster(st, 'double', st.lastTick || Date.now(), 'за задание дня');
  addHistory(st, { m: st.month, t: `Задание дня «${t.title}»: +${fmt(t.reward)}.` });
  checkGoals(st);
  return t.reward;
}
export function claimLogin(st) {
  const p = st.login?.pending || 0;
  if (!p) return 0;
  st.login.pending = 0;
  st.money += p;
  addXp(st, XP.login);
  addHistory(st, { m: st.month, t: `Бонус за вход, день ${st.login.streak}: +${fmt(p)}.` });
  checkGoals(st);
  return p;
}

/* ---------- Ремонт дома деда ---------- */
export const nextRepair = (st) => HOUSE_STAGES[st.house || 0] || null;
export function canRepair(st) {
  const n = nextRepair(st);
  if (!n) return 'дом полностью отремонтирован';
  if (st.phase === 'clean') return 'сначала уборка';
  if (st.money < n.cost) return 'не хватает ' + fmt(n.cost - st.money);
  return null;
}
export function repairHouse(st) {
  const why = canRepair(st);
  if (why) return why;
  const n = nextRepair(st);
  st.money -= n.cost;
  st.house = (st.house || 0) + 1;
  addXp(st, XP.repair);
  addHistory(st, { m: st.month, t: `Дом деда: ${n.name.toLowerCase()} — готово (${fmt(n.cost)}). +3% ко всему доходу.` });
  checkGoals(st);
  return null;
}
// выгода ремонта для «самого выгодного» (₽/мин на рубль) — для симуляции
export function repairValue(st) {
  const n = nextRepair(st); if (!n) return 0;
  const base = PRODUCERS.reduce((a, p) => a + incOf(st, p, level(st, p)) * soonSeason(st, p), 0) * globalMult(st, false);
  return base * HOUSE_BONUS / (1 + HOUSE_BONUS * (st.house || 0)) / n.cost;
}

/* ---------- Уровень фермы (⭐ опыт) ---------- */
export function farmLevel(st) { let n = 1; while ((st.xp || 0) >= xpForLevel(n + 1)) n++; return n; }
export const levelProgress = (st) => { const n = farmLevel(st), a = xpForLevel(n), b = xpForLevel(n + 1); return { level: n, have: (st.xp || 0) - a, need: b - a }; };
// «догоняющий» бонус: капитал для следующей цели уже есть, а уровня фермы не хватает — опыт ×2
export const catchUp = (st) => st.phase !== 'clean' && st.tier !== undefined && ratingCapital(st) >= goalOf(st.tier) && farmLevel(st) < goalLevel(st.tier)
  && st.capAt?.tier === st.tier && (st.lastTick || Date.now()) - st.capAt.at >= CATCHUP_AFTER_MS;
// когда капитал для текущей цели набран впервые (для «догоняющего» бонуса)
function markCapital(st, now) { if ((!st.capAt || st.capAt.tier !== st.tier) && ratingCapital(st) >= goalOf(st.tier)) st.capAt = { tier: st.tier, at: now }; }
export function addXp(st, n) {
  const add = Math.round(n * (catchUp(st) ? 2 : 1));
  st.xp = (st.xp || 0) + add;
  if (st.tier !== undefined && st.ach) checkGoals(st); // новый уровень может открыть цель
  return add;
}
// сколько ⭐ осталось до уровня, нужного для следующей цели
export const xpToGoal = (st) => Math.max(0, xpForLevel(goalLevel(st.tier)) - (st.xp || 0));

/* ---------- Ярмарка в райцентре: деньги → опыт (раз в 2 часа) ---------- */
export const fairPrice = (st) => nice(Math.max(2000, perMin(st) * FAIR.mins));
export const fairXp = (st) => { const L = farmLevel(st); return Math.max(20, Math.round((xpForLevel(L + 1) - xpForLevel(L)) * FAIR.share)); };
export const fairLeft = (st, now = Date.now()) => Math.max(0, (st.fairAt || 0) + FAIR.everyMs - now);
export function buyFair(st, now = Date.now()) {
  if (st.phase === 'clean') return 'сначала уборка';
  if ((st.tier || 0) < 1) return 'ярмарка откроется после первого миллиона';
  const w = fairLeft(st, now); if (w > 0) return `следующая ярмарка через ${Math.ceil(w / 60000)} мин`;
  const c = fairPrice(st); if (st.money < c) return 'не хватает ' + fmt(c - st.money);
  st.money -= c; st.fairAt = now;
  const got = addXp(st, fairXp(st));
  addHistory(st, { m: st.month, t: `🎪 Ярмарка в райцентре: −${fmt(c)}, +${got} ⭐.` });
  return null;
}
// постройки, открытые на уровне фермы n
export const unlockedAt = (n) => Object.keys(BUILDINGS).filter(id => BUILDINGS[id].lvl === n);

/* ---------- Доска заказов ---------- */
export const productPrice = (p) => PRODUCTS[p]?.price || 1;
// рыба своя, не с постройки: одна рыбина стоит ~минуту дохода фермы (но не дешевле базовой цены)
export const itemPrice = (st, p) => (p === 'fish' ? Math.max(PRODUCTS.fish.price, Math.round(perMin(st) * 8)) : productPrice(p));

/* ---------- Работники ---------- */
export const hired = (st, w) => !!st.workers?.[w];
export const wLv = (st, w) => (st.workers?.[w] ? st.workers[w].lv || 1 : 0);
export const helperEvery = (st) => [5, 5, 3, 2][wLv(st, 'helper')] || 5; // минут между сборами помощника
export const workerUpPrice = (st, w) => nice(hirePrice(st, w) * WORKER_UP_MULT ** wLv(st, w));
export function canUpWorker(st, w) {
  if (!hired(st, w)) return 'сначала наймите';
  if (wLv(st, w) >= WORKER_MAX) return 'максимальный уровень';
  if (st.money < workerUpPrice(st, w)) return 'не хватает ' + fmt(workerUpPrice(st, w) - st.money);
  return null;
}
export function upWorker(st, w) {
  const why = canUpWorker(st, w); if (why) return why;
  const p = workerUpPrice(st, w);
  st.money -= p; st.workers[w].lv = wLv(st, w) + 1;
  st.workers[w].spent = (st.workers[w].spent || 0) + p;
  addHistory(st, { m: st.month, t: `👷 ${WORKERS[w].name}: уровень ${st.workers[w].lv} (${fmt(p)}).` });
  return null;
}
/* ---------- Покупки за звёзды (выдаёт сервер после successful_payment) ---------- */
// p = { charge_id, item, amount }. Каждая покупка применяется один раз: id запоминаются в сохранении.
export function applyPurchase(st, p, now = Date.now()) {
  if (!st.paid) st.paid = {};
  const got = st.paid.applied || (st.paid.applied = []);
  if (got.includes(p.charge_id)) return null;
  got.push(p.charge_id); if (got.length > 300) got.splice(0, got.length - 300);
  let text = '';
  switch (p.item) {
    case 'skip': fastForward(st); text = 'Месяц ускорен — жми «Следующий месяц»!'; break;
    case 'cast': st.fishAt = {}; text = 'Удочка готова — можно рыбачить прямо сейчас!'; break;
    case 'helper7': {
      if (!st.workers) st.workers = {};
      const cur = st.workers.helper;
      if (cur && !cur.freeUntil) { gain(st, hirePrice(st, 'helper')); text = 'Ваня уже работает — вернули деньгами: ' + fmt(hirePrice(st, 'helper')); break; }
      const from = Math.max(now, cur?.freeUntil || 0);
      st.workers.helper = { at: now, last: cur?.last || 0, lv: cur?.lv || 1, spent: 0, freeUntil: from + 7 * 86400000 };
      text = 'Помощник Ваня на 7 дней — сам собирает урожай!'; break;
    }
    case 'samovar': st.paid.samovar = true; text = 'Дедов самовар на ферме: +3% ко всему доходу!'; break;
    case 'g_fert': case 'g_feed': case 'g_beefeed': case 'g_vitamins': case 'g_kit':
    case 'g_sprinklers': case 'g_incubator': case 'g_ghheat': case 'g_beebed': case 'g_minitractor': {
      const gid = p.item.slice(2), err = buyGood(st, gid, 'stars', now);
      text = err ? `${GOODS[gid].name}: ${err} — звёзды не пропали, напиши /paysupport` : `${GOODS[gid].e} ${GOODS[gid].name} — готово!`;
      break;
    }
    case 'boost_grow': activateBooster(st, 'grow', now, 'за звёзды'); text = '⚡ Быстрый рост: огород и теплица ×2 на 30 минут!'; break;
    case 'boost_double': activateBooster(st, 'double', now, 'за звёзды'); text = '🎁 ×2 урожай на 30 минут!'; break;
    case 'patron': st.paid.patron = true; grantAch(st, 'patron'); text = 'Спасибо, что поддержали автора! Значок «Меценат» — в рейтинге.'; break;
    case 'bag': case 'wallet': case 'chest': {
      const a = Math.max(0, Math.min(1e16, Math.round(+p.amount || 0)));
      st.money += a; text = `+${fmt(a)} на счёт фермы!`; break;
    }
    default: return null;
  }
  addHistory(st, { m: st.month, t: `⭐ Покупка: ${text}` });
  checkGoals(st);
  return text;
}
// сколько денег даст пакет: N минут дохода фермы, но не меньше минимума
export const packAmount = (st, minutes, min) => nice(Math.max(min, perMin(st) * minutes));

/* ---------- Украшения фермы ---------- */
export const hasDecor = (st, id) => !!st.decor?.[id];
// цена украшения — от текущего дохода: прибавка +2% окупается за 1–2 ч (cost — нижняя граница)
export function decorPrice(st, id) {
  const i = DECOR.findIndex(d => d.id === id), d = DECOR[i];
  const first = DECOR.findIndex(x => x.tier === d.tier);
  return nice(Math.max(d.cost, perMin(st) * DECOR_BONUS * 60 * (1 + 0.8 * (i - first))));
}
export const decorCount = (st) => Object.keys(st.decor || {}).length;
export function canDecor(st, id) {
  const d = DECOR.find(x => x.id === id);
  if (!d) return 'нет такого';
  if (hasDecor(st, id)) return 'уже стоит';
  if (st.phase === 'clean') return 'сначала уборка';
  if (d.tier > st.tier) return `откроется после цели ${tierName(d.tier - 1)}`;
  if (st.money < decorPrice(st, id)) return 'не хватает ' + fmt(decorPrice(st, id) - st.money);
  return null;
}
export function buyDecor(st, id) {
  const why = canDecor(st, id); if (why) return why;
  const d = DECOR.find(x => x.id === id);
  const price = decorPrice(st, id);
  st.money -= price;
  if (!st.decor) st.decor = {};
  st.decor[id] = price;                     // помним цену — она в капитале фермы
  addHistory(st, { m: st.month, t: `🌼 Украшение фермы: ${d.name} (${fmt(price)}). +2% к доходу.` });
  checkGoals(st);
  return null;
}
export const workersAt = (n) => WORKER_ORDER.filter(w => WORKERS[w].lvl === n).map(w => ({ id: w, ...WORKERS[w] }));
// цена найма фиксируется, когда работник открылся: hireMin минут дохода фермы на тот момент
export function hirePrice(st, w) {
  if (!st.wprice) st.wprice = {};
  if (!st.wprice[w]) st.wprice[w] = nice(Math.max(1000, perMin(st) * WORKERS[w].hireMin));
  return st.wprice[w];
}
// зарплата: доля собранного за месяц (не меньше 3 минут дохода — чтобы зимой не работали бесплатно)
const wageFloor = (st, w) => perMin(st) * (MONTH_MS / 60000) * WORKERS[w].wage * 0.5; // зимой собрано мало — платим хотя бы половину обычной
export const wageOf = (st, w, income = st.monthIncome) => nice(Math.max(WORKERS[w].wage * income, wageFloor(st, w)));
export const wageEstimate = (st, w) => nice(Math.max(WORKERS[w].wage * perMin(st) * MONTH_MS / 60000, wageFloor(st, w)));
export function canHire(st, w) {
  const d = WORKERS[w];
  if (!d) return 'нет такого работника';
  if (st.phase === 'clean') return 'сначала уборка';
  if (hired(st, w) && !st.workers[w].freeUntil) return 'уже работает'; // Ваню «по звёздам» можно нанять насовсем
  if (farmLevel(st) < d.lvl) return `нужен уровень фермы ${d.lvl}`;
  if (st.money < hirePrice(st, w)) return 'не хватает ' + fmt(hirePrice(st, w) - st.money);
  return null;
}
export function hire(st, w, now = Date.now()) {
  const why = canHire(st, w); if (why) return why;
  const p = hirePrice(st, w);
  st.money -= p;
  if (!st.workers) st.workers = {};
  st.workers[w] = { at: now, last: now, lv: 1, spent: p }; // наём — вложение в ферму, идёт в капитал
  addHistory(st, { m: st.month, t: `👷 Наняли: ${WORKERS[w].name} (${fmt(p)}).` });
  return null;
}
export function fire(st, w) {
  if (!hired(st, w)) return 'не работает';
  delete st.workers[w];
  addHistory(st, { m: st.month, t: `👷 ${WORKERS[w].name} больше не работает на ферме.` });
  return null;
}
// автосбор помощника и доставка заказов водителем — каждый тик
export let lastAuto = { collected: 0, reserved: 0, delivered: [] };
function workersTick(st, now) {
  const out = { collected: 0, reserved: 0, delivered: [] };
  if (st.flags.helper) delete st.flags.helper; // старое событие «Ваня на каникулах» — теперь раздел «Работники»
  if (st.phase === 'clean') return (lastAuto = out);
  // открылись новые работники — фиксируем цену найма на этот момент
  const lvl = farmLevel(st);
  for (const w of WORKER_ORDER) if (WORKERS[w].lvl <= lvl) hirePrice(st, w);
  if (!st.workers) return (lastAuto = out);
  const h = st.workers.helper;
  if (h?.freeUntil && now > h.freeUntil) { // «Ваня на 7 дней» закончился
    delete st.workers.helper;
    addHistory(st, { m: st.month, t: '👷 Неделя Вани закончилась. Нанять насовсем — в «Работниках».' });
    out.helperGone = true;
  } else if (h && now - (h.last || 0) >= helperEvery(st) * 60000) {
    h.last = now;
    for (const id of PRODUCERS) {
      if (!level(st, id) || ready(st, id) <= 0) continue;
      out.collected += collect(st, id, true);
      out.reserved += lastReserved.units;
    }
  }
  if (st.workers.driver) {
    (st.orders || []).forEach((o, i) => { if (orderDone(o)) { const r = deliverOrder(st, i, now); if (r) out.delivered.push(r); } });
    if (wLv(st, 'driver') >= 3 && st.big && !st.big.done && orderDone(st.big)) { const r = deliverOrder(st, 'big', now); if (r) out.delivered.push(r); }
  }
  return (lastAuto = out);
}

/* ---------- Рыбалка, щенок, сосед ---------- */
// --- Рыбалка ---
export const spotOpen = (st, spot) => (st.tier || 0) >= FISH_SPOTS[spot].tier && st.phase !== 'clean';
// сколько ждать до следующего заброса (мс), 0 — можно рыбачить
export const fishWait = (st, spot, now = Date.now()) => Math.max(0, (st.fishAt?.[spot] || 0) + FISH_SPOTS[spot].cd * 60000 - now);
export const biteWindow = (st) => Math.round(FISH_BITE_MS * (1 + 0.25 * level(st, 'rod')));
export const fishValue = (st, f, spot) => nice(perMin(st) * f.min * FISH_REWARD_K * FISH_SPOTS[spot].k * (st.storyFlags?.riverDirty ? 0.6 : 1)); // река помутнела — рыба мельче
// закинуть удочку: попытка тратится сразу (сорвалась — ждать снова)
export function castRod(st, spot, now = Date.now()) {
  if (!spotOpen(st, spot)) return spot === 'river' ? 'пруд — в локации «Река и луг» (после 1 млн)' : 'сначала уборка';
  const w = fishWait(st, spot, now);
  if (w > 0) return `клюёт через ${Math.ceil(w / 60000)} мин`;
  if (!st.fishAt) st.fishAt = {};
  st.fishAt[spot] = now;
  return null;
}
// что клюнуло: удочка повышает шанс редкого улова (щука, сом, сундук)
export function rollFish(st, rand = Math.random) {
  const k = 1 + 0.5 * level(st, 'rod');
  const pool = FISH.filter(f => !(f.chest && st.ach?.chest && rand() < 0.5)); // сундук после первого — реже
  const total = pool.reduce((a, f) => a + f.w * (f.rare ? k : 1), 0);
  let x = rand() * total;
  for (const f of pool) { x -= f.w * (f.rare ? k : 1); if (x <= 0) return f; }
  return pool[0];
}
// улов: продать сразу или отдать в заказ «Уха»
export const ukhaOrder = (st) => activeOrders(st).find(x => x.o.ukha && x.o.items.some(it => it.p === 'fish' && it.have < it.need));
export function landFish(st, f, spot, toOrder = false) {
  const value = fishValue(st, f, spot);
  if (st.daily) st.daily.fish = (st.daily.fish || 0) + (f.chest ? 0 : 1);
  if (f.chest) {
    gain(st, value);
    grantAch(st, 'chest');
    addXp(st, 30);
    addHistory(st, { m: st.month, t: `🎣 Выловили старый сундук деда! +${fmt(value)}.` });
    checkGoals(st);
    return { sold: value, order: false };
  }
  addXp(st, XP.fish + Math.round(f.min / 4));
  if (toOrder && ukhaOrder(st)) {
    reserveForOrders(st, 'fish', 1);
    addHistory(st, { m: st.month, t: `🎣 ${f.name} — в заказ «Уха».` });
    return { sold: 0, order: true };
  }
  gain(st, value);
  addHistory(st, { m: st.month, t: `🎣 Поймали: ${f.name.toLowerCase()} (+${fmt(value)}).` });
  checkGoals(st);
  return { sold: value, order: false };
}
export function missFish(st) { addHistory(st, { m: st.month, t: '🎣 Сорвалась!' }); }
export const hasDog = (st) => !!st.dog?.name;
export const needDogName = (st) => (st.house || 0) >= 3 && !st.dog?.name;
export function nameDog(st, name) { st.dog = { name: String(name).trim().slice(0, 16) || 'Шарик', petAt: 0, boostUntil: 0 }; }
export const petLeft = (st, now = Date.now()) => Math.max(0, (st.dog?.petAt || 0) + DOG_PET_MS - now);
export function petDog(st, now = Date.now()) {
  if (!hasDog(st) || petLeft(st, now) > 0) return false;
  st.dog.petAt = now; st.dog.boostUntil = now + DOG_BOOST_MS;
  addXp(st, 3);
  return true;
}
// Сосед-соперник Петрович: идёт вровень с игроком — 85–110% твоего капитала с запаздыванием ~6 минут игры.
// Множитель медленно «гуляет» (период ~47 мин), поэтому он то обгоняет, то отстаёт.
// Сосед Петрович: тянется к 85–110% ТВОЕГО ТЕКУЩЕГО капитала с запаздыванием ~4 минуты реального времени.
// Время — реальное, включая офлайн: пока ты спал, сосед тоже работал, поэтому после ночи он не отстаёт в разы.
// Множитель медленно «гуляет» (период ~47 мин) — то обгоняет, то отстаёт. Никогда не беднеет.
const NB_TAU_MIN = 4;
function logCapital(st, now = Date.now(), realMs = 0) {
  const me = Math.max(0, ratingCapital(st));
  const t = now / 60000;
  const f = 0.975 + 0.125 * Math.sin(2 * Math.PI * t / 47 + (st.seed % 7));
  const nb = (st.storyFlags?.nbBoostUntil || 0) > st.month ? 1.15 : 1; // завод ушёл к соседу — он рванул вперёд
  const target = Math.max(START_MONEY * 0.9, me * f * nb);
  const dt = Math.min(realMs / 60000, 24 * 60);
  const k = 1 - Math.exp(-dt / NB_TAU_MIN);
  const prev = st.nbVal || START_MONEY * 0.9;
  // за офлайн сосед «доигрывает» до своей цели сразу; онлайн — плавно догоняет
  st.nbVal = Math.max(prev, Math.min(prev + (target - prev) * k, me * 1.1 * nb)); // не беднеет и не уходит выше 110% тебя
}
export const neighborCap = (st) => Math.round(Math.max(st.nbVal || 0, START_MONEY * 0.9));
// перегнал соседа / отстал: возвращает событие один раз при смене лидера
export function neighborCheck(st, now = Date.now()) {
  if (st.phase === 'clean') return null;
  const me = ratingCapital(st), nb = neighborCap(st);
  const ahead = me > nb;
  if (!st.nb) { st.nb = { ahead, at: now, wins: 0 }; return null; }
  if (ahead === st.nb.ahead) return null;
  if (now - st.nb.at < 3 * 60000) return null; // не дёргаем, если идём ноздря в ноздрю
  st.nb.ahead = ahead; st.nb.at = now;
  if (ahead) {
    st.nb.wins = (st.nb.wins || 0) + 1;
    const prize = Math.max(500, Math.round(totalRate(st) * 10 / 10) * 10);
    st.money += prize; st.monthIncome += prize;
    addXp(st, 20);
    addHistory(st, { m: st.month, t: `🏁 Обогнали соседа Петровича! Награда +${fmt(prize)}, +20 ⭐.` });
    return { type: 'ahead', prize };
  }
  return { type: 'behind' };
}
const rndRange = (r, a, b) => a + r() * (b - a);
// какие продукты ферма может дать прямо сейчас (постройка есть и сезон идёт) и с какой скоростью, шт/мин
export function producible(st) {
  const out = {};
  for (const id of PRODUCERS) {
    const p = BUILDINGS[id].product;
    if (!p || !level(st, id)) continue;
    const r = rate(st, id) / productPrice(p);
    if (r > 0) out[p] = (out[p] || 0) + r;
  }
  return out;
}
// заказ: 1–2 продукта на 4–10 минут производства (большой — 25–40 минут), оплата ×1.6–1.8 рынка + опыт
export function makeOrder(st, now, big = false) {
  const can = producible(st);
  const ps = Object.keys(can);
  if (!ps.length) return null;
  const r = rng((st.seed ^ Math.floor(now / 1000)) >>> 0);
  // заказ «Уха» от кафе: 1–2 рыбы (одна такая на доске), платит дороже, чем продать рыбу сразу
  if (!big && st.phase !== 'clean' && !activeOrders(st).some(x => x.o.ukha) && r() < 0.25) {
    const need = 1 + (r() < 0.4 ? 1 : 0);
    return { client: 'cafe', ukha: true, name: 'Кафе «У трассы» — уха', emoji: '🍲', big: false, items: [{ p: 'fish', need, have: 0 }],
      // награда ≈9 мин дохода за рыбу
      reward: nice(itemPrice(st, 'fish') * need * 1.1 * (1 + 0.2 * level(st, 'market'))), xp: 24 + need * 12, at: now }; // уха — без срока: рыбалка по желанию
  }
  const tr = st.trust ?? TRUST.start;
  const premium = !big && tr >= TRUST.high && r() < 0.5, small = !big && tr < TRUST.low;
  const client = big ? { id: 'big', name: 'Большой заказ дня', emoji: '🚚', mult: 1.8 }
    : premium ? PREMIUM_CLIENTS[Math.floor(r() * PREMIUM_CLIENTS.length)] : small ? SMALL_CLIENT : CLIENTS[Math.floor(r() * CLIENTS.length)];
  const k = Math.min(ps.length, big ? 2 : small ? 1 : (r() < 0.45 ? 2 : 1));
  const chosen = [];
  while (chosen.length < k) { const p = ps[Math.floor(r() * ps.length)]; if (!chosen.includes(p)) chosen.push(p); }
  // объём — сколько ферма произведёт этого продукта за t минут после появления заказа (обычный 3–10 мин, большой 20–30);
  // копится только новое производство (it.avail), старый запас амбара разом не засчитывается.
  // Награда — минуты дохода всей фермы: обычный 3–8 мин (больше объём — больше награда), большой — 15–20 мин.
  const newbie = (st.month || 0) < NEWBIE_MONTHS;
  const t = big ? rndRange(r, 20, 30) : newbie ? rndRange(r, 1.5, 3) : small ? rndRange(r, 2, 4) : rndRange(r, 3, 10);  // новичкам — 1,5–3 мин, при низком доверии — мелкие
  const items = (newbie && !big ? chosen.slice(0, 1) : chosen).map(p => ({ p, need: Math.max(newbie ? 2 : 3, Math.round(can[p] * t)), have: 0, avail: 0 }));
  const value = items.reduce((a, it) => a + it.need * itemPrice(st, it.p), 0);
  const rewMin = big ? 15 + (t - 20) / 2 : newbie ? 2 + t / 2 : 3 + (t - 3) / 7 * 5;
  const mult = (big ? 1 : client.mult / 1.3) * (1 + 0.2 * level(st, 'market'));
  return {
    client: client.id, name: client.name, emoji: client.emoji, big, items,
    reward: nice(Math.max(perMin(st) * rewMin * mult, value * 1.25)),
    xp: big ? Math.round(XP.big * t / 25) : Math.round(XP.order[0] + (t - 3) / 7 * (XP.order[1] - XP.order[0])), at: now,
    // срок сдачи — по времени в игре (st.playMs), чтобы ночью заказы не «сгорали»; у большого заказа срок — конец дня
    ...(big ? {} : { dueAt: (st.playMs || 0) + Math.max(ORDER_DUE.min, t * ORDER_DUE.k + ORDER_DUE.add) * 60000 }),
  };
}
// сколько продукции для заказа ферма произвела с момента его появления
function accrueOrders(st, dt) {
  const act = activeOrders(st); if (!act.length) return;
  const can = producible(st);
  for (const { o } of act) for (const it of o.items) if (it.avail !== undefined && can[it.p]) it.avail = Math.min(it.need, it.avail + can[it.p] * dt / 60000);
}
// сколько минут игры осталось до срока заказа (null — без срока)
export const orderLeft = (st, o) => (o && o.dueAt !== undefined ? o.dueAt - (st.playMs || 0) : null);
// просроченные заказы уходят с доски: отложенное продаём, доверие падает
// заказ сейчас не выполнить: нужный продукт не производится (не сезон, постройка стоит)
export function orderStalled(st, o, can = producible(st)) {
  return !!o && !o.wait && o.items.some(it => it.have < it.need && !can[it.p] && it.p !== 'fish');
}
function expireOrders(st, now) {
  const can = producible(st);
  (st.orders || []).forEach((o, i) => {
    if (!o || o.wait || o.dueAt === undefined || orderDone(o)) return;
    // нужный продукт сейчас не производится (не сезон, постройка стоит) — срок на паузе, это не вина игрока
    if (orderStalled(st, o, can)) { o.dueAt = Math.max(o.dueAt, (st.playMs || 0) + 5 * 60000); return; }
    if ((st.playMs || 0) < o.dueAt) return;
    const back = o.items.reduce((a, it) => a + it.have * itemPrice(st, it.p), 0);
    st.money += back; st.monthIncome += back;
    addTrust(st, TRUST.expired); st.orderStreak = 0;
    addHistory(st, { m: st.month, t: `⌛ Заказ «${o.name}» просрочен: ${TRUST.expired} 🤝` });
    (st.expiredNew ||= []).push(o.name);
    st.orders[i] = { wait: true, readyAt: now + ORDER_DECLINE_MIN * 60000 };
  });
}
function refillOrders(st, now) {
  if (st.phase === 'clean') return;
  if (!st.orders) st.orders = [];
  expireOrders(st, now);
  for (let i = 0; i < ORDER_SLOTS; i++) {
    const o = st.orders[i];
    if (o && !o.wait) continue;
    if (o && o.wait && o.readyAt > now) continue;
    const n = makeOrder(st, now + i * 7919);
    if (n) st.orders[i] = n; else st.orders[i] = { wait: true, readyAt: now + 60000 };
  }
  // большой заказ — раз в день (появляется, когда на ферме уже есть 2 вида продукции)
  const day = dayKey(st, now);
  if ((!st.big || st.big.day !== day) && Object.keys(producible(st)).length >= 2) {
    const b = makeOrder(st, now + 31337, true);
    if (b) st.big = { ...b, day };
  }
}
export const activeOrders = (st) => [...(st.orders || []).map((o, i) => ({ o, i })), ...(st.big && !st.big.done ? [{ o: st.big, i: 'big' }] : [])].filter(x => x.o && !x.o.wait);
const orderAt = (st, i) => (i === 'big' ? st.big : st.orders?.[i]);
export const orderDone = (o) => o && !o.wait && o.items.every(it => it.have >= it.need);
// урожай → в заказы (по порядку на доске, большой заказ — последним)
function reserveForOrders(st, p, units) {
  let left = units, used = 0;
  for (const { o } of activeOrders(st)) {
    for (const it of o.items) {
      if (it.p !== p || it.have >= it.need || left <= 0) continue;
      // в заказ идёт только то, что произведено после его появления (старый запас амбара не засчитывается разом)
      const room = it.avail === undefined ? it.need : Math.floor(it.avail) - it.have;
      const take = Math.min(left, it.need - it.have, Math.max(0, room));
      if (take <= 0) continue;
      it.have += take; left -= take; used += take;
    }
  }
  return { units: used, value: used * itemPrice(st, p) };
}
// рыба и прочее, что приходит не со сбора постройки
export function addProduct(st, p, units) {
  const r = reserveForOrders(st, p, units);
  const sold = (units - r.units) * itemPrice(st, p);
  st.money += sold; st.monthIncome += sold;
  return r;
}
export function deliverOrder(st, i, now = Date.now()) {
  const o = orderAt(st, i);
  if (!orderDone(o)) return null;
  st.money += o.reward; st.monthIncome += o.reward;
  o.gotXp = addXp(st, o.xp);
  // доверие: сдан вовремя +1, каждые 5 заказов подряд без отказов — ещё +2
  st.orderStreak = (st.orderStreak || 0) + 1;
  o.trust = trustDaily(st, 'order', TRUST.order + (st.orderStreak % TRUST.streak === 0 ? TRUST.streakBonus : 0), TRUST.orderDay, now);
  addHistory(st, { m: st.month, t: `${o.emoji} Заказ «${o.name}» выполнен: +${fmt(o.reward)}, +${o.xp} ⭐${o.trust > 0 ? `, +${+o.trust.toFixed(1)} 🤝` : ''}.` });
  if (i === 'big') st.big.done = true;
  else { const r = rng(now >>> 0); st.orders[i] = { wait: true, readyAt: now + rndRange(r, ORDER_REFILL_MIN[0], ORDER_REFILL_MIN[1]) * 60000 }; }
  dailyProgress(st, 'order', 1);
  checkGoals(st);
  return o;
}
export function declineOrder(st, i, now = Date.now()) {
  const o = orderAt(st, i);
  if (!o || o.wait) return 0;
  // отложенное в амбар продаём по обычной цене
  const back = o.items.reduce((a, it) => a + it.have * itemPrice(st, it.p), 0);
  st.money += back; st.monthIncome += back;
  // отказ — покупатели запоминают; но если заказ сейчас не выполнить (не сезон) — без штрафа
  if (!orderStalled(st, o)) { addTrust(st, TRUST.decline); st.orderStreak = 0; }
  if (i === 'big') st.big.done = true;
  else st.orders[i] = { wait: true, readyAt: now + ORDER_DECLINE_MIN * 60000 };
  return back;
}

/* ---------- Стройка и улучшения ---------- */
// множитель цены уровня: ×1.6 (у прилавка и марки — свой)
export const levelMult = (b) => b.costMult || LEVEL_COST_MULT;
// цена перехода с уровня L на L+1
export function costAt(b, L) { return b.cost * levelMult(b) ** L; }
// постоянный доход фермы (без счастливого часа, бустеров, щенка и событий месяца)
export const steadyRate = (st) => PRODUCERS.reduce((a, id) => a + incOf(st, id, level(st, id)) * workerMult(st, id) * (st.perm?.[id] ?? 1), 0) * globalMult(st, false);
// доход «чистыми» — после расходов на содержание (корм, свет, налоги): из него игрок копит на покупки
export const netRate = (st) => steadyRate(st) * (1 - upkeepShare(st.tier || 0));
// при открытии поздней локации: k = доход фермы / расчётный доход (первая постройка ≈ LATE_MIN минут дохода)
function setLocK(st) {
  for (const L of LOCATIONS) {
    if (L.tier < 1 || L.tier !== st.tier || st.locK?.[L.id]) continue;
    const first = Math.min(...Object.keys(BUILDINGS).filter(id => BUILDINGS[id].loc === L.id && BUILDINGS[id].tier === L.tier).map(id => BUILDINGS[id].cost));
    const k = Math.max(1, steadyRate(st) * LATE_MIN / first);
    (st.locK ||= {})[L.id] = k; (st.locKi ||= {})[L.id] = k * (LOC_INC[L.id] ?? 1);
  }
}
// цена «живой» постройки: ~35 минут текущего дохода; «Своя марка» (+доля ко всему) и «Рынок» (+к заказам) — по их эффекту
function dynPrice(st, id) {
  const b = BUILDINGS[id], base = Math.max(netRate(st), 1000), L = level(st, id); // от дохода «чистыми» — копится ~35 минут
  if (b.kind === 'boost') return base * b.boost / (1 + b.boost * L) * dynPayback(st) * (1 - upkeepShare(st.tier || 0)); // +доля ко всему доходу — по её окупаемости
  return base * DYN.mins;                                       // постройка, уровень, рынок — ~35 минут дохода «чистыми»
}
export function priceOf(st, id) {
  const b = BUILDINGS[id], L = level(st, id);
  let p = isDyn(id) ? dynPrice(st, id) : costAt(b, L) * locK(st, id);
  const disc = st.flags.disc?.[id];
  if (disc) p *= 1 - disc;
  return Math.round(p);
}
// сколько стоят постройки сейчас (всё, что вложено в уровни и ремонт дома)
// сколько вложено в постройку: «живые» — сколько заплачено; остальные — по прежней формуле уровней
function bookValue(st, id) {
  if (st.bpaid?.[id] !== undefined) return st.bpaid[id];
  const b = BUILDINGS[id], L = level(st, id);
  let v = 0, p = b.cost * locK(st, id);
  for (let i = 0; i < L; i++) { v += p; p *= levelMult(b); }
  return v;
}
export function buildingsValue(st) {
  let v = 0;
  for (let i = 0; i < (st.house || 0); i++) v += HOUSE_STAGES[i].cost;
  for (const d of DECOR) if (st.decor?.[d.id] === true) v += d.cost; // старые сохранения
  for (const w of Object.values(st.workers || {})) v += w.spent || 0; // наём и улучшения работников — тоже вложения в ферму
  if (CAPITAL_PAID.on) v += st.bvExtra || 0;                                                // доплата сверх «книжной» цены — тоже вложено в ферму
  for (const id of Object.keys(st.decor || {})) v += st.decor[id] === true ? 0 : st.decor[id]; // украшения — по цене покупки
  for (const id of Object.keys(st.lv)) {
    const b = BUILDINGS[id], L = level(st, id);
    if (b.kind === 'once') { v += b.cost * L; continue; }
    v += bookValue(st, id);
  }
  return v;
}

export function canBuy(st, id) {
  const b = BUILDINGS[id];
  if (st.phase === 'clean') return 'сначала уборка';
  if (b.tier > st.tier) return `откроется после цели ${tierName(b.tier - 1)}`;
  if (b.lvl && farmLevel(st) < b.lvl) return `нужен уровень фермы ${b.lvl}`;
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
  if (isDyn(id)) {
    // «живая» постройка: доход растёт на цену/окупаемость, в капитал — сколько заплачено
    if (BUILDINGS[id].kind === 'prod') (st.binc ||= {})[id] = incOf(st, id, level(st, id) + 1);
    (st.bpaid ||= {})[id] = (st.bpaid[id] ?? bookValue(st, id)) + p;
  }
  st.lv[id] = level(st, id) + 1;
  if (st.flags.disc?.[id]) delete st.flags.disc[id];
  dailyProgress(st, 'build', 1);
  addXp(st, Math.min(XP.build[1], XP.build[0] + st.lv[id]));   // постройка/улучшение: 6–15 ⭐
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
  if (b.kind === 'prod') return (incOf(st, id, L + 1) - incOf(st, id, L)) * soonSeason(st, id) * k;
  if (b.kind === 'boost') {
    const base = PRODUCERS.reduce((a, p) => a + incOf(st, p, level(st, p)) * soonSeason(st, p), 0);
    return base * k * b.boost / (1 + b.boost * L);
  }
  if (id === 'stove') return baseIncome('greenhouse', level(st, 'greenhouse')) * 1.5 * k * (isWinter(st.month + 1) ? 1 : 0.25);
  if (id === 'omshanik') return baseIncome('apiary', level(st, 'apiary')) * k * (st.month % 12 >= 6 && st.month % 12 <= 9 ? 0.5 : 0.05);
  if (id === 'fence') return PRODUCERS.reduce((a, p) => a + incOf(st, p, level(st, p)), 0) * 0.02;
  if (b.kind === 'orders') { // рынок: заказы дороже — грубо: заказы дают ~15% дохода
    const base = PRODUCERS.reduce((a, p) => a + incOf(st, p, level(st, p)) * soonSeason(st, p), 0);
    return base * k * 0.15 * b.orderBoost / (1 + b.orderBoost * L);
  }
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
// цель: капитал есть, а уровня фермы не хватает
export const goalNeedsLevel = (st) => ratingCapital(st) >= goal(st) && farmLevel(st) < goalLevel(st.tier);
export const progress = (st) => Math.max(0, Math.min(1, ratingCapital(st) / goal(st)));

export function grantAch(st, id) {
  if (st.ach[id]) return false;
  st.ach[id] = { at: Date.now(), capital: capital(st), month: st.month };
  st.achNew.push(id);
  return true;
}
// что ещё не построено в текущей поздней локации (для цели нужно «обжиться»: всё по 1-му уровню)
export function settleMissing(st) {
  if (!SETTLE.on) return [];
  const L = LOCATIONS.find(l => l.tier === st.tier && l.tier >= 2);
  if (!L) return [];
  return Object.keys(BUILDINGS).filter(id => BUILDINGS[id].loc === L.id && BUILDINGS[id].tier === L.tier && !level(st, id));
}
export function checkGoals(st) {
  let reached = false;
  while (ratingCapital(st) >= goalOf(st.tier) && farmLevel(st) >= goalLevel(st.tier) && !settleMissing(st).length) {
    grantAch(st, goalAchievement(st.tier));
    addHistory(st, { m: st.month, t: `Цель достигнута: ${tierName(st.tier)}! Открыты новые постройки.` });
    st.tier++;
    setLocK(st);
    reached = true;
  }
  return reached;
}

/* ---------- Месяцы и события ---------- */
export const monthLeft = (st) => Math.max(0, MONTH_MS - st.monthMs);
export const monthReady = (st) => st.phase === 'play' && monthLeft(st) <= 0;
// пропуск ожидания: половина того, что ферма заработала бы за оставшееся время (минимум 500 ₽)
export const skipCost = (st) => nice(Math.max(500, totalRate(st) * 0.5 * monthLeft(st) / 60000));
// ускорение месяца: запоминаем, сколько времени промотали — зарплаты и проценты за него не берём
export function fastForward(st) {
  st.skippedMs = Math.min(MONTH_MS, (st.skippedMs || 0) + monthLeft(st));
  st.monthMs = MONTH_MS;
}
export function skipMonth(st) {
  if (st.phase !== 'play' || monthReady(st)) return 'месяц уже прошёл';
  const c = skipCost(st);
  if (st.money < c) return 'не хватает ' + fmt(c - st.money);
  st.money -= c;
  fastForward(st);
  addHistory(st, { m: st.month, t: `Поторопили время за ${fmt(c)}.` });
  return null;
}

// подпись ключа эффекта в ленте решений: «+15% продаж», «пасека −20%»
const KEY_NAME = { sales: 'продаж' };
const KEY_SHORT = { garden: 'огород', cabbage: 'капуста', carrot: 'морковь', greenhouse: 'теплица', apiary: 'пасека', honeyfield: 'пасека-поле', coop: 'курятник', cow: 'корова', cowshed: 'коровник', mill: 'мельница', cheese: 'сыроварня' };
export function effectText(key, k, months = 0) {
  const pct = Math.round((k - 1) * 100), sign = pct > 0 ? '+' : '−', v = `${sign}${Math.abs(pct)}%`;
  const name = KEY_NAME[key] ? `${v} ${KEY_NAME[key]}` : `${(KEY_SHORT[key] || BUILDINGS[key]?.name || key).toLowerCase()} ${v}`;
  return months ? `${name} на ${months} мес.` : name;
}
function helpers(st, log, chg = []) {
  const r = rng(st.seed ^ (st.month * 2654435761));
  const S = monthScale(st);
  const addMod = (bucket, key, v) => { bucket[key] = (bucket[key] ?? 1) * v; };
  return {
    fmt, S,
    amt: (k) => nice(S * k),
    mins: (n) => nice(perMin(st) * n),   // цена события: n минут дохода фермы
    pay: (sum, label) => { st.money -= sum; log.push({ label, amount: -sum }); chg.push(`−${fmt(sum)}`); },
    gain: (sum, label) => { st.money += sum; log.push({ label, amount: sum }); chg.push(`+${fmt(sum)}`); },
    // доверие покупателей
    trust: (n) => { const d = addTrust(st, n); if (d) chg.push(`${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))} 🤝`); },
    // навсегда: perm('sales', 1.15) = продажи +15%
    perm: (key, v) => { st.perm[key] = (st.perm[key] ?? 1) * v; chg.push(effectText(key, v)); },
    // на n месяцев (включая текущий), значок с таймером на панели
    temp: (key, v, months, icon = '📅', label = '') => { st.effects.push({ key, k: v, until: st.month + months, icon, label }); chg.push(effectText(key, v, months)); },
    flag: (name, v = true) => { st.storyFlags[name] = v; },
    has: (name) => st.storyFlags[name],
    // продолжение сюжета через n месяцев
    later: (id, n) => { st.storyQueue.push({ id, at: st.month + n }); },
    note: (t) => chg.push(t),
    mod: (key, v) => { addMod(st.mods, key, v); chg.push(effectText(key, v) + ' в этом месяце'); },
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
export const resolveText = (v, st) => (typeof v === 'function' ? v(st, helpers(st, [], [])) : v);

// каждое событие игрок видит один раз (кроме запасного «Тихий месяц»)
const eventKey = (e) => e.id;
const fits = (st, e) => !st.usedEvents.includes(e.id) && (!e.cond || e.cond(st));
// продолжение сюжета, которому пришёл срок (раньше случайных событий)
export function dueStory(st) {
  for (const q of st.storyQueue || []) { const e = EVENT_BY_ID[q.id]; if (e && q.at <= st.month + 1 && fits(st, e)) return e; }
  return null;
}
export function pickEvent(st) {
  const story = dueStory(st);
  if (story) return story;
  const r = rng(st.seed + (st.month + 1) * 7919);
  const nm = (st.month + 1) % 12;
  const pool = EVENTS.filter(e => !e.follow && e.months.includes(nm) && (e.repeat || fits(st, e)) && (!e.cond || e.cond(st)));
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let x = r() * total;
  for (const e of pool) { if ((x -= e.weight) <= 0) return e; }
  return pool[pool.length - 1] || EVENT_BY_ID.quiet;
}

// «Следующий месяц»: только когда месяц прошёл. Сначала итоги прошедшего месяца (st.report),
// потом — событие нового месяца (st.event), выбор в нём действует уже на новый месяц.
export function endMonth(st) {
  if (!monthReady(st)) return null;
  const e = pickEvent(st);
  st.eventKey = eventKey(e);
  const report = closeMonth(st);
  report.after = Math.round(st.money);
  report.capital = capital(st);
  st.report = report;
  st.event = e.id;
  st.phase = 'event';
  checkGoals(st);
  return e;
}
export function optionState(st, e, i) {
  const o = e.options[i];
  return { why: o.can ? o.can(st, helpers(st, [])) : null, desc: resolveText(o.desc, st), label: resolveText(o.label, st), icon: o.icon };
}
export const allBlocked = (st, e) => e.options.every((o) => o.can && o.can(st, helpers(st, [])));
const PASS = { label: 'Не по карману', effect: () => 'Денег не хватило ни на один вариант.' };
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

export function choose(st, i) {
  if (st.phase !== 'event') return null;
  const e = EVENT_BY_ID[st.event];
  const o = i === -1 && allBlocked(st, e) ? PASS : e.options[i];
  if (!o || (o.can && o.can(st, helpers(st, [])))) return null;
  const title = stripTags(resolveText(e.title, st)), label = resolveText(o.label, st);
  const log = [], chg = [];
  const trust0 = st.trust ?? TRUST.start;
  const text = o.effect(st, helpers(st, log, chg)); // событие действует на новый (уже начавшийся) месяц
  if (!e.repeat) chg.push(`+${addXp(st, XP.story)} ⭐`); // решение в событии — опыт
  if (!e.repeat && !st.usedEvents.includes(e.id)) st.usedEvents.push(e.id);
  st.storyQueue = (st.storyQueue || []).filter(q => q.id !== e.id);
  delete st.eventKey;
  // лента решений: «Июль: пустил завод → +15% продаж, −10 🤝»
  const what = o.short || `${title.replace(/!$/, '')}: ${label.toLowerCase()}`;
  const sum = chg.join(', ');
  addHistory(st, { m: st.month, t: sum ? `${what} → ${sum}` : `${what}. ${text}`, d: 1 });
  (st.decisions ||= []).push({ m: st.month, ev: e.id, opt: label, sum, trust: Math.round(st.trust ?? TRUST.start) });
  if (st.decisions.length > 200) st.decisions.shift();
  const result = { title, choice: label, text, log, chg, trust: Math.round((st.trust ?? TRUST.start) - trust0), month: st.month };
  st.event = null;
  st.phase = 'play';
  checkGoals(st);
  return result;
}

function closeMonth(st) {
  const m = st.month;
  const income = Math.round(st.monthIncome);
  const costs = [];
  const up = upkeepShare(st.tier || 0);
  if (income > 0) costs.push({ label: up > 0.1 ? `Содержание хозяйства (${Math.round(up * 100)}%)` : 'Корм, свет и налоги', amount: Math.round(income * up) });
  // месяц ускорили — платим только за реально прошедшее время (доход за промотанное время не начислялся)
  const lived = 1 - Math.min(MONTH_MS, st.skippedMs || 0) / MONTH_MS;
  if (st.debt) costs.push({ label: 'Проценты по кредиту', amount: Math.round(st.debt * LOAN_RATE * lived) });
  for (const w of WORKER_ORDER) if (hired(st, w) && !st.workers[w].freeUntil) {
    const full = wageOf(st, w, income), pay = lived < 1 ? nice(Math.max(WORKERS[w].wage * income, wageFloor(st, w) * lived)) : full;
    costs.push({ label: `Зарплата: ${WORKERS[w].name}${lived < 1 ? ` (${Math.max(1, Math.round(lived * 15))} из 15 мин)` : ''}`, amount: Math.min(full, pay), wage: true });
  }
  const notes = [];
  if (lived < 1) notes.push(`⏩ Месяц ускорили: зарплаты и проценты — только за ${Math.max(1, Math.round(lived * 15))} мин из 15.`);
  if (st.flags.contract) {
    const c = st.flags.contract;
    if (income < c.min) { costs.push({ label: 'Штраф кафе', amount: c.fine }); notes.push('Кафе недовольно: выручка меньше нормы.'); }
    if (--c.left <= 0) { delete st.flags.contract; notes.push('Контракт с кафе закончился.'); }
  }
  // аренда от завода (договорились: фильтры + аренда каждый месяц)
  if (st.storyFlags?.factoryRent && income > 0) {
    const rent = nice(income * 0.08);
    st.money += rent; notes.push(`🏭 Завод заплатил аренду: +${fmt(rent)}`);
  }
  if (st.storyFlags?.solarSell && income > 0) {
    const sun = nice(income * 0.04);
    st.money += sun; notes.push(`☀️ Излишки электричества проданы в сеть: +${fmt(sun)}`);
  }
  const expense = costs.reduce((a, c) => a + c.amount, 0);
  st.money -= expense;
  if (m % 12 === 9 && level(st, 'apiary') > 1 && !level(st, 'omshanik') && !hired(st, 'beekeeper')) {
    notes.push('Без омшаника пчёлы замёрзли — пасека откатилась на 1-й уровень.');
    addHistory(st, { m, t: 'Пасека замёрзла без омшаника.' });
    st.lv.apiary = 1;
  }
  st.ledger.push({ m, income, expense, wages: costs.filter(c => c.wage).reduce((a, c) => a + c.amount, 0), money: Math.round(st.money) });
  if (st.ledger.length > 36) st.ledger.shift();
  const report = { month: m, name: monthOf(m).name, year: yearOf(m), income, costs, expense, notes };
  st.month++;
  st.monthMs = 0;
  st.monthIncome = 0; st.skippedMs = 0;
  st.mods = st.nextMods; st.nextMods = {};
  st.effects = (st.effects || []).filter(e => e.until > st.month);
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
  // новые поля для старых сохранений (прогресс не трогаем)
  save.trust ??= TRUST.start; save.orderStreak ??= 0;
  // опыт по новым правилам: заказы и задания дают вдвое больше, +1 ⭐ за каждый сбор руками — пересчитываем, не понижая
  if (!save.xpV2) { save.xp = Math.max(save.xp || 0, Math.round((save.xp || 0) * 2 + (save.taps || 0) * XP.collect)); save.xpV2 = 1; }
  if (!save.locK) { save.locK = {}; for (const L of LOCATIONS) if (L.tier >= 1 && (save.tier || 0) >= L.tier) save.locK[L.id] = 1; } // уже открытые — без изменений
  save.storyFlags ??= {}; save.storyQueue ??= []; save.goods ??= { equip: {}, supply: {} }; save.perm ??= {}; save.effects ??= []; save.decisions ??= [];
  // раньше события повторялись каждый год («id@год») — теперь каждое один раз
  save.usedEvents = [...new Set((save.usedEvents || []).map(k => String(k).split('@')[0]))];
  return save;
}
