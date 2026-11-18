// «Ферма деда» — контроллер интерфейса: экраны, тапы, Telegram, сохранение.
import * as E from './engine.js';
import {
  PRODUCTS, HOUSE_STAGES, LETTERS, BUILDINGS, BUILD_ORDER, TRASH, SEASON_ICON, SCRAP_BONUS, ACHIEVEMENTS, ACHIEVEMENT_ORDER,
  monthOf, yearOf, goalLabel, maxLevel, MONTH_MS, LOCATIONS, locOf,
} from './data.js';
import { EVENT_BY_ID } from './events.js';
import { renderScene, floatText, puff, SLOT_POS, READY_POSITIONS } from './scene.js';
import { farmerSVG } from './farmer.js';
import { ICONS, POSTCARD_ART } from './icons.js';
import * as api from './api.js';
import { playerName, setPlayerName, tgName } from './api.js';
import { sfx } from './sfx.js';
import * as coach from './coach.js';
import { music } from './music.js';
import { openRating, submitScore } from './rating.js';

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const svg = $('#scene');
const fmt = E.fmt;
// Настройки игрока (хранятся в браузере)
const prefs = (() => { try { return { haptics: true, hints: true, ...JSON.parse(localStorage.getItem('ferma-prefs') || '{}') }; } catch { return { haptics: true, hints: true }; } })();
const savePrefs = () => { try { localStorage.setItem('ferma-prefs', JSON.stringify(prefs)); } catch { /* */ } };
const haptic = (t = 'light') => prefs.haptics && tg?.HapticFeedback?.impactOccurred?.(t);
const notify = (t) => prefs.haptics && tg?.HapticFeedback?.notificationOccurred?.(t);
const SKY = { early: '#6db8ef', spring: '#55b0f1', summer: '#35a6f3', autumn: '#79b4dd', late: '#8fb0c8', winter: '#8eb0cc' };
const TRASH_DEF = Object.fromEntries(TRASH.map(t => [t.id, t]));
const n = (x) => Math.round(x).toLocaleString('ru-RU');
// «с мая»: месяц в родительном падеже (номер 0…11, 0 = март)
const MONTH_GEN = ['марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря', 'января', 'февраля'];
const waitText = (w) => (w.minutes === Infinity ? 'нужна печка' : w.minutes < 60 ? `через ≈${w.minutes} мин` : `через ≈${Math.floor(w.minutes / 60)} ч ${w.minutes % 60} мин`);
// «с мая (через ≈9 мин)», а если сезон со следующего месяца — «с нового месяца — жми «Следующий месяц»»
const seasonLine = (w, built) => (w.months === 1
  ? `${built ? 'ждёт сезона — ' : ''}с нового месяца — жми «Следующий месяц»`
  : `${built ? 'ждёт сезона — ' : ''}с ${MONTH_GEN[w.month]}${w.minutes !== Infinity ? ` (${waitText(w)})` : ''}`);
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
const payText = (m) => (m === Infinity ? '—' : m < 90 ? `≈${Math.max(1, Math.round(m))} мин` : m < 48 * 60 ? `≈${Math.round(m / 60)} ч` : `≈${Math.round(m / 1440)} дн`);
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
  const fresh = {};
  const full = {};
  for (const id of E.PRODUCERS) {
    stock[id] = E.unitsReady(st, id);
    fresh[id] = stock[id] > 0 && E.freshShare(st, id) >= 0.99;
    full[id] = stock[id] > 0 && (st.acc[id] || 0) >= E.storageCap(st, id) * 0.98; // склад полон — пузырь мигает
  }
  return {
    month: st.month, loc: st.loc || 'home', house: st.house || 0, built, lv: st.lv, tier: st.tier, hens: hens(), hives: hives(), flags: st.flags,
    clean: E.cleanLevel(st), fieldClear: E.fieldClear(st), stock, fresh, full,
    trash: st.trash.map(t => ({ ...TRASH_DEF[t.id], hp: t.hp, maxHp: TRASH_DEF[t.id].hp })),
    fox: st.phase === 'event' && st.event === 'fox',
    ordersActive: E.activeOrders(st).filter(x => x.i !== 'big').length,
    ordersDone: E.activeOrders(st).filter(x => E.orderDone(x.o)).length,
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
  farmInfo();
  $('#app').classList.toggle('clean-phase', st.phase === 'clean' || !profile.game);
  // быстрые кнопки есть в DOM только когда видны (никаких скрытых кнопок 0×0)
  const q = $('#quick'), needQuick = !(st.phase === 'clean' || !profile.game);
  if (needQuick && !q.children.length) q.innerHTML = QUICK_HTML;
  if (!needQuick && q.children.length) q.innerHTML = '';
  locNav(needQuick);
  // уровень фермы ⭐
  const lp = E.levelProgress(st), pill = q.querySelector('.lvl-pill');
  if (pill) { pill.querySelector('b').textContent = `⭐ ${lp.level}`; pill.querySelector('i').style.width = Math.round(100 * lp.have / lp.need) + '%'; }
  const sky = SKY[m.season];
  music.setSeason(m.season); // плавная смена мелодии вместе с сезоном (если музыка уже играет)
  if (hud.sky !== sky) {
    hud.sky = sky; tg?.setHeaderColor?.(sky); tg?.setBackgroundColor?.(sky); document.body.style.background = sky;
    const grass = { winter: '#c9d5de', autumn: '#9a9548', late: '#9a9548', early: '#7f8f4d' }[m.season] || '#3f8f31';
    document.documentElement.style.setProperty('--meadow', grass);
  }
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
/* Важные подсказки — по центру (coach.js). Пока открыта — игра на паузе: время фермы не идёт, тапы не работают. */
let pausedAt = 0;
coach.init({
  onPause: () => { if (!pausedAt) pausedAt = Date.now(); $('#app').classList.add('paused'); },
  onResume: () => {
    if (pausedAt && st && st.phase !== 'clean') st.lastTick += Date.now() - pausedAt; // пауза не считается временем фермы
    pausedAt = 0; $('#app').classList.remove('paused');
    tapBlockUntil = Date.now() + 300;
    if (st && st.phase === 'clean') hint(); else $('#bubble').hidden = true;
  },
  onTap: () => { haptic(); sfx.click(); },
});
function important(html, mood = 'wink', onClose = null) {
  if (!prefs.hints) { if (onClose) onClose(); return; }
  $('#bubble').hidden = true;
  coach.show(html, { mood, onClose });
}

let sayTimer, hideTimer, forceSay = false;
function say(html, mood = 'wink', ms = 0) {
  $('#farmer').innerHTML = farmerSVG(mood);
  if (coach.isOpen()) return;
  // подсказки выключены — говорим только во время уборки и когда игрок сам тапнул по фермеру
  if (!prefs.hints && !forceSay && st && st.phase !== 'clean') { $('#bubble').hidden = true; return; }
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
  if (!E.canRepair(st)) return say(`Хватает на ремонт дома деда (${E.nextRepair(st).name.toLowerCase()})! <b>Тапни по дому</b> — там и письма деда.`, 'happy');
  if (st.debt) return say(`Долг банку ${short(st.debt)}. Проценты капают — верни в Тетради → Расходы.`);
  say(`До цели — <b>${short(Math.max(0, E.goal(st) - E.ratingCapital(st)))}</b>. Улучшай постройки — тапни по любой!`, 'happy');
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}

/* ================= Тапы по сцене ================= */
// Мгновенный отклик: действие — сразу в момент касания (pointerdown), не ждём отпускания пальца.
// Так тап не теряется, если палец чуть сдвинулся или пузырь урожая как раз перерисовался.
svg.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !st || coach.isOpen() || tapsBlocked()) return;
  const el = e.target.closest('[data-tap]');
  if (!el) return;
  const { tap, id } = el.dataset;
  if (tap === 'trash') return hitTrash(id);
  if (tap === 'slot') { haptic(); sfx.click(); return openBuilding(id); }
  if (tap === 'bld') return collect(id);
  if (tap === 'board') { haptic(); sfx.click(); return openBoard(); }
  if (tap === 'house') { haptic(); sfx.click(); return openHouse(); }
  if (tap === 'fish') { haptic(); sfx.click(); return openFishing(); }
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
    render();
    $('#btnBuild').classList.add('glow');
    setTimeout(() => important(`<b>Ферма чистая!</b> Дедов металлолом сдали — +${fmt(SCRAP_BONUS)}.<br>Жми <b>«Стройка»</b> — начнём с курятника.`, 'happy'), 500);
  } else if (Math.random() < .25) {
    say(['Ух, сколько хлама!', 'Ещё немного!', 'Шины — потом на клумбы пустим.', 'Бурьян по пояс…', 'Дед ничего не выбрасывал!'][Math.floor(Math.random() * 5)], 'wink', 2500);
  }
  persist();
}

function collect(id) {
  const pos = READY_POSITIONS[id];
  const amt = E.collect(st, id);
  if (!pos || amt <= 0) { haptic(); return openBuilding(id); } // нечего собирать — открываем карточку улучшения
  const fresh = E.lastFresh, res = E.lastReserved;
  const doneBefore = E.activeOrders(st).filter(x => E.orderDone(x.o)).length;
  const sold = amt - res.value;
  if (sold > 0) flyToMoney(id, `+${short(sold)}`);
  haptic('medium');
  if (fresh > 0 && fresh >= amt * 0.15) sfx.fresh(); else sfx.coin();
  render('ready');
  if (sold > 0) floatText(svg, pos[0], pos[1], `+${short(sold)}`);
  if (res.units > 0) setTimeout(() => floatText(svg, pos[0], pos[1] - (sold > 0 ? 18 : 0), `в заказ: ${PRODUCTS[BUILDINGS[id].product].emoji} ${res.units}`, '#8a5a3c'), 120);
  if (fresh > 0 && fresh >= amt * 0.15) setTimeout(() => floatText(svg, pos[0], pos[1] - 36, 'свежее +20%!', '#2f8a2f'), 240);
  // заказ собран полностью — подсветим доску и подскажем
  const doneNow = E.activeOrders(st).filter(x => E.orderDone(x.o)).length;
  if (doneNow > doneBefore) { render(); sfx.bell(); toast('📋 Заказ собран — сдай его на доске заказов!'); }
  else if (res.units > 0) render();
  updateDots();
  afterGain();
  persist();
}

// «+N ₽» вылетает от пузыря к счётчику денег
function flyToMoney(id, text) {
  const from = svg.querySelector(`#ready [data-id="${id}"] .pill`) || svg.querySelector(`#${id}`);
  const to = $('#money');
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), app = $('#app').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly-coin'; el.textContent = text;
  el.style.left = (a.left + a.width / 2 - app.left) + 'px'; el.style.top = (a.top + a.height / 2 - app.top) + 'px';
  $('#app').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(.7)`;
    el.style.opacity = '0.2';
  }));
  setTimeout(() => { el.remove(); to.parentElement.classList.remove('bump-chip'); void to.offsetWidth; to.parentElement.classList.add('bump-chip'); }, 620);
}

/* ================= Реальное время ================= */
const tickReady = {};
setInterval(() => {
  if (!st || !profile.game || st.phase === 'clean' || coach.isOpen()) return;
  const r = E.tick(st);
  if (r.changed) render('ready');
  hud();
  afterGain();
  submitScore(st, profile); // сам ограничивает частоту: не чаще раза в 30 с
  updateDots();
  if (st.login?.pending && layer.hidden) maybeLoginBonus();
  // напоминание: месяц прошёл
  if (E.monthReady(st) && !tickReady.done) { tickReady.done = true; notify('success'); if (layer.hidden) hint(); }
  if (!E.monthReady(st)) tickReady.done = false;
}, 1000);
setInterval(() => profile.game && st.phase !== 'clean' && persist(), 10000);

// Вернулся в игру — показать, сколько накопилось за время отсутствия
function welcomeBack() {
  if (!st || !profile.game || st.phase === 'clean') return;
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
// Свернули игру — музыка и звуки на паузе; вернулись — продолжаем
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { sfx.resume(); welcomeBack(); } else { sfx.suspend(); if (profile.game) persist(true); }
});
tg?.onEvent?.('deactivated', () => sfx.suspend());
tg?.onEvent?.('activated', () => sfx.resume());

// Новые цели и открытки — поздравляем, когда ничего не открыто
function afterGain() {
  if (!st || !layer.hidden || coach.isOpen()) return;
  if (st.achNew?.length) return showAchievement(st.achNew.shift());
  // новая локация открылась — праздник и письмо деда
  if (!st.locSeen) st.locSeen = ['home'];
  const newLoc = openLocations().find(l => !st.locSeen.includes(l.id));
  if (newLoc) { st.locSeen.push(newLoc.id); persist(true); return showLocOpen(newLoc); }
  // новый уровень фермы
  const lvl = E.farmLevel(st);
  if (lvl > (st.lvlSeen || 1)) { st.lvlSeen = lvl; showLevelUp(lvl); return; }
  // первая доска заказов — расскажем по центру
  if (!st.flags.boardHint && E.activeOrders(st).length && st.phase === 'play') {
    st.flags.boardHint = true;
    important('Появилась <b>доска заказов</b> — внизу, у дороги! Кафе, дачники и магазин платят <b>дороже прилавка</b> и дают ⭐ опыт. Урожай для заказа откладывается сам, когда собираешь.', 'happy');
  }
}

/* ================= Дом деда: интерьер, ремонт, письма ================= */
// Комната деда: чем дальше ремонт, тем уютнее (стены, свет, ковёр, цветы, огонь в печи)
function interiorSVG(stage) {
  const wall = ['#cfc3ad', '#d9c8a6', '#e8d3a8', '#f1dcae', '#f6e1b0', '#fbe7b8'][stage];
  const glow = stage >= 5 ? '<circle cx="290" cy="40" r="60" fill="#ffe9a8" opacity=".5"/>' : '';
  return `<svg viewBox="0 0 340 170" class="interior" aria-hidden="true">
    <rect width="340" height="170" fill="${wall}"/>${glow}
    ${stage < 1 ? '<path d="M0 0 L60 0 L30 26z M250 0 h60 l-20 20z" fill="#9d9381" opacity=".6"/>' : ''}
    <rect y="128" width="340" height="42" fill="${stage >= 5 ? '#c98a55' : '#a58460'}"/>
    ${stage >= 5 ? '<ellipse cx="170" cy="150" rx="90" ry="12" fill="#d8392d" opacity=".75"/>' : ''}
    <!-- окно -->
    <rect x="230" y="26" width="70" height="58" fill="${stage >= 2 ? '#bfe6fa' : '#7f97a8'}" stroke="#fff" stroke-width="5"/>
    <path d="M265 26 V84 M230 55 H300" stroke="#fff" stroke-width="4"/><rect x="227" y="23" width="76" height="64" fill="none" stroke="#3b2a1f" stroke-width="2"/>
    ${stage < 2 ? '<g stroke="#3b2a1f" stroke-width="1.6"><rect x="222" y="38" width="86" height="9" fill="#b9845a" transform="rotate(-8 265 42)"/><rect x="222" y="62" width="86" height="9" fill="#c2905e" transform="rotate(6 265 66)"/></g>' : '<path d="M233 28 q10 28 0 54 M297 28 q-10 28 0 54" stroke="#e2403a" stroke-width="7" fill="none"/>'}
    <!-- печь -->
    <g stroke="#3b2a1f" stroke-width="2"><rect x="14" y="60" width="62" height="70" fill="${stage >= 4 ? '#f4efe4' : '#cfc7b8'}"/><rect x="26" y="96" width="36" height="24" fill="#3b2a1f"/><rect x="28" y="40" width="22" height="22" fill="${stage >= 4 ? '#f4efe4' : '#cfc7b8'}"/></g>
    ${stage >= 4 ? '<path d="M32 118 l6 -14 l5 7 l5 -11 l6 18z" fill="#f28c28"/>' : ''}
    <!-- фото деда на стене -->
    <g transform="translate(110 22)"><rect width="56" height="66" rx="3" fill="#8b5a36" stroke="#3b2a1f" stroke-width="2"/><rect x="6" y="6" width="44" height="54" fill="#f3e6c8"/>
      <ellipse cx="28" cy="34" rx="12" ry="14" fill="#f3c8a2" stroke="#3b2a1f" stroke-width="1.4"/>
      <path d="M16 26 q12 -12 24 0 q-6 -4 -12 -4 q-6 0 -12 4z" fill="#7b6a5a"/><path d="M14 27 h28 v-5 q-14 -8 -28 0z" fill="#5d6b7a" stroke="#3b2a1f" stroke-width="1"/>
      <path d="M20 42 q8 6 16 0 q-8 3 -16 0z" fill="#eee"/><circle cx="23" cy="34" r="1.4" fill="#2a1d16"/><circle cx="33" cy="34" r="1.4" fill="#2a1d16"/>
      <rect x="10" y="50" width="36" height="10" fill="#4d6b8a"/></g>
    <!-- стол с письмами -->
    <g stroke="#3b2a1f" stroke-width="2"><rect x="120" y="100" width="100" height="10" fill="#9a6838"/><rect x="128" y="110" width="6" height="22" fill="#8b5a36"/><rect x="206" y="110" width="6" height="22" fill="#8b5a36"/></g>
    ${Array.from({ length: Math.min(6, stage + 1) }, (_, i) => `<rect x="${136 + i * 12}" y="${92 - (i % 2) * 2}" width="16" height="10" fill="#fffaf0" stroke="#8a5a3c" stroke-width="1.2" transform="rotate(${(i % 3) * 5 - 5} ${144 + i * 12} 97)"/>`).join('')}
    ${stage >= 5 ? '<g stroke="#3b2a1f" stroke-width="1.4"><rect x="244" y="96" width="14" height="12" fill="#a8693c"/><circle cx="248" cy="92" r="5" fill="#e2403a"/><circle cx="256" cy="90" r="5" fill="#ffd23f"/></g>' : ''}
  </svg>`;
}
function openHouse() {
  const h = st.house || 0, next = E.nextRepair(st), why = E.canRepair(st);
  const steps = HOUSE_STAGES.map((x, i) => `<div class="hs ${i < h ? 'ok' : i === h ? 'now' : ''}"><span>${i < h ? '✓' : x.emoji}</span><small>${x.name}</small></div>`).join('');
  const letters = LETTERS.map((l, i) => i <= h
    ? `<button class="letter-row" data-act="letter" data-id="${i}">✉️ <b>${l.title}</b><span>читать</span></button>`
    : `<div class="letter-row locked">🔒 <b>${l.title}</b><span>после ремонта: ${HOUSE_STAGES[i - 1].name.toLowerCase()}</span></div>`).join('');
  sheet('🏠 Дом деда', `${interiorSVG(h)}
    <div class="house-steps">${steps}</div>
    ${next ? `<div class="card"><h3>${next.emoji} ${next.name}</h3><div class="price">${short(next.cost)}</div><p>${next.desc}</p>
      <div class="tags"><span class="tag inc">+3% ко всему доходу</span><span class="tag">+ новое письмо деда</span></div>
      <button class="btn primary go" data-act="repair" ${why ? `data-lock="${cap1(why)}"` : ''}>${why && !why.startsWith('не хватает') ? cap1(why) : `Отремонтировать · ${short(next.cost)}`}</button></div>`
      : '<div class="card"><h3>Дом полностью отремонтирован!</h3><p>+15% ко всему доходу. Дед бы гордился.</p></div>'}
    <div class="sub">Письма деда</div><div class="letters">${letters}</div>`, 'house');
}
function showLetter(i, isNew = false) {
  const l = LETTERS[i];
  openLayer(`<div class="intro">${isNew ? '<div class="kicker-light">НОВОЕ ПИСЬМО ДЕДА</div>' : ''}
    <div class="letter"><p><b>${l.title}</b></p><p>${l.text}</p><p class="sign">Твой дед</p></div>
    <button class="btn primary big" data-act="house">К дому деда</button></div>`, 'screen dim keep-ui', true);
  layer.dataset.kind = 'letter';
}

/* ================= Доска заказов и уровень фермы ================= */
function orderCard({ o, i }) {
  const done = E.orderDone(o);
  const items = o.items.map(it => `<div class="oi"><span class="oe">${PRODUCTS[it.p].emoji}</span><span class="on">${n(Math.min(it.have, it.need))}/${n(it.need)}</span>
    <div class="ob"><i style="width:${Math.round(100 * Math.min(1, it.have / it.need))}%"></i></div></div>`).join('');
  return `<div class="ocard ${o.big ? 'big' : ''} ${done ? 'done' : ''}">
    <div class="oh"><span class="oc">${o.emoji}</span><b>${o.name}</b>${o.big ? '<em>до конца дня</em>' : ''}</div>
    <div class="ois">${items}</div>
    <div class="or"><span>Награда:</span><b>${short(o.reward)}</b><span class="ox">+${o.xp} ⭐</span></div>
    <div class="row"><button class="btn primary wide" data-act="deliver" data-id="${i}" ${done ? '' : 'data-lock="Ещё не всё собрано — тапай по постройкам"'}>${done ? 'Сдать заказ' : 'Собираем…'}</button>
      <button class="btn wide ghost-dark" data-act="decline" data-id="${i}">Отказаться</button></div></div>`;
}
function openBoard() {
  const list = [];
  (st.orders || []).forEach((o, i) => {
    if (o && !o.wait) list.push(orderCard({ o, i }));
    else list.push(`<div class="ocard wait"><div class="oh"><span class="oc">⏳</span><b>Новый заказ</b></div><p class="note">появится через ${mmss(Math.max(0, (o?.readyAt || 0) - Date.now()))}</p></div>`);
  });
  if (st.big && !st.big.done) list.push(orderCard({ o: st.big, i: 'big' }));
  sheet('📋 Доска заказов', `<p class="note">Заказчики платят <b>дороже прилавка</b> и дают ⭐ опыт. Нужный урожай откладывается в амбар сам, когда собираешь его с построек. Отказался — новый заказ через 10 минут.</p>${list.join('')}`, 'board');
}
function showLevelUp(lvl) {
  const opened = E.unlockedAt(lvl).map(id => BUILDINGS[id].name);
  notify('success'); sfx.fanfare();
  openLayer(`<div class="ending"><div class="confetti">${Array.from({ length: 18 }, (_, k) => `<i style="--x:${(k * 41) % 100}%;--d:${(k % 6) * 0.15}s;--c:${['#e8a21a', '#3fa34d', '#4a90d9', '#d8392d'][k % 4]}"></i>`).join('')}</div>
    <div class="kicker">УРОВЕНЬ ФЕРМЫ</div><div class="lvl-big">⭐ ${lvl}</div>
    <p class="pc-sub">${opened.length ? 'Открыто: <b>' + opened.join(', ') + '</b>' : 'Ферма растёт! Заказчики стали щедрее.'}</p>
    <button class="btn primary big" data-act="${opened.length ? 'buildNow' : 'close'}">${opened.length ? 'В «Стройку»' : 'Отлично!'}</button></div>`, 'screen dim', false);
  layer.dataset.kind = 'levelup';
}

/* ================= Слои-оверлеи ================= */
const layer = $('#layer');
// Кнопки, которые всегда на месте (нижняя панель, быстрые сверху): срабатывают на касание.
// click оставлен для мыши/клавиатуры, но не дублирует касание.
// После закрытия любого окна 300 мс тапы игнорируются: второй тап «Закрыть»
// не должен нажать «Следующий месяц», который стоит на том же месте.
let tapBlockUntil = 0;
const tapsBlocked = () => Date.now() < tapBlockUntil;
function fastTap(el, fn) {
  let last = 0;
  el.addEventListener('pointerdown', (e) => { if (e.button > 0 || tapsBlocked()) return; last = Date.now(); fn(e); });
  el.addEventListener('click', (e) => { if (Date.now() - last < 700 || tapsBlocked()) return; fn(e); });
}

// keep-ui: окно поверх, но нижняя панель и фермер остаются на месте (фон затемнён)
function openLayer(html, cls = 'sheet-wrap', back = true) {
  layer.className = cls;
  $('#app').classList.toggle('covered', cls.startsWith('screen') && !cls.includes('keep-ui'));
  $('#app').classList.toggle('bare', cls === 'screen');
  layer.innerHTML = html;
  layer.hidden = false;
  layer.dataset.opened = Date.now();
  if (back) tg?.BackButton.show(); else tg?.BackButton.hide();
}
function closeLayer() {
  tapBlockUntil = Date.now() + 300;
  layer.hidden = true; layer.innerHTML = '';
  $('#app').classList.remove('covered', 'bare');
  tg?.BackButton.hide();
  setTimeout(afterGain, 300);
}
tg?.BackButton.onClick(() => {
  if (coach.isOpen()) return coach.close();
  const k = layer.dataset.kind;
  if (k === 'event' || k === 'report') return;
  if (k === 'intro' || k === 'album-start' || k === 'rating-start') return showSplash();
  closeLayer();
});
const sheet = (title, body, kind) => { openLayer(`<div class="sheet"><div class="grab"></div><h2>${title}</h2>${body}</div>`); layer.dataset.kind = kind; };

// нажатие считается, только если палец опустили уже на открытом окне (нет «призрачных» кликов)
layer.addEventListener('pointerdown', () => { layer.dataset.down = Date.now(); });
layer.addEventListener('click', (e) => {
  if ((+layer.dataset.down || 0) < (+layer.dataset.opened || 0) && e.pointerType !== '' && e.detail !== 0) return;
  const a = e.target.closest('[data-act]');
  if (e.target === layer && layer.classList.contains('sheet-wrap')) return closeLayer();
  if (!a) return;
  haptic(); sfx.click();
  const fn = ACTIONS[a.dataset.act];
  if (fn) fn(a.dataset.id, a);
});

const ACTIONS = {
  buy: (id, el) => { if (el.dataset.lock) { haptic('rigid'); sfx.error(); return toast(el.dataset.lock); } doBuy(id); },
  buyAnyway: (id) => doBuy(id, true),
  backToBuild: () => openBuild(),
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
  deliver: (id, el) => {
    if (el.dataset.lock) { haptic('rigid'); sfx.error(); return toast(el.dataset.lock); }
    const key = id === 'big' ? 'big' : +id;
    const o = E.deliverOrder(st, key);
    if (!o) return;
    notify('success'); sfx.fresh();
    toast(`${o.emoji} Заказ сдан: +${short(o.reward)}, +${o.xp} ⭐`);
    render(); persist(true); openBoard();
    setTimeout(afterGain, 400);
  },
  decline: (id) => { const back = E.declineOrder(st, id === 'big' ? 'big' : +id); toast(`Отказались. ${back ? 'Отложенное продали за ' + short(back) + '. ' : ''}Новый заказ — через 10 минут`); render(); persist(true); openBoard(); },
  buildNow: () => openBuild(),
  house: () => openHouse(),
  letter: (id) => showLetter(+id),
  goLoc: (id) => { closeLayer(); goLoc(id); },
  locLetter: (id) => showLocOpen(LOC_BY_ID[id], true),
  map: () => openMap(),
  repair: (id, el) => {
    if (el.dataset.lock) { haptic('rigid'); sfx.error(); return toast(el.dataset.lock); }
    const err = E.repairHouse(st);
    if (err) return toast(err);
    notify('success'); sfx.build(); setTimeout(() => sfx.fanfare(), 450);
    delete svg.dataset.month; render(); persist(true);
    puff(svg, 98, 330); floatText(svg, 98, 300, `${HOUSE_STAGES[st.house - 1].name}: готово! +3%`, '#2f8a2f');
    showLetter(st.house, true);
  },
  claimLogin: () => { const p = E.claimLogin(st); if (p) { sfx.fresh(); notify('success'); toast(`Бонус за вход: +${short(p)}`); } closeLayer(); render(); persist(true); },
  claimDaily: (id) => { const p = E.claimDaily(st, +id); if (p) { sfx.coin(); notify('success'); toast(`Задание выполнено: +${short(p)}`); } render(); persist(true); updateDots(); openBook('tasks'); },
  sound: () => { const m = sfx.toggle(); toast(m ? 'Звук выключен' : 'Звук включён'); openBook('tasks'); },
  pref: (id, el) => {
    if (id === 'sound') sfx.toggle();
    else if (id === 'music') music.enable(!sfx.settings.music);
    else { prefs[id] = !prefs[id]; savePrefs(); }
    toast(id === 'hints' ? `Подсказки фермера: ${prefs.hints ? 'вкл' : 'выкл'}` : id === 'music' ? `Музыка: ${sfx.settings.music ? 'вкл' : 'выкл'}` : id === 'sound' ? `Звуки: ${sfx.muted ? 'выкл' : 'вкл'}` : 'Сохранено');
    if (el?.dataset.from === 'book') openBook('tasks'); else openSettings();
  },
  saveName: () => { const v = layer.querySelector('#setName')?.value.trim().slice(0, 24) || ''; setPlayerName(v); submitScore(st, profile, true); toast(v ? `Имя в рейтинге: ${v}` : 'Имя сброшено'); },
  rules: () => openRules(),
  settings: () => openSettings(),
  menu: () => { persist(true); showSplash(); },
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
  music.start(monthOf(profile.game ? profile.game.month : 0).season); // первый тап — можно включать звук
  if (profile.game) { st = profile.game; enterGame(); return; }
  if (!profile.introSeen) return showIntro(0);
  newGame();
}
function confirmNew() {
  openLayer(`<div class="dialog"><h3>Точно начать заново?</h3><p><b>Прогресс пропадёт:</b> ферма (год ${yearOf(profile.game.month)}, капитал ${short(E.capital(profile.game))}) начнётся с нуля. Открытки останутся, в рейтинге останется лучший результат.</p>
    <div class="row"><button class="btn primary wide" data-act="splash">Нет, играть дальше</button><button class="btn wide danger" data-act="newyes">Да, заново</button></div></div>`, 'screen dim', true);
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
  important('Дед оставил нам ферму… и <b>бурьян</b> по пояс.<br>Тапай по хламу и бурьяну — всё, по чему можно тапать, обведено <b>кружком</b>.', 'wink');
}
function enterGame() {
  closeLayer();
  delete svg.dataset.month;
  st.tzOff = new Date().getTimezoneOffset();
  render(); hint();
  welcomeBack();
  if (st.phase === 'event') showEvent();
  else setTimeout(maybeLoginBonus, 600);
}

/* ================= Ежедневное: бонус за вход и задания дня ================= */
function maybeLoginBonus() {
  if (!st?.login?.pending || st.phase === 'clean' || !layer.hidden || coach.isOpen()) return;
  const n = st.login.streak;
  const days = Array.from({ length: 7 }, (_, i) => `<div class="lb-day ${i + 1 < n ? 'got' : i + 1 === n ? 'now' : ''}"><span>${i + 1}</span><b>${i + 1 < n ? '✓' : i + 1 === n ? '🎁' : '·'}</b></div>`).join('');
  openLayer(`<div class="dialog login-bonus"><div class="kicker">БОНУС ЗА ВХОД</div><h3>День ${n} из 7</h3>
    <div class="lb-days">${days}</div>
    <p>Заходи каждый день — бонус растёт! Пропустишь день — серия начнётся заново.</p>
    <button class="btn primary big" data-act="claimLogin">Забрать ${short(st.login.pending)}</button></div>`, 'screen dim', false);
  layer.dataset.kind = 'login';
}
function dailyBlock() {
  const tasks = E.dailyTasks(st);
  if (!tasks.length) return '';
  return `<div class="sub">Задания дня</div><ul class="daily">${tasks.map((t, i) => `<li class="${t.claimed ? 'claimed' : t.done ? 'done' : ''}">
      <div class="dl-main"><span>${t.title}</span><div class="dl-bar"><i style="width:${Math.round(100 * t.have / t.need)}%"></i></div></div>
      ${t.claimed ? '<b class="dl-ok">✓</b>' : `<button class="btn primary dl-btn" data-act="claimDaily" data-id="${i}" ${t.done ? '' : 'disabled'}>${t.done ? 'Забрать' : short(t.reward)}</button>`}
    </li>`).join('')}</ul><p class="note">Награда за каждое — ${short(tasks[0].reward)}. Новые задания — каждый день.</p>`;
}
// красная точка на «Тетради», если есть что забрать
function updateDots() {
  if (!st) return;
  const can = E.dailyTasks(st).some(t => t.done && !t.claimed);
  $('#btnBook').classList.toggle('has-dot', can);
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
    const w = E.seasonWait(st, id);
    const waiting = w && w.months > 0;
    const nowTag = waiting
      ? `<span class="tag wait">🌱 ${seasonLine(w, L > 0)}</span>`
      : `<span class="tag inc">${L ? `сейчас ${short(E.rate(st, id))}/мин` : `≈ ${short(E.baseIncome(id, 1) * k)}/мин`}</span>`;
    stats = `${nowTag}${waiting && !L ? `<span class="tag inc">≈ ${short(E.baseIncome(id, 1) * k)}/мин в сезон</span>` : ''}${L < max ? `<span class="tag inc">${L ? `+${short(next)}/мин за уровень` : ''}</span>`.replace('<span class="tag inc"></span>', '') : ''}${L < max ? `<span class="tag">окупится за ${payText(E.paybackMin(st, id))}</span>` : ''}<span class="tag">${b.seasonText}</span>`;
  } else if (b.kind === 'boost') {
    stats = `<span class="tag inc">сейчас +${Math.round(b.boost * L * 100)}% ко всему</span><span class="tag">+${Math.round(b.boost * 100)}% за уровень</span>`;
  }
  const lvl = b.kind === 'once' ? '' : `<div class="lvl">${Array.from({ length: Math.min(max, 10) }, (_, i) => `<i class="${i < L ? 'on' : ''}"></i>`).join('')}<span>ур. ${L}/${max}</span></div>`;
  const label = L >= max ? (b.kind === 'once' ? '✔ Построено' : '✔ Максимум')
    : lock && !lock.startsWith('не хватает') ? cap1(lock)
      : `${L ? `Улучшить до ур. ${L + 1}` : 'Построить'} · ${short(price)}`;
  return `<div class="card ${L >= max ? 'done' : ''} ${lock && L < max ? 'lock' : ''}" id="card-${id}">
    <h3>${b.name}</h3><div class="price">${L >= max ? '' : short(price)}</div>
    ${b.loc && b.loc !== 'home' ? `<div class="loc-tag">📍 ${LOC_BY_ID[b.loc].name}</div>` : ''}
    <p>${b.desc}</p>${lvl}<div class="tags">${stats}</div>
    ${L >= max ? `<div class="tag ok">${label}</div>` : `<button class="btn primary go" data-act="buy" data-id="${id}" ${lock ? `data-lock="${cap1(lock)}"` : ''}>${label}</button>`}
  </div>`;
}

function openBuild(focus) {
  const open = BUILD_ORDER.filter(id => BUILDINGS[id].tier <= st.tier && !(id === 'garden' && st.flags.fieldSold));
  const soon = BUILD_ORDER.filter(id => BUILDINGS[id].tier === st.tier + 1);
  open.sort((a, b) => (!E.canBuy(st, b)) - (!E.canBuy(st, a))); // сначала то, что можно купить сейчас
  if (focus) open.sort((a, b) => (b === focus) - (a === focus));
  const nr = E.nextRepair(st);
  const houseCard = nr ? `<div class="card house-card"><h3>🏠 Дом деда: ${nr.name.toLowerCase()}</h3><div class="price">${short(nr.cost)}</div>
      <p>Ремонт по этапам: каждый +3% ко всему доходу и новое письмо деда.</p><button class="btn primary go" data-act="house">Открыть дом деда</button></div>` : '';
  sheet('Стройка', `<div class="money-line">В кармане: <b>${short(st.money)}</b> · доход <b>${short(E.totalRate(st))}/мин</b></div>
    ${houseCard}${open.map(card).join('')}
    ${soon.length ? `<div class="sub">После цели ${goalLabel(st.tier)}</div>${soon.map(card).join('')}` : ''}`, 'build');
}
function openBuilding(id) {
  if (!BUILDINGS[id]) return;
  sheet(BUILDINGS[id].name, `<div class="money-line">В кармане: <b>${short(st.money)}</b></div>${card(id)}
    <button class="btn wide" data-act="close">Закрыть</button>`, 'building');
}

function doBuy(id, sure = false) {
  const firstTime = !E.level(st, id);
  // сезонная постройка вне сезона — предупреждаем перед покупкой
  const w = E.seasonWait(st, id);
  if (firstTime && !sure && w && w.months > 0) {
    openLayer(`<div class="dialog"><h3>🌱 ${BUILDINGS[id].name} — не сезон</h3>
      <p>Начнёт приносить <b>${w.months === 1 ? 'с нового месяца' : 'с ' + MONTH_GEN[w.month]}</b>${w.months === 1 ? ' — жми «Следующий месяц», когда он закончится' : w.minutes !== Infinity ? ` (${waitText(w)})` : ''}. До этого урожая не будет.</p>
      <p>Можно построить сейчас — или подождать и потратить деньги на то, что приносит уже сегодня.</p>
      <div class="row"><button class="btn wide" data-act="backToBuild">Подожду</button><button class="btn primary wide" data-act="buyAnyway" data-id="${id}">Построить · ${short(E.priceOf(st, id))}</button></div></div>`, 'screen dim keep-ui', true);
    layer.dataset.kind = 'season-warn';
    return;
  }
  const err = E.buy(st, id);
  if (err) return toast(err);
  notify('success'); sfx.build();
  if (firstTime && locOf(id) !== (st.loc || 'home')) goLoc(locOf(id), false); // новая постройка — показываем её локацию
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
    cowshed: 'Коровник на лугу! Молоко — и на сыр, и в заказы.',
    mill: 'Мельница крутится — своя мука!',
    cafe: 'Кафе открыто — пироги из нашей муки и молока!',
    market: 'Место на рынке — заказы теперь дороже!',
    elevator: 'Элеватор построен — зерно храним сами.',
  }[id] || 'Готово!', 'happy', 6000);
}

/* ================= Тетрадь фермера ================= */
function openBook(tab = 'tasks') {
  const tabs = [['tasks', 'Задания'], ['costs', 'Расходы'], ['story', 'История'], ['cards', 'Открытки']];
  let body = '';
  if (tab === 'tasks') {
    body = dailyBlock() + `<div class="sub">Задания фермы</div><ul class="todo">${E.tasks(st).map(([t, ok]) => `<li class="${ok ? 'ok' : ''}"><span class="box">${ok ? '✓' : ''}</span>${t}</li>`).join('')}</ul>
      <p class="note">Капитал = деньги + стоимость построек − долг. Сейчас: <b>${short(E.capital(st))}</b>. Покупки за Telegram Stars в рейтинг не идут.</p>
      <ul class="settings"><li><span>🧑‍🌾 Подсказки фермера: ${prefs.hints ? 'вкл' : 'выкл'}<small>кто уже знает игру — может отключить</small></span><button class="switch ${prefs.hints ? 'on' : ''}" data-act="pref" data-id="hints" data-from="book" aria-label="переключить"></button></li></ul>
      <div class="row"><button class="btn wide" data-act="rating">🏆 Рейтинг</button><button class="btn wide" data-act="settings">⚙️ Звук и музыка</button></div>`;
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
  const e = E.endMonth(st);
  persist(true);
  const nm = monthOf(st.month + 1).name;
  important(`Наступил <b>${nm.toLowerCase()}</b>! А на ферме — «${e.title.replace(/<[^>]+>/g, '')}».<br>Выбирай с умом: от этого зависит весь месяц.`, 'worried', showEvent);
}
function askSkip() {
  const cost = E.skipCost(st), left = E.monthLeft(st), lack = Math.max(0, cost - st.money);
  openLayer(`<div class="dialog"><h3>Месяц ещё идёт</h3>
    <p>До конца месяца — <b>${mmss(left)}</b>. Постройки работают — собирай урожай!</p>
    <p>Можно поторопить время за <b>${short(cost)}</b>. Продукция за пропущенное время не накопится.</p>
    <div class="row"><button class="btn wide" data-act="close">Подожду</button>
      <button class="btn primary wide skip-btn ${lack ? 'off' : ''}" data-act="skip" ${lack ? 'aria-disabled="true"' : ''}>⏩ ${short(cost)}${lack ? `<small>не хватает ${short(lack)}</small>` : ''}</button></div>
    <p class="note">Ускорение — только за монеты фермы. На рейтинг не влияет.</p></div>`, 'screen dim keep-ui', true);
  layer.dataset.kind = 'skip';
}
function doSkip() {
  if (st.money < E.skipCost(st)) { haptic('rigid'); sfx.error(); return toast(`Не хватает ${short(E.skipCost(st) - st.money)}`); }
  const err = E.skipMonth(st);
  if (err) { sfx.error(); return toast(cap1(err)); }
  closeLayer(); persist(true); nextMonth();
}
function showEvent() {
  sfx.card();
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
  sfx.bell(); // новый месяц — колокольчик
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

/* ================= Раздел «Моя ферма» под картинкой (листай вниз) ================= */
function farmInfo() {
  const box = $('#farmInfo');
  if (!box || !st) return;
  if (st.phase === 'clean' || !profile.game) { if (box.innerHTML) box.innerHTML = ''; return; }
  const levels = Object.entries(st.lv).filter(([id]) => BUILDINGS[id].kind !== 'once').reduce((a, [, L]) => a + L, 0);
  const built = Object.keys(st.lv).filter(id => st.lv[id] > 0).length;
  const cards = ACHIEVEMENT_ORDER.filter(k => profile.album[k]).length;
  const todo = E.tasks(st).filter(([, ok]) => !ok).slice(0, 3);
  const html = `<div class="fi-card">
      <div class="fi-head"><span class="fi-title">Моя ферма</span><span class="fi-sub">Год ${yearOf(st.month)} · ${monthOf(st.month).name}</span></div>
      <div class="fi-stats">
        <div><span>Доход</span><b>${short(E.totalRate(st))}/мин</b></div>
        <div><span>Капитал</span><b>${short(E.ratingCapital(st))}</b></div>
        <div><span>Постройки</span><b>${built} · ур. ${levels}</b></div>
        <div><span>Открытки</span><b>${cards}/${ACHIEVEMENT_ORDER.length}</b></div>
      </div>
      ${todo.length ? `<div class="fi-lbl">Ближайшие задания</div><ul class="todo small">${todo.map(([t]) => `<li><span class="box"></span>${t}</li>`).join('')}</ul>` : ''}
      <div class="fi-btns">
        <button class="btn" data-fi="board">📋<small>Заказы</small></button>
        <button class="btn" data-fi="build">🔨<small>Стройка</small></button>
        <button class="btn" data-fi="rating">🏆<small>Рейтинг</small></button>
        <button class="btn" data-fi="book">📒<small>Тетрадь</small></button>
        <button class="btn" data-fi="settings">⚙️<small>Настройки</small></button>
        <button class="btn" data-fi="rules">📖<small>Как играть</small></button>
        <button class="btn" data-fi="top">⬆️<small>К ферме</small></button>
      </div></div>`;
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}
// фермер не закрывает раздел «Моя ферма», когда до него долистали
$('#farmScroll').addEventListener('scroll', () => {
  const f = $('#farmScroll');
  $('#app').classList.toggle('info-view', f.scrollTop > svg.clientHeight - f.clientHeight + 60);
}, { passive: true });
$('#farmInfo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fi]');
  if (!b || !st) return;
  haptic(); sfx.click();
  const k = b.dataset.fi;
  if (k === 'build') return openBuild();
  if (k === 'board') return openBoard();
  if (k === 'rating') return ACTIONS.rating();
  if (k === 'book') return openBook();
  if (k === 'settings') return openSettings();
  if (k === 'rules') return openRules();
  if (k === 'top') return $('#farmScroll').scrollTo({ top: 0, behavior: 'smooth' });
});

/* ================= Локации: карта, переходы, праздник открытия ================= */
const LOC_BY_ID = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));
const openLocations = () => LOCATIONS.filter(l => l.tier <= st.tier);
// в локации есть что собрать (чтобы подсветить её на карте и на стрелках)
const locReady = (loc) => E.PRODUCERS.some(id => locOf(id) === loc && E.level(st, id) > 0 && E.unitsReady(st, id) >= 1);
const locCount = (loc) => Object.keys(BUILDINGS).filter(id => locOf(id) === loc && E.level(st, id) > 0).length;

function goLoc(id, anim = true, dir = 0) {
  if (!LOC_BY_ID[id] || LOC_BY_ID[id].tier > st.tier || (st.loc || 'home') === id) return;
  st.loc = id;
  render();
  if (anim) {
    svg.classList.remove('slide-l', 'slide-r'); void svg.getBoundingClientRect();
    svg.classList.add(dir < 0 ? 'slide-r' : 'slide-l');
    sfx.whoosh?.();
  }
  $('#farmScroll').scrollTo({ top: 0 });
  persist();
}
function stepLoc(d) {
  const open = openLocations();
  if (open.length < 2) return;
  const i = open.findIndex(l => l.id === (st.loc || 'home'));
  const next = open[(i + d + open.length) % open.length];
  haptic(); goLoc(next.id, true, d);
}
// Полоска «◀ Река и луг ▶» под быстрыми кнопками — есть, только когда открыто больше одной локации
function locNav(show) {
  let el = $('#locnav');
  const open = show ? openLocations() : [];
  if (open.length < 2) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'locnav'; el.className = 'locnav';
    $('#quick').after(el);
    fastTap(el, (e) => {
      const b = e.target.closest('[data-ln]'); if (!b || !st) return;
      sfx.click();
      if (b.dataset.ln === 'map') { haptic(); return openMap(); }
      stepLoc(+b.dataset.ln);
    });
  }
  const cur = LOC_BY_ID[st.loc || 'home'];
  const others = open.filter(l => l.id !== cur.id && locReady(l.id)).length;
  const html = `<button class="ln-arrow" data-ln="-1" aria-label="Предыдущая локация">◀</button>
    <button class="ln-name" data-ln="map"><span>${cur.emoji}</span>${cur.name}${others ? '<i class="ln-dot"></i>' : ''}</button>
    <button class="ln-arrow" data-ln="1" aria-label="Следующая локация">▶</button>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
function mapArt(id) {
  const c = { home: ['#8fd068', '#c4553e'], river: ['#6fb6ec', '#f4e5c4'], town: ['#e8dcc8', '#3fa34d'], agro: ['#e9c24a', '#d9dde1'] }[id];
  return `<svg viewBox="0 0 120 70" class="map-art" aria-hidden="true"><rect width="120" height="70" rx="10" fill="#bfe3fb"/>
    <path d="M0 40 Q30 28 60 38 T120 34 V70 H0z" fill="${c[0]}" stroke="#3b2a1f" stroke-width="1.5"/>
    ${id === 'home' ? '<path d="M40 44 L58 30 L76 44z" fill="#c4553e" stroke="#3b2a1f" stroke-width="1.5"/><rect x="44" y="44" width="28" height="16" fill="#f1dfb2" stroke="#3b2a1f" stroke-width="1.5"/>' : ''}
    ${id === 'river' ? '<path d="M0 52 Q60 42 120 54 V62 Q60 50 0 60z" fill="#4d9be0"/><rect x="88" y="22" width="10" height="20" fill="#f4e5c4" stroke="#3b2a1f" stroke-width="1.2"/><path d="M93 22 l-10 -10 M93 22 l10 -10 M93 22 l-10 10 M93 22 l10 10" stroke="#8b5a36" stroke-width="2.5"/>' : ''}
    ${id === 'town' ? '<g stroke="#3b2a1f" stroke-width="1.2"><rect x="16" y="24" width="24" height="30" fill="#c4553e"/><rect x="46" y="16" width="26" height="38" fill="#cfe5c6"/><rect x="78" y="28" width="26" height="26" fill="#3fa34d"/></g>' : ''}
    ${id === 'agro' ? '<path d="M0 46 L120 40 M0 54 L120 50 M0 62 L120 60" stroke="#c99a2e" stroke-width="3"/><g stroke="#3b2a1f" stroke-width="1.2"><rect x="80" y="14" width="10" height="28" fill="#d9dde1"/><rect x="92" y="14" width="10" height="28" fill="#d9dde1"/></g>' : ''}
  </svg>`;
}
function openMap() {
  const cur = st.loc || 'home';
  const cards = LOCATIONS.map(l => {
    const open = l.tier <= st.tier;
    const g = l.tier > 0 ? goalLabel(l.tier - 1) : '';
    const goalNow = l.tier === st.tier + 1;
    return `<div class="mcard ${open ? '' : 'locked'} ${l.id === cur ? 'here' : ''}">
      <div class="mart">${mapArt(l.id)}${open ? '' : '<div class="mlock">🔒</div>'}</div>
      <div class="mtext"><b>${l.emoji} ${l.name}</b><small>${l.about}</small>
        ${open ? `<span class="mstat">${locCount(l.id)} построек${locReady(l.id) ? ' · <em>урожай готов!</em>' : ''}</span>`
          : `<span class="mgoal">Откроется: капитал ${g}${goalNow ? ` · сейчас ${Math.round(E.progress(st) * 100)}%` : ''}</span>`}
        ${open ? (l.id === cur ? '<span class="mhere">ты здесь</span>' : `<button class="btn primary" data-act="goLoc" data-id="${l.id}">Поехать</button>`) : ''}
        ${open && l.letter ? `<button class="mletter" data-act="locLetter" data-id="${l.id}">✉️ письмо деда</button>` : ''}
      </div></div>`;
  }).join('');
  sheet('🗺 Карта', `<p class="note">Переходить между локациями — кнопками ◀ ▶ сверху или <b>свайпом</b> по ферме влево-вправо.</p>${cards}`, 'map');
}
function showLocOpen(l, reread = false) {
  if (!reread) { notify('success'); sfx.fanfare(); }
  openLayer(`<div class="ending">${reread ? '' : `<div class="confetti">${Array.from({ length: 30 }, (_, k) => `<i style="--x:${(k * 37) % 100}%;--d:${(k % 7) * 0.13}s;--c:${['#e8a21a', '#d8392d', '#3fa34d', '#4a90d9', '#f2c84b'][k % 5]}"></i>`).join('')}</div>`}
    <div class="kicker">${reread ? 'ПИСЬМО ДЕДА' : 'НОВАЯ ЛОКАЦИЯ!'}</div>
    <div class="loc-big">${mapArt(l.id)}<b>${l.emoji} ${l.name}</b></div>
    <div class="letter"><p>${l.letter}</p><p class="sign">Твой дед</p></div>
    ${reread ? '<button class="btn primary big" data-act="map">К карте</button>' : `<button class="btn primary big" data-act="goLoc" data-id="${l.id}">Поехать туда!</button>`}</div>`, 'screen dim', !reread);
  layer.dataset.kind = 'locopen';
}
// свайп по ферме влево-вправо — соседняя локация
(() => {
  const f = $('#farmScroll'); let sx = 0, sy = 0, t0 = 0, on = false;
  f.addEventListener('touchstart', (e) => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; t0 = Date.now(); on = true; }, { passive: true });
  f.addEventListener('touchend', (e) => {
    if (!on || !st || !layer.hidden || coach.isOpen()) return; on = false;
    const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - t0 < 700) stepLoc(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
// Рыбалка — мини-игра появится в следующем обновлении
function openFishing() { toast('🎣 Рыбалка скоро! Удочку дед уже починил.'); }

/* ================= Быстрые кнопки, настройки, правила ================= */
const QUICK_HTML = `<button class="lvl-pill" data-q="level" aria-label="Уровень фермы"><b>⭐ 1</b><span class="lvl-track"><i></i></span></button>
      <button class="qbtn" data-q="rating" aria-label="Рейтинг"><span>🏆</span><small>Рейтинг</small></button>
      <button class="qbtn" data-q="map" aria-label="Карта"><span>🗺</span><small>Карта</small></button>
      <button class="qbtn" data-q="settings" aria-label="Настройки"><span>⚙️</span><small>Настройки</small></button>
      <button class="qbtn" data-q="menu" aria-label="Меню"><span>🏠</span><small>Меню</small></button>`;
fastTap($('#quick'), (e) => {
  const b = e.target.closest('[data-q]');
  if (!b || !st) return;
  haptic(); sfx.click();
  const q = b.dataset.q;
  if (q === 'rating') return ACTIONS.rating();
  if (q === 'cards') return openBook('cards');
  if (q === 'map') return openMap();
  if (q === 'settings') return openSettings();
  if (q === 'menu') return ACTIONS.menu();
  if (q === 'level') { const lp = E.levelProgress(st); const next = E.unlockedAt(lp.level + 1).map(id => BUILDINGS[id].name); return toast(`Уровень фермы ${lp.level}: ${lp.have}/${lp.need} ⭐${next.length ? ' · дальше: ' + next.join(', ') : ''}`); }
});

function openSettings() {
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" data-act="pref" data-id="${id}" aria-label="переключить"></button>`;
  const tgUser = tgName();
  sheet('⚙️ Настройки', `<ul class="settings">
      <li><span>🎵 Музыка<small>своя мелодия на каждый сезон</small></span>${sw('music', sfx.settings.music)}</li>
      <li class="vol-row"><span>🔈 Громкость музыки</span><input type="range" id="vol" min="0" max="100" step="5" value="${sfx.settings.volume}" aria-label="Громкость музыки"><b id="volNum">${sfx.settings.volume}%</b></li>
      <li><span>🔊 Звуки<small>вжух, монетки, молоток, фанфары</small></span>${sw('sound', !sfx.muted)}</li>
      <li><span>📳 Вибрация<small>в Telegram на телефоне</small></span>${sw('haptics', prefs.haptics)}</li>
      <li><span>🧑‍🌾 Подсказки фермера<small>${prefs.hints ? 'вкл — важное фермер расскажет по центру экрана' : 'выкл — тапни по фермеру, и он подскажет'}</small></span>${sw('hints', prefs.hints)}</li>
      <li><span>🏆 Имя в рейтинге<small>${tgUser ? 'берётся из Telegram: ' + tgUser : 'как тебя видят другие игроки'}</small></span></li>
    </ul>
    ${tgUser ? '' : `<div class="r-name"><input id="setName" maxlength="24" placeholder="Твоё имя" value="${(playerName() || '').replace(/"/g, '&quot;')}"><button class="btn primary" data-act="saveName">ОК</button></div>`}
    <div class="row" style="margin-top:12px"><button class="btn wide" data-act="rules">📖 Как играть</button><button class="btn wide" data-act="menu">🏠 Главное меню</button></div>
    <div class="row" style="margin-top:10px"><button class="btn wide danger" data-act="newgame">Начать заново</button></div>
    <p class="note">Игра сохраняется сама${api.online ? ' — на сервере, по твоему Telegram' : ' — в этом браузере'}.</p>`, 'settings');
}

function openRules() {
  sheet('📖 Как играть', `<div class="rules">
    <p><b>1. Уборка.</b> Тапай по хламу и бурьяну — дед оставил ферму в запустении.</p>
    <p><b>2. Стройка.</b> Зелёный «＋» на ферме или кнопка «Стройка». У построек есть уровни: каждый следующий дороже в 1,6 раза, но приносит больше.</p>
    <p><b>3. Сбор.</b> Постройки работают сами. Над ними появляются значки — тапай, чтобы собрать деньги. Пока тебя нет, ферма копит до 2 часов.</p>
    <p><b>4. Месяцы.</b> Месяц длится 15 минут. Потом жми «Следующий месяц» — будет событие с выбором и итоги. Сезоны меняются: мёд летом, огород с мая, теплице зимой нужна печка.</p>
    <p><b>5. Цели.</b> Первая — 1 000 000 ₽. Дальше 10 млн, 100 млн… На каждой цели открываются новые постройки, а ферма растёт прямо на картинке.</p>
    <p><b>6. Рейтинг.</b> Место — по капиталу фермы: деньги + постройки − долг. Покупки за Telegram Stars в рейтинг не идут.</p>
    <p>Ферму можно листать пальцем вверх-вниз — внизу луг, там появятся новые постройки.</p>
  </div><button class="btn primary big" data-act="close">Понятно!</button>`, 'rules');
}

// ползунок громкости: меняем сразу, пока тянут
layer.addEventListener('input', (e) => {
  if (e.target.id !== 'vol') return;
  const v = +e.target.value; sfx.set('volume', v);
  const n = layer.querySelector('#volNum'); if (n) n.textContent = v + '%';
  if (v > 0 && !sfx.settings.music) music.enable(true);
});

/* ================= Кнопки ================= */
fastTap($('#btnBuild'), () => { if (!st) return; haptic(); sfx.click(); $('#btnBuild').classList.remove('glow'); if (st.phase === 'clean') return say('Сначала <b>уборка</b> — потом стройка!', 'worried', 2500); openBuild(); });
fastTap($('#btnBook'), () => { if (!st) return; haptic(); sfx.click(); openBook(); });
fastTap($('#btnNext'), () => { if (!st) return; haptic('medium'); sfx.click(); nextMonth(); });
$('#farmer').onclick = () => { if (!st) return; haptic(); forceSay = true; hint(); forceSay = false; };
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
  st.tzOff = new Date().getTimezoneOffset();
  if (location.hash === '#dev') window.__ferma = { E, music, sfx, st: () => st, set: (v) => { st = v; profile.game = v; enterGame(); }, render, profile: () => profile };
  render();
  say('Привет! Я помогу с фермой.', 'wink');
  showSplash();
}
boot();
