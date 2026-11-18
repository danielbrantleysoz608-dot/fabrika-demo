// События месяца: карточка с выбором из 2 вариантов (как голосование в серии).
// Выпадают в начале нового месяца; months — номера месяцев 0…11 (0 = март).
// Суммы масштабируются под размер фермы: h.amt(k) = k × месячный доход (S), округлённо.
// option.can(st, h) — причина, если вариант недоступен; option.effect(st, h) — текст для итогов.

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const need = (st, sum) => (st.money < sum ? `нужно ${Math.round(sum).toLocaleString('ru-RU')} ₽` : null);
import { maxLevel } from './data.js';
const lv = (st, id) => st.lv[id] || 0;
const canUp = (st, id) => lv(st, id) < maxLevel(id, st.tier);

export const EVENTS = [
  {
    id: 'beekeeper', months: [1, 2], weight: 3, cond: (st) => canUp(st, 'apiary'),
    kicker: 'Предложение', title: 'Пасечник <em>продаёт ульи</em>',
    text: 'Старый пасечник Михалыч уезжает к дочке в город и отдаёт ульи со скидкой 40%.',
    options: [
      { icon: 'hive', label: 'Купить', desc: (st, h) => `${lv(st, 'apiary') ? 'следующий уровень пасеки' : 'своя пасека'} за ${h.fmt(h.price('apiary') * 0.6)}`,
        can: (st, h) => need(st, h.price('apiary') * 0.6),
        effect: (st, h) => { h.pay(Math.round(h.price('apiary') * 0.6), 'Ульи Михалыча'); st.lv.apiary = lv(st, 'apiary') + 1; return 'Ульи Михалыча теперь наши!'; } },
      { icon: 'no', label: 'Отказаться', desc: 'деньги целее', effect: () => 'Михалыч уехал с ульями.' },
    ],
  },
  {
    id: 'frost', months: [0, 1], weight: 3,
    kicker: 'Погода', title: 'Заморозок <em>−20°</em>',
    text: 'Ночью обещают мороз. Рассада и куры под угрозой.',
    options: [
      { icon: 'blanket', label: 'Укрыть всё', desc: (st, h) => `${h.fmt(h.amt(0.08))} на плёнку и обогрев`, can: (st, h) => need(st, h.amt(0.08)),
        effect: (st, h) => { h.pay(h.amt(0.08), 'Плёнка и обогрев'); return 'Укрыли — всё живо.'; } },
      { icon: 'dice', label: 'Рискнуть', desc: 'теплица и куры −50% весь месяц',
        effect: (st, h) => { h.mod('greenhouse', 0.5); h.mod('coop', 0.5); return 'Мороз побил рассаду, куры не неслись.'; } },
    ],
  },
  {
    id: 'land', months: [1, 2, 3], weight: 2, cond: (st) => !lv(st, 'garden') && !st.flags.fieldSold,
    kicker: 'Сосед', title: 'Сосед хочет <em>купить поле</em>',
    text: (st, h) => `Дедово поле под огород приглянулось соседу. Предлагает ${h.fmt(h.amt(0.6))} сразу.`,
    options: [
      { icon: 'money', label: 'Продать', desc: 'деньги сейчас, но огорода не будет',
        effect: (st, h) => { h.gain(h.amt(0.6), 'Продажа поля'); st.flags.fieldSold = true; return 'Поле теперь соседское.'; } },
      { icon: 'no', label: 'Не продам', desc: 'дедова земля!', effect: () => 'Дедову землю не продаём.' },
    ],
  },
  {
    id: 'fox', months: [1, 2, 3, 4, 5, 6, 7, 8], weight: 4, cond: (st) => lv(st, 'coop') > 1,
    kicker: 'Тревога', title: 'Лиса <em>у курятника!</em>',
    text: (st) => (lv(st, 'fence') ? 'Лиса ходит вдоль сетки. Забор держит, но она не уходит…' : 'Ночью у курятника видели следы. Забора-то нет!'),
    options: [
      { icon: 'trap', label: 'Капканы', desc: (st, h) => `${h.fmt(h.amt(0.04))}, куры целы`, can: (st, h) => need(st, h.amt(0.04)),
        effect: (st, h) => { h.pay(h.amt(0.04), 'Капканы'); return 'Лиса ушла ни с чем.'; } },
      { icon: 'dice', label: 'И так сойдёт', desc: (st) => (lv(st, 'fence') ? 'забор защитит' : 'без забора курятник −1 уровень'),
        effect: (st) => {
          if (lv(st, 'fence')) return 'Забор не подвёл — лиса ушла ни с чем.';
          st.lv.coop -= 1; return 'Лиса утащила 10 кур (курятник −1 уровень). Нужен забор!';
        } },
    ],
  },
  {
    id: 'cafe', months: [3, 4], weight: 3, cond: (st) => lv(st, 'coop') || lv(st, 'garden') || lv(st, 'greenhouse'),
    kicker: 'Заказ', title: 'Кафе хочет <em>заказ</em>',
    text: 'Кафе «У трассы» хочет брать нашу продукцию 3 месяца по повышенной цене.',
    options: [
      { icon: 'cafe', label: 'Контракт', desc: (st, h) => `3 месяца +30% к доходу, но если за месяц соберёшь меньше ${h.fmt(h.amt(0.4))} — штраф ${h.fmt(h.amt(0.15))}`,
        effect: (st, h) => { st.flags.contract = { left: 3, min: h.amt(0.4), fine: h.amt(0.15) }; return 'Подписали контракт с кафе. Тапай чаще!'; } },
      { icon: 'stall', label: 'Сами продадим', desc: 'без обязательств', effect: () => 'Кафе нашло другого поставщика.' },
    ],
  },
  {
    id: 'drought', months: [4, 5], weight: 3, cond: (st) => lv(st, 'garden') || lv(st, 'apiary'),
    kicker: 'Погода', title: 'Засуха!',
    text: 'Месяц без дождя. Огород сохнет, пчёлам нечего собирать.',
    options: [
      { icon: 'water', label: 'Полив', desc: (st, h) => `${h.fmt(h.amt(0.07))} на насос и шланги`, can: (st, h) => need(st, h.amt(0.07)),
        effect: (st, h) => { h.pay(h.amt(0.07), 'Полив'); return 'Насос спас урожай.'; } },
      { icon: 'dice', label: 'Ждать дождя', desc: 'огород и мёд −40% весь месяц',
        effect: (st, h) => { h.mod('garden', 0.6); h.mod('apiary', 0.6); h.mod('honeyfield', 0.6); return 'Дождь так и не пришёл.'; } },
    ],
  },
  {
    id: 'blogger', months: [3, 4, 5, 6], weight: 2,
    kicker: 'Гости', title: 'Блогер хочет <em>снять ролик</em>',
    text: 'Блогер с миллионом подписчиков хочет снять про ферму деда. Просит оплатить дорогу.',
    options: [
      { icon: 'camera', label: 'Пустить', desc: (st, h) => `${h.fmt(h.amt(0.06))}, весь месяц доход +30%`, can: (st, h) => need(st, h.amt(0.06)),
        effect: (st, h) => { h.pay(h.amt(0.06), 'Дорога блогеру'); h.mod('sales', 1.3); return 'Ролик вышел! Покупатели едут.'; } },
      { icon: 'no', label: 'Не до того', desc: 'работаем', effect: () => 'Блогер уехал снимать соседа.' },
    ],
  },
  {
    id: 'swarm', months: [3, 4], weight: 3, cond: (st) => lv(st, 'apiary') > 1,
    kicker: 'Пасека', title: 'Рой улетел <em>к соседу</em>',
    text: 'Пчёлы роем ушли на соседскую яблоню. Сосед готов вернуть — не бесплатно.',
    options: [
      { icon: 'money', label: 'Выкупить', desc: (st, h) => `${h.fmt(h.amt(0.05))}, пасека цела`, can: (st, h) => need(st, h.amt(0.05)),
        effect: (st, h) => { h.pay(h.amt(0.05), 'Выкуп роя'); return 'Рой вернули в улей.'; } },
      { icon: 'no', label: 'Пусть летят', desc: 'пасека −1 уровень', effect: (st) => { st.lv.apiary -= 1; return 'Пасека потеряла уровень.'; } },
    ],
  },
  {
    id: 'loan', months: [1, 6], weight: 2, cond: (st) => !st.debt,
    kicker: 'Банк', title: 'Банк предлагает <em>кредит</em>',
    text: (st, h) => `Менеджер банка приехал лично: «${h.fmt(h.amt(2))} на развитие фермы!»`,
    options: [
      { icon: 'bank', label: 'Взять', desc: '5% в месяц, вернуть можно в любой момент (Тетрадь → Расходы)',
        effect: (st, h) => { const s = h.amt(2); h.gain(s, 'Кредит'); st.debt = s; return 'Взяли кредит. Проценты — каждый месяц.'; } },
      { icon: 'no', label: 'Без долгов', desc: 'дед в долг не жил', effect: () => 'Обойдёмся без банка.' },
    ],
  },
  {
    id: 'fair', months: [6, 7], weight: 3,
    kicker: 'Ярмарка', title: 'Ярмарка <em>в райцентре</em>',
    text: 'Осенняя ярмарка! Народ скупает всё деревенское.',
    options: [
      { icon: 'truck', label: 'Везти всё', desc: (st, h) => `весь месяц доход +30%, бензин ${h.fmt(h.amt(0.05))}`, can: (st, h) => need(st, h.amt(0.05)),
        effect: (st, h) => { h.pay(h.amt(0.05), 'Бензин на ярмарку'); h.mod('sales', 1.3); return 'Торгуем на ярмарке весь месяц!'; } },
      { icon: 'stall', label: 'Остаться', desc: 'торгуем у дороги', effect: () => 'Остались дома.' },
    ],
  },
  {
    id: 'hail', months: [5, 6, 7], weight: 3, cond: (st) => lv(st, 'greenhouse'),
    kicker: 'Погода', title: 'Град <em>побил теплицу</em>',
    text: 'Град размером с вишню. Три дедовых рамы — вдребезги.',
    options: [
      { icon: 'tools', label: 'Ремонт', desc: (st, h) => `${h.fmt(h.amt(0.08))} на стёкла`, can: (st, h) => need(st, h.amt(0.08)),
        effect: (st, h) => { h.pay(h.amt(0.08), 'Стёкла для теплицы'); return 'Вставили новые стёкла.'; } },
      { icon: 'dice', label: 'Плёнкой', desc: 'теплица −60% в этом и следующем месяце',
        effect: (st, h) => { h.mod('greenhouse', 0.4); h.next('greenhouse', 0.4); return 'Затянули плёнкой — урожай упал.'; } },
    ],
  },
  {
    id: 'cow_stove', months: [8, 9], weight: 4, cond: (st) => !lv(st, 'cow') || (lv(st, 'greenhouse') && !lv(st, 'stove')),
    kicker: 'Выбор', title: 'Корова <em>или</em> печка?',
    text: 'Знакомый продаёт и корову, и буржуйку со скидкой 30%. Можно взять что-то одно.',
    options: [
      { icon: 'cow', label: 'Корова', desc: (st, h) => `молоко каждый день — ${h.fmt(h.price('cow') * 0.7)}`,
        can: (st, h) => (lv(st, 'cow') ? 'корова уже есть' : need(st, h.price('cow') * 0.7)),
        effect: (st, h) => { h.pay(Math.round(h.price('cow') * 0.7), 'Корова со скидкой'); st.lv.cow = 1; return 'Му-у! У нас корова.'; } },
      { icon: 'stove', label: 'Печка', desc: (st, h) => `в теплицу — огурцы зимой, ${h.fmt(h.price('stove') * 0.7)}`,
        can: (st, h) => (!lv(st, 'greenhouse') ? 'нужна теплица' : lv(st, 'stove') ? 'печка уже есть' : need(st, h.price('stove') * 0.7)),
        effect: (st, h) => { h.pay(Math.round(h.price('stove') * 0.7), 'Печка со скидкой'); st.lv.stove = 1; return 'Буржуйка в теплице!'; } },
    ],
  },
  {
    id: 'pipes', months: [9, 10], weight: 3, cond: (st) => lv(st, 'cow') || lv(st, 'coop'),
    kicker: 'Мороз', title: 'Трубы <em>замёрзли!</em>',
    text: 'В сарае лёд, поилки замёрзли. Животные без воды.',
    options: [
      { icon: 'tools', label: 'Мастер', desc: (st, h) => `${h.fmt(h.amt(0.06))}, всё работает`, can: (st, h) => need(st, h.amt(0.06)),
        effect: (st, h) => { h.pay(h.amt(0.06), 'Сантехник'); return 'Мастер отогрел трубы.'; } },
      { icon: 'bucket', label: 'Вёдрами', desc: 'корова и куры −50% весь месяц',
        effect: (st, h) => { h.mod('cow', 0.5); h.mod('coop', 0.5); return 'Таскаем воду вёдрами — надои упали.'; } },
    ],
  },
  {
    id: 'newyear', months: [9], weight: 4, cond: (st) => lv(st, 'coop') || lv(st, 'apiary'),
    kicker: 'Заказ', title: 'Новогодний <em>заказ</em>',
    text: 'Магазин в райцентре хочет яйца и мёд к Новому году. Платят сразу, но надо сдать вовремя.',
    options: [
      { icon: 'gift', label: 'Взять', desc: (st, h) => `+${h.fmt(h.amt(0.4))} сейчас; если курятник < 3 ур. и нет пасеки — штраф ${h.fmt(h.amt(0.6))}`,
        effect: (st, h) => {
          h.gain(h.amt(0.4), 'Новогодний заказ');
          if (lv(st, 'coop') >= 3 || lv(st, 'apiary')) return 'Заказ сдан — магазин доволен!';
          h.pay(h.amt(0.6), 'Штраф за срыв заказа'); return 'Не хватило продукции — заплатили штраф.';
        } },
      { icon: 'no', label: 'Отказаться', desc: 'не рискуем', effect: () => 'Отказались от заказа.' },
    ],
  },
  {
    id: 'deep_frost', months: [10, 11], weight: 3,
    kicker: 'Мороз', title: 'Мороз <em>−35°!</em>',
    text: 'Синоптики обещают неделю лютого мороза. Утеплим ферму?',
    options: [
      { icon: 'blanket', label: 'Утеплить', desc: (st, h) => `${h.fmt(h.amt(0.07))} на дрова и утеплитель`, can: (st, h) => need(st, h.amt(0.07)),
        effect: (st, h) => { h.pay(h.amt(0.07), 'Дрова и утеплитель'); return 'Перезимовали в тепле.'; } },
      { icon: 'dice', label: 'Переживём', desc: 'шанс 50%: ферма замёрзнет, весь доход −50% на месяц',
        effect: (st, h) => {
          if (!h.chance(0.5)) return 'Обошлось — мороз ударил по соседям.';
          h.modAll(0.5); h.ach('frozen'); return 'Ферма замёрзла! Весь месяц работаем вполсилы.';
        } },
    ],
  },
  {
    id: 'sell_farm', months: [8, 9, 10], weight: 2, once: true, cond: (st) => (st.lv.coop || 0) >= 2,
    kicker: 'Сосед', title: 'Сосед хочет <em>купить ферму</em>',
    text: 'Сосед давно положил глаз на дедову ферму. Готов взять половину хозяйства — деньги сразу.',
    options: [
      { icon: 'money', label: 'Продать половину', desc: (st, h) => `+${h.fmt(h.buildingsValue() * 0.4)}, все постройки потеряют половину уровней`,
        effect: (st, h) => {
          const before = h.buildingsValue();
          for (const id of Object.keys(st.lv)) if (st.lv[id] > 1) st.lv[id] = Math.ceil(st.lv[id] / 2);
          h.gain(Math.round(before * 0.4), 'Сосед купил полфермы');
          h.ach('sold'); return 'Полфермы теперь у соседа. Строимся заново!';
        } },
      { icon: 'heart', label: 'Не продам', desc: '«дедову землю не продаю»', effect: () => 'Ферма остаётся в семье.' },
    ],
  },
  {
    id: 'helper', months: [2, 3, 4, 5, 6], weight: 2, cond: (st) => !st.flags.helper && Object.keys(st.lv).length >= 3,
    kicker: 'Помощник', title: 'Внук соседа <em>хочет помогать</em>',
    text: 'Ваня на каникулах, хочет заработать. 3 месяца будет сам собирать всё, что произвела ферма.',
    options: [
      { icon: 'boy', label: 'Нанять', desc: (st, h) => `сбор сам идёт в кошелёк, зарплата ${h.fmt(h.amt(0.08))}/мес`,
        effect: (st) => { st.flags.helper = { left: 3 }; return 'Ваня теперь работает на ферме.'; } },
      { icon: 'no', label: 'Сами справимся', desc: 'экономим', effect: () => 'Справимся сами.' },
    ],
  },
  {
    id: 'grandpa_box', months: [0, 1, 2, 3], weight: 2,
    kicker: 'Находка', title: 'Сундук <em>деда</em>',
    text: 'На чердаке нашёлся дедов сундук: старые рамы, инструменты и… конверт.',
    options: [
      { icon: 'money', label: 'Конверт', desc: (st, h) => `+${h.fmt(h.amt(0.25))} — дедова заначка`,
        effect: (st, h) => { h.gain(h.amt(0.25), 'Дедова заначка'); return 'В конверте — деньги и записка «На ферму».'; } },
      { icon: 'tools', label: 'Рамы', desc: 'следующий уровень теплицы −50%',
        effect: (st) => { st.flags.disc = { ...(st.flags.disc || {}), greenhouse: 0.5 }; return 'Из дедовых рам теплица выйдет вдвое дешевле.'; } },
    ],
  },
  // запасное событие — если ничего не подошло
  {
    id: 'quiet', months: ALL, weight: 0.6, repeat: true,
    kicker: 'Тихий месяц', title: 'Тихо <em>на ферме</em>',
    text: 'Ни лис, ни гостей. Чем займёмся?',
    options: [
      { icon: 'stall', label: 'Торговать', desc: 'доход +10% весь месяц', effect: (st, h) => { h.mod('sales', 1.1); return 'Весь месяц стоим у прилавка.'; } },
      { icon: 'heart', label: 'Отдохнуть', desc: 'помощник доволен', effect: () => 'Отдохнули — тоже дело.' },
    ],
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));
