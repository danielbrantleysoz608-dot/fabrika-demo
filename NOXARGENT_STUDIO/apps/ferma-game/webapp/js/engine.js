// Логика игры v2 — чистые функции над объектом состояния. Без DOM (работает и в Node для симуляции).
// Время — реальное: продукция копится по минутам, 1 игровой месяц = MONTH_MS.
import {
  SCHEMA_VERSION, START_MONEY, SCRAP_BONUS, MONTH_MS, OFFLINE_CAP_MS, STORAGE_MIN, LEVEL_COST_MULT, UPKEEP_SHARE,
  LOAN_RATE, INC_GROWTH, PRODUCTS, CLIENTS, ORDER_SLOTS, ORDER_REFILL_MIN, ORDER_DECLINE_MIN, xpForLevel, XP, HOUSE_STAGES, HOUSE_BONUS, FRESH_MIN, FRESH_BONUS, DAILY_REWARD, LOGIN_REWARD, LOGIN_DAYS, BUILDINGS, PRODUCERS, TRASH, FIELD_WEEDS, monthOf, yearOf, isWinter, goalOf, goalAchievement, maxLevel,
  FISH_PER_DAY, DOG_PET_MS, DOG_BOOST_MS, DOG_BONUS, WORKERS, WORKER_ORDER,
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
    xp: 0, lvlSeen: 1,                       // опыт фермы (⭐) и последний показанный уровень
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
export const baseIncome = (id, L) => { const g = BUILDINGS[id].incGrowth || INC_GROWTH; return L > 0 ? BUILDINGS[id].inc * (g ** L - 1) / (g - 1) : 0; };
// окупаемость следующего уровня (минуты, в сезон)
export function paybackMin(st, id) {
  const L = level(st, id), d = (baseIncome(id, L + 1) - baseIncome(id, L)) * globalMult(st, false);
  return d > 0 ? priceOf(st, id) / d : Infinity;
}

export function globalMult(st, withMods = true) {
  let k = 1;
  for (const id of ['stall', 'brand']) k *= 1 + (BUILDINGS[id].boost || 0) * level(st, id);
  k *= 1 + HOUSE_BONUS * (st.house || 0);  // ремонт дома деда: +3% за этап
  if (hired(st, 'seller')) k *= 1 + WORKERS.seller.all; // продавец на прилавке
  if (withMods) {
    k *= st.mods.sales ?? 1;
    if (st.dog?.boostUntil > (st.lastTick || 0)) k *= 1 + DOG_BONUS; // погладили щенка: +10% на 30 мин
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
export const workerMult = (st, id) => { let k = 1; for (const w of WORKER_ORDER) if (hired(st, w) && WORKERS[w].bonus?.[id]) k *= 1 + WORKERS[w].bonus[id]; return k; };
// текущая скорость, ₽/мин
export const rate = (st, id) => baseIncome(id, level(st, id)) * seasonMult(st, id) * workerMult(st, id) * (st.mods[id] ?? 1) * globalMult(st);
export const totalRate = (st) => PRODUCERS.reduce((a, id) => a + rate(st, id), 0);
// вместимость склада: 2 часа номинального производства
export const storageCap = (st, id) => baseIncome(id, level(st, id)) * globalMult(st, false) * 1.5 * STORAGE_MIN;
// «масштаб» экономики для событий: доход за месяц без сезонов
// доход фермы в минуту для наград и цен: текущий, но не меньше половины номинального (зимой не обесценивается)
export const perMin = (st) => Math.max(totalRate(st), PRODUCERS.reduce((a, id) => a + baseIncome(id, level(st, id)), 0) * globalMult(st, false) * 0.5, 30);
export const monthScale = (st) => Math.max(15000, PRODUCERS.reduce((a, id) => a + baseIncome(id, level(st, id)), 0) * globalMult(st, false) * MONTH_MS / 60000);

/* ---------- Реальное время ---------- */
export function tick(st, now = Date.now()) {
  const real = Math.max(0, now - st.lastTick);
  st.lastTick = now;
  if (st.phase === 'clean') return { changed: false, offline: 0 };
  st.playMs = (st.playMs || 0) + Math.min(real, 60000); // время в игре (офлайн не считается) — для соседа
  logCapital(st);
  const dt = Math.min(real, OFFLINE_CAP_MS);
  st.monthMs = Math.min(MONTH_MS, st.monthMs + real);
  newDay(st, now);
  refillOrders(st, now);
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
export function collect(st, id, auto = false) {
  const amt = ready(st, id);
  lastFresh = 0; lastReserved = { units: 0, value: 0 };
  if (amt <= 0 || st.phase === 'clean') return 0;
  const fresh = Math.floor(Math.min(amt, rate(st, id) * FRESH_MIN) * FRESH_BONUS);
  st.acc[id] -= amt;
  // часть урожая, нужная для заказов на доске, откладывается в амбар — остальное продаётся на прилавке
  const reserved = reserveForOrders(st, BUILDINGS[id].product, Math.floor((amt + fresh) / productPrice(BUILDINGS[id].product)));
  lastReserved = reserved;
  gain(st, amt + fresh - reserved.value);
  lastFresh = fresh;
  if (!auto) { st.taps++; dailyProgress(st, 'collect', amt + fresh); }
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
  const base = PRODUCERS.reduce((a, p) => a + baseIncome(p, level(st, p)) * soonSeason(st, p), 0) * globalMult(st, false);
  return base * HOUSE_BONUS / (1 + HOUSE_BONUS * (st.house || 0)) / n.cost;
}

/* ---------- Уровень фермы (⭐ опыт) ---------- */
export function farmLevel(st) { let n = 1; while ((st.xp || 0) >= xpForLevel(n + 1)) n++; return n; }
export const levelProgress = (st) => { const n = farmLevel(st), a = xpForLevel(n), b = xpForLevel(n + 1); return { level: n, have: (st.xp || 0) - a, need: b - a }; };
export function addXp(st, n) { st.xp = (st.xp || 0) + n; }
// постройки, открытые на уровне фермы n
export const unlockedAt = (n) => Object.keys(BUILDINGS).filter(id => BUILDINGS[id].lvl === n);

/* ---------- Доска заказов ---------- */
export const productPrice = (p) => PRODUCTS[p]?.price || 1;
// рыба своя, не с постройки: одна рыбина стоит ~минуту дохода фермы (но не дешевле базовой цены)
export const itemPrice = (st, p) => (p === 'fish' ? Math.max(PRODUCTS.fish.price, Math.round(totalRate(st))) : productPrice(p));

/* ---------- Работники ---------- */
export const hired = (st, w) => !!st.workers?.[w];
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
  if (hired(st, w)) return 'уже работает';
  if (farmLevel(st) < d.lvl) return `нужен уровень фермы ${d.lvl}`;
  if (st.money < hirePrice(st, w)) return 'не хватает ' + fmt(hirePrice(st, w) - st.money);
  return null;
}
export function hire(st, w, now = Date.now()) {
  const why = canHire(st, w); if (why) return why;
  const p = hirePrice(st, w);
  st.money -= p;
  if (!st.workers) st.workers = {};
  st.workers[w] = { at: now, last: now };
  addXp(st, XP.build);
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
  if (h && now - (h.last || 0) >= WORKERS.helper.every * 60000) {
    h.last = now;
    for (const id of PRODUCERS) {
      if (!level(st, id) || ready(st, id) <= 0) continue;
      out.collected += collect(st, id, true);
      out.reserved += lastReserved.units;
    }
  }
  if (st.workers.driver) {
    (st.orders || []).forEach((o, i) => { if (orderDone(o)) { const r = deliverOrder(st, i, now); if (r) out.delivered.push(r); } });
  }
  return (lastAuto = out);
}

/* ---------- Рыбалка, щенок, сосед ---------- */
export const fishLeft = (st, now = Date.now()) => (st.fishing?.day === dayKey(st, now) ? Math.max(0, FISH_PER_DAY - st.fishing.n) : FISH_PER_DAY);
export function startFishing(st, now = Date.now()) {
  if ((st.tier || 0) < 1) return 'пруд — в локации «Река и луг»';
  if (!fishLeft(st, now)) return 'рыбалка — не больше 3 раз в день. Приходи завтра!';
  const day = dayKey(st, now);
  st.fishing = { day, n: st.fishing?.day === day ? st.fishing.n + 1 : 1 };
  return null;
}
export function catchFish(st, n) {
  if (n <= 0) return { units: 0, value: 0, sold: 0 };
  const r = addProduct(st, 'fish', n);
  addXp(st, n);
  addHistory(st, { m: st.month, t: `🎣 Рыбалка: поймано ${n} 🐟.` });
  checkGoals(st);
  return { ...r, sold: (n - r.units) * itemPrice(st, 'fish') };
}
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
const NB_DELAY_MIN = 6;
function logCapital(st) {
  const t = (st.playMs || 0) / 60000;
  const log = st.capLog || (st.capLog = []);
  if (!log.length || t - log[log.length - 1][0] >= 1) {
    log.push([Math.round(t * 10) / 10, Math.round(ratingCapital(st))]);
    if (log.length > 20) log.shift();
  }
}
export function neighborCap(st) {
  const t = (st.playMs || 0) / 60000;
  const log = st.capLog || [];
  let base = Math.max(0, ratingCapital(st)) * 0.9;
  for (let i = log.length - 1; i >= 0; i--) if (log[i][0] <= t - NB_DELAY_MIN) { base = log[i][1]; break; }
  if (log.length && log[0][0] > t - NB_DELAY_MIN) base = log[0][1]; // истории ещё мало — берём самое раннее
  const f = 0.975 + 0.125 * Math.sin(2 * Math.PI * t / 47 + (st.seed % 7));
  return Math.max(START_MONEY * 0.9, Math.round(Math.max(0, base) * f));
}
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
  // рыба с пруда — в обычные заказы, пока сегодня ещё можно порыбачить
  if (!big && (st.tier || 0) >= 1 && fishLeft(st, now) > 0 && r() < 0.35) { can.fish = 0.5; ps.push('fish'); }
  const client = big ? { id: 'big', name: 'Большой заказ дня', emoji: '🚚', mult: 1.8 } : CLIENTS[Math.floor(r() * CLIENTS.length)];
  const k = Math.min(ps.length, big ? 2 : (r() < 0.45 ? 2 : 1));
  const chosen = [];
  while (chosen.length < k) { const p = ps[Math.floor(r() * ps.length)]; if (!chosen.includes(p)) chosen.push(p); }
  // объём — сколько ферма произведёт за W минут (копить 3–10 мин; большой — 20–30 мин)
  const W = big ? rndRange(r, 20, 30) : rndRange(r, 3, 10);
  const items = chosen.map(p => {
    const need = p === 'fish' ? 3 + Math.floor(r() * 4) : Math.max(3, Math.round(can[p] * W));
    return { p, need, have: 0 };
  });
  const value = items.reduce((a, it) => a + it.need * itemPrice(st, it.p), 0);
  // награда — минуты дохода фермы: обычный 3–8 мин (чем больше объём, тем больше), большой — 15–20 мин
  const rewMin = big ? 15 + (W - 20) / 2 : 3 + (W - 3) / 7 * 5;
  const mult = (big ? 1 : client.mult / 1.3) * (1 + 0.2 * level(st, 'market'));
  const reward = Math.max(perMin(st) * rewMin * mult, value * 1.25);
  return {
    client: client.id, name: client.name, emoji: client.emoji, big, items,
    reward: nice(reward), xp: big ? Math.round(XP.big * W / 25) : Math.round(XP.order[0] + (W - 3) / 7 * (XP.order[1] - XP.order[0])), at: now,
  };
}
function refillOrders(st, now) {
  if (st.phase === 'clean') return;
  if (!st.orders) st.orders = [];
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
      const take = Math.min(left, it.need - it.have);
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
  addXp(st, o.xp);
  addHistory(st, { m: st.month, t: `${o.emoji} Заказ «${o.name}» выполнен: +${fmt(o.reward)}, +${o.xp} ⭐.` });
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
  if (i === 'big') st.big.done = true;
  else st.orders[i] = { wait: true, readyAt: now + ORDER_DECLINE_MIN * 60000 };
  return back;
}

/* ---------- Стройка и улучшения ---------- */
// множитель цены уровня: ×1.6 (у прилавка и марки — свой)
export const levelMult = (b) => b.costMult || LEVEL_COST_MULT;
// цена перехода с уровня L на L+1
export function costAt(b, L) { return b.cost * levelMult(b) ** L; }
export function priceOf(st, id) {
  const b = BUILDINGS[id], L = level(st, id);
  let p = costAt(b, L);
  const disc = st.flags.disc?.[id];
  if (disc) p *= 1 - disc;
  return Math.round(p);
}
// сколько стоят постройки сейчас (всё, что вложено в уровни и ремонт дома)
export function buildingsValue(st) {
  let v = 0;
  for (let i = 0; i < (st.house || 0); i++) v += HOUSE_STAGES[i].cost;
  for (const id of Object.keys(st.lv)) {
    const b = BUILDINGS[id], L = level(st, id);
    if (b.kind === 'once') { v += b.cost * L; continue; }
    let p = b.cost;
    for (let i = 0; i < L; i++) { v += p; p *= levelMult(b); }
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
  st.lv[id] = level(st, id) + 1;
  if (st.flags.disc?.[id]) delete st.flags.disc[id];
  dailyProgress(st, 'build', 1);
  addXp(st, XP.build);
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
  if (b.kind === 'orders') { // рынок: заказы дороже — грубо: заказы дают ~15% дохода
    const base = PRODUCERS.reduce((a, p) => a + baseIncome(p, level(st, p)) * soonSeason(st, p), 0);
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
    mins: (n) => nice(perMin(st) * n),   // цена события: n минут дохода фермы
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

// «Следующий месяц»: только когда месяц прошёл. Сначала итоги прошедшего месяца (st.report),
// потом — событие нового месяца (st.event), выбор в нём действует уже на новый месяц.
export function endMonth(st) {
  if (!monthReady(st)) return null;
  const e = pickEvent(st);
  st.eventKey = eventKey(e, st);
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
  const log = [];
  const text = o.effect(st, helpers(st, log)); // событие действует на новый (уже начавшийся) месяц
  st.usedEvents.push(st.eventKey || e.id);
  delete st.eventKey;
  // помним события только этого года (и разовые) — иначе список растёт бесконечно
  const y = yearOf(st.month);
  st.usedEvents = st.usedEvents.filter(k => !k.includes('@') || +k.split('@')[1] >= y);
  addHistory(st, { m: st.month, t: `${stripTags(e.title)}: ${o.label.toLowerCase()}. ${text}` });
  const result = { title: stripTags(e.title), choice: o.label, text, log, month: st.month };
  st.event = null;
  st.phase = 'play';
  checkGoals(st);
  return result;
}

function closeMonth(st) {
  const m = st.month;
  const income = Math.round(st.monthIncome);
  const costs = [];
  if (income > 0) costs.push({ label: 'Корм, свет и налоги', amount: Math.round(income * UPKEEP_SHARE) });
  if (st.debt) costs.push({ label: 'Проценты по кредиту', amount: Math.round(st.debt * LOAN_RATE) });
  for (const w of WORKER_ORDER) if (hired(st, w)) costs.push({ label: `Зарплата: ${WORKERS[w].name}`, amount: wageOf(st, w, income), wage: true });
  const notes = [];
  if (st.flags.contract) {
    const c = st.flags.contract;
    if (income < c.min) { costs.push({ label: 'Штраф кафе', amount: c.fine }); notes.push('Кафе недовольно: выручка меньше нормы.'); }
    if (--c.left <= 0) { delete st.flags.contract; notes.push('Контракт с кафе закончился.'); }
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
