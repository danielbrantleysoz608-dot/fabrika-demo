// «Ферма деда» — контроллер интерфейса: экраны, тапы, Telegram, сохранение.
import * as E from './engine.js';
import {
  MONTHS, BUILDINGS, BUILD_ORDER, UNITS, TRASH, GOAL, SEASON_ICON, ENDINGS, ENDING_ORDER, PRODUCTS, SCRAP_BONUS,
} from './data.js';
import { EVENT_BY_ID } from './events.js';
import { renderScene, floatText, puff, SLOT_POS, READY_POSITIONS } from './scene.js';
import { farmerSVG } from './farmer.js';
import { ICONS, POSTCARD_ART } from './icons.js';
import * as api from './api.js';

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const svg = $('#scene');
const fmt = E.fmt;
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred?.(t);
const notify = (t) => tg?.HapticFeedback?.notificationOccurred?.(t);
const SKY = { early: '#6db8ef', spring: '#55b0f1', summer: '#35a6f3', autumn: '#79b4dd', late: '#8fb0c8', winter: '#8eb0cc' };
const TRASH_DEF = Object.fromEntries(TRASH.map(t => [t.id, t]));

let profile = { game: null, album: {}, introSeen: false };
let st = null;

/* ================= Состояние → сцена ================= */
function view() {
  const stock = {};
  for (const id of E.PRODUCERS) stock[id] = E.ready(st, id);
  return {
    month: st.month, built: st.built, hens: st.hens, hives: st.hives, flags: st.flags,
    clean: E.cleanLevel(st), fieldClear: E.fieldClear(st), stock,
    trash: st.trash.map(t => ({ ...TRASH_DEF[t.id], hp: t.hp, maxHp: TRASH_DEF[t.id].hp })),
    fox: st.phase === 'event' && st.event === 'fox',
    canBuild: st.phase === 'play',
  };
}

function render(layers = 'all') {
  renderScene(svg, view(), BUILDINGS, layers);
  if (layers !== 'all') return;
  const m = MONTHS[st.month];
  $('#monthName').textContent = m.name;
  $('#seasonIcon').className = 'ic-' + SEASON_ICON[m.season];
  $('#money').textContent = short(st.money);
  $('#money').classList.toggle('neg', st.money < 0);
  $('#hudHens').textContent = st.hens;
  $('#hudHives').textContent = st.hives;
  const cap = E.capital(st);
  $('#goalFill').style.width = (E.progress(st) * 100) + '%';
  $('#goalNum').textContent = `${Math.round(cap).toLocaleString('ru-RU')} / 1 000 000 ₽`;
  const clean = st.phase !== 'clean';
  $('#cleanBar').hidden = clean;
  const cl = E.cleanLevel(st);
  $('#cleanFill').style.width = (cl * 100) + '%';
  $('#cleanNum').textContent = Math.round(cl * 100) + '%';
  $('#btnNext').classList.toggle('locked', !clean);
  $('#nextLbl').innerHTML = clean ? (st.month === 11 ? 'Итоги года' : 'Следующий месяц') : `Сначала уборка<small>чистота ${Math.round(cl * 100)}%</small>`;
  tg?.setHeaderColor?.(SKY[m.season]);
  tg?.setBackgroundColor?.(SKY[m.season]);
  document.body.style.background = SKY[m.season];
}

function persist(now = false) {
  profile.game = st;
  api.save(profile, { now });
}

/* ================= Помощник ================= */
let sayTimer;
function say(html, mood = 'wink', ms = 0) {
  $('#farmer').innerHTML = farmerSVG(mood);
  const b = $('#bubble');
  b.innerHTML = html; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(sayTimer);
  if (ms) sayTimer = setTimeout(hint, ms);
}

function hint() {
  const m = st.month, b = st.built;
  if (st.phase === 'clean') return say('Дед оставил нам ферму… и <b>бурьян</b>. Тапай по мусору — наведём порядок!');
  if (st.money < 0) return say('Мы <b>в минусе</b>! Ещё месяц так — и ферма замёрзнет. Собирай всё до крошки!', 'worried');
  if (!Object.keys(b).length) return say('Чисто! Жми зелёный <b>＋</b> — начнём с курятника, он кормит круглый год.', 'happy');
  if (E.PRODUCERS.some(id => E.ready(st, id) >= 1)) return say('Продукция готова — <b>тапай</b> по значкам! Несобранное уйдёт за полцены.');
  if (b.coop && !b.fence && m <= 7) return say('Кур без забора лиса утащит. <b>Сетка</b> — 6 000 ₽.', 'worried');
  if (!b.apiary && m <= 2) return say('Летом <b>мёд</b> — самое дорогое. Пасеку бы к июню!');
  if (b.apiary && !b.omshanik && m >= 6 && m <= 9) return say('Нужен <b>омшаник</b>, иначе в декабре пчёлы замёрзнут!', 'worried');
  if (b.greenhouse && !b.stove && m >= 7 && m <= 10) return say('Зимой теплица встанет. <b>Печка</b> — и огурцы в мороз втридорога!');
  if (st.debt) return say(`Долг банку ${fmt(st.debt)}. Проценты капают — верни, как сможешь (Тетрадь → Расходы).`);
  const left = GOAL - E.capital(st);
  if (left <= 0) return say('Капитал — <b>миллион</b>! Дотяни до февраля!', 'happy');
  say(`До миллиона — <b>${fmt(left)}</b>. ${MONTHS.length - m - 1 > 0 ? 'Осталось ходов: ' + (12 - m) : 'Последний месяц!'}`, 'happy');
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2000);
}

/* ================= Тапы по сцене ================= */
svg.addEventListener('click', (e) => {
  if (!st) return;
  const el = e.target.closest('[data-tap]');
  if (!el) return;
  const { tap, id } = el.dataset;
  if (tap === 'trash') return hitTrash(id);
  if (tap === 'slot') { haptic(); return openBuild(id); }
  if (tap === 'bld') return collect(id);
});

function hitTrash(id) {
  const res = E.hitTrash(st, id);
  if (!res) return;
  const t = TRASH_DEF[id];
  haptic(res.removed ? 'medium' : 'light');
  if (res.removed) {
    render(); puff(svg, t.x, t.y);
    floatText(svg, t.x, t.y - 30, `+${Math.round(res.share * 100)}% чистоты`, '#2f8a2f');
    if (res.done) {
      notify('success');
      floatText(svg, 230, 380, `+${fmt(SCRAP_BONUS)} за металлолом`, '#e8891a');
      say(`Вот это порядок! Дедов металлолом сдали — <b>+${fmt(SCRAP_BONUS)}</b>. Теперь — стройка!`, 'happy');
    } else if (Math.random() < .3) {
      say(['Ух, сколько хлама!', 'Ещё немного!', 'Шины — потом на клумбы пустим.', 'Бурьян по пояс…', 'Дед ничего не выбрасывал!'][Math.floor(Math.random() * 5)], 'wink', 2500);
    }
  } else {
    const g = svg.querySelector(`[data-tap="trash"][data-id="${id}"]`);
    if (g) { g.classList.remove('bump'); void g.getBBox(); g.classList.add('bump'); }
    floatText(svg, t.x, t.y - 30, 'ещё!', '#8a5a3c');
    $('#cleanFill').style.width = (E.cleanLevel(st) * 100) + '%';
    $('#cleanNum').textContent = Math.round(E.cleanLevel(st) * 100) + '%';
  }
  persist();
}

function collect(id) {
  const pos = READY_POSITIONS[id];
  const amt = E.collect(st, id);
  if (!pos || amt <= 0) {
    const b = BUILDINGS[id];
    if (!PRODUCTS[id]) return toast(`${b.name}: ${b.income}`);
    const cap = E.monthlyCap(st, id);
    return toast(cap ? `${b.name}: ещё зреет…` : `${b.name}: не сезон (${b.season})`);
  }
  haptic('medium');
  render('ready');
  floatText(svg, pos[0], pos[1], `+${amt} ${PRODUCTS[id].unit}`);
  persist();
}

/* ================= Реальное время ================= */
setInterval(() => {
  if (!st || st.phase !== 'play') { if (st) st.lastTick = Date.now(); return; }
  if (E.tick(st)) render('ready');
}, 500);
setInterval(() => st && st.phase === 'play' && persist(), 10000);

/* ================= Слои-оверлеи ================= */
const layer = $('#layer');
function openLayer(html, cls = 'sheet-wrap', back = true) {
  layer.className = cls;
  $('#app').classList.toggle('covered', cls.startsWith('screen'));
  $('#app').classList.toggle('bare', cls === 'screen');
  layer.innerHTML = html;
  layer.hidden = false;
  if (back) tg?.BackButton.show(); else tg?.BackButton.hide();
}
function closeLayer() {
  layer.hidden = true; layer.innerHTML = '';
  $('#app').classList.remove('covered', 'bare');
  tg?.BackButton.hide();
}
tg?.BackButton.onClick(() => {
  if (layer.dataset.kind === 'event' || layer.dataset.kind === 'report' || layer.dataset.kind === 'ending') return;
  if (layer.dataset.kind === 'intro' || layer.dataset.kind === 'album-start') return showSplash();
  closeLayer();
});
const sheet = (title, body, kind) => { openLayer(`<div class="sheet"><div class="grab"></div><h2>${title}</h2>${body}</div>`); layer.dataset.kind = kind; };

layer.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (e.target === layer && layer.classList.contains('sheet-wrap')) return closeLayer();
  if (!a) return;
  haptic();
  const { act, id } = a.dataset;
  const fn = ACTIONS[act];
  if (fn) fn(id, a);
});

const ACTIONS = {
  build: (id, el) => { if (el.dataset.lock) { haptic('rigid'); return toast(el.dataset.lock); } doBuild(id); },
  buy: (id, el) => { if (el.dataset.lock) { haptic('rigid'); return toast(el.dataset.lock); } doBuy(id); },
  tab: (id) => openBook(id),
  repay: () => { const why = E.repay(st); if (why) return toast(why); notify('success'); render(); persist(); openBook('costs'); say('Долг вернули! Теперь спим спокойно.', 'happy'); },
  opt: (id) => pickOption(+id),
  next: () => afterReport(),
  close: () => closeLayer(),
  play: () => startOrContinue(),
  newgame: () => confirmNew(),
  newyes: () => newGame(),
  album: () => showAlbum(),
  splash: () => showSplash(),
  introNext: (id) => showIntro(+id),
  share: () => share(),
};

/* ================= Заставка и интро ================= */
function showSplash() {
  const g = profile.game;
  const inProgress = g && g.phase !== 'end';
  const got = ENDING_ORDER.filter(k => profile.album[k]).length;
  openLayer(`<div class="splash">
      <div class="logo"><div class="kicker">по мотивам сериала «Ферма с нуля»</div><h1>Ферма <em>деда</em></h1>
        <p>10 000 ₽ → 1 000 000 ₽ за год</p></div>
      <div class="splash-farmer">${farmerSVG('wink')}</div>
      <div class="splash-btns">
        <button class="btn primary big" data-act="play">${inProgress ? `Продолжить<small>${MONTHS[g.month].name} · ${fmt(g.money)}</small>` : 'Играть'}</button>
        ${inProgress ? '<button class="btn wide" data-act="newgame">Новая игра</button>' : ''}
        <button class="btn wide" data-act="album">Открытки с фермы · ${got}/4</button>
      </div></div>`, 'screen', false);
  layer.dataset.kind = 'splash';
}

function startOrContinue() {
  if (profile.game && profile.game.phase !== 'end') { st = profile.game; enterGame(); return; }
  if (!profile.introSeen) return showIntro(0);
  newGame();
}
function confirmNew() {
  openLayer(`<div class="dialog"><h3>Начать заново?</h3><p>Текущая ферма (${MONTHS[profile.game.month].name}, ${fmt(profile.game.money)}) будет потеряна. Открытки останутся.</p>
    <div class="row"><button class="btn wide" data-act="splash">Нет</button><button class="btn primary wide" data-act="newyes">Да, заново</button></div></div>`, 'screen dim', true);
  layer.dataset.kind = 'intro';
}

const INTRO = [
  { mood: 'wink', html: `<div class="letter"><p>Внучек!</p><p>Если читаешь это письмо — ферма теперь твоя. Дом, сарай, поле… и немного бурьяна.</p><p>В сарае — старые рамы, не выбрасывай, пригодятся.</p><p class="sign">Твой дед</p></div>` },
  { mood: 'happy', html: `<div class="card-big"><div class="big-num">10 000 ₽</div><p>Всё наследство — в конверте. Плюс заброшенная ферма.</p></div>` },
  { mood: 'wink', html: `<div class="card-big"><div class="big-num green">1 000 000 ₽</div><p><b>Цель — за год.</b> 1 месяц = 1 ход. Строй, тапай по постройкам, собирай урожай. Каждый месяц — выбор, как в серии!</p></div>` },
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
  E.tick(st);
  render(); hint();
  if (st.phase === 'event') showEvent();
}

/* ================= Стройка ================= */
function openBuild(focus) {
  const order = [...BUILD_ORDER];
  if (focus) order.sort((a, b) => (b === focus) - (a === focus));
  const cards = order.map(id => {
    const b = BUILDINGS[id], done = st.built[id];
    if (id === 'garden' && st.flags.fieldSold) return '';
    const lock = E.canBuild(st, id);
    const price = E.priceOf(st, id);
    return `<div class="card ${done ? 'done' : ''} ${lock && !done ? 'lock' : ''}">
      <h3>${b.name}</h3><div class="price">${price !== b.price ? `<s>${fmt(b.price)}</s> ` : ''}${fmt(price)}</div>
      <p>${b.desc}</p>
      <div class="tags"><span class="tag inc">${b.income}</span><span class="tag">${b.season}</span></div>
      ${done ? '<div class="tag ok">✔ Построено</div>'
        : `<button class="btn primary go" data-act="build" data-id="${id}" ${lock ? `data-lock="${lock}"` : ''}>${lock ? cap1(lock) : 'Построить'}</button>`}
    </div>`;
  }).join('');
  const units = Object.entries(UNITS).filter(([, u]) => st.built[u.requires]).map(([k, u]) => {
    const lock = E.canBuy(st, k);
    return `<div class="card unit ${lock ? 'lock' : ''}"><h3>${u.label}</h3><div class="price">${fmt(u.price)}</div>
      <p>Сейчас: ${st[k]} из ${u.max}</p>
      <button class="btn primary go" data-act="buy" data-id="${k}" ${lock ? `data-lock="${lock}"` : ''}>${lock ? cap1(lock) : 'Купить'}</button></div>`;
  }).join('');
  sheet('Стройка', `<div class="money-line">В кармане: <b>${fmt(st.money)}</b></div>${units ? `<div class="sub">Хозяйство</div>${units}<div class="sub">Постройки</div>` : ''}${cards}`, 'build');
}
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);

function doBuild(id) {
  const err = E.build(st, id);
  if (err) return toast(err);
  closeLayer(); render(); persist(true);
  notify('success');
  const p = SLOT_POS[id];
  puff(svg, p.x, p.y + 10);
  floatText(svg, p.x, p.y - 10, BUILDINGS[id].name + '!', '#2f8a2f');
  say({
    coop: 'Куры заселились! Яйца появятся над курятником — <b>собирай тапом</b>.',
    stall: 'Прилавок «ЯЙЦА деревенские» готов! Всё продаём дороже.',
    garden: 'Грядки вскопаны. Урожай — с мая по сентябрь.',
    fence: 'Сетка стоит. Пусть теперь лиса попробует!',
    greenhouse: 'Дедовы рамы пригодились! Теплица работает с марта по ноябрь.',
    stove: 'Буржуйка трещит — зимой будут огурцы!',
    apiary: 'Пчёлы гудят! Мёд — летом. Ульи можно докупать в «Стройке».',
    omshanik: 'Пчёлам есть где перезимовать.',
    cow: 'Му-у! Молоко каждый день.',
  }[id], 'happy', 6000);
}
function doBuy(k) {
  const err = E.buy(st, k);
  if (err) return toast(err);
  notify('success'); render(); persist(); openBuild();
  toast(UNITS[k].name + '!');
}

/* ================= Тетрадь фермера ================= */
function openBook(tab = 'tasks') {
  const tabs = [['tasks', 'Задания'], ['costs', 'Расходы'], ['story', 'История'], ['cards', 'Открытки']];
  let body = '';
  if (tab === 'tasks') {
    body = `<ul class="todo">${E.tasks(st).map(([t, ok]) => `<li class="${ok ? 'ok' : ''}"><span class="box">${ok ? '✓' : ''}</span>${t}</li>`).join('')}</ul>
      <p class="note">Капитал = деньги + половина стоимости построек + куры и ульи − долг. Сейчас: <b>${fmt(E.capital(st))}</b></p>`;
  }
  if (tab === 'costs') {
    const rows = st.ledger.map(l => `<tr><td>${MONTHS[l.m].name}</td><td class="plus">+${n(l.income)}</td><td class="minus">−${n(l.expense)}</td><td>${l.event ? (l.event > 0 ? '+' : '−') + n(Math.abs(l.event)) : '—'}</td><td><b>${n(l.money)}</b></td></tr>`).join('');
    body = `<table class="ledger"><thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>Событие</th><th>Итог</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">Первые итоги — в конце месяца</td></tr>'}</tbody></table>
      <div class="sub">Расходы этого месяца (примерно)</div><ul class="todo small">${expectedCosts().map(([l, a]) => `<li>${l}<span>${fmt(a)}</span></li>`).join('')}</ul>
      ${st.debt ? `<div class="debt">Долг банку: <b>${fmt(st.debt)}</b> · 5% в месяц<button class="btn primary go" data-act="repay">Вернуть долг</button></div>` : ''}`;
  }
  if (tab === 'story') body = `<ul class="todo story">${[...st.history].reverse().map(h => `<li><span class="m">${MONTHS[h.m].name}</span>${h.t}</li>`).join('')}</ul>`;
  if (tab === 'cards') body = albumGrid();
  sheet('Тетрадь фермера', `<div class="tabs">${tabs.map(([k, l]) => `<button data-act="tab" data-id="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`, 'book');
}
const n = (x) => Math.round(x).toLocaleString('ru-RU');
// для плашки ДЕНЬГИ: 1 250 000 → «1,25 млн ₽»
function short(x) {
  if (Math.abs(x) < 1e6) return fmt(x);
  return (x / 1e6).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + ' млн ₽';
}
function expectedCosts() {
  const fake = structuredClone(st);
  fake.made = {}; fake.barn = {}; fake.mods = {}; fake.flags = { ...fake.flags, soldFarm: false, contract: null };
  const r = E.closeMonth(fake, null);
  return r.costs.map(c => [c.label, c.amount]);
}

/* ================= Событие месяца ================= */
function nextMonth() {
  if (st.phase === 'clean') { haptic('rigid'); return say('Сначала <b>уборка</b>! Тапай по хламу и бурьяну.', 'worried', 2600); }
  if (st.phase !== 'play') return;
  E.tick(st);
  E.endMonth(st);
  persist(true);
  showEvent();
}
function showEvent() {
  const e = EVENT_BY_ID[st.event];
  render();
  const opts = e.options.map((_, i) => E.optionState(st, e, i));
  const blocked = E.allBlocked(st, e);
  openLayer(`<div class="ev-title"><div class="kicker">${MONTHS[st.month].name.toUpperCase()} · ${e.kicker.toUpperCase()}</div>
      <h2>${e.title}</h2><p>${E.resolveText(e.text, st)}</p></div>
    <div class="ev-opts">${opts.map((o, i) => `<button class="opt ${o.why ? 'off' : ''}" data-act="opt" data-id="${i}">${ICONS[o.icon] || ''}<b>${o.label}</b><span>${o.desc}</span>${o.why ? `<em>${cap1(o.why)}</em>` : ''}</button>`).join('')}</div>
    ${blocked ? '<button class="btn wide pass" data-act="opt" data-id="-1">Не по карману — пропустить</button>' : ''}`, 'event-wrap', false);
  layer.dataset.kind = 'event';
  say('Думай! От выбора зависит весь месяц.', 'worried');
}
function pickOption(i) {
  const e = EVENT_BY_ID[st.event];
  if (i >= 0) { const o = E.optionState(st, e, i); if (o.why) { haptic('rigid'); return toast(cap1(o.why)); } }
  const rep = E.choose(st, i);
  if (!rep) return;
  haptic('medium');
  persist(true);
  showReport(rep);
}

/* ================= Итоги месяца ================= */
function showReport(r) {
  const net = r.income - r.expense + r.eventSum;
  const sales = r.sales.map(s => `<li><span>${BUILDINGS[s.id].name}<small>${s.hand} из ${s.qty} ${PRODUCTS[s.id].unit} собрано руками</small></span><b class="plus">+${n(s.sum)}</b></li>`).join('');
  const costs = r.costs.map(c => `<li><span>${c.label}</span><b class="minus">−${n(c.amount)}</b></li>`).join('');
  const evLog = (r.event?.log || []).map(l => `<li><span>${l.label}</span><b class="${l.amount > 0 ? 'plus' : 'minus'}">${l.amount > 0 ? '+' : '−'}${n(Math.abs(l.amount))}</b></li>`).join('');
  openLayer(`<div class="report">
      <div class="kicker">ИТОГИ МЕСЯЦА</div><h2>${r.name}</h2>
      ${r.event ? `<div class="ev-res"><b>${r.event.title}</b> → ${r.event.choice}. ${r.event.text}</div>` : ''}
      <ul class="lines">${sales || '<li class="empty">Продавать пока нечего</li>'}${evLog}${costs}</ul>
      ${r.notes.map(t => `<div class="warn">${t}</div>`).join('')}
      <div class="total"><span>Итог месяца</span><b class="${net >= 0 ? 'plus' : 'minus'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</b></div>
      <div class="total sm"><span>В кармане</span><b>${fmt(r.after)}</b></div>
      <div class="total sm"><span>Капитал</span><b>${fmt(r.capital)}</b></div>
      <button class="btn primary big" data-act="next">${st.phase === 'end' ? 'Чем всё кончилось?' : 'Дальше'}</button></div>`, 'screen dim', false);
  layer.dataset.kind = 'report';
}
function afterReport() {
  if (st.phase === 'end') return showEnding();
  closeLayer(); render();
  const m = MONTHS[st.month];
  const r = st.report;
  const hiveNote = r?.notes.find(t => t.includes('ульев'));
  if (hiveNote) return say(hiveNote + ' Эх, омшаник бы…', 'worried', 6000);
  say(`Наступил <b>${m.name.toLowerCase()}</b>. ${r && r.income - r.expense >= 0 ? 'Месяц в плюсе!' : 'Месяц в минусе — надо поднажать.'}`, r && r.income - r.expense >= 0 ? 'happy' : 'worried', 5000);
}

/* ================= Концовки и альбом ================= */
function showEnding() {
  const k = st.ending, en = ENDINGS[k];
  const first = !profile.album[k];
  profile.album[k] = profile.album[k] && profile.album[k].capital >= st.finalCapital ? profile.album[k] : { at: Date.now(), capital: st.finalCapital, month: st.month };
  persist(true);
  api.reportResult({ ending: k, capital: st.finalCapital, seed: st.seed, startedAt: st.startedAt, taps: st.taps, months: st.ledger.length, schema: st.v });
  notify(k === 'frozen' ? 'error' : 'success');
  openLayer(`<div class="ending">
      <div class="kicker">${first ? 'НОВАЯ ОТКРЫТКА!' : 'ОТКРЫТКА С ФЕРМЫ'}</div>
      <div class="postcard big" style="--c:${en.color}">${POSTCARD_ART[k]}<div class="pc-title">${en.title}</div></div>
      <p class="pc-sub">${en.sub}</p>
      <div class="stats"><div><span>Капитал</span><b>${fmt(st.finalCapital)}</b></div><div><span>Построек</span><b>${Object.keys(st.built).length}/9</b></div><div><span>Тапов</span><b>${n(st.taps)}</b></div></div>
      <button class="btn primary big" data-act="newyes">Сыграть снова</button>
      <div class="row"><button class="btn wide" data-act="album">Альбом</button>${tg ? '<button class="btn wide" data-act="share">Поделиться</button>' : ''}</div>
    </div>`, 'screen dim', false);
  layer.dataset.kind = 'ending';
  say(k === 'millionaire' ? 'МИЛЛИОН! Дед бы плясал!' : k === 'frozen' ? 'Эх… Но опыт — тоже капитал.' : 'Хороший был год!', k === 'frozen' ? 'worried' : 'happy');
}
function albumGrid() {
  return `<div class="album">${ENDING_ORDER.map(k => {
    const got = profile.album[k], en = ENDINGS[k];
    return `<div class="postcard ${got ? '' : 'locked'}" style="--c:${en.color}">${POSTCARD_ART[got ? k : 'locked']}
      <div class="pc-title">${got ? en.title : '???'}</div>${got ? `<div class="pc-cap">${fmt(got.capital)}</div>` : ''}</div>`;
  }).join('')}</div><p class="note">Собери все 4 концовки! Открытки остаются навсегда, даже после новой игры.</p>`;
}
function showAlbum() {
  openLayer(`<div class="album-screen"><h2>Открытки с фермы</h2>${albumGrid()}
    <button class="btn primary big" data-act="splash">Назад</button></div>`, 'screen dim', true);
  layer.dataset.kind = 'album-start';
}
function share() {
  const bot = window.FERMA_CONFIG?.botUsername;
  const text = `Моя «Ферма деда»: ${ENDINGS[st.ending].title}, капитал ${fmt(st.finalCapital)}! А ты дойдёшь до миллиона?`;
  const url = bot ? `https://t.me/${bot}` : 'https://t.me';
  tg?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

/* ================= Кнопки ================= */
$('#btnBuild').onclick = () => { if (!st) return; haptic(); if (st.phase === 'clean') return say('Сначала <b>уборка</b> — потом стройка!', 'worried', 2500); openBuild(); };
$('#btnBook').onclick = () => { if (!st) return; haptic(); openBook(); };
$('#btnNext').onclick = () => { if (!st) return; haptic('medium'); nextMonth(); };
$('#farmer').onclick = () => { if (!st) return; haptic(); hint(); };
$('.goal').onclick = () => st && toast(`Капитал ${fmt(E.capital(st))}: деньги + хозяйство − долг`);

/* ================= Старт ================= */
async function boot() {
  if (tg) {
    tg.ready(); tg.expand();
    tg.disableVerticalSwipes?.();
    tg.enableClosingConfirmation?.();
  }
  const saved = await api.loadSave();
  if (saved) profile = { album: {}, introSeen: false, ...saved, game: E.migrate(saved.game) };
  // фон заставки: текущая ферма или новая
  if (profile.game?.phase === 'end' && !profile.album[profile.game.ending]) {
    profile.album[profile.game.ending] = { at: Date.now(), capital: profile.game.finalCapital, month: profile.game.month };
  }
  st = profile.game || E.newGame();
  if (location.hash === '#dev') window.__ferma = { E, st: () => st, set: (v) => { st = v; profile.game = v; enterGame(); }, render };
  render();
  say('Привет! Я помогу с фермой.', 'wink');
  showSplash();
}
boot();
