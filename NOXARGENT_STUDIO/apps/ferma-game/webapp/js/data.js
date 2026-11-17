// Чистые данные игры. Без DOM — файл импортируется и в браузере, и в Node (симуляция баланса).

export const SCHEMA_VERSION = 2;
export const START_MONEY = 10_000;
export const SCRAP_BONUS = 5_000;           // награда за уборку: дедов металлолом
export const MONTH_MS = 15 * 60 * 1000;     // 1 игровой месяц = 15 минут реального времени
export const OFFLINE_CAP_MS = 2 * 60 * 60 * 1000; // офлайн копим максимум 2 часа
export const STORAGE_MIN = 120;             // склад постройки вмещает 2 часа производства
export const LEVEL_COST_MULT = 1.6;         // цена каждого следующего уровня ×1.6
// После миллиона рост замедляется: уровни выше STEEP_FROM дорожают круче (×STEEP_MULT вместо ×1.6)
export const STEEP_FROM = 5;
export const STEEP_MULT = 4.5;
// Свежий сбор: собрал в первые 5 минут после созревания — +20%
export const FRESH_MIN = 5;
export const FRESH_BONUS = 0.2;
// Ежедневные задания и бонус за вход (награда — доля месячного дохода фермы)
export const DAILY_REWARD = 0.1;       // за каждое задание дня
export const LOGIN_REWARD = 0.05;        // × номер дня серии (1…7)
export const LOGIN_DAYS = 7;
export const LEVEL_INC_MULT = 0.85;         // доход: уровень L даёт inc × L × 1.15^(L−1)
export const UPKEEP_SHARE = 0.10;           // корм, свет, налоги — 10% месячного дохода
export const LOAN_RATE = 0.05;

// Цели: 1 млн → 10 млн → 100 млн → … (бесконечно)
export const goalOf = (tier) => 10 ** (6 + tier);
export const goalLabel = (tier) => {
  const g = goalOf(tier);
  if (g >= 1e12) return `${g / 1e12} трлн`;
  if (g >= 1e9) return `${g / 1e9} млрд`;
  return `${g / 1e6} млн`;
};

export const MONTHS = [
  { name: 'Март',     season: 'early',  trees: 'bare'    },
  { name: 'Апрель',   season: 'spring', trees: 'buds'    },
  { name: 'Май',      season: 'spring', trees: 'blossom' },
  { name: 'Июнь',     season: 'summer', trees: 'full'    },
  { name: 'Июль',     season: 'summer', trees: 'full'    },
  { name: 'Август',   season: 'summer', trees: 'apples'  },
  { name: 'Сентябрь', season: 'autumn', trees: 'autumn'  },
  { name: 'Октябрь',  season: 'autumn', trees: 'autumn'  },
  { name: 'Ноябрь',   season: 'late',   trees: 'bare'    },
  { name: 'Декабрь',  season: 'winter', trees: 'snow'    },
  { name: 'Январь',   season: 'winter', trees: 'snow'    },
  { name: 'Февраль',  season: 'winter', trees: 'snow'    },
];
export const monthOf = (m) => MONTHS[((m % 12) + 12) % 12];
export const yearOf = (m) => Math.floor(m / 12) + 1;
export const isWinter = (m) => monthOf(m).season === 'winter';
export const SEASON_ICON = { early: 'sprout', spring: 'sprout', summer: 'sun', autumn: 'leaf', late: 'leaf', winter: 'flake' };

/*
  Постройки.
  kind: 'prod' — производит (уровни 1…max, доход растёт), 'boost' — множитель ко всему доходу, 'once' — одна покупка.
  cost — цена 1-го уровня (дальше ×1.6 за уровень), inc — ₽/мин на 1-м уровне, unit/price — для показа продукции.
  season(m, st) — множитель сезона (m = номер месяца 0…11, 0 = март). tier — после какой цели открывается.
*/
const always = () => 1;
const months = (from, to, k = 1) => (m) => (m >= from && m <= to ? k : 0);
export const BUILDINGS = {
  coop:       { kind: 'prod', name: 'Курятник', cost: 450, inc: 640, unit: 'яиц', price: 12, tier: 0, max: 10,
                season: (m) => (m >= 9 ? 0.5 : 1), seasonText: 'круглый год, зимой вдвое меньше',
                desc: 'Куры несут яйца. Каждый уровень — +10 кур и быстрее.' },
  stall:      { kind: 'boost', name: 'Прилавок у дороги', cost: 6000, boost: 0.05, costMult: 2, tier: 0, max: 10,
                desc: '«ЯЙЦА деревенские». Каждый уровень — +5% ко всему доходу.' },
  garden:     { kind: 'prod', name: 'Огород', cost: 6000, inc: 450, unit: 'кг', price: 25, tier: 0, max: 10,
                season: months(2, 6), seasonText: 'май – сентябрь', desc: 'Грядки на дедовом поле.' },
  fence:      { kind: 'once', name: 'Забор', cost: 6000, tier: 0, desc: 'Сетка вокруг двора. Лиса не пройдёт.' },
  greenhouse: { kind: 'prod', name: 'Теплица из окон деда', cost: 3000, inc: 600, unit: 'кг', price: 60, tier: 0, max: 10,
                season: (m, st) => (m <= 8 ? 1 : st?.lv?.stove ? 1.5 : 0), seasonText: 'март – ноябрь, зимой — с печкой',
                desc: 'Дед хранил старые рамы. Собираем из них теплицу!' },
  stove:      { kind: 'once', name: 'Печка в теплицу', cost: 30000, tier: 0, requires: 'greenhouse',
                desc: 'Буржуйка: зимой теплица работает и даёт ×1.5 (огурцы втридорога).' },
  apiary:     { kind: 'prod', name: 'Пасека', cost: 160000, inc: 600, unit: 'кг мёда', price: 600, tier: 0, max: 10,
                season: months(3, 5), seasonText: 'мёд июнь – август', desc: 'Ульи. Мёд только летом, зато дорогой.' },
  omshanik:   { kind: 'once', name: 'Омшаник', cost: 20000, tier: 0, requires: 'apiary',
                desc: 'Зимний домик для пчёл. Без него в декабре пасека откатится на 1-й уровень.' },
  cow:        { kind: 'prod', name: 'Корова', cost: 350000, inc: 350, unit: 'л молока', price: 60, tier: 0, max: 10,
                season: (m) => (m >= 9 ? 0.8 : 1), seasonText: 'круглый год', desc: 'Молоко каждый день. Каждый уровень — ещё корова.' },
  // --- открываются после целей ---
  cheese:     { kind: 'prod', name: 'Сыроварня', cost: 1500000, inc: 160, unit: 'кг сыра', price: 900, tier: 1, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Из своего молока — свой сыр. Дорого и вкусно.' },
  honeyfield: { kind: 'prod', name: 'Пасека-поле', cost: 3000000, inc: 1200, unit: 'кг мёда', price: 600, tier: 1, max: 10,
                season: months(2, 6), seasonText: 'май – сентябрь', desc: 'Целое поле медоносов и сотня ульев.' },
  tractor:    { kind: 'prod', name: 'Трактор и поля', cost: 15000000, inc: 3000, unit: 'т зерна', price: 15000, tier: 2, max: 10,
                season: months(2, 7), seasonText: 'май – октябрь', desc: 'Свой трактор и гектары полей за холмом.' },
  shop:       { kind: 'prod', name: 'Магазин в городе', cost: 150000000, inc: 16000, unit: 'чеков', price: 1500, tier: 3, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Фирменная лавка «Ферма деда» в райцентре.' },
  brand:      { kind: 'boost', name: 'Марка «Ферма деда»', cost: 4000000000, boost: 0.5, costMult: 2.5, tier: 4, max: 10,
                desc: 'Своя марка на полках магазинов. +50% ко всему доходу за уровень.' },
  factory:    { kind: 'prod', name: 'Завод', cost: 2000000000, inc: 300000, unit: 'т продукции', price: 50000, tier: 5, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Свой перерабатывающий завод. Ферма деда — бренд страны!' },
};
export const BUILD_ORDER = Object.keys(BUILDINGS);
export const PRODUCERS = BUILD_ORDER.filter(id => BUILDINGS[id].kind === 'prod');
// Сверх 5-й цели максимальный уровень растёт: +5 за каждую следующую цель
export const maxLevel = (id, tier) => (BUILDINGS[id].kind === 'once' ? 1 : BUILDINGS[id].max + Math.max(0, tier - 5) * 5);

// Достижения-открытки (раньше — концовки). Игра теперь бесконечная.
export const ACHIEVEMENTS = {
  millionaire: { title: 'Миллионер', sub: 'Дедова ферма стала настоящим бизнесом!', color: '#e8a21a', art: 'millionaire' },
  alive:       { title: 'Ферма живёт', sub: 'Прожили на ферме целый год. Дед был бы рад.', color: '#3fa34d', art: 'alive' },
  sold:        { title: 'Продал ферму соседу', sub: 'Полфермы ушло соседу. Зато опыт!', color: '#8a5a3c', art: 'sold' },
  frozen:      { title: 'Ферма замёрзла', sub: 'Мороз −35° взял своё. Но мы оттаяли!', color: '#4a90d9', art: 'frozen' },
  goal1:       { title: '10 миллионов', sub: 'Трактор и поля — ферма растёт за холм.', color: '#e8a21a', art: 'millionaire' },
  goal2:       { title: '100 миллионов', sub: 'Свой магазин в городе!', color: '#d8392d', art: 'millionaire' },
  goal3:       { title: 'Миллиард', sub: 'Марка «Ферма деда» на полках страны.', color: '#7a4ec9', art: 'millionaire' },
  goal4:       { title: '10 миллиардов', sub: 'Свой завод. Дед бы не поверил!', color: '#2f6fb5', art: 'millionaire' },
};
export const ACHIEVEMENT_ORDER = Object.keys(ACHIEVEMENTS);
export const goalAchievement = (tier) => (tier === 0 ? 'millionaire' : `goal${tier}`);

// Мусор на заброшенной ферме: каждый предмет убирается одним тапом (хлам улетает, бурьян срезается)
export const TRASH = [
  // бурьян на дедовом поле
  { id: 'w1', type: 'weeds', x: 232, y: 450 }, { id: 'w2', type: 'weeds', x: 296, y: 462 },
  { id: 'w3', type: 'weeds', x: 370, y: 448 }, { id: 'w4', type: 'weeds', x: 420, y: 470 },
  { id: 'w5', type: 'weeds', x: 250, y: 520 }, { id: 'w6', type: 'weeds', x: 330, y: 506 },
  { id: 'w7', type: 'weeds', x: 400, y: 535 }, { id: 'w8', type: 'weeds', x: 215, y: 548 },
  // хлам по двору
  { id: 't1', type: 'tire',   x: 66,  y: 584 }, { id: 't2', type: 'tire',   x: 128, y: 598 },
  { id: 'p1', type: 'planks', x: 92,  y: 486 }, { id: 'b1', type: 'barrel', x: 300, y: 600 },
  { id: 'c1', type: 'cart',   x: 398, y: 604 }, { id: 'g1', type: 'bags',   x: 362, y: 402 },
  { id: 'k1', type: 'bucket', x: 206, y: 622 }, { id: 'w9', type: 'weeds',  x: 172, y: 560 },
  { id: 'wa', type: 'weeds',  x: 44,  y: 530 }, { id: 't3', type: 'tire',   x: 160, y: 470 },
  { id: 'p2', type: 'planks', x: 300, y: 405 }, { id: 'k2', type: 'bucket', x: 56,  y: 446 },
].map(t => ({ ...t, hp: 1 }));
export const FIELD_WEEDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];

// Задел: лавка «Ярмарка» за Telegram Stars. Купленные монеты учитываются в st.paid и НЕ идут в рейтинг.
export const SHOP_ITEMS = [];
