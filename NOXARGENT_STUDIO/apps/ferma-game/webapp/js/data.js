// Чистые данные игры: месяцы, сезоны, постройки.
// (События, концовки и баланс — на этапе «вся механика».)

export const START_MONEY = 10_000;
export const GOAL = 1_000_000;

// Игровой год: март → февраль (12 ходов)
export const MONTHS = [
  { name: 'Март',     season: 'early',  trees: 'bare'     },
  { name: 'Апрель',   season: 'spring', trees: 'buds'     },
  { name: 'Май',      season: 'spring', trees: 'blossom'  },
  { name: 'Июнь',     season: 'summer', trees: 'full'     },
  { name: 'Июль',     season: 'summer', trees: 'full'     },
  { name: 'Август',   season: 'summer', trees: 'apples'   },
  { name: 'Сентябрь', season: 'autumn', trees: 'autumn'   },
  { name: 'Октябрь',  season: 'autumn', trees: 'autumn'   },
  { name: 'Ноябрь',   season: 'late',   trees: 'bare'     },
  { name: 'Декабрь',  season: 'winter', trees: 'snow'     },
  { name: 'Январь',   season: 'winter', trees: 'snow'     },
  { name: 'Февраль',  season: 'winter', trees: 'snow'     },
];

export const SEASON_ICON = { early: 'sprout', spring: 'sprout', summer: 'sun', autumn: 'leaf', late: 'leaf', winter: 'flake' };

// Постройки. income — для карточки; точные формулы будут в engine.js
export const BUILDINGS = {
  coop:       { name: 'Курятник', price: 8000, income: '≈ 4 000 ₽/мес', season: 'круглый год, зимой меньше',
                desc: '10 кур несут яйца. Тапай по курятнику — собирай.', product: 'яиц', rate: 6, cap: 60 },
  stall:      { name: 'Прилавок у дороги', price: 3000, income: '+25% к продажам', season: 'летом +50% (дачники)',
                desc: '«ЯЙЦА деревенские». Всё продаётся дороже.' },
  garden:     { name: 'Огород', price: 2000, income: '≈ 6 000 ₽/мес', season: 'май – сентябрь',
                desc: 'Грядки на дедовом поле. Урожай собирать тапами.', product: 'кг', rate: 10, cap: 120 },
  fence:      { name: 'Забор', price: 6000, income: 'защита', season: 'всегда',
                desc: 'Сетка вокруг двора. Лиса не пройдёт.' },
  greenhouse: { name: 'Теплица из окон деда', price: 15000, income: '≈ 15 000 ₽/мес', season: 'март – ноябрь',
                desc: 'Дед хранил старые рамы. Собираем из них теплицу!', product: 'кг', rate: 8, cap: 100 },
  stove:      { name: 'Печка в теплицу', price: 20000, income: 'огурцы зимой ×3', season: 'зима',
                desc: 'Буржуйка: теплица работает и в мороз.', requires: 'greenhouse' },
  apiary:     { name: 'Пасека', price: 25000, income: '≈ 10 000 ₽/улей', season: 'мёд июнь – август',
                desc: '3 улья для начала. Мёд — тапами.', product: 'кг мёда', rate: 3, cap: 30 },
  omshanik:   { name: 'Омшаник', price: 15000, income: 'ульи живы зимой', season: 'зима',
                desc: 'Зимний домик для пчёл. Без него ульи замёрзнут.', requires: 'apiary' },
  cow:        { name: 'Корова', price: 60000, income: '≈ 25 000 ₽/мес', season: 'круглый год',
                desc: 'Молоко каждый день. Дорого, но надёжно.', product: 'л молока', rate: 8, cap: 80 },
};

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
