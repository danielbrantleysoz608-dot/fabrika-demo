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
  const fresh = {};
  for (const id of E.PRODUCERS) { stock[id] = E.unitsReady(st, id); fresh[id] = stock[id] > 0 && E.freshShare(st, id) >= 0.99; }
  return {
    month: st.month, built, lv: st.lv, tier: st.tier, hens: hens(), hives: hives(), flags: st.flags,
    clean: E.cleanLevel(st), fieldClear: E.fieldClear(st), stock, fresh,
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
  farmInfo();
  $('#app').classList.toggle('clean-phase', st.phase === 'clean' || !profile.game);
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
  if (st.debt) return say(`Долг банку ${short(st.debt)}. Проценты капают — верни в Тетради → Расходы.`);
  say(`До цели — <b>${short(Math.max(0, E.goal(st) - E.ratingCapital(st)))}</b>. Улучшай постройки — тапни по любой!`, 'happy');
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}

/* ================= Тапы по сцене ================= */
// Тап по ферме: палец опустили и подняли почти на том же месте (если листали — это не тап).
// Цель запоминаем при касании: так анимации построек не уводят её из-под пальца.
let downAt = null;
svg.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  downAt = { x: e.clientX, y: e.clientY, t: Date.now(), el: e.target.closest('[data-tap]') };
});
svg.addEventListener('pointercancel', () => { downAt = null; });
svg.addEventListener('pointerup', (e) => {
  const d = downAt; downAt = null;
  if (!d || !st || !d.el || coach.isOpen()) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || Date.now() - d.t > 800) return;
  const el = d.el;
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
  const fresh = E.lastFresh;
  haptic('medium');
  if (fresh > 0 && fresh >= amt * 0.15) sfx.fresh(); else sfx.coin();
  render('ready');
  floatText(svg, pos[0], pos[1], `+${short(amt)}`);
  if (fresh > 0 && fresh >= amt * 0.15) setTimeout(() => floatText(svg, pos[0], pos[1] - 18, 'свежее +20%!', '#2f8a2f'), 180);
  updateDots();
  afterGain();
  persist();
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
  if (coach.isOpen()) return coach.close();
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
  const cost = E.skipCost(st), left = E.monthLeft(st);
  openLayer(`<div class="dialog"><h3>Месяц ещё идёт</h3>
    <p>До конца месяца — <b>${mmss(left)}</b>. Постройки работают — собирай урожай!</p>
    <p>Можно поторопить время за <b>${short(cost)}</b>. Продукция за пропущенное время не накопится.</p>
    <div class="row"><button class="btn wide" data-act="close">Подожду</button><button class="btn primary wide" data-act="skip">⏩ ${short(cost)}</button></div>
    <p class="note">Ускорение — только за монеты фермы. На рейтинг не влияет.</p></div>`, 'screen dim', true);
  layer.dataset.kind = 'skip';
}
function doSkip() {
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
  if (k === 'rating') return ACTIONS.rating();
  if (k === 'book') return openBook();
  if (k === 'settings') return openSettings();
  if (k === 'rules') return openRules();
  if (k === 'top') return $('#farmScroll').scrollTo({ top: 0, behavior: 'smooth' });
});

/* ================= Быстрые кнопки, настройки, правила ================= */
$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b || !st) return;
  haptic(); sfx.click();
  const q = b.dataset.q;
  if (q === 'rating') return ACTIONS.rating();
  if (q === 'cards') return openBook('cards');
  if (q === 'settings') return openSettings();
  if (q === 'menu') return ACTIONS.menu();
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
$('#btnBuild').onclick = () => { if (!st) return; haptic(); sfx.click(); $('#btnBuild').classList.remove('glow'); if (st.phase === 'clean') return say('Сначала <b>уборка</b> — потом стройка!', 'worried', 2500); openBuild(); };
$('#btnBook').onclick = () => { if (!st) return; haptic(); sfx.click(); openBook(); };
$('#btnNext').onclick = () => { if (!st) return; haptic('medium'); sfx.click(); nextMonth(); };
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
