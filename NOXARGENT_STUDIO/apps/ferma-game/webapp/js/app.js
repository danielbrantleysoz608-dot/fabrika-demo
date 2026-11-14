// «Ферма деда» — контроллер интерфейса: экраны, тапы, Telegram, сохранение.
import * as E from './engine.js';
import {
  BUILDINGS, BUILD_ORDER, TRASH, SEASON_ICON, SCRAP_BONUS, ACHIEVEMENTS, ACHIEVEMENT_ORDER,
  monthOf, yearOf, goalLabel, maxLevel, MONTH_MS,
} from './data.js';
import { EVENT_BY_ID } from './events.js';
import { renderScene, floatText, puff, SLOT_POS, READY_POSITIONS } from './scene.js';
import { farmerSVG } from './farmer.js';
import { ICONS, POSTCARD_ART } from './icons.js';
import * as api from './api.js';
import { sfx } from './sfx.js';
import { openRating, submitScore } from './rating.js';

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const svg = $('#scene');
const fmt = E.fmt;
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred?.(t);
const notify = (t) => tg?.HapticFeedback?.notificationOccurred?.(t);
const SKY = { early: '#6db8ef', spring: '#55b0f1', summer: '#35a6f3', autumn: '#79b4dd', late: '#8fb0c8', winter: '#8eb0cc' };
const TRASH_DEF = Object.fromEntries(TRASH.map(t => [t.id, t]));
const n = (x) => Math.round(x).toLocaleString('ru-RU');
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
// 1 250 000 → «1,25 млн»
function short(x, cur = ' ₽') {
  const a = Math.abs(x);
  const f = (v, u) => (v).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + u + cur;
  if (a >= 1e12) return f(x / 1e12, ' трлн');
  if (a >= 1e9) return f(x / 1e9, ' млрд');
  if (a >= 1e6) return f(x / 1e6, ' млн');
  return n(x) + cur;
}
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let profile = { game: null, album: {}, introSeen: false };
let st = null;

/* ================= Состояние → сцена ================= */
function view() {
  const stock = {}, built = {};
  for (const id of Object.keys(st.lv)) if (st.lv[id] > 0) built[id] = true;
  for (const id of E.PRODUCERS) stock[id] = E.unitsReady(st, id);
  return {
    month: st.month, built, lv: st.lv, tier: st.tier, hens: hens(), hives: hives(), flags: st.flags,
    clean: E.cleanLevel(st), fieldClear: E.fieldClear(st), stock,
    trash: st.trash.map(t => ({ ...TRASH_DEF[t.id], hp: t.hp, maxHp: TRASH_DEF[t.id].hp })),
    fox: st.phase === 'event' && st.event === 'fox',
    canBuild: st.phase !== 'clean',
  };
}
const hens = () => E.level(st, 'coop') * 10;
const hives = () => E.level(st, 'apiary') * 3 + E.level(st, 'honeyfield') * 20;

function render(layers = 'all') {
  renderScene(svg, view(), BUILDINGS, layers);
  hud();
}

function hud() {
  const m = monthOf(st.month), y = yearOf(st.month);
  $('#monthLbl').textContent = y > 1 ? `ГОД ${y}` : 'МЕСЯЦ';
  $('#monthName').textContent = m.name;
  $('#seasonIcon').className = 'ic-' + SEASON_ICON[m.season];
  $('#money').textContent = short(st.money);
  $('#money').classList.toggle('neg', st.money < 0);
  $('#hudHens').textContent = hens();
  $('#hudHives').textContent = hives();
  const cap = E.ratingCapital(st), g = E.goal(st);
  $('#goalLbl').textContent = st.tier === 0 ? 'ДО МИЛЛИОНА' : `ДО ${goalLabel(st.tier).toUpperCase()}`;
  $('#goalFill').style.width = (E.progress(st) * 100) + '%';
  $('#goalNum').textContent = `${short(cap, '')} / ${short(g)}`;
  updateClean();
  updateNext();
  const sky = SKY[m.season];
  if (hud.sky !== sky) { hud.sky = sky; tg?.setHeaderColor?.(sky); tg?.setBackgroundColor?.(sky); document.body.style.background = sky; }
}

// Кнопка «Следующий месяц»: таймер, пока месяц идёт; активна, когда прошёл
function updateNext() {
  if (st.phase === 'clean') return;
  const btn = $('#btnNext');
  btn.classList.remove('locked');
  const left = E.monthLeft(st);
  const ready = left <= 0;
  btn.classList.toggle('ready', ready);
  btn.classList.toggle('wait', !ready);
  $('#nextLbl').innerHTML = ready
    ? 'Следующий месяц ▶'
    : `Следующий месяц<small>через ${mmss(left)} · ⏩ ускорить</small>`;
  $('#monthBar').style.width = (100 * (1 - left / MONTH_MS)) + '%';
}

// Чистота считается в одном месте и показывается одинаково сверху и на кнопке
function updateClean() {
  const cleaning = st.phase === 'clean';
  const pct = Math.round(E.cleanLevel(st) * 100);
  $('#cleanBar').hidden = !cleaning;
  $('#cleanFill').style.width = pct + '%';
  $('#cleanNum').textContent = pct + '%';
  if (cleaning) {
    $('#btnNext').classList.add('locked');
    $('#btnNext').classList.remove('ready', 'wait');
    $('#nextLbl').innerHTML = `Сначала уборка<small>чистота ${pct}%</small>`;
    $('#monthBar').style.width = '0';
  }
}

function persist(now = false) {
  profile.game = st;
  api.save(profile, { now });
}

/* ================= Помощник ================= */
let sayTimer, hideTimer;
function say(html, mood = 'wink', ms = 0) {
  $('#farmer').innerHTML = farmerSVG(mood);
  const b = $('#bubble');
  b.hidden = false;
  b.innerHTML = html; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(sayTimer); clearTimeout(hideTimer);
  if (ms) sayTimer = setTimeout(hint, ms);
  // подсказка прячется сама, чтобы не закрывать ферму (во время уборки висит)
  if (st && st.phase !== 'clean') hideTimer = setTimeout(() => { b.hidden = true; }, Math.max(ms, 7000));
}

function hint() {
  const L = (id) => E.level(st, id), m = st.month % 12;
  if (st.phase === 'clean') return say('Дед оставил нам ферму… и <b>бурьян</b>. Тапай по мусору — наведём порядок!');
  if (!Object.keys(st.lv).length) return say('Чисто! Жми зелёный <b>＋</b> — начнём с курятника, он самый быстрый.', 'happy');
  if (E.PRODUCERS.some(id => E.ready(st, id) >= 1)) return say('Продукция готова — <b>тапай</b> по значкам над постройками!');
  if (L('coop') && !L('fence') && m <= 8) return say('Кур без забора лиса утащит. <b>Забор</b> — в «Стройке».', 'worried');
  if (L('apiary') && !L('omshanik') && m >= 6 && m <= 9) return say('Нужен <b>омшаник</b>, иначе в декабре пчёлы замёрзнут!', 'worried');
  if (L('greenhouse') && !L('stove') && m >= 7) return say('Зимой теплица встанет. <b>Печка</b> — и огурцы в мороз втридорога!');
  if (E.monthReady(st)) return say('Месяц прошёл! Жми <b>«Следующий месяц»</b>.', 'happy');
  if (st.debt) return say(`Долг банку ${short(st.debt)}. Проценты капают — верни в Тетради → Расходы.`);
  say(`До цели — <b>${short(Math.max(0, E.goal(st) - E.ratingCapital(st)))}</b>. Улучшай постройки — тапни по любой!`, 'happy');
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}

/* ================= Тапы по сцене ================= */
// pointerdown: срабатывает сразу при касании и одинаково в Chrome / Firefox / Telegram
svg.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !st) return;
  const el = e.target.closest('[data-tap]');
  if (!el) return;
  const { tap, id } = el.dataset;
  if (tap === 'trash') return hitTrash(id);
  if (tap === 'slot') { haptic(); sfx.click(); return openBuilding(id); }
  if (tap === 'bld') return collect(id);
});

function hitTrash(id) {
  const res = E.hitTrash(st, id);
  if (!res) return;
  const t = TRASH_DEF[id];
  const g = svg.querySelector(`[data-tap="trash"][data-id="${id}"]`);
  if (g) { g.removeAttribute('data-tap'); g.classList.add(t.type === 'weeds' ? 'cut' : 'fly'); }
  t.type === 'weeds' ? sfx.snip() : sfx.whoosh();
  haptic('medium');
  puff(svg, t.x, t.y);
  floatText(svg, t.x, t.y - 30, `+${Math.round(res.share * 100)}% чистоты`, '#2f8a2f');
  updateClean();
  clearTimeout(hitTrash.t);
  hitTrash.t = setTimeout(() => render(), 480);
  if (res.done) {
    notify('success'); sfx.fanfare();
    st.lastTick = Date.now();
    floatText(svg, 230, 380, `+${fmt(SCRAP_BONUS)} за металлолом`, '#e8891a');
    say(`Вот это порядок! Дедов металлолом сдали — <b>+${fmt(SCRAP_BONUS)}</b>. Теперь — стройка!`, 'happy');
    render();
  } else if (Math.random() < .25) {
    say(['Ух, сколько хлама!', 'Ещё немного!', 'Шины — потом на клумбы пустим.', 'Бурьян по пояс…', 'Дед ничего не выбрасывал!'][Math.floor(Math.random() * 5)], 'wink', 2500);
  }
  persist();
}

function collect(id) {
  const pos = READY_POSITIONS[id];
  const amt = E.collect(st, id);
  if (!pos || amt <= 0) { haptic(); return openBuilding(id); } // нечего собирать — открываем карточку улучшения
  haptic('medium'); sfx.coin();
  render('ready');
  floatText(svg, pos[0], pos[1], `+${short(amt)}`);
  afterGain();
  persist();
}

/* ================= Реальное время ================= */
const tickReady = {};
setInterval(() => {
  if (!st || st.phase === 'clean') return;
  const r = E.tick(st);
  if (r.changed) render('ready');
  hud();
  afterGain();
  // напоминание: месяц прошёл
  if (E.monthReady(st) && !tickReady.done) { tickReady.done = true; notify('success'); if (layer.hidden) hint(); }
  if (!E.monthReady(st)) tickReady.done = false;
}, 1000);
setInterval(() => st && st.phase !== 'clean' && persist(), 10000);

// Вернулся в игру — показать, сколько накопилось за время отсутствия
function welcomeBack() {
  if (!st || st.phase === 'clean') return;
  const sum = () => E.PRODUCERS.reduce((a, id) => a + (st.acc[id] || 0), 0) + st.money;
  const before = sum();
  const r = E.tick(st);
  const got = sum() - before;
  render();
  if (r.offline > 0 && got > 1) {
    const mins = Math.round(r.offline / 60000);
    say(`Пока тебя не было ${mins >= 60 ? Math.floor(mins / 60) + ' ч ' + (mins % 60) + ' мин' : mins + ' мин'}, ферма наработала <b>${short(got)}</b>${r.offline >= 7200000 ? ' (больше 2 часов не копится)' : ''}. Собирай!`, 'happy', 8000);
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') welcomeBack(); else if (st) persist(true); });

// Новые цели и открытки — поздравляем, когда ничего не открыто
function afterGain() {
  if (!st?.achNew?.length || !layer.hidden) return;
  showAchievement(st.achNew.shift());
}

/* ================= Слои-оверлеи ================= */
const layer = $('#layer');
function openLayer(html, cls = 'sheet-wrap', back = true) {
  layer.className = cls;
  $('#app').classList.toggle('covered', cls.startsWith('screen'));
  $('#app').classList.toggle('bare', cls === 'screen');
  layer.innerHTML = html;
  layer.hidden = false;
  layer.dataset.opened = Date.now();
  if (back) tg?.BackButton.show(); else tg?.BackButton.hide();
}
function closeLayer() {
  layer.hidden = true; layer.innerHTML = '';
  $('#app').classList.remove('covered', 'bare');
  tg?.BackButton.hide();
  setTimeout(afterGain, 300);
}
tg?.BackButton.onClick(() => {
  const k = layer.dataset.kind;
  if (k === 'event' || k === 'report') return;
  if (k === 'intro' || k === 'album-start' || k === 'rating-start') return showSplash();
  closeLayer();
});
const sheet = (title, body, kind) => { openLayer(`<div class="sheet"><div class="grab"></div><h2>${title}</h2>${body}</div>`); layer.dataset.kind = kind; };

layer.addEventListener('click', (e) => {
  if (Date.now() - (+layer.dataset.opened || 0) < 300) return; // «призрачный» клик после касания
  const a = e.target.closest('[data-act]');
  if (e.target === layer && layer.classList.contains('sheet-wrap')) return closeLayer();
  if (!a) return;
  haptic(); sfx.click();
  const fn = ACTIONS[a.dataset.act];
  if (fn) fn(a.dataset.id, a);
});

const ACTIONS = {
  buy: (id, el) => { if (el.dataset.lock) { haptic('rigid'); sfx.error(); return toast(el.dataset.lock); } doBuy(id); },
  tab: (id) => openBook(id),
  repay: () => { const why = E.repay(st); if (why) return toast(why); notify('success'); render(); persist(); openBook('costs'); say('Долг вернули! Теперь спим спокойно.', 'happy'); },
  opt: (id) => pickOption(+id),
  next: () => afterReport(),
  close: () => closeLayer(),
  skip: () => doSkip(),
  play: () => startOrContinue(),
  newgame: () => confirmNew(),
  newyes: () => newGame(),
  album: () => showAlbum(),
  rating: () => openRating({ st, profile, openLayer, layer, short, fromSplash: layer.dataset.kind === 'splash' }),
  splash: () => showSplash(),
  introNext: (id) => showIntro(+id),
  share: (id) => share(id),
  sound: () => { const m = sfx.toggle(); toast(m ? 'Звук выключен' : 'Звук включён'); openBook('tasks'); },
};

/* ================= Заставка и интро ================= */
function showSplash() {
  const g = profile.game;
  const got = ACHIEVEMENT_ORDER.filter(k => profile.album[k]).length;
  openLayer(`<div class="splash">
      <div class="logo"><div class="kicker">по мотивам сериала «Ферма с нуля»</div><h1>Ферма <em>деда</em></h1>
        <p>10 000 ₽ → 1 000 000 ₽ → и дальше!</p></div>
      <div class="splash-farmer">${farmerSVG('wink')}</div>
      <div class="splash-btns">
        <button class="btn primary big" data-act="play">${g ? `Продолжить<small>Год ${yearOf(g.month)}, ${monthOf(g.month).name.toLowerCase()} · ${short(g.money)}</small>` : 'Играть'}</button>
        <div class="row"><button class="btn wide" data-act="rating">🏆 Рейтинг</button><button class="btn wide" data-act="album">Открытки · ${got}/${ACHIEVEMENT_ORDER.length}</button></div>
        ${g ? '<button class="btn wide ghost" data-act="newgame">Начать заново</button>' : ''}
      </div></div>`, 'screen', false);
  layer.dataset.kind = 'splash';
}

function startOrContinue() {
  if (profile.game) { st = profile.game; enterGame(); return; }
  if (!profile.introSeen) return showIntro(0);
  newGame();
}
function confirmNew() {
  openLayer(`<div class="dialog"><h3>Начать заново?</h3><p>Текущая ферма (год ${yearOf(profile.game.month)}, капитал ${short(E.capital(profile.game))}) будет потеряна. Открытки останутся, в рейтинге останется лучший результат.</p>
    <div class="row"><button class="btn wide" data-act="splash">Нет</button><button class="btn primary wide" data-act="newyes">Да, заново</button></div></div>`, 'screen dim', true);
  layer.dataset.kind = 'intro';
}

const INTRO = [
  { mood: 'wink', html: `<div class="letter"><p>Внучек!</p><p>Если читаешь это письмо — ферма теперь твоя. Дом, сарай, поле… и немного бурьяна.</p><p>В сарае — старые рамы, не выбрасывай, пригодятся.</p><p class="sign">Твой дед</p></div>` },
  { mood: 'happy', html: `<div class="card-big"><div class="big-num">10 000 ₽</div><p>Всё наследство — в конверте. Плюс заброшенная ферма.</p></div>` },
  { mood: 'wink', html: `<div class="card-big"><div class="big-num green">1 000 000 ₽</div><p><b>Первая цель.</b> Постройки работают сами, а ты тапай «собрать» и улучшай. Месяц длится 15 минут, в конце — выбор, как в серии! А после миллиона — 10, 100…</p></div>` },
];
function showIntro(i) {
  if (i >= INTRO.length) { profile.introSeen = true; return newGame(); }
  const s = INTRO[i];
  openLayer(`<div class="intro">${s.html}
    <div class="intro-farmer">${farmerSVG(s.mood)}</div>
    <div class="dots">${INTRO.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn primary big" data-act="introNext" data-id="${i + 1}">${i === INTRO.length - 1 ? 'На ферму!' : 'Дальше'}</button></div>`, 'screen dim', true);
  layer.dataset.kind = 'intro';
}

function newGame() {
  st = E.newGame();
  profile.game = st;
  persist(true);
  enterGame();
}
function enterGame() {
  closeLayer();
  delete svg.dataset.month;
  render(); hint();
  welcomeBack();
  if (st.phase === 'event') showEvent();
}

/* ================= Стройка и улучшения ================= */
function card(id) {
  const b = BUILDINGS[id], L = E.level(st, id), max = maxLevel(id, st.tier);
  const lock = E.canBuy(st, id);
  const price = E.priceOf(st, id);
  const k = E.globalMult(st, false);
  let stats = '';
  if (b.kind === 'prod') {
    const next = (E.baseIncome(id, L + 1) - E.baseIncome(id, L)) * k;
    stats = `<span class="tag inc">${L ? `сейчас ${short(E.rate(st, id))}/мин` : `≈ ${short(E.baseIncome(id, 1) * k)}/мин`}</span>${L && L < max ? `<span class="tag inc">+${short(next)}/мин за уровень</span>` : ''}<span class="tag">${b.seasonText}</span>`;
  } else if (b.kind === 'boost') {
    stats = `<span class="tag inc">сейчас +${Math.round(b.boost * L * 100)}% ко всему</span><span class="tag">+${Math.round(b.boost * 100)}% за уровень</span>`;
  }
  const lvl = b.kind === 'once' ? '' : `<div class="lvl">${Array.from({ length: Math.min(max, 10) }, (_, i) => `<i class="${i < L ? 'on' : ''}"></i>`).join('')}<span>ур. ${L}/${max}</span></div>`;
  const label = L >= max ? (b.kind === 'once' ? '✔ Построено' : '✔ Максимум')
    : lock && !lock.startsWith('не хватает') ? cap1(lock)
      : `${L ? `Улучшить до ур. ${L + 1}` : 'Построить'} · ${short(price)}`;
  return `<div class="card ${L >= max ? 'done' : ''} ${lock && L < max ? 'lock' : ''}" id="card-${id}">
    <h3>${b.name}</h3><div class="price">${L >= max ? '' : short(price)}</div>
    <p>${b.desc}</p>${lvl}<div class="tags">${stats}</div>
    ${L >= max ? `<div class="tag ok">${label}</div>` : `<button class="btn primary go" data-act="buy" data-id="${id}" ${lock ? `data-lock="${cap1(lock)}"` : ''}>${label}</button>`}
  </div>`;
}

function openBuild(focus) {
  const open = BUILD_ORDER.filter(id => BUILDINGS[id].tier <= st.tier && !(id === 'garden' && st.flags.fieldSold));
  const soon = BUILD_ORDER.filter(id => BUILDINGS[id].tier === st.tier + 1);
  open.sort((a, b) => (!E.canBuy(st, b)) - (!E.canBuy(st, a))); // сначала то, что можно купить сейчас
  if (focus) open.sort((a, b) => (b === focus) - (a === focus));
  sheet('Стройка', `<div class="money-line">В кармане: <b>${short(st.money)}</b> · доход <b>${short(E.totalRate(st))}/мин</b></div>
    ${open.map(card).join('')}
    ${soon.length ? `<div class="sub">После цели ${goalLabel(st.tier)}</div>${soon.map(card).join('')}` : ''}`, 'build');
}
function openBuilding(id) {
  if (!BUILDINGS[id]) return;
  sheet(BUILDINGS[id].name, `<div class="money-line">В кармане: <b>${short(st.money)}</b></div>${card(id)}
    <button class="btn wide" data-act="close">Закрыть</button>`, 'building');
}

function doBuy(id) {
  const firstTime = !E.level(st, id);
  const err = E.buy(st, id);
  if (err) return toast(err);
  notify('success'); sfx.build();
  render(); persist(true);
  const p = SLOT_POS[id] || READY_POSITIONS[id];
  if (p) { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; puff(svg, x, y + 10); floatText(svg, x, y - 10, firstTime ? BUILDINGS[id].name + '!' : `ур. ${st.lv[id]}!`, '#2f8a2f'); }
  if (layer.dataset.kind === 'building') openBuilding(id); else openBuild();
  if (firstTime) say({
    coop: 'Куры заселились! Яйца появятся над курятником — <b>собирай тапом</b>.',
    stall: 'Прилавок «ЯЙЦА деревенские» готов! Всё продаём дороже.',
    garden: 'Грядки вскопаны. Урожай — с мая по сентябрь.',
    fence: 'Сетка стоит. Пусть теперь лиса попробует!',
    greenhouse: 'Дедовы рамы пригодились! Теплица работает с марта по ноябрь.',
    stove: 'Буржуйка трещит — зимой будут огурцы!',
    apiary: 'Пчёлы гудят! Мёд — летом. Не забудь омшаник к зиме.',
    omshanik: 'Пчёлам есть где перезимовать.',
    cow: 'Му-у! Молоко каждый день.',
    cheese: 'Своя сыроварня! Сыр — дорогой товар.',
    honeyfield: 'Целое поле медоносов! Летом мёд рекой.',
    tractor: 'Трактор урчит — поля за холмом наши!',
    shop: 'Магазин «Ферма деда» открыт в городе!',
    brand: 'Наша марка на полках страны!',
    factory: 'Завод запущен. Дед бы не поверил!',
  }[id] || 'Готово!', 'happy', 6000);
}

/* ================= Тетрадь фермера ================= */
function openBook(tab = 'tasks') {
  const tabs = [['tasks', 'Задания'], ['costs', 'Расходы'], ['story', 'История'], ['cards', 'Открытки']];
  let body = '';
  if (tab === 'tasks') {
    body = `<ul class="todo">${E.tasks(st).map(([t, ok]) => `<li class="${ok ? 'ok' : ''}"><span class="box">${ok ? '✓' : ''}</span>${t}</li>`).join('')}</ul>
      <p class="note">Капитал = деньги + стоимость построек − долг. Сейчас: <b>${short(E.capital(st))}</b>. Покупки за Telegram Stars в рейтинг не идут.</p>
      <div class="row"><button class="btn wide" data-act="rating">🏆 Рейтинг</button><button class="btn wide" data-act="sound">${sfx.muted ? '🔇 Звук выкл.' : '🔊 Звук вкл.'}</button></div>`;
  }
  if (tab === 'costs') {
    const rows = [...st.ledger].reverse().map(l => `<tr><td>${monthOf(l.m).name}${yearOf(l.m) > 1 ? ` <small>г.${yearOf(l.m)}</small>` : ''}</td><td class="plus">+${short(l.income, '')}</td><td class="minus">−${short(l.expense, '')}</td><td><b>${short(l.money, '')}</b></td></tr>`).join('');
    body = `<div class="money-line">Этот месяц: собрано <b>${short(st.monthIncome)}</b> · доход ${short(E.totalRate(st))}/мин</div>
      <table class="ledger"><thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>В кармане</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="empty">Первые итоги — в конце месяца</td></tr>'}</tbody></table>
      <p class="note">В конце месяца: корм, свет и налоги — 10% от собранного${st.debt ? ', проценты по кредиту — 5% от долга' : ''}.</p>
      ${st.debt ? `<div class="debt">Долг банку: <b>${fmt(st.debt)}</b> · 5% в месяц<button class="btn primary go" data-act="repay">Вернуть долг</button></div>` : ''}`;
  }
  if (tab === 'story') body = `<ul class="todo story">${[...st.history].reverse().slice(0, 80).map(h => `<li><span class="m">${monthOf(h.m).name}${yearOf(h.m) > 1 ? ' г.' + yearOf(h.m) : ''}</span>${h.t}</li>`).join('')}</ul>`;
  if (tab === 'cards') body = albumGrid();
  sheet('Тетрадь фермера', `<div class="tabs">${tabs.map(([k, l]) => `<button data-act="tab" data-id="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`, 'book');
}

/* ================= Месяц: ускорение и событие ================= */
function nextMonth() {
  if (st.phase === 'clean') { haptic('rigid'); return say('Сначала <b>уборка</b>! Тапай по хламу и бурьяну.', 'worried', 2600); }
  if (st.phase === 'event') return showEvent();
  E.tick(st);
  if (!E.monthReady(st)) return askSkip();
  E.endMonth(st);
  persist(true);
  showEvent();
}
function askSkip() {
  const cost = E.skipCost(st), left = E.monthLeft(st);
  openLayer(`<div class="dialog"><h3>Месяц ещё идёт</h3>
    <p>До конца месяца — <b>${mmss(left)}</b>. Постройки работают — собирай урожай!</p>
    <p>Можно поторопить время за <b>${short(cost)}</b>. Продукция за пропущенное время не накопится.</p>
    <div class="row"><button class="btn wide" data-act="close">Подожду</button><button class="btn primary wide" data-act="skip">⏩ ${short(cost)}</button></div>
    <p class="note">Скоро: ускорение за Telegram Stars. На место в рейтинге не влияет.</p></div>`, 'screen dim', true);
  layer.dataset.kind = 'skip';
}
function doSkip() {
  const err = E.skipMonth(st);
  if (err) { sfx.error(); return toast(cap1(err)); }
  closeLayer(); persist(true); nextMonth();
}
function showEvent() {
  const e = EVENT_BY_ID[st.event];
  render();
  const opts = e.options.map((_, i) => E.optionState(st, e, i));
  const blocked = E.allBlocked(st, e);
  const nm = monthOf(st.month + 1);
  openLayer(`<div class="ev-title"><div class="kicker">${nm.name.toUpperCase()}${yearOf(st.month + 1) > 1 ? ' · ГОД ' + yearOf(st.month + 1) : ''} · ${e.kicker.toUpperCase()}</div>
      <h2>${e.title}</h2><p>${E.resolveText(e.text, st)}</p></div>
    <div class="ev-opts">${opts.map((o, i) => `<button class="opt ${o.why ? 'off' : ''}" data-act="opt" data-id="${i}">${ICONS[o.icon] || ''}<b>${o.label}</b><span>${o.desc}</span>${o.why ? `<em>${cap1(o.why)}</em>` : ''}</button>`).join('')}</div>
    ${blocked ? '<button class="btn wide pass" data-act="opt" data-id="-1">Не по карману — пропустить</button>' : ''}`, 'event-wrap', false);
  layer.dataset.kind = 'event';
  say('Думай! От выбора зависит весь месяц.', 'worried');
}
function pickOption(i) {
  const e = EVENT_BY_ID[st.event];
  if (i >= 0) { const o = E.optionState(st, e, i); if (o.why) { haptic('rigid'); sfx.error(); return toast(cap1(o.why)); } }
  const rep = E.choose(st, i);
  if (!rep) return;
  haptic('medium');
  persist(true);
  submitScore(st, profile);
  showReport(rep);
}

function showReport(r) {
  const evLog = (r.event?.log || []).map(l => `<li><span>${l.label}</span><b class="${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : '−'}${short(Math.abs(l.amount), '')}</b></li>`).join('');
  const costs = r.costs.map(c => `<li><span>${c.label}</span><b class="minus">−${short(c.amount, '')}</b></li>`).join('');
  openLayer(`<div class="report">
      <div class="kicker">ИТОГИ МЕСЯЦА${r.year > 1 ? ' · ГОД ' + r.year : ''}</div><h2>${r.name}</h2>
      <ul class="lines"><li><span>Собрано с фермы</span><b class="plus">+${short(r.income, '')}</b></li>${costs}</ul>
      ${r.event ? `<div class="ev-res"><b>${r.event.title}</b> → ${r.event.choice}. ${r.event.text}</div>` : ''}
      ${evLog ? `<ul class="lines">${evLog}</ul>` : ''}
      ${r.notes.map(t => `<div class="warn">${t}</div>`).join('')}
      <div class="total sm"><span>В кармане</span><b>${short(r.after)}</b></div>
      <div class="total sm"><span>Капитал</span><b>${short(r.capital)}</b></div>
      <button class="btn primary big" data-act="next">Дальше</button></div>`, 'screen dim', false);
  layer.dataset.kind = 'report';
}
function afterReport() {
  closeLayer(); render();
  const r = st.report;
  const m = monthOf(st.month);
  const note = r?.notes.find(t => t.includes('омшаник'));
  if (note) return say(note, 'worried', 6000);
  say(`Наступил <b>${m.name.toLowerCase()}</b>${st.month % 12 === 0 ? ` — <b>год ${yearOf(st.month)}</b>!` : ''}. ${r && r.income ? 'Собрали за месяц ' + short(r.income) + '.' : 'Собирай урожай почаще!'}`, 'happy', 5000);
}

/* ================= Открытки и цели ================= */
function showAchievement(id) {
  const a = ACHIEVEMENTS[id];
  if (!a) return;
  const first = !profile.album[id];
  if (first || (profile.album[id].capital || 0) < st.ach[id].capital) profile.album[id] = st.ach[id];
  persist(true);
  submitScore(st, profile);
  const isGoal = id === 'millionaire' || id.startsWith('goal');
  const unlocked = isGoal ? BUILD_ORDER.filter(b => BUILDINGS[b].tier === st.tier) : [];
  notify('success'); sfx.fanfare();
  openLayer(`<div class="ending">
      ${isGoal ? '<div class="confetti">' + Array.from({ length: 24 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 6) * 0.15}s;--c:${['#e8a21a', '#d8392d', '#3fa34d', '#4a90d9', '#f2c84b'][i % 5]}"></i>`).join('') + '</div>' : ''}
      <div class="kicker">${first ? 'НОВАЯ ОТКРЫТКА!' : 'ОТКРЫТКА С ФЕРМЫ'}</div>
      <div class="postcard big" style="--c:${a.color}">${POSTCARD_ART[a.art]}<div class="pc-title">${a.title}</div></div>
      <p class="pc-sub">${a.sub}</p>
      ${isGoal ? `<div class="goal-next">Новая цель: <b>${goalLabel(st.tier)} ₽</b>${unlocked.length ? `<br>Открыто: ${unlocked.map(b => BUILDINGS[b].name).join(', ')}` : ''}</div>` : ''}
      <button class="btn primary big" data-act="close">${isGoal ? 'Вперёд!' : 'Ура!'}</button>
      ${tg ? `<button class="btn wide" data-act="share" data-id="${id}">Поделиться</button>` : ''}
    </div>`, 'screen dim', false);
  layer.dataset.kind = 'ach';
  say(isGoal ? `${a.title}! Ферма растёт — смотри, что открылось в «Стройке».` : a.sub, 'happy', 6000);
}
function albumGrid() {
  return `<div class="album">${ACHIEVEMENT_ORDER.map(k => {
    const got = profile.album[k], a = ACHIEVEMENTS[k];
    return `<div class="postcard ${got ? '' : 'locked'}" style="--c:${a.color}">${POSTCARD_ART[got ? a.art : 'locked']}
      <div class="pc-title">${got ? a.title : '???'}</div>${got ? `<div class="pc-cap">${short(got.capital)}</div>` : ''}</div>`;
  }).join('')}</div><p class="note">Открытки — за цели и особые события. Остаются навсегда, даже после новой игры.</p>`;
}
function showAlbum() {
  openLayer(`<div class="album-screen"><h2>Открытки с фермы</h2>${albumGrid()}
    <button class="btn primary big" data-act="splash">Назад</button></div>`, 'screen dim', true);
  layer.dataset.kind = 'album-start';
}
function share(id) {
  const bot = window.FERMA_CONFIG?.botUsername;
  const a = ACHIEVEMENTS[id] || ACHIEVEMENTS.millionaire;
  const text = `Моя «Ферма деда»: открытка «${a.title}», капитал ${short(E.capital(st))}! А ты дойдёшь до миллиона?`;
  const url = bot ? `https://t.me/${bot}` : 'https://t.me';
  tg?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

/* ================= Кнопки ================= */
$('#btnBuild').onclick = () => { if (!st) return; haptic(); sfx.click(); if (st.phase === 'clean') return say('Сначала <b>уборка</b> — потом стройка!', 'worried', 2500); openBuild(); };
$('#btnBook').onclick = () => { if (!st) return; haptic(); sfx.click(); openBook(); };
$('#btnNext').onclick = () => { if (!st) return; haptic('medium'); sfx.click(); nextMonth(); };
$('#farmer').onclick = () => { if (!st) return; haptic(); hint(); };
$('.goal').onclick = () => st && toast(`Капитал ${short(E.ratingCapital(st))}: деньги + постройки − долг`);

window.addEventListener('error', (e) => { try { toast('Ошибка: ' + e.message); } catch { /* */ } });

/* ================= Старт ================= */
async function boot() {
  if (tg) {
    tg.ready(); tg.expand();
    tg.disableVerticalSwipes?.();
    tg.enableClosingConfirmation?.();
  }
  const saved = await api.loadSave();
  if (saved) profile = { album: {}, introSeen: false, ...saved, game: E.migrate(saved.game) };
  st = profile.game || E.newGame();
  if (location.hash === '#dev') window.__ferma = { E, st: () => st, set: (v) => { st = v; profile.game = v; enterGame(); }, render, profile: () => profile };
  render();
  say('Привет! Я помогу с фермой.', 'wink');
  showSplash();
}
boot();
