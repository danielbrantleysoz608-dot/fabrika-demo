// События месяца: карточка с выбором из 2 вариантов (как голосование в серии).
// months — номера ходов (0 = март … 11 = февраль); cond — когда событие возможно;
// option.can — вернуть строку-причину, если вариант недоступен;
// option.effect(st, h) — меняет состояние, возвращает текст для итогов месяца.
// h — помощники из engine.js: fmt, pay, gain, mod, next, lose.

const SPRING = [0, 1, 2], SUMMER = [3, 4, 5], AUTUMN = [6, 7, 8], WINTER = [9, 10, 11];
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const need = (st, sum) => (st.money < sum ? `нужно ${sum.toLocaleString('ru-RU')} ₽` : null);

export const EVENTS = [
  {
    id: 'beekeeper', months: [1, 2], weight: 3,
    kicker: 'Предложение', title: 'Пасечник <em>продаёт ульи</em>',
    text: 'Старый пасечник Михалыч уезжает к дочке в город и отдаёт ульи со скидкой.',
    options: [
      { icon: 'hive', label: 'Купить', desc: (st) => st.built.apiary ? '+3 улья за 12 000 ₽' : 'пасека с 3 ульями за 15 000 ₽',
        can: (st) => need(st, st.built.apiary ? 12000 : 15000),
        effect: (st, h) => {
          if (st.built.apiary) { h.pay(12000, 'Ульи Михалыча'); st.hives = Math.min(15, st.hives + 3); return 'Купили 3 улья у Михалыча.'; }
          h.pay(15000, 'Пасека Михалыча'); st.built.apiary = true; st.hives = 3; return 'Своя пасека! 3 улья за полцены.';
        } },
      { icon: 'no', label: 'Отказаться', desc: 'деньги целее', effect: () => 'Михалыч уехал с ульями.' },
    ],
  },
  {
    id: 'frost', months: [0, 1], weight: 3,
    kicker: 'Погода', title: 'Заморозок <em>−20°</em>',
    text: 'Ночью обещают мороз. Рассада и куры под угрозой.',
    options: [
      { icon: 'blanket', label: 'Укрыть всё', desc: '−3 000 ₽ на плёнку и обогрев', can: (st) => need(st, 3000),
        effect: (st, h) => { h.pay(3000, 'Плёнка и обогрев'); return 'Укрыли — всё живо.'; } },
      { icon: 'dice', label: 'Рискнуть', desc: 'теплица и куры −50% в этом месяце',
        effect: (st, h) => { h.mod('greenhouse', 0.5); h.mod('coop', 0.5); return 'Мороз побил рассаду, куры не неслись.'; } },
    ],
  },
  {
    id: 'land', months: [1, 2, 3], weight: 2, cond: (st) => !st.built.garden,
    kicker: 'Сосед', title: 'Сосед хочет <em>купить поле</em>',
    text: 'Дедово поле под огород приглянулось соседу. Предлагает 30 000 ₽ сразу.',
    options: [
      { icon: 'money', label: 'Продать', desc: '+30 000 ₽, огорода не будет',
        effect: (st, h) => { h.gain(30000, 'Продажа поля'); st.flags.fieldSold = true; return 'Поле теперь соседское. Зато +30 000 ₽.'; } },
      { icon: 'no', label: 'Не продам', desc: 'дедова земля!', effect: () => 'Дедову землю не продаём.' },
    ],
  },
  {
    id: 'fox', months: [1, 2, 3, 4, 5, 6, 7, 8], weight: 4, cond: (st) => st.built.coop && st.hens > 0,
    kicker: 'Тревога', title: 'Лиса <em>у курятника!</em>',
    text: (st) => st.built.fence ? 'Лиса ходит вдоль сетки. Забор держит, но она не уходит…' : 'Ночью у курятника видели следы. Забора-то нет!',
    options: [
      { icon: 'trap', label: 'Капканы', desc: '−2 000 ₽, куры целы', can: (st) => need(st, 2000),
        effect: (st, h) => { h.pay(2000, 'Капканы'); return 'Лиса ушла ни с чем.'; } },
      { icon: 'dice', label: 'И так сойдёт', desc: (st) => st.built.fence ? 'забор защитит' : 'без забора — минус куры',
        effect: (st, h) => {
          if (st.built.fence) return 'Забор не подвёл — лиса ушла ни с чем.';
          const lost = Math.max(1, Math.round(st.hens * 0.4)); st.hens -= lost; return `Лиса утащила ${lost} кур. Нужен забор!`;
        } },
    ],
  },
  {
    id: 'cafe', months: [3, 4], weight: 3, cond: (st) => st.built.coop || st.built.garden || st.built.greenhouse,
    kicker: 'Заказ', title: 'Кафе хочет <em>заказ</em>',
    text: 'Кафе «У трассы» хочет брать нашу продукцию 3 месяца по повышенной цене.',
    options: [
      { icon: 'cafe', label: 'Контракт', desc: '3 месяца +30% к продажам, но выручка < 15 000 ₽ — штраф 10 000 ₽',
        effect: (st) => { st.flags.contract = { left: 3, min: 15000, fine: 10000 }; return 'Подписали контракт с кафе.'; } },
      { icon: 'stall', label: 'Сами продадим', desc: 'без обязательств', effect: () => 'Кафе нашло другого поставщика.' },
    ],
  },
  {
    id: 'drought', months: [4, 5], weight: 3, cond: (st) => st.built.garden || st.built.apiary,
    kicker: 'Погода', title: 'Засуха!',
    text: 'Месяц без дождя. Огород сохнет, пчёлам нечего собирать.',
    options: [
      { icon: 'water', label: 'Полив', desc: '−6 000 ₽ на насос и шланги', can: (st) => need(st, 6000),
        effect: (st, h) => { h.pay(6000, 'Полив'); return 'Насос спас урожай.'; } },
      { icon: 'dice', label: 'Ждать дождя', desc: 'огород и мёд −40%',
        effect: (st, h) => { h.mod('garden', 0.6); h.mod('apiary', 0.6); return 'Дождь так и не пришёл. Урожай меньше.'; } },
    ],
  },
  {
    id: 'blogger', months: [3, 4, 5, 6], weight: 2,
    kicker: 'Гости', title: 'Блогер хочет <em>снять ролик</em>',
    text: 'Блогер с миллионом подписчиков хочет снять про ферму деда.',
    options: [
      { icon: 'camera', label: 'Пустить', desc: 'следующий месяц продажи ×1.5, но день без работы (−20% сбора сейчас)',
        effect: (st, h) => { h.next('sales', 1.5); h.modAll(0.8); return 'Ролик вышел! Ждём покупателей.'; } },
      { icon: 'no', label: 'Не до того', desc: 'работаем', effect: () => 'Блогер уехал снимать соседа.' },
    ],
  },
  {
    id: 'swarm', months: [3, 4], weight: 3, cond: (st) => st.built.apiary && st.hives > 0,
    kicker: 'Пасека', title: 'Рой улетел <em>к соседу</em>',
    text: 'Пчёлы роем ушли на соседскую яблоню. Сосед готов вернуть — не бесплатно.',
    options: [
      { icon: 'money', label: 'Выкупить', desc: '−4 000 ₽, улей остаётся', can: (st) => need(st, 4000),
        effect: (st, h) => { h.pay(4000, 'Выкуп роя'); return 'Рой вернули в улей.'; } },
      { icon: 'no', label: 'Пусть летят', desc: '−1 улей', effect: (st) => { st.hives -= 1; return 'Минус один улей.'; } },
    ],
  },
  {
    id: 'loan', months: [1, 2, 6], weight: 2, cond: (st) => !st.debt,
    kicker: 'Банк', title: 'Банк предлагает <em>кредит</em>',
    text: 'Менеджер банка приехал лично: «100 000 ₽ на развитие фермы!»',
    options: [
      { icon: 'bank', label: 'Взять', desc: '+100 000 ₽, 5% в месяц, вернуть до конца года',
        effect: (st, h) => { h.gain(100000, 'Кредит'); st.debt = 100000; return 'Взяли кредит. Проценты — каждый месяц.'; } },
      { icon: 'no', label: 'Без долгов', desc: 'дед в долг не жил', effect: () => 'Обойдёмся без банка.' },
    ],
  },
  {
    id: 'fair', months: [6, 7], weight: 3,
    kicker: 'Ярмарка', title: 'Ярмарка <em>в райцентре</em>',
    text: 'Осенняя ярмарка! Народ скупает всё деревенское.',
    options: [
      { icon: 'truck', label: 'Везти всё', desc: 'продажи ×1.3, бензин −3 000 ₽', can: (st) => need(st, 3000),
        effect: (st, h) => { h.pay(3000, 'Бензин на ярмарку'); h.mod('sales', 1.3); return 'Распродали всё на ярмарке!'; } },
      { icon: 'stall', label: 'Остаться', desc: 'торгуем у дороги', effect: () => 'Остались дома.' },
    ],
  },
  {
    id: 'hail', months: [5, 6, 7], weight: 3, cond: (st) => st.built.greenhouse,
    kicker: 'Погода', title: 'Град <em>побил теплицу</em>',
    text: 'Град размером с вишню. Три дедовых рамы — вдребезги.',
    options: [
      { icon: 'tools', label: 'Ремонт', desc: '−8 000 ₽ на стёкла', can: (st) => need(st, 8000),
        effect: (st, h) => { h.pay(8000, 'Стёкла для теплицы'); return 'Вставили новые стёкла.'; } },
      { icon: 'dice', label: 'Плёнкой', desc: 'теплица −60% в этом и следующем месяце',
        effect: (st, h) => { h.mod('greenhouse', 0.4); h.next('greenhouse', 0.4); return 'Затянули плёнкой — урожай упал.'; } },
    ],
  },
  {
    id: 'cow_stove', months: [8, 9], weight: 4, cond: (st) => !st.built.cow || (st.built.greenhouse && !st.built.stove),
    kicker: 'Выбор', title: 'Корова <em>или</em> печка?',
    text: 'Знакомый продаёт и корову, и буржуйку со скидкой. Можно взять что-то одно.',
    options: [
      { icon: 'cow', label: 'Корова', desc: 'молоко каждый день — 45 000 ₽',
        can: (st) => st.built.cow ? 'корова уже есть' : need(st, 45000),
        effect: (st, h) => { h.pay(45000, 'Корова (со скидкой)'); st.built.cow = true; return 'Му-у! У нас корова.'; } },
      { icon: 'stove', label: 'Печка', desc: 'в теплицу — огурцы зимой, 14 000 ₽',
        can: (st) => !st.built.greenhouse ? 'нужна теплица' : st.built.stove ? 'печка уже есть' : need(st, 14000),
        effect: (st, h) => { h.pay(14000, 'Печка (со скидкой)'); st.built.stove = true; return 'Буржуйка в теплице!'; } },
    ],
  },
  {
    id: 'pipes', months: [9, 10], weight: 3, cond: (st) => st.built.cow || st.built.coop,
    kicker: 'Мороз', title: 'Трубы <em>замёрзли!</em>',
    text: 'В сарае лёд, поилки замёрзли. Животные без воды.',
    options: [
      { icon: 'tools', label: 'Мастер', desc: '−6 000 ₽, всё работает', can: (st) => need(st, 6000),
        effect: (st, h) => { h.pay(6000, 'Сантехник'); return 'Мастер отогрел трубы.'; } },
      { icon: 'bucket', label: 'Вёдрами', desc: 'корова и куры −50%',
        effect: (st, h) => { h.mod('cow', 0.5); h.mod('coop', 0.5); return 'Таскали воду вёдрами — надои упали.'; } },
    ],
  },
  {
    id: 'newyear', months: [9], weight: 4, cond: (st) => st.built.coop || st.built.apiary,
    kicker: 'Заказ', title: 'Новогодний <em>заказ</em>',
    text: 'Магазин в райцентре хочет яйца и мёд к Новому году. Платят сразу, но надо сдать вовремя.',
    options: [
      { icon: 'gift', label: 'Взять', desc: '+25 000 ₽ сейчас; если нет ≥20 кур или ≥3 ульев — штраф 15 000 ₽',
        effect: (st, h) => {
          h.gain(25000, 'Новогодний заказ');
          if (st.hens >= 20 || st.hives >= 3) return 'Заказ сдан — магазин доволен!';
          h.pay(15000, 'Штраф за срыв заказа'); return 'Не хватило продукции — заплатили штраф.';
        } },
      { icon: 'no', label: 'Отказаться', desc: 'не рискуем', effect: () => 'Отказались от заказа.' },
    ],
  },
  {
    id: 'sell_farm', months: [8, 9, 10], weight: 2, once: true,
    kicker: 'Сосед', title: 'Продай <em>ферму целиком</em>',
    text: (st, h) => `Сосед предлагает купить всю ферму: ${h.fmt(h.offer(st))}. Подумай…`,
    options: [
      { icon: 'money', label: 'Продать', desc: (st, h) => `${h.fmt(h.offer(st))} — и конец игры`,
        effect: (st, h) => { h.sellFarm(); return 'Ферма продана соседу.'; } },
      { icon: 'heart', label: 'Не продам', desc: '«дедову землю не продаю»', effect: () => 'Ферма остаётся в семье.' },
    ],
  },
  {
    id: 'helper', months: [2, 3, 4, 5, 6], weight: 2, cond: (st) => !st.flags.helper && Object.keys(st.built).length >= 2,
    kicker: 'Помощник', title: 'Внук соседа <em>хочет помогать</em>',
    text: 'Ваня на каникулах, хочет заработать. Будет собирать всё, что ты не успел.',
    options: [
      { icon: 'boy', label: 'Нанять', desc: 'несобранное — по полной цене, зарплата 4 000 ₽/мес',
        effect: (st) => { st.flags.helper = true; return 'Ваня теперь работает на ферме.'; } },
      { icon: 'no', label: 'Сами справимся', desc: 'экономим', effect: () => 'Справимся сами.' },
    ],
  },
  {
    id: 'grandpa_box', months: [0, 1, 2, 3], weight: 2,
    kicker: 'Находка', title: 'Сундук <em>деда</em>',
    text: 'На чердаке нашёлся дедов сундук: старые рамы, инструменты и… конверт.',
    options: [
      { icon: 'money', label: 'Конверт', desc: '+5 000 ₽ — дедова заначка',
        effect: (st, h) => { h.gain(5000, 'Дедова заначка'); return 'В конверте — 5 000 ₽ и записка «На ферму».'; } },
      { icon: 'tools', label: 'Рамы', desc: 'теплица дешевле на 7 000 ₽', can: (st) => st.built.greenhouse ? 'теплица уже есть' : null,
        effect: (st) => { st.flags.greenhouseDiscount = 7000; return 'Из дедовых рам теплица выйдет дешевле.'; } },
    ],
  },
  // запасное событие — если ничего не подошло
  {
    id: 'quiet', months: ALL, weight: 0.5, repeat: true,
    kicker: 'Тихий месяц', title: 'Тихо <em>на ферме</em>',
    text: 'Ни лис, ни гостей. Чем займёмся?',
    options: [
      { icon: 'stall', label: 'Торговать', desc: 'продажи +10% в этом месяце',
        effect: (st, h) => { h.mod('sales', 1.1); return 'Весь месяц стояли у прилавка.'; } },
      { icon: 'heart', label: 'Отдохнуть', desc: 'помощник доволен', effect: () => 'Отдохнули — тоже дело.' },
    ],
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));
export { SPRING, SUMMER, AUTUMN, WINTER };
