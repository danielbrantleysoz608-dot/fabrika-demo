// События месяца: карточка с выбором из 2 вариантов (как голосование в серии).
// Выпадают в начале нового месяца; months — номера месяцев 0…11 (0 = март).
// Суммы масштабируются под размер фермы: h.amt(k) = k × месячный доход (S), h.mins(n) = n минут дохода фермы.
// option.can(st, h) — причина, если вариант недоступен; option.effect(st, h) — текст для итогов.

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const need = (st, sum) => (st.money < sum ? `нужно ${Math.round(sum).toLocaleString('ru-RU')} ₽` : null);
import { maxLevel } from './data.js';
const lv = (st, id) => st.lv[id] || 0;
const canUp = (st, id) => lv(st, id) < maxLevel(id, st.tier);

export const EVENTS = [
  /* ---- события новых локаций ---- */
  {
    id: 'flood', months: [0, 1], weight: 4, cond: (st) => lv(st, 'cowshed') || lv(st, 'mill'),
    kicker: 'Река и луг', title: 'Половодье <em>на реке!</em>',
    text: 'Река вышла из берегов, вода подбирается к коровнику и мельнице.',
    options: [
      { icon: 'tools', label: 'Мешки с песком', desc: (st, h) => `${h.fmt(h.mins(3))} — укрепим берег`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'Мешки с песком'); return 'Берег выстоял — луг сухой.'; } },
      { icon: 'dice', label: 'Авось пронесёт', desc: 'коровник, мельница и сыроварня −50% весь месяц',
        effect: (st, h) => { h.mod('cowshed', 0.5); h.mod('mill', 0.5); h.mod('cheese', 0.5); return 'Луг подтопило — месяц работали вполсилы.'; } },
    ],
  },
  {
    id: 'bakery', months: [5, 6, 7], weight: 3, cond: (st) => lv(st, 'mill'),
    kicker: 'Река и луг', title: 'Пекарня просит <em>нашу муку</em>',
    text: 'Пекарня из соседнего села распробовала муку с дедовой мельницы и просит возить ещё.',
    options: [
      { icon: 'truck', label: 'Возить', desc: (st, h) => `мельница +60% весь месяц, бензин ${h.fmt(h.mins(2))}`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Бензин до пекарни'); h.mod('mill', 1.6); return 'Мука уходит пекарне мешками!'; } },
      { icon: 'no', label: 'Не до того', desc: 'своих дел хватает', effect: () => 'Пекарня нашла другую мельницу.' },
    ],
  },
  {
    id: 'inspect', months: [2, 3, 4, 5, 6, 7, 8], weight: 3, cond: (st) => lv(st, 'shop') || lv(st, 'cafe'),
    kicker: 'Райцентр', title: 'Проверка <em>в магазине</em>',
    text: 'В магазин «Ферма деда» пришла проверка: ценники не те, холодильник старый.',
    options: [
      { icon: 'tools', label: 'Всё исправить', desc: (st, h) => `${h.fmt(h.mins(2.5))} на новый холодильник`, can: (st, h) => need(st, h.mins(2.5)),
        effect: (st, h) => { h.pay(h.mins(2.5), 'Холодильник в магазин'); return 'Проверка ушла довольная.'; } },
      { icon: 'dice', label: 'Спорить', desc: 'магазин и кафе −50% весь месяц',
        effect: (st, h) => { h.mod('shop', 0.5); h.mod('cafe', 0.5); return 'Магазин месяц работал с перебоями.'; } },
    ],
  },
  {
    id: 'cityday', months: [5, 6], weight: 3, cond: (st) => lv(st, 'cafe') || lv(st, 'market'),
    kicker: 'Райцентр', title: 'День города!',
    text: 'В райцентре праздник: концерт, ярмарка и полная площадь народу.',
    options: [
      { icon: 'stall', label: 'Палатка на площади', desc: (st, h) => `${h.fmt(h.mins(2))}, магазин и кафе +50% весь месяц`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Палатка на Дне города'); h.mod('shop', 1.5); h.mod('cafe', 1.5); return 'Пироги разлетелись за час!'; } },
      { icon: 'no', label: 'Обычный день', desc: 'работаем как всегда', effect: () => 'Праздник прошёл мимо.' },
    ],
  },
  {
    id: 'combines', months: [5, 6], weight: 4, cond: (st) => lv(st, 'tractor') || lv(st, 'elevator'),
    kicker: 'Агрохолдинг', title: 'Рекордный <em>урожай</em>',
    text: 'Зерна столько, что своя техника не успевает. Можно нанять комбайны.',
    options: [
      { icon: 'truck', label: 'Нанять комбайны', desc: (st, h) => `${h.fmt(h.mins(4))}, поля и элеватор +50% весь месяц`, can: (st, h) => need(st, h.mins(4)),
        effect: (st, h) => { h.pay(h.mins(4), 'Аренда комбайнов'); h.mod('tractor', 1.5); h.mod('elevator', 1.5); return 'Убрали всё до зёрнышка!'; } },
      { icon: 'dice', label: 'Своими силами', desc: 'часть урожая уйдёт под снег', effect: (st, h) => { h.mod('tractor', 0.8); return 'Не всё успели убрать.'; } },
    ],
  },
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
      { icon: 'blanket', label: 'Укрыть всё', desc: (st, h) => `${h.fmt(h.mins(4))} на плёнку и обогрев`, can: (st, h) => need(st, h.mins(4)),
        effect: (st, h) => { h.pay(h.mins(4), 'Плёнка и обогрев'); return 'Укрыли — всё живо.'; } },
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
      { icon: 'trap', label: 'Капканы', desc: (st, h) => `${h.fmt(h.mins(2))}, куры целы`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Капканы'); return 'Лиса ушла ни с чем.'; } },
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
    id: 'swarm', months: [3, 4], weight: 3, cond: (st) => lv(st, 'apiary') > 1,
    kicker: 'Пасека', title: 'Рой улетел <em>к соседу</em>',
    text: 'Пчёлы роем ушли на соседскую яблоню. Сосед готов вернуть — не бесплатно.',
    options: [
      { icon: 'money', label: 'Выкупить', desc: (st, h) => `${h.fmt(h.mins(2.5))}, пасека цела`, can: (st, h) => need(st, h.mins(2.5)),
        effect: (st, h) => { h.pay(h.mins(2.5), 'Выкуп роя'); return 'Рой вернули в улей.'; } },
      { icon: 'no', label: 'Пусть летят', desc: 'пасека −1 уровень', effect: (st) => { st.lv.apiary -= 1; return 'Пасека потеряла уровень.'; } },
    ],
  },
  {
    id: 'hail', months: [5, 6, 7], weight: 3, cond: (st) => lv(st, 'greenhouse'),
    kicker: 'Погода', title: 'Град <em>побил теплицу</em>',
    text: 'Град размером с вишню. Три дедовых рамы — вдребезги.',
    options: [
      { icon: 'tools', label: 'Ремонт', desc: (st, h) => `${h.fmt(h.mins(4))} на стёкла`, can: (st, h) => need(st, h.mins(4)),
        effect: (st, h) => { h.pay(h.mins(4), 'Стёкла для теплицы'); return 'Вставили новые стёкла.'; } },
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
      { icon: 'tools', label: 'Мастер', desc: (st, h) => `${h.fmt(h.mins(3))}, всё работает`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'Сантехник'); return 'Мастер отогрел трубы.'; } },
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
      { icon: 'blanket', label: 'Утеплить', desc: (st, h) => `${h.fmt(h.mins(3.5))} на дрова и утеплитель`, can: (st, h) => need(st, h.mins(3.5)),
        effect: (st, h) => { h.pay(h.mins(3.5), 'Дрова и утеплитель'); return 'Перезимовали в тепле.'; } },
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
  /* =====================================================================
     СЮЖЕТНЫЕ ВЕТКИ. Каждое событие — один раз. Решения ставят флаги (st.storyFlags),
     h.later(id, n) — продолжение через n месяцев (follow: true — только как продолжение).
     option.short — как решение выглядит в «Тетрадь → История»: «пустил завод → +15% продаж, −10 🤝».
     ===================================================================== */
  /* ---- Завод у реки ---- */
  {
    id: 'factory', months: [2, 3, 4, 5, 6, 7, 8], weight: 6, cond: (st) => lv(st, 'cowshed') || lv(st, 'mill'),
    kicker: 'Река и луг', title: 'Завод хочет <em>построиться у реки</em>',
    text: 'Приехали люди в касках: «Поставим у реки консервный завод. Рабочие места, покупатели — но и дым над лугом».',
    options: [
      { icon: 'truck', label: 'Пустить', short: 'пустил завод', desc: '+15% к продажам (рабочие покупают), но −10 🤝 и пасека −20%',
        effect: (st, h) => { h.perm('sales', 1.15); h.trust(-10); h.perm('apiary', 0.8); if (lv(st, 'honeyfield')) h.perm('honeyfield', 0.8); h.flag('factory', 'yes'); h.later('river_dirty', 2);
          return 'Завод строится. Рабочие уже скупают молоко и яйца!'; } },
      { icon: 'no', label: 'Отказать', short: 'отказал заводу', desc: '+10 🤝, но завод уйдёт к соседу',
        effect: (st, h) => { h.trust(10); h.flag('factory', 'no'); h.flag('nbBoostUntil', st.month + 4); h.note('сосед +15% на 4 мес.'); h.later('neighbor_grew', 3);
          return 'Жители повесили табличку «Спасибо!». А завод ушёл к соседу…'; } },
      { icon: 'money', label: 'Торговаться', short: 'договорился с заводом', desc: 'фильтры на трубы и аренда каждый месяц, +3 🤝',
        effect: (st, h) => { h.flag('factory', 'deal'); h.flag('factoryRent'); h.note('аренда 8% дохода каждый месяц'); h.trust(3); h.later('factory_contract', 3);
          return 'Завод поставит фильтры и будет платить аренду за берег.'; } },
    ],
  },
  {
    id: 'river_dirty', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.factory === 'yes',
    kicker: 'Река и луг', title: 'Река <em>помутнела</em>',
    text: 'После завода вода в реке мутная, рыба ушла, пчёлы облетают луг стороной.',
    options: [
      { icon: 'tools', label: 'Очистные', short: 'построил очистные', desc: (st, h) => `${h.fmt(h.mins(5))} — река чистая, пасека снова в норме, +5 🤝`, can: (st, h) => need(st, h.mins(5)),
        effect: (st, h) => { h.pay(h.mins(5), 'Очистные сооружения'); h.trust(5); h.flag('cleanRiver'); h.perm('apiary', 1.25); if (st.perm.honeyfield) h.perm('honeyfield', 1.25);
          return 'Вода снова чистая — рыба вернулась, пчёлы тоже.'; } },
      { icon: 'dice', label: 'Оставить', short: 'оставил реку грязной', desc: 'рыбалка −40% навсегда, −5 🤝',
        effect: (st, h) => { h.flag('riverDirty'); h.note('рыбалка −40%'); h.trust(-5); return 'Рыба мельчает, покупатели ворчат.'; } },
    ],
  },
  {
    id: 'neighbor_grew', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.factory === 'no',
    kicker: 'Сосед', title: 'Сосед <em>расширился</em>',
    text: 'С заводскими деньгами сосед построил новый коровник и предлагает торговать вместе.',
    options: [
      { icon: 'heart', label: 'Торговать вместе', short: 'торгую вместе с соседом', desc: 'продажи +10% на 3 месяца, +3 🤝',
        effect: (st, h) => { h.temp('sales', 1.1, 3, '🤝', 'Вместе с соседом'); h.trust(3); return 'Общая палатка на рынке — очередь до угла.'; } },
      { icon: 'stall', label: 'Соревноваться', short: 'решил обогнать соседа', desc: (st, h) => `реклама ${h.fmt(h.mins(3))}, продажи +20% на 2 месяца`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'Реклама на радио'); h.temp('sales', 1.2, 2, '📣', 'Реклама'); return 'Реклама на районном радио — покупатели едут к нам!'; } },
    ],
  },
  {
    id: 'factory_contract', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.factory === 'deal',
    kicker: 'Завод', title: 'Завод предлагает <em>контракт</em>',
    text: 'Заводская столовая хочет каждую неделю молоко, яйца и овощи с нашей фермы.',
    options: [
      { icon: 'truck', label: 'Подписать', short: 'подписал контракт с заводом', desc: '+10% к продажам навсегда, +3 🤝',
        effect: (st, h) => { h.perm('sales', 1.1); h.trust(3); h.flag('factoryContract'); return 'Грузовик завода приезжает каждый понедельник.'; } },
      { icon: 'no', label: 'Хватит аренды', short: 'оставил заводу только аренду', desc: 'без обязательств', effect: () => 'Завод платит аренду — и ладно.' },
    ],
  },
  /* ---- Дорога до трассы → туристы ---- */
  {
    id: 'road', months: [1, 2, 3, 4, 5, 6, 7], weight: 5, cond: (st) => lv(st, 'stall') > 0,
    kicker: 'Сельсовет', title: 'Дорога <em>до трассы</em>',
    text: 'Сельсовет собирает деньги на асфальт до трассы. Тогда к прилавку поедут покупатели из города.',
    options: [
      { icon: 'truck', label: 'Скинуться', short: 'скинулся на дорогу', desc: (st, h) => `${h.fmt(h.amt(0.5))} — продажи +10% навсегда, +5 🤝`, can: (st, h) => need(st, h.amt(0.5)),
        effect: (st, h) => { h.pay(h.amt(0.5), 'Асфальт до трассы'); h.perm('sales', 1.1); h.trust(5); h.flag('road'); h.later('tourists', 2); return 'Положили асфальт — машины едут к прилавку!'; } },
      { icon: 'no', label: 'Не сейчас', short: 'не дал денег на дорогу', desc: '−2 🤝 (сельчане обиделись)',
        effect: (st, h) => { h.trust(-2); return 'Дорогу отложили. Грязь по колено.'; } },
    ],
  },
  {
    id: 'tourists', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.road,
    kicker: 'Гости', title: 'Туристы <em>просятся на ферму</em>',
    text: 'По новой дороге едут горожане: хотят посмотреть кур, подоить корову и купить мёд прямо с пасеки.',
    options: [
      { icon: 'camera', label: 'Агротуризм', short: 'открыл агротуризм', desc: (st, h) => `${h.fmt(h.mins(4))} на тропинки и вывеску — продажи +12% навсегда, +5 🤝`, can: (st, h) => need(st, h.mins(4)),
        effect: (st, h) => { h.pay(h.mins(4), 'Агротуризм: тропинки и вывеска'); h.perm('sales', 1.12); h.trust(5); h.flag('agro'); h.later('agro_review', 3); return 'Экскурсии по выходным — дети в восторге от кур!'; } },
      { icon: 'no', label: 'Не пускать', short: 'не пустил туристов', desc: 'ферма — не музей', effect: () => 'Туристы поехали дальше.' },
    ],
  },
  {
    id: 'agro_review', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.agro,
    kicker: 'Слава', title: 'Про нас написали <em>в путеводителе</em>',
    text: '«Ферма деда — самые вкусные яйца в области и честные хозяева». Можно повесить вырезку на прилавок.',
    options: [
      { icon: 'gift', label: 'Повесить на прилавок', short: 'повесил отзыв из путеводителя', desc: 'продажи +25% на 2 месяца, +3 🤝',
        effect: (st, h) => { h.temp('sales', 1.25, 2, '📖', 'Путеводитель'); h.trust(3); return 'Читают отзыв — и покупают вдвое больше.'; } },
      { icon: 'heart', label: 'Скромно промолчать', short: 'скромно промолчал про отзыв', desc: '+6 🤝', effect: (st, h) => { h.trust(6); return 'Скромность покупатели тоже ценят.'; } },
    ],
  },
  /* ---- Сетевой супермаркет ---- */
  {
    id: 'supermarket', months: [3, 4, 5, 6, 7, 8, 9], weight: 5, cond: (st) => lv(st, 'coop') >= 2,
    kicker: 'Предложение', title: 'Супермаркет <em>хочет контракт</em>',
    text: 'Сеть магазинов «Корзинка» готова брать всё оптом — но по своей цене и с машинами по расписанию.',
    options: [
      { icon: 'truck', label: 'Подписать', short: 'подписал контракт с сетью', desc: 'продажи +25% на 3 месяца, −5 🤝 (свои покупатели обидятся)',
        effect: (st, h) => { h.temp('sales', 1.25, 3, '🏬', 'Контракт с сетью'); h.trust(-5); h.flag('chain'); h.later('chain_squeeze', 3); return 'Фуры «Корзинки» забирают всё подчистую.'; } },
      { icon: 'heart', label: 'Продаю своим', short: 'отказал сети — продаю своим', desc: '+5 🤝',
        effect: (st, h) => { h.trust(5); h.flag('local'); h.later('local_coop', 2); return 'Сельчане рады: лучшее остаётся им.'; } },
    ],
  },
  {
    id: 'chain_squeeze', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.chain,
    kicker: 'Сеть', title: 'Сеть требует <em>скидку 20%</em>',
    text: '«Корзинка»: «Или скидка 20%, или ищем другого поставщика».',
    options: [
      { icon: 'money', label: 'Уступить', short: 'дал сети скидку 20%', desc: 'продажи −10% на 3 месяца',
        effect: (st, h) => { h.temp('sales', 0.9, 3, '🏬', 'Скидка сети'); return 'Работаем почти в ноль, зато стабильно.'; } },
      { icon: 'no', label: 'Разорвать', short: 'разорвал контракт с сетью', desc: '+5 🤝 — возвращаемся к своим покупателям',
        effect: (st, h) => { h.trust(5); h.flag('chain', false); return 'Разорвали контракт. Свои покупатели вернулись.'; } },
    ],
  },
  {
    id: 'local_coop', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.local,
    kicker: 'Соседи', title: 'Зовут <em>в кооператив</em>',
    text: 'Фермеры района открывают общую лавку в райцентре и зовут нас — раз мы не ушли к сети.',
    options: [
      { icon: 'stall', label: 'Вступить', short: 'вступил в кооператив', desc: (st, h) => `взнос ${h.fmt(h.mins(2))}, продажи +10% навсегда, +5 🤝`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Взнос в кооператив'); h.perm('sales', 1.1); h.trust(5); return 'Наша полка в общей лавке — с краю, но самая яркая.'; } },
      { icon: 'no', label: 'Сам по себе', short: 'не пошёл в кооператив', desc: 'без взносов', effect: () => 'Торгуем сами.' },
    ],
  },
  /* ---- Ярмарка: честно или нет ---- */
  {
    id: 'farm_fair', months: [5, 6, 7], weight: 5,
    kicker: 'Ярмарка', title: 'Районная <em>ярмарка</em>',
    text: 'На ярмарке весь район. Можно торговать честно, а можно… заработать побыстрее.',
    options: [
      { icon: 'heart', label: 'Честные цены', short: 'торговал на ярмарке честно', desc: 'продажи +15% в этом месяце, +8 🤝',
        effect: (st, h) => { h.mod('sales', 1.15); h.trust(8); return 'Покупатели запомнили честную ферму.'; } },
      { icon: 'money', label: 'Задрать цены', short: 'задрал цены на ярмарке', desc: (st, h) => `+${h.fmt(h.amt(0.3))} сразу, но −10 🤝`,
        effect: (st, h) => { h.gain(h.amt(0.3), 'Ярмарка с наценкой'); h.trust(-10); h.flag('cheated'); h.later('bad_review', 2); return 'Касса полная… но покупатели косятся.'; } },
      { icon: 'dice', label: 'Сбыть подпорченное', short: 'продал подпорченное', desc: (st, h) => `+${h.fmt(h.amt(0.15))}, −15 🤝`,
        effect: (st, h) => { h.gain(h.amt(0.15), 'Распродажа подпорченного'); h.trust(-15); h.flag('cheated'); h.later('bad_review', 2); return 'Сбыли всё, что залежалось. Совесть неспокойна.'; } },
    ],
  },
  {
    id: 'bad_review', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.cheated,
    kicker: 'Отзывы', title: 'Покупатели <em>жалуются</em>',
    text: 'В районном чате пишут: «На ферме деда обманули!»',
    options: [
      { icon: 'money', label: 'Вернуть деньги', short: 'вернул деньги обманутым', desc: (st, h) => `${h.fmt(h.mins(3))}, +6 🤝`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'Возврат покупателям'); h.trust(6); return 'Извинились и вернули деньги — люди оттаяли.'; } },
      { icon: 'no', label: 'Промолчать', short: 'промолчал на жалобы', desc: '−6 🤝, продажи −10% на 2 месяца',
        effect: (st, h) => { h.trust(-6); h.temp('sales', 0.9, 2, '😠', 'Жалобы'); return 'Слухи расползлись по району.'; } },
    ],
  },
  /* ---- Солнечные панели ---- */
  {
    id: 'solar', months: [1, 2, 3, 4, 5, 6], weight: 4, cond: (st) => (st.house || 0) >= 1,
    kicker: 'Предложение', title: 'Солнечные панели <em>за полцены</em>',
    text: 'Монтажники ставят панели на крышу дома деда за полцены. Свет станет почти бесплатным.',
    options: [
      { icon: 'tools', label: 'Поставить', short: 'поставил солнечные панели', desc: (st, h) => `${h.fmt(h.amt(0.6))} — доход +5% навсегда, +2 🤝`, can: (st, h) => need(st, h.amt(0.6)),
        effect: (st, h) => { h.pay(h.amt(0.6), 'Солнечные панели'); h.perm('sales', 1.05); h.trust(2); h.flag('solar'); h.later('solar_sell', 3); return 'Панели блестят на крыше дома деда!'; } },
      { icon: 'no', label: 'Не надо', short: 'отказался от панелей', desc: 'дед и при лампочке жил', effect: () => 'Остались при старом счётчике.' },
    ],
  },
  {
    id: 'solar_sell', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.solar,
    kicker: 'Солнце', title: 'Излишки <em>света</em>',
    text: 'Панели дают больше, чем ферма тратит. Энергосбыт готов покупать излишки.',
    options: [
      { icon: 'money', label: 'Продавать в сеть', short: 'продаю свет в сеть', desc: '+4% от дохода каждый месяц',
        effect: (st, h) => { h.flag('solarSell'); h.note('+4% дохода каждый месяц'); return 'Счётчик крутится в обратную сторону!'; } },
      { icon: 'stove', label: 'Греть теплицу', short: 'грею теплицу от солнца', desc: 'теплица +15% навсегда',
        effect: (st, h) => { h.perm('greenhouse', 1.15); return 'В теплице тепло даже ночью.'; } },
    ],
  },
  /* ---- Банк ---- */
  {
    id: 'bank', months: [1, 6], weight: 3, cond: (st) => !st.debt,
    kicker: 'Банк', title: 'Банк предлагает <em>кредит</em>',
    text: (st, h) => `Менеджер банка приехал лично: «${h.fmt(h.amt(2))} на развитие фермы!»`,
    options: [
      { icon: 'bank', label: 'Взять', short: 'взял кредит', desc: '5% в месяц, вернуть можно в любой момент (Тетрадь → Расходы)',
        effect: (st, h) => { const s = h.amt(2); h.gain(s, 'Кредит'); st.debt = s; h.flag('loan'); h.later('bank_check', 3); return 'Взяли кредит. Проценты — каждый месяц.'; } },
      { icon: 'no', label: 'Без долгов', short: 'отказался от кредита', desc: 'дед в долг не жил', effect: () => 'Обойдёмся без банка.' },
    ],
  },
  {
    id: 'bank_check', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.loan,
    kicker: 'Банк', title: (st) => (st.debt ? 'Банк <em>повышает ставку</em>' : 'Банк хвалит <em>заёмщика</em>'),
    text: (st) => (st.debt ? 'Звонок из банка: «Погасите кредит досрочно — или долг вырастет на 10%».' : 'Кредит вернули вовремя — банк предлагает «Карту фермера» со скидками у поставщиков.'),
    options: [
      { icon: 'money', label: 'Погасить долг', short: 'погасил кредит досрочно', desc: (st, h) => (st.debt ? `${h.fmt(st.debt)}, +3 🤝` : 'долга нет'),
        can: (st) => (!st.debt ? 'долга нет' : need(st, st.debt)),
        effect: (st, h) => { h.pay(st.debt, 'Досрочное погашение'); st.debt = 0; h.trust(3); return 'Свободны от банка!'; } },
      { icon: 'bank', label: (st) => (st.debt ? 'Пусть растёт' : 'Взять карту'), short: 'ответил банку', desc: (st) => (st.debt ? 'долг +10%' : 'продажи +3% навсегда'),
        effect: (st, h) => { if (st.debt) { st.debt = Math.round(st.debt * 1.1); h.note('долг +10%'); return 'Долг подрос.'; } h.perm('sales', 1.03); return 'Карта фермера в кармане.'; } },
    ],
  },
  /* ---- Засуха → поливалки ---- */
  {
    id: 'dry_summer', months: [3, 4], weight: 5, cond: (st) => lv(st, 'garden') || lv(st, 'greenhouse'),
    kicker: 'Погода', title: 'Надвигается <em>засуха</em>',
    text: 'Синоптики: два месяца без дождей. Огород не выдержит.',
    options: [
      { icon: 'water', label: 'Поливалки', short: 'поставил поливалки', desc: (st, h) => `${h.fmt(h.mins(5))} — огород и капуста +10% навсегда, засуха не страшна`, can: (st, h) => need(st, h.mins(5)),
        effect: (st, h) => { h.pay(h.mins(5), 'Поливалки на огород'); h.flag('sprinklers'); h.perm('garden', 1.1); h.perm('cabbage', 1.1); h.later('dry_again', 12); return 'Поливалки крутятся над грядками — урожай спасён!'; } },
      { icon: 'dice', label: 'Ждать дождя', short: 'ждал дождя в засуху', desc: 'огород и капуста −40% на 2 месяца',
        effect: (st, h) => { h.temp('garden', 0.6, 2, '☀️', 'Засуха'); h.temp('cabbage', 0.6, 2, '☀️', 'Засуха'); h.later('dry_again', 12); return 'Дождь так и не пришёл.'; } },
    ],
  },
  {
    id: 'dry_again', follow: true, months: ALL, weight: 1,
    kicker: 'Погода', title: 'Снова <em>засуха</em>',
    text: (st) => (st.storyFlags.sprinklers ? 'Опять жара — но у нас поливалки! Соседи завидуют.' : 'Опять жара, а полива так и нет.'),
    options: [
      { icon: 'water', label: (st) => (st.storyFlags.sprinklers ? 'Поливалки работают' : 'Срочно полив'), short: 'пережил вторую засуху с поливом',
        desc: (st, h) => (st.storyFlags.sprinklers ? 'огород +20% в этом месяце, +3 🤝' : `${h.fmt(h.mins(6))} на поливалки`),
        can: (st, h) => (st.storyFlags.sprinklers ? null : need(st, h.mins(6))),
        effect: (st, h) => {
          if (st.storyFlags.sprinklers) { h.mod('garden', 1.2); h.trust(3); return 'Пока у всех сухо — у нас помидоры!'; }
          h.pay(h.mins(6), 'Поливалки (срочно)'); h.flag('sprinklers'); return 'Поставили поливалки в последний момент.';
        } },
      { icon: 'dice', label: 'Терпеть', short: 'терпел вторую засуху', desc: 'огород −50% в этом месяце', can: (st) => (st.storyFlags.sprinklers ? 'поливалки уже есть' : null),
        effect: (st, h) => { h.mod('garden', 0.5); return 'Огород засох.'; } },
    ],
  },
  /* ---- Колорадский жук → «Эко-ферма» ---- */
  {
    id: 'beetle', months: [3, 4, 5], weight: 5, cond: (st) => lv(st, 'garden') > 0,
    kicker: 'Огород', title: 'Колорадский <em>жук!</em>',
    text: 'Жук объедает помидоры. Травить или воевать по-дедовски?',
    options: [
      { icon: 'bucket', label: 'Химия', short: 'потравил жука химией', desc: (st, h) => `${h.fmt(h.mins(1.5))}, огород цел, но −5 🤝`, can: (st, h) => need(st, h.mins(1.5)),
        effect: (st, h) => { h.pay(h.mins(1.5), 'Отрава от жука'); h.trust(-5); h.flag('chem'); return 'Жука нет, но покупатели морщатся: «С химией?»'; } },
      { icon: 'heart', label: 'Собирать руками', short: 'собирал жука руками', desc: 'огород −15% в этом месяце, +4 🤝',
        effect: (st, h) => { h.mod('garden', 0.85); h.trust(4); h.flag('eco1'); h.later('eco_label', 3); return 'Всей семьёй собирали жука в банки.'; } },
      { icon: 'gift', label: 'Выпустить кур', short: 'выпустил кур на грядки', desc: 'куры едят жука: курятник +10% в этом месяце, +3 🤝',
        can: (st) => (lv(st, 'coop') ? null : 'нужен курятник'),
        effect: (st, h) => { h.mod('coop', 1.1); h.trust(3); h.flag('eco1'); h.later('eco_label', 3); return 'Куры объелись жуков и несутся как никогда!'; } },
    ],
  },
  {
    id: 'eco_label', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.eco1 && !st.storyFlags.chem,
    kicker: 'Эко', title: 'Значок <em>«Эко-ферма»</em>',
    text: 'Без химии — значит эко! Комиссия готова выдать сертификат.',
    options: [
      { icon: 'gift', label: 'Получить', short: 'получил значок «Эко-ферма»', desc: (st, h) => `${h.fmt(h.mins(2))}, продажи +10% навсегда, +10 🤝`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Сертификат «Эко-ферма»'); h.perm('sales', 1.1); h.trust(10); h.flag('eco'); return 'Зелёный значок «ЭКО» на прилавке!'; } },
      { icon: 'no', label: 'Не нужно', short: 'отказался от эко-значка', desc: 'и так все знают', effect: () => 'Обошлись без бумажек.' },
    ],
  },
  /* ---- Блогер ---- */
  {
    id: 'blogger', months: [3, 4, 5, 6], weight: 4,
    kicker: 'Гости', title: 'Блогер хочет <em>снять ролик</em>',
    text: 'Блогер с миллионом подписчиков хочет снять про ферму деда. Просит оплатить дорогу — и спрашивает, как снимать.',
    options: [
      { icon: 'camera', label: 'Как есть', short: 'показал блогеру ферму как есть', desc: (st, h) => `${h.fmt(h.mins(2))}, продажи +20% в этом месяце, +5 🤝`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Дорога блогеру'); h.mod('sales', 1.2); h.trust(5); h.flag('blogHonest'); h.later('blogger_hype', 2); return 'Ролик честный и тёплый.'; } },
      { icon: 'dice', label: 'Приукрасить', short: 'приукрасил ферму для блогера', desc: (st, h) => `${h.fmt(h.mins(3))}, продажи +40% в этом месяце, но −5 🤝`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'Блогер + реквизит'); h.mod('sales', 1.4); h.trust(-5); h.flag('blogFake'); h.later('blogger_expose', 2); return 'Арендовали пони и покрасили забор только с одной стороны…'; } },
      { icon: 'no', label: 'Не пускать', short: 'не пустил блогера', desc: 'работаем', effect: () => 'Блогер уехал снимать соседа.' },
    ],
  },
  {
    id: 'blogger_hype', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.blogHonest,
    kicker: 'Слава', title: 'Ролик набрал <em>миллион!</em>',
    text: 'Подписчики едут за «настоящими деревенскими яйцами». У прилавка очередь.',
    options: [
      { icon: 'truck', label: 'Принимать всех', short: 'принимал всех после ролика', desc: 'продажи +30% в этом месяце, −2 🤝 (очереди)',
        effect: (st, h) => { h.mod('sales', 1.3); h.trust(-2); return 'Продали всё, но люди ворчали в очереди.'; } },
      { icon: 'heart', label: 'По записи', short: 'принимал гостей по записи', desc: 'продажи +15% в этом месяце, +5 🤝',
        effect: (st, h) => { h.mod('sales', 1.15); h.trust(5); return 'Каждого встретили с чаем.'; } },
    ],
  },
  {
    id: 'blogger_expose', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.blogFake,
    kicker: 'Скандал', title: 'Подписчики заметили <em>обман</em>',
    text: '«В ролике — сказка, а приехали — пони нет, забор облезлый!»',
    options: [
      { icon: 'heart', label: 'Извиниться', short: 'извинился за ролик', desc: (st, h) => `скидки гостям ${h.fmt(h.mins(2))}, +6 🤝`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => { h.pay(h.mins(2), 'Скидки обиженным гостям'); h.trust(6); return 'Честное видео-извинение тоже набрало просмотры.'; } },
      { icon: 'no', label: 'Промолчать', short: 'промолчал про обман', desc: '−10 🤝, продажи −15% на 2 месяца',
        effect: (st, h) => { h.trust(-10); h.temp('sales', 0.85, 2, '😠', 'Скандал'); return 'Скандал гремит на весь район.'; } },
    ],
  },
  /* ---- Сосед Петрович ---- */
  {
    id: 'petrovich', months: [0, 1, 2, 3, 4, 5, 6, 7, 8], weight: 4, cond: (st) => st.month >= 1,
    kicker: 'Сосед', title: 'Петрович <em>просит в долг</em>',
    text: 'Сосед Петрович мнёт кепку: «Выручи до осени — трактор сломался!»',
    options: [
      { icon: 'money', label: 'Одолжить', short: 'одолжил Петровичу', desc: (st, h) => `${h.fmt(h.mins(3))} — вернёт?`, can: (st, h) => need(st, h.mins(3)),
        effect: (st, h) => { h.pay(h.mins(3), 'В долг Петровичу'); h.flag('petrLent'); h.later('petrovich_back', 2); return 'Петрович обещал вернуть с процентами.'; } },
      { icon: 'no', label: 'Отказать', short: 'отказал Петровичу', desc: 'деньги целее', effect: (st, h) => { h.flag('petrNo'); h.later('petrovich_grudge', 2); return 'Петрович ушёл хмурый.'; } },
    ],
  },
  {
    id: 'petrovich_back', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.petrLent,
    kicker: 'Сосед', title: 'Петрович <em>вернул долг!</em>',
    text: 'Петрович привёз деньги с процентами и мешок отборных семян: «Спасибо, выручил!»',
    options: [
      { icon: 'money', label: 'Взять с процентами', short: 'взял долг с процентами', desc: (st, h) => `+${h.fmt(h.mins(4.5))}, огород +20% на 2 месяца`,
        effect: (st, h) => { h.gain(h.mins(4.5), 'Петрович вернул долг'); h.temp('garden', 1.2, 2, '🌱', 'Семена Петровича'); return 'Семена Петровича — огонь!'; } },
      { icon: 'heart', label: 'Простить проценты', short: 'простил Петровичу проценты', desc: (st, h) => `+${h.fmt(h.mins(3))}, +5 🤝 (Петрович всем расскажет)`,
        effect: (st, h) => { h.gain(h.mins(3), 'Петрович вернул долг'); h.trust(5); h.temp('garden', 1.2, 2, '🌱', 'Семена Петровича'); return 'Петрович хвалит нас на всё село.'; } },
    ],
  },
  {
    id: 'petrovich_grudge', follow: true, months: ALL, weight: 1, cond: (st) => st.storyFlags.petrNo,
    kicker: 'Сосед', title: 'Петрович <em>обиделся</em>',
    text: 'Петрович рассказывает в магазине, что у нас яйца несвежие.',
    options: [
      { icon: 'gift', label: 'Отнести пирог', short: 'помирился с Петровичем', desc: (st, h) => `${h.fmt(h.mins(1))}, +2 🤝`, can: (st, h) => need(st, h.mins(1)),
        effect: (st, h) => { h.pay(h.mins(1), 'Пирог для Петровича'); h.trust(2); return 'Помирились за чаем.'; } },
      { icon: 'no', label: 'Не обращать внимания', short: 'не стал мириться с Петровичем', desc: '−6 🤝', effect: (st, h) => { h.trust(-6); return 'Слухи сделали своё дело.'; } },
    ],
  },
  /* ---- Конкурс «Ферма года»: решает доверие ---- */
  {
    id: 'farm_of_year', months: [6, 7, 8], weight: 6, cond: (st) => st.month >= 6,
    kicker: 'Конкурс', title: 'Конкурс <em>«Ферма года»</em>',
    text: (st) => `Жюри смотрит на доверие покупателей. У нас — ${Math.round(st.trust ?? 50)} 🤝. Нужно 70 для первого места, 50 — для второго.`,
    options: [
      { icon: 'gift', label: 'Участвовать', short: 'участвовал в «Ферме года»', desc: (st, h) => `взнос ${h.fmt(h.mins(2))}; 1-е место: +${h.fmt(h.amt(0.5))} и +10% продаж навсегда`, can: (st, h) => need(st, h.mins(2)),
        effect: (st, h) => {
          h.pay(h.mins(2), 'Взнос за конкурс');
          const t = st.trust ?? 50;
          if (t >= 70) { h.gain(h.amt(0.5), 'Приз «Ферма года»'); h.perm('sales', 1.1); h.note('🏆 1-е место'); h.flag('farmOfYear'); return '🏆 Первое место! Кубок стоит на прилавке.'; }
          if (t >= 50) { h.gain(h.amt(0.2), '2-е место в конкурсе'); h.note('🥈 2-е место'); return '🥈 Второе место — тоже неплохо!'; }
          h.note('не прошли'); return 'Не прошли: жюри смутили отзывы покупателей.';
        } },
      { icon: 'no', label: 'Не в этот раз', short: 'пропустил конкурс', desc: 'и так дел много', effect: () => 'Конкурс прошёл без нас.' },
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
