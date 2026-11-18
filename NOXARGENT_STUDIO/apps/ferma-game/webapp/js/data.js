// Чистые данные игры. Без DOM — файл импортируется и в браузере, и в Node (симуляция баланса).

export const SCHEMA_VERSION = 2;
export const START_MONEY = 10_000;
export const SCRAP_BONUS = 5_000;           // награда за уборку: дедов металлолом
export const MONTH_MS = 15 * 60 * 1000;     // 1 игровой месяц = 15 минут реального времени
export const OFFLINE_CAP_MS = 2 * 60 * 60 * 1000; // офлайн копим максимум 2 часа
export const STORAGE_MIN = 120;             // склад постройки вмещает 2 часа производства
export const LEVEL_COST_MULT = 1.6;         // цена каждого следующего уровня ×1.6
export const INC_GROWTH = 1.37;             // прибавка дохода за каждый следующий уровень ×1.37 (не падает!)
// Итог: окупаемость уровня растёт плавно — ×1.6/1.37 ≈ ×1.17 за уровень (≈12–15 мин на 1-м, ≈1 ч на 10-м).
// Темп после миллиона держится не дорогими уровнями, а их открытием: до 1 млн — уровни 1–5,
// каждые две цели открывают ещё один уровень.
// Свежий сбор: собрал в первые 5 минут после созревания — +20%
export const FRESH_MIN = 5;
export const FRESH_BONUS = 0.2;
// Ежедневные задания и бонус за вход (награда — доля месячного дохода фермы)
export const DAILY_REWARD = 0.1;       // за каждое задание дня
export const LOGIN_REWARD = 0.05;        // × номер дня серии (1…7)
export const LOGIN_DAYS = 7;
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
  coop:       { product: 'egg', lvl: 1, kind: 'prod', name: 'Курятник', cost: 420, inc: 21.4, unit: 'яиц', price: 12, tier: 0, max: 10,
                season: (m) => (m >= 9 ? 0.5 : 1), seasonText: 'круглый год, зимой вдвое меньше',
                desc: 'Куры несут яйца. Каждый уровень — +10 кур и быстрее.' },
  stall:      { lvl: 2, kind: 'boost', name: 'Прилавок у дороги', cost: 6000, boost: 0.05, costMult: 2, tier: 0, max: 10,
                desc: '«ЯЙЦА деревенские». Каждый уровень — +5% ко всему доходу.' },
  garden:     { product: 'veg', lvl: 2, kind: 'prod', name: 'Огород', cost: 1900, inc: 69.4, unit: 'кг', price: 25, tier: 0, max: 10,
                season: months(2, 6), seasonText: 'май – сентябрь', desc: 'Грядки на дедовом поле.' },
  fence:      { lvl: 2, kind: 'once', name: 'Забор', cost: 6000, tier: 0, desc: 'Сетка вокруг двора. Лиса не пройдёт.' },
  greenhouse: { product: 'cuke', lvl: 1, kind: 'prod', name: 'Теплица из окон деда', cost: 1000, inc: 42.3, unit: 'кг', price: 60, tier: 0, max: 10,
                season: (m, st) => (m <= 8 ? 1 : st?.lv?.stove ? 1.5 : 0), seasonText: 'март – ноябрь, зимой — с печкой',
                desc: 'Дед хранил старые рамы. Собираем из них теплицу!' },
  stove:      { lvl: 4, kind: 'once', name: 'Печка в теплицу', cost: 30000, tier: 0, requires: 'greenhouse',
                desc: 'Буржуйка: зимой теплица работает и даёт ×1.5 (огурцы втридорога).' },
  apiary:     { product: 'honey', lvl: 3, kind: 'prod', name: 'Пасека', cost: 3400, inc: 115.7, unit: 'кг мёда', price: 600, tier: 0, max: 10,
                season: months(3, 5), seasonText: 'мёд июнь – август', desc: 'Ульи. Мёд только летом, зато дорогой.' },
  omshanik:   { lvl: 3, kind: 'once', name: 'Омшаник', cost: 20000, tier: 0, requires: 'apiary',
                desc: 'Зимний домик для пчёл. Без него в декабре пасека откатится на 1-й уровень.' },
  cow:        { product: 'milk', lvl: 4, kind: 'prod', name: 'Корова', cost: 18000, inc: 400, unit: 'л молока', price: 60, tier: 0, max: 10,
                season: (m) => (m >= 9 ? 0.8 : 1), seasonText: 'круглый год', desc: 'Корова — дорогое удовольствие: забирает все деньги, зато молоко каждый день и много. Каждый уровень — ещё корова.' },
  // --- Река и луг (после 1 млн) ---
  honeyfield: { loc: 'river', product: 'honey', kind: 'prod', name: 'Пасека-поле', cost: 3000000, inc: 60000, unit: 'кг мёда', price: 600, tier: 1, max: 10,
                season: months(2, 6), seasonText: 'май – сентябрь', desc: 'Луг медоносов у реки и сотня ульев.' },
  cowshed:    { loc: 'river', product: 'milk', kind: 'prod', name: 'Коровник', cost: 1200000, inc: 25000, unit: 'л молока', price: 60, tier: 1, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Большой коровник у заливного луга. Молоко — для сыра и заказов.' },
  cheese:     { loc: 'river', product: 'cheese', kind: 'prod', name: 'Сыроварня', cost: 1500000, inc: 30000, unit: 'кг сыра', price: 900, tier: 1, max: 10, requires: 'cowshed',
                season: always, seasonText: 'круглый год', desc: 'Сыр из своего молока — самый дорогой товар для заказов.' },
  mill:       { loc: 'river', product: 'flour', kind: 'prod', name: 'Мельница', cost: 2000000, inc: 40000, unit: 'мешков муки', price: 300, tier: 1, max: 10,
                season: (m) => (m >= 9 ? 0.5 : 1), seasonText: 'круглый год, зимой река мелеет', desc: 'Ветряк на холме у реки мелет муку.' },
  // --- Райцентр (после 10 млн) ---
  shop:       { loc: 'town', product: 'goods', kind: 'prod', name: 'Магазин «Ферма деда»', cost: 15000000, inc: 80000, unit: 'чеков', price: 1500, tier: 2, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Своя лавка в райцентре — всё с нашей фермы.' },
  cafe:       { loc: 'town', product: 'pie', kind: 'prod', name: 'Кафе', cost: 25000000, inc: 130000, unit: 'пирогов', price: 800, tier: 2, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Пироги с нашим сыром, мёдом и молоком.' },
  market:     { loc: 'town', kind: 'orders', name: 'Рынок', cost: 20000000, orderBoost: 0.2, costMult: 2, tier: 2, max: 10,
                desc: 'Место на рынке райцентра: все заказы платят на 20% дороже за уровень.' },
  // --- Агрохолдинг (после 100 млн) ---
  tractor:    { loc: 'agro', product: 'grain', kind: 'prod', name: 'Большие поля', cost: 150000000, inc: 400000, unit: 'т зерна', price: 15000, tier: 3, max: 10,
                season: months(2, 7), seasonText: 'май – октябрь', desc: 'Гектары полей и свой трактор.' },
  elevator:   { loc: 'agro', product: 'grain', kind: 'prod', name: 'Элеватор', cost: 250000000, inc: 600000, unit: 'т зерна', price: 15000, tier: 3, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Хранит зерно и продаёт его круглый год.' },
  brand:      { loc: 'agro', kind: 'boost', name: 'Своя марка «Ферма деда»', cost: 400000000, boost: 0.25, costMult: 2.5, tier: 3, max: 10,
                desc: 'Наша марка на полках страны. +25% ко всему доходу за уровень.' },
  factory:    { loc: 'agro', product: 'goods', kind: 'prod', name: 'Завод', cost: 2000000000, inc: 4000000, unit: 'т продукции', price: 50000, tier: 5, max: 10,
                season: always, seasonText: 'круглый год', desc: 'Свой перерабатывающий завод. Ферма деда — бренд страны!' },
};
export const BUILD_ORDER = Object.keys(BUILDINGS);

// Локации: открываются целями. На каждой — свой фон, постройки и письмо деда при открытии.
export const LOCATIONS = [
  { id: 'home',  name: 'Ферма деда',  emoji: '🏡', tier: 0, about: 'Дом, сарай, курятник, огород и теплица.' },
  { id: 'river', name: 'Река и луг',  emoji: '🎣', tier: 1, about: 'Пруд с рыбалкой, коровник, мельница и сыроварня.',
    letter: 'За рекой — заливной луг, где я косил сено. Поставь там коровник и мельницу, а у пруда отдохни с удочкой. Лучший клёв — на рассвете!' },
  { id: 'town',  name: 'Райцентр',    emoji: '🏘', tier: 2, about: 'Свой магазин, кафе и место на рынке.',
    letter: 'Помню, возил я в райцентр яйца на телеге. А теперь там будет наш магазин! Цену держи честную — люди это помнят.' },
  { id: 'agro',  name: 'Агрохолдинг', emoji: '🚜', tier: 3, about: 'Большие поля, элеватор и своя марка.',
    letter: 'Вот это размах, внучек! Поля до горизонта. Только не забывай, с чего начинал: с десяти кур и старых рам.' },
];
export const locOf = (id) => BUILDINGS[id]?.loc || 'home';

// Продукция: иконка, название, цена на прилавке за единицу (заказы платят больше)
export const PRODUCTS = {
  egg:    { name: 'яйца',    emoji: '🥚', price: 12,    unit: 'шт' },
  veg:    { name: 'овощи',   emoji: '🍅', price: 25,    unit: 'кг' },
  cuke:   { name: 'огурцы',  emoji: '🥒', price: 60,    unit: 'кг' },
  honey:  { name: 'мёд',     emoji: '🍯', price: 600,   unit: 'кг' },
  milk:   { name: 'молоко',  emoji: '🥛', price: 60,    unit: 'л' },
  cheese: { name: 'сыр',     emoji: '🧀', price: 900,   unit: 'кг' },
  fish:   { name: 'рыба',    emoji: '🐟', price: 400,   unit: 'шт' },
  flour:  { name: 'мука',    emoji: '🥖', price: 300,   unit: 'мешок' },
  grain:  { name: 'зерно',   emoji: '🌾', price: 15000, unit: 'т' },
  goods:  { name: 'товары',  emoji: '📦', price: 1500,  unit: 'шт' },
  pie:    { name: 'пироги',  emoji: '🥧', price: 800,   unit: 'шт' },
};
// Заказчики на доске заказов
export const CLIENTS = [
  { id: 'cafe',  name: 'Кафе «У трассы»', emoji: '☕', mult: 1.3 },
  { id: 'dacha', name: 'Дачники',          emoji: '🏡', mult: 1.25 },
  { id: 'store', name: 'Магазин в селе',   emoji: '🏪', mult: 1.35 },
];
export const ORDER_SLOTS = 3;
// Работники: нанимаются за игровые ₽ (не за Stars), открываются по уровню фермы, зарплата — раз в месяц.
// hireMin — цена найма в минутах дохода фермы (фиксируется, когда работник открылся), wage — доля собранного за месяц.
export const WORKERS = {
  helper:    { lvl: 3, name: 'Помощник Ваня',   role: 'Помощник',  hireMin: 12, wage: 0.04, every: 5,
               desc: 'Сам собирает урожай со всех построек раз в 5 минут — и откладывает нужное в заказы.', at: 'barn' },
  henwife:   { lvl: 4, name: 'Птичница Галя',   role: 'Птичница',  hireMin: 14, wage: 0.03, bonus: { coop: 0.25 },
               desc: 'Курятник +25%, а зимой куры несутся как летом (не вдвое меньше).', at: 'coop' },
  beekeeper: { lvl: 5, name: 'Пасечник Михалыч', role: 'Пасечник', hireMin: 15, wage: 0.035, bonus: { apiary: 0.25, honeyfield: 0.25 },
               desc: 'Пасека +25%. Знает, как пчёлам перезимовать: омшаник не нужен.', at: 'apiary' },
  milkmaid:  { lvl: 5, name: 'Доярка Люба',     role: 'Доярка',    hireMin: 15, wage: 0.035, bonus: { cow: 0.25, cowshed: 0.25 },
               desc: 'Корова и коровник +25% молока.', at: 'cow' },
  seller:    { lvl: 6, name: 'Продавец Света',  role: 'Продавец',  hireMin: 18, wage: 0.05, all: 0.10,
               desc: 'Стоит за прилавком и зазывает покупателей: ещё +10% ко всему доходу.', at: 'stall' },
  driver:    { lvl: 7, name: 'Водитель Коля',   role: 'Водитель',  hireMin: 20, wage: 0.04,
               desc: 'Сам отвозит готовые обычные заказы (кроме большого заказа дня).', at: 'board' },
};
export const WORKER_ORDER = Object.keys(WORKERS);

// Рыбалка и щенок
export const FISH_PER_DAY = 3;                 // не чаще 3 раз в день
export const FISH_GAME_MS = 20000;             // 20 секунд на заход
export const DOG_PET_MS = 4 * 3600000;         // погладить — раз в 4 часа
export const DOG_BOOST_MS = 30 * 60000;        // бонус держится 30 минут
export const DOG_BONUS = 0.1;                  // +10% к доходу
export const ORDER_REFILL_MIN = [2, 5];     // новый заказ после выполнения — через 2–5 мин
export const ORDER_DECLINE_MIN = 10;        // после отказа — через 10 мин
// Уровень фермы: опыт (⭐) за заказы, постройки и ремонт. Сколько всего опыта нужно для уровня n
export const xpForLevel = (n) => (n <= 1 ? 0 : Math.round(30 * (n - 1) ** 1.7));
export const XP = { build: 8, repair: 60, order: [12, 30], big: 80 };

// Ремонт дома деда: 5 этапов, каждый +3% ко всему доходу и новое письмо деда
export const HOUSE_BONUS = 0.03;
export const HOUSE_STAGES = [
  { id: 'roof',    name: 'Крыша',   emoji: '🏚', cost: 15000,   desc: 'Закрыть дыры, перекрыть крышу.' },
  { id: 'windows', name: 'Окна',    emoji: '🪟', cost: 60000,   desc: 'Снять доски, вставить стёкла, повесить занавески.' },
  { id: 'porch',   name: 'Крыльцо', emoji: '🪵', cost: 250000,  desc: 'Новое крыльцо с навесом — как при деде.' },
  { id: 'stove',   name: 'Печь',    emoji: '🔥', cost: 1000000, desc: 'Переложить печь — в доме снова тепло.' },
  { id: 'rooms',   name: 'Комнаты', emoji: '🛋', cost: 4000000, desc: 'Обои, мебель, цветы на окнах. Дом живой!' },
];
// Письма деда: первое — сразу, дальше по одному за каждый этап ремонта
export const LETTERS = [
  { title: 'Первое письмо', text: 'Внучек, ферма — это не стены, а руки. Начни с малого: убери двор и заведи кур, они всегда кормили нашу семью.' },
  { title: 'Про крышу', text: 'Крышу я всё собирался перекрыть, да руки не дошли. Раз ты читаешь это под новой крышей — значит, ты здесь хозяин. Горжусь.' },
  { title: 'Про окна', text: 'Эти окна смотрят на поле, где я встречал рассветы с твоей бабушкой. Протри их как следует — и увидишь, какая здесь красота.' },
  { title: 'Про крыльцо', text: 'На этом крыльце мы пили чай с соседями по вечерам. Заведи собаку — без неё двор пустой, а с ней и работа веселее.' },
  { title: 'Про печь', text: 'Печь — сердце дома. Пока она топится, никакой мороз не страшен ни людям, ни огурцам. Береги тепло, внучек.' },
  { title: 'Последнее письмо', text: 'Ну вот, дом снова живой. Я знал, что у тебя получится. Веди ферму дальше, а я буду смотреть и радоваться. Твой дед.' },
];
export const PRODUCERS = BUILD_ORDER.filter(id => BUILDINGS[id].kind === 'prod');
// Сверх 5-й цели максимальный уровень растёт: +5 за каждую следующую цель
// Открытые уровни: до 1 млн — 1–5, дальше +1 уровень за каждые две цели (10-й — после 1 трлн), потом +5 за цель
export const levelCap = (tier) => (tier <= 10 ? 5 + Math.floor(tier / 2) : 10 + (tier - 10) * 5);
export const maxLevel = (id, tier) => (BUILDINGS[id].kind === 'once' ? 1 : Math.min(BUILDINGS[id].max + Math.max(0, tier - 10) * 5, levelCap(tier)));

// Достижения-открытки (раньше — концовки). Игра теперь бесконечная.
export const ACHIEVEMENTS = {
  millionaire: { title: 'Миллионер', sub: 'Дедова ферма стала настоящим бизнесом! Открыта «Река и луг».', color: '#e8a21a', art: 'millionaire' },
  alive:       { title: 'Ферма живёт', sub: 'Прожили на ферме целый год. Дед был бы рад.', color: '#3fa34d', art: 'alive' },
  sold:        { title: 'Продал ферму соседу', sub: 'Полфермы ушло соседу. Зато опыт!', color: '#8a5a3c', art: 'sold' },
  frozen:      { title: 'Ферма замёрзла', sub: 'Мороз −35° взял своё. Но мы оттаяли!', color: '#4a90d9', art: 'frozen' },
  goal1:       { title: '10 миллионов', sub: 'Открыт Райцентр — свой магазин, кафе и рынок!', color: '#e8a21a', art: 'millionaire' },
  goal2:       { title: '100 миллионов', sub: 'Открыт Агрохолдинг — поля до горизонта!', color: '#d8392d', art: 'millionaire' },
  goal3:       { title: 'Миллиард', sub: 'Ферму деда знает вся страна!', color: '#7a4ec9', art: 'millionaire' },
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
