// Чистые данные игры: месяцы, постройки, экономика, концовки.
// Никакого DOM — файл импортируется и в браузере, и в Node (симуляция баланса).

export const SCHEMA_VERSION = 1;
export const START_MONEY = 10_000;
export const GOAL = 1_000_000;
export const MONTH_FILL_SEC = 60;      // за сколько секунд реального времени постройка «накапливает» месячную норму
export const UNCOLLECTED_SHARE = 0.5;  // несобранное продаётся за полцены
export const SCRAP_BONUS = 5000;       // награда за уборку: металлолом деда

// Игровой год: март → февраль (12 ходов)
export const MONTHS = [
  { name: 'Март',     gen: 'марта',    season: 'early',  trees: 'bare'    },
  { name: 'Апрель',   gen: 'апреля',   season: 'spring', trees: 'buds'    },
  { name: 'Май',      gen: 'мая',      season: 'spring', trees: 'blossom' },
  { name: 'Июнь',     gen: 'июня',     season: 'summer', trees: 'full'    },
  { name: 'Июль',     gen: 'июля',     season: 'summer', trees: 'full'    },
  { name: 'Август',   gen: 'августа',  season: 'summer', trees: 'apples'  },
  { name: 'Сентябрь', gen: 'сентября', season: 'autumn', trees: 'autumn'  },
  { name: 'Октябрь',  gen: 'октября',  season: 'autumn', trees: 'autumn'  },
  { name: 'Ноябрь',   gen: 'ноября',   season: 'late',   trees: 'bare'    },
  { name: 'Декабрь',  gen: 'декабря',  season: 'winter', trees: 'snow'    },
  { name: 'Январь',   gen: 'января',   season: 'winter', trees: 'snow'    },
  { name: 'Февраль',  gen: 'февраля',  season: 'winter', trees: 'snow'    },
];
export const isWinter = (m) => MONTHS[m].season === 'winter';
export const isSummer = (m) => MONTHS[m].season === 'summer';
export const SEASON_ICON = { early: 'sprout', spring: 'sprout', summer: 'sun', autumn: 'leaf', late: 'leaf', winter: 'flake' };

// Постройки. Формулы дохода — в engine.js (PRODUCTS + monthlyOutput)
export const BUILDINGS = {
  coop:       { name: 'Курятник', price: 8000, income: '≈ 3 000 ₽/мес на 10 кур', season: 'круглый год, зимой вдвое меньше',
                desc: '10 кур несут яйца. Тапай по курятнику — собирай. Кур можно докупать.' },
  stall:      { name: 'Прилавок у дороги', price: 3000, income: '+25% к продажам', season: 'летом +50% (дачники)',
                desc: '«ЯЙЦА деревенские». Всё продаётся дороже.' },
  garden:     { name: 'Огород', price: 2000, income: '≈ 10 000 ₽/мес', season: 'май – сентябрь',
                desc: 'Грядки на дедовом поле. Урожай собирать тапами.' },
  fence:      { name: 'Забор', price: 6000, income: 'защита', season: 'всегда',
                desc: 'Сетка вокруг двора. Лиса не пройдёт.' },
  greenhouse: { name: 'Теплица из окон деда', price: 15000, income: '≈ 18 000 ₽/мес', season: 'март – ноябрь',
                desc: 'Дед хранил старые рамы. Собираем из них теплицу!' },
  stove:      { name: 'Печка в теплицу', price: 20000, income: 'зимние огурцы ≈ 37 000 ₽/мес', season: 'декабрь – февраль',
                desc: 'Буржуйка: теплица работает и в мороз. Дрова 5 000 ₽/мес.', requires: 'greenhouse' },
  apiary:     { name: 'Пасека', price: 25000, income: '≈ 12 000 ₽/улей в мес', season: 'мёд июнь – август',
                desc: '3 улья для начала. Мёд — только летом, зато дорого.' },
  omshanik:   { name: 'Омшаник', price: 15000, income: 'ульи живы зимой', season: 'зима',
                desc: 'Зимний домик для пчёл. Без него в декабре ульи замёрзнут.', requires: 'apiary' },
  cow:        { name: 'Корова', price: 60000, income: '≈ 30 000 ₽/мес', season: 'круглый год',
                desc: 'Молоко каждый день. Дорого, но надёжно. Корм 5–8 тыс. ₽/мес.' },
};
export const BUILD_ORDER = ['coop', 'stall', 'garden', 'fence', 'greenhouse', 'stove', 'apiary', 'omshanik', 'cow'];

// Докупка животных
export const UNITS = {
  hens:  { name: '+10 кур', price: 4000, step: 10, max: 60, requires: 'coop', label: 'Докупить 10 кур' },
  hives: { name: '+1 улей', price: 7000, step: 1, max: 15, requires: 'apiary', label: 'Докупить улей' },
};

// Продукция: месячная норма (cap) и цена за единицу
export const PRODUCTS = {
  coop:       { unit: 'яиц',    price: 14 },
  garden:     { unit: 'кг',     price: 25 },
  greenhouse: { unit: 'кг',     price: 60 },
  apiary:     { unit: 'кг мёда', price: 600 },
  cow:        { unit: 'л молока', price: 60 },
};

// Расходы
export const COSTS = {
  base: 1000,          // свет, налог
  heating: 3000,       // зима: отопление дома
  henFeed: 40, henFeedWinter: 60,
  cowFeed: 5000, cowFeedWinter: 8000,
  gardenSeeds: 1000,
  greenhouse: 1500,
  firewood: 5000,
  helper: 4000,
  loanRate: 0.05,
};

// Стоимость хозяйства в капитале
export const ASSET_SHARE = 0.5;
export const HEN_VALUE = 200;
export const HIVE_VALUE = 3500;

export const ENDINGS = {
  millionaire: { title: 'Миллионер', sub: 'Дедова ферма стала настоящим бизнесом!', color: '#e8a21a' },
  alive:       { title: 'Ферма живёт', sub: 'До миллиона не дотянули, но ферма в плюсе. Дед был бы рад.', color: '#3fa34d' },
  sold:        { title: 'Продал ферму соседу', sub: 'Деньги в кармане, а куры теперь соседские…', color: '#8a5a3c' },
  frozen:      { title: 'Ферма замёрзла', sub: 'Долги и холод взяли своё. Попробуем ещё раз?', color: '#4a90d9' },
};
export const ENDING_ORDER = ['millionaire', 'alive', 'sold', 'frozen'];

// Мусор на заброшенной ферме: hp = сколько тапов
export const TRASH = [
  { id: 'w1', type: 'weeds', x: 232, y: 452, hp: 1 }, { id: 'w2', type: 'weeds', x: 300, y: 470, hp: 1 },
  { id: 'w3', type: 'weeds', x: 375, y: 455, hp: 1 }, { id: 'w4', type: 'weeds', x: 260, y: 520, hp: 1 },
  { id: 'w5', type: 'weeds', x: 345, y: 528, hp: 1 }, { id: 'w6', type: 'weeds', x: 420, y: 515, hp: 1 },
  { id: 't1', type: 'tire',  x: 70,  y: 585, hp: 2 }, { id: 't2', type: 'tire',  x: 128, y: 596, hp: 2 },
  { id: 'p1', type: 'planks',x: 92,  y: 488, hp: 2 }, { id: 'b1', type: 'barrel',x: 300, y: 596, hp: 2 },
  { id: 'c1', type: 'cart',  x: 395, y: 600, hp: 3 }, { id: 'g1', type: 'bags',  x: 360, y: 400, hp: 2 },
  { id: 'w7', type: 'weeds', x: 175, y: 560, hp: 1 }, { id: 'k1', type: 'bucket',x: 205, y: 618, hp: 1 },
];
export const FIELD_WEEDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];

// Задел на будущее: лавка «Ярмарка» за Telegram Stars (в v1 пусто).
// Покупки — только косметика/удобство, флаг affectsRating всегда false.
export const SHOP_ITEMS = [];
