// Прототип главного экрана: уборка, сезоны, стройка, сбор тапами, пример карточки события.
// Полная механика (engine.js, события, итоги, концовки, сохранение на сервер) — следующий этап.
import { MONTHS, BUILDINGS, TRASH, START_MONEY, GOAL, SEASON_ICON } from './data.js';
import { renderScene, floatText, puff, SLOT_POS, READY_POSITIONS } from './scene.js';
import { farmerSVG } from './farmer.js';

const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const svg = $('#scene');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽';
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred?.(t);

const SAVE_KEY = 'ferma-proto-v1';
const fresh = () => ({
  month: 0, money: START_MONEY, hens: 0, hives: 0, clean: 0,
  trash: TRASH.map(t => ({ ...t, maxHp: t.hp })), fieldClear: false,
  built: {}, stock: {}, barn: {},
});
let st = load() || fresh();

function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch {} }

/* ---------- Telegram ---------- */
if (tg) {
  tg.ready(); tg.expand();
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('#55b0f1'); tg.setBackgroundColor?.('#55b0f1');
  tg.BackButton.onClick(closeAll);
  $('#proto').hidden = !location.hash.includes('proto'); // в Telegram панель прототипа скрыта (откройте с #proto)
}

/* ---------- Отрисовка ---------- */
function totalHp() { return st.trash.reduce((a, t) => a + t.maxHp, 0); }
function leftHp() { return st.trash.reduce((a, t) => a + Math.max(0, t.hp), 0); }

function render() {
  st.clean = 1 - leftHp() / totalHp();
  st.fieldClear = st.trash.filter(t => t.id.startsWith('w') && +t.id.slice(1) <= 6).every(t => t.hp <= 0);
  renderScene(svg, st, BUILDINGS);
  const m = MONTHS[st.month];
  $('#monthName').textContent = m.name;
  $('#seasonIcon').className = 'ic-' + SEASON_ICON[m.season];
  $('#money').textContent = fmt(st.money);
  $('#hudHens').textContent = st.hens;
  $('#hudHives').textContent = st.hives;
  const g = Math.max(0, Math.min(1, st.money / GOAL));
  $('#goalFill').style.width = (g * 100) + '%';
  $('#goalNum').textContent = `${Math.round(st.money).toLocaleString('ru-RU')} / 1 000 000 ₽`;
  const clean = st.clean >= 1;
  $('#cleanBar').hidden = clean;
  $('#cleanFill').style.width = (st.clean * 100) + '%';
  $('#cleanNum').textContent = Math.round(st.clean * 100) + '%';
  const next = $('#btnNext');
  next.classList.toggle('locked', !clean);
  $('#nextLbl').innerHTML = clean ? 'Следующий месяц' : `Сначала уборка<small>чистота ${Math.round(st.clean * 100)}%</small>`;
  save();
}

let sayTimer;
function say(html, mood = 'wink', ms = 0) {
  $('#farmer').innerHTML = farmerSVG(mood);
  const b = $('#bubble');
  b.innerHTML = html; b.style.animation = 'none'; b.offsetWidth; b.style.animation = '';
  clearTimeout(sayTimer);
  if (ms) sayTimer = setTimeout(hint, ms);
}

function hint() {
  if (st.clean < 1) return say('Дед оставил нам ферму… и <b>бурьян</b>. Тапай по мусору — наведём порядок!', 'wink');
  const nb = Object.keys(st.built).length;
  if (!nb) return say('Чисто! Жми зелёный <b>＋</b> — начнём с курятника или прилавка.', 'happy');
  const ready = Object.keys(READY_POSITIONS).some(id => st.built[id] && st.stock[id] >= 1);
  if (ready) return say('Яйца сами себя не соберут — <b>тапай</b> по значкам!', 'wink');
  say('Копим на следующую постройку. До миллиона — <b>' + fmt(GOAL - st.money) + '</b>.', 'happy');
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  t.style.animation = 'none'; t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
}

/* ---------- Тапы по сцене ---------- */
svg.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tap]');
  if (!el) return;
  const { tap, id } = el.dataset;
  if (tap === 'trash') return hitTrash(id);
  if (tap === 'slot') return openBuild(id);
  if (tap === 'bld') return collect(id);
});

function hitTrash(id) {
  const t = st.trash.find(x => x.id === id);
  if (!t || t.hp <= 0) return;
  t.hp--; haptic(t.hp ? 'light' : 'medium');
  if (t.hp <= 0) {
    render(); puff(svg, t.x, t.y);
    floatText(svg, t.x, t.y - 30, `+${Math.round(t.maxHp / totalHp() * 100)}% чистоты`, '#2f8a2f');
    if (st.clean >= 1) {
      tg?.HapticFeedback?.notificationOccurred?.('success');
      $('#cleanBar').classList.add('done');
      say('Вот это порядок! Дед бы гордился. Теперь — <b>стройка</b>.', 'happy');
    } else if (Math.random() < .3) {
      say(['Ух, сколько хлама!', 'Ещё немного!', 'Шины — на клумбы потом пустим.', 'Бурьян по пояс…'][Math.floor(Math.random() * 4)], 'wink', 2500);
    }
  } else {
    const g = svg.querySelector(`[data-id="${id}"]`);
    if (g) { g.classList.remove('bump'); void g.getBBox(); g.classList.add('bump'); }
    $('#cleanFill').style.width = ((1 - leftHp() / totalHp()) * 100) + '%';
    floatText(svg, t.x, t.y - 30, 'ещё!', '#8a5a3c');
  }
}

function collect(id) {
  const pos = READY_POSITIONS[id];
  const amt = Math.floor(st.stock[id] || 0);
  if (!pos || amt <= 0) {
    const b = BUILDINGS[id];
    return toast(b.product ? `${b.name}: копим — не сезон или уже собрано` : b.name);
  }
  st.stock[id] = 0;
  st.barn[id] = (st.barn[id] || 0) + amt;
  haptic('medium');
  render();
  floatText(svg, pos[0], pos[1], `+${amt} ${BUILDINGS[id].product}`);
  if (Math.random() < .4) say('В амбар! Продадим в конце месяца — на прилавке дороже.', 'happy', 2600);
}

/* ---------- Производство в реальном времени ---------- */
function producing(id) {
  const s = MONTHS[st.month].season, n = st.month;
  if (!st.built[id]) return false;
  if (id === 'garden') return n >= 2 && n <= 6;
  if (id === 'greenhouse') return s !== 'winter' || st.built.stove;
  if (id === 'apiary') return n >= 3 && n <= 5;
  return true;
}
setInterval(() => {
  if (st.clean < 1) return;
  let changed = false;
  for (const id of Object.keys(READY_POSITIONS)) {
    if (!producing(id)) continue;
    const b = BUILDINGS[id], before = Math.floor(st.stock[id] || 0);
    const mult = id === 'coop' ? Math.max(1, st.hens / 10) : id === 'apiary' ? Math.max(1, st.hives / 3) : 1;
    st.stock[id] = Math.min(b.cap, (st.stock[id] || 0) + b.rate * mult / 3);
    if (Math.floor(st.stock[id]) !== before) changed = true;
  }
  if (changed && !document.querySelector('.sheet-wrap:not([hidden]), .event-wrap:not([hidden])')) render();
}, 1000);

/* ---------- Стройка ---------- */
function openBuild(focus) {
  const order = ['coop', 'stall', 'garden', 'fence', 'greenhouse', 'stove', 'apiary', 'omshanik', 'cow'];
  if (focus) order.sort((a, b) => (b === focus) - (a === focus));
  const cards = order.map(id => {
    const b = BUILDINGS[id], done = st.built[id];
    const needs = b.requires && !st.built[b.requires];
    const lockText = st.clean < 1 ? 'Сначала уборка' : needs ? 'Нужно: ' + BUILDINGS[b.requires].name : st.money < b.price ? `Не хватает ${fmt(b.price - st.money)}` : '';
    return `<div class="card ${done ? 'done' : ''} ${lockText && !done ? 'lock' : ''}">
      <h3>${b.name}</h3><div class="price">${fmt(b.price)}</div>
      <p>${b.desc}</p>
      <div class="tags"><span class="tag inc">${b.income}</span><span class="tag">${b.season}</span></div>
      ${done ? '<div class="tag" style="grid-column:1/-1;text-align:center">✔ Построено</div>'
        : `<button class="btn primary go" data-build="${id}" ${lockText ? 'data-lock="' + lockText + '"' : ''}>${lockText || 'Построить'}</button>`}
    </div>`;
  }).join('');
  openSheet(`<h2>Стройка</h2>${cards}`);
}

function build(id) {
  const b = BUILDINGS[id];
  st.money -= b.price; st.built[id] = true;
  if (id === 'coop') st.hens += 10;
  if (id === 'apiary') st.hives += 3;
  closeAll(); render();
  tg?.HapticFeedback?.notificationOccurred?.('success');
  const p = SLOT_POS[id];
  puff(svg, p.x, p.y + 10);
  floatText(svg, p.x, p.y - 10, b.name + '!', '#2f8a2f');
  say({
    coop: 'Куры заселились! Яйца появятся над курятником — <b>собирай тапом</b>.',
    stall: 'Прилавок «ЯЙЦА деревенские» готов! Дачники уже тормозят.',
    garden: 'Грядки вскопаны. Урожай — с мая по сентябрь.',
    fence: 'Сетка стоит. Пусть теперь лиса попробует!',
    greenhouse: 'Дедовы рамы пригодились! Теплица — от марта до ноября.',
    stove: 'Буржуйка трещит — зимой будут огурцы!',
    apiary: 'Пчёлы гудят! Мёд — летом. И не забудь про омшаник к зиме.',
    omshanik: 'Пчёлам есть где перезимовать.',
    cow: 'Му-у! Молоко каждый день.',
  }[id], 'happy');
}

/* ---------- Тетрадь фермера ---------- */
function openBook(tab = 'tasks') {
  const tasks = [
    ['Убрать ферму деда', st.clean >= 1], ['Построить курятник', !!st.built.coop], ['Поставить прилавок у дороги', !!st.built.stall],
    ['Защитить кур забором', !!st.built.fence], ['Собрать теплицу из окон деда', !!st.built.greenhouse], ['Накопить 100 000 ₽', st.money >= 100000],
    ['Дожить до весны без долгов', false], ['Миллион!', st.money >= GOAL],
  ];
  const body = {
    tasks: `<ul class="todo">${tasks.map(([t, ok]) => `<li><span class="box">${ok ? '✓' : ''}</span>${t}</li>`).join('')}</ul>`,
    costs: `<ul class="todo"><li>Корм курам — 800 ₽/мес</li><li>Электричество — 1 200 ₽/мес</li><li>Отопление (зима) — 3 000 ₽/мес</li><li style="opacity:.6">Полный учёт — на следующем этапе</li></ul>`,
    story: `<ul class="todo"><li>${MONTHS[0].name}: получили ферму деда и 10 000 ₽</li>${st.clean >= 1 ? '<li>Убрали весь хлам</li>' : ''}${Object.keys(st.built).map(id => `<li>Построили: ${BUILDINGS[id].name}</li>`).join('')}</ul>`,
    cards: `<ul class="todo">${['Миллионер', 'Ферма живёт', 'Продал ферму соседу', 'Ферма замёрзла'].map(t => `<li><span class="box">?</span>${t}</li>`).join('')}</ul>`,
  }[tab];
  openSheet(`<h2>Тетрадь фермера</h2>
    <div class="tabs">${[['tasks', 'Задания'], ['costs', 'Расходы'], ['story', 'История'], ['cards', 'Открытки']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`);
}

/* ---------- Пример карточки события ---------- */
const ICONS = {
  hive: '<svg viewBox="0 0 84 64"><g stroke="#3b2a1f" stroke-width="2.4" stroke-linejoin="round"><rect x="20" y="14" width="44" height="8" fill="#d6463a"/><rect x="24" y="22" width="36" height="16" fill="#f2c84b"/><rect x="24" y="38" width="36" height="16" fill="#f2c84b"/></g><rect x="38" y="48" width="9" height="3" fill="#3b2a1f"/><circle cx="68" cy="16" r="3" fill="#2b2b2b"/><circle cx="14" cy="30" r="3" fill="#2b2b2b"/></svg>',
  no: '<svg viewBox="0 0 84 64"><circle cx="42" cy="32" r="22" fill="#fbf3e3" stroke="#8a7f72" stroke-width="4"/><path d="M32 22 L52 42 M52 22 L32 42" stroke="#8a7f72" stroke-width="5" stroke-linecap="round"/></svg>',
  cow: '<svg viewBox="0 0 84 64"><g stroke="#3b2a1f" stroke-width="2"><rect x="10" y="22" width="44" height="22" rx="9" fill="#fff"/><rect x="14" y="40" width="5" height="14" fill="#fff"/><rect x="44" y="40" width="5" height="14" fill="#fff"/><rect x="50" y="10" width="20" height="18" rx="7" fill="#fff"/><ellipse cx="68" cy="24" rx="7" ry="5" fill="#f4a3b4"/></g><circle cx="22" cy="30" r="5" fill="#222"/><circle cx="40" cy="36" r="4" fill="#222"/><circle cx="58" cy="17" r="2" fill="#222"/></svg>',
  stove: '<svg viewBox="0 0 84 64"><g stroke="#3b2a1f" stroke-width="2"><rect x="38" y="2" width="7" height="20" fill="#5b6168"/><rect x="24" y="20" width="36" height="32" rx="5" fill="#5b6168"/><rect x="31" y="27" width="22" height="16" fill="#3b2a1f"/></g><path d="M35 43 l5 -10 l3 5 l3 -7 l4 12z" fill="#f28c28"/><path d="M12 44 v-10 M18 46 v-12 M66 44 v-10 M72 46 v-12" stroke="#3fae4f" stroke-width="5" stroke-linecap="round"/></svg>',
  trap: '<svg viewBox="0 0 84 64"><path d="M14 40 h56 v8 h-56z" fill="#757d85" stroke="#3b2a1f" stroke-width="2"/><path d="M18 40 q24 -36 48 0" fill="none" stroke="#3b2a1f" stroke-width="3"/><path d="M22 40 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6" fill="none" stroke="#9aa3a8" stroke-width="2"/></svg>',
};
function sampleEvent() {
  const s = MONTHS[(st.month + 1) % 12].season;
  if (s === 'winter') return { kicker: MONTHS[(st.month + 1) % 12].name.toUpperCase() + ' · ВЫБОР', title: 'Корова <em>или</em> печка?', text: 'Денег хватит только на одно.',
    a: ['cow', 'Корова', 'молоко каждый день, но все деньги'], b: ['stove', 'Печка', 'в теплицу — огурцы зимой ×3'] };
  if (s === 'autumn' || s === 'late') return { kicker: MONTHS[(st.month + 1) % 12].name.toUpperCase() + ' · СОБЫТИЕ', title: 'Лиса <em>у курятника!</em>', text: 'Ночью видели следы у сетки.',
    a: ['trap', 'Капканы', '−2 000 ₽, куры целы'], b: ['no', 'И так сойдёт', 'без забора — минус куры'] };
  return { kicker: MONTHS[(st.month + 1) % 12].name.toUpperCase() + ' · СОБЫТИЕ', title: 'Пасечник <em>продаёт ульи</em>', text: 'Сосед уезжает в город и отдаёт 3 улья со скидкой.',
    a: ['hive', 'Купить', '3 улья за 12 000 ₽'], b: ['no', 'Отказаться', 'деньги целее'] };
}
function nextMonth() {
  if (st.clean < 1) { haptic('rigid'); return say('Сначала <b>уборка</b>! Тапай по хламу и бурьяну.', 'worried', 2600); }
  const ev = sampleEvent();
  const w = $('#eventWrap');
  w.innerHTML = `<div class="ev-title"><div class="kicker">${ev.kicker}</div><h2>${ev.title}</h2><p>${ev.text}</p></div>
    <div class="ev-opts">${[ev.a, ev.b].map((o, i) => `<button class="opt" data-opt="${i}">${ICONS[o[0]]}<b>${o[1]}</b><span>${o[2]}</span></button>`).join('')}</div>`;
  w.hidden = false; tg?.BackButton.show();
}
function resolveEvent() {
  $('#eventWrap').hidden = true; tg?.BackButton.hide();
  // продажа собранного (черновой расчёт для прототипа)
  const price = { coop: 30, greenhouse: 120, garden: 60, apiary: 600, cow: 60 };
  let sold = 0;
  for (const [id, q] of Object.entries(st.barn)) sold += q * price[id] * (st.built.stall ? 1.25 : 1);
  for (const [id, q] of Object.entries(st.stock)) sold += q * price[id] * .5;
  st.barn = {}; st.stock = {};
  st.money += sold;
  st.month = (st.month + 1) % 12;
  render();
  toast(`${MONTHS[st.month].name}: продали на ${fmt(sold)}`);
  say(`Наступил <b>${MONTHS[st.month].name.toLowerCase()}</b>. ${sold ? 'Выручка ' + fmt(sold) + '.' : 'Пока без выручки — надо строиться.'}`, 'happy');
}

/* ---------- Шторка ---------- */
function openSheet(html) {
  $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheetWrap').hidden = false; tg?.BackButton.show();
}
function closeAll() { $('#sheetWrap').hidden = true; $('#eventWrap').hidden = true; tg?.BackButton.hide(); }

$('#sheetWrap').addEventListener('click', (e) => {
  if (e.target.id === 'sheetWrap') return closeAll();
  const bb = e.target.closest('[data-build]');
  if (bb) { if (bb.dataset.lock) { haptic('rigid'); return toast(bb.dataset.lock); } return build(bb.dataset.build); }
  const tb = e.target.closest('[data-tab]');
  if (tb) openBook(tb.dataset.tab);
});
$('#eventWrap').addEventListener('click', (e) => { if (e.target.closest('[data-opt]')) { haptic('medium'); resolveEvent(); } });
$('#btnBuild').onclick = () => { haptic(); openBuild(); };
$('#btnBook').onclick = () => { haptic(); openBook(); };
$('#btnNext').onclick = () => { haptic('medium'); nextMonth(); };
$('#farmer').onclick = () => { haptic(); hint(); };

/* ---------- Панель прототипа ---------- */
$('#pToggle').onclick = () => { const b = $('.proto-body'); b.hidden = !b.hidden; };
$('.proto-body').addEventListener('click', (e) => {
  const p = e.target.dataset.p;
  if (p === 'season') st.month = (st.month + 1) % 12;
  if (p === 'clean') st.trash.forEach(t => (t.hp = 0));
  if (p === 'money') st.money += 100000;
  if (p === 'all') { st.trash.forEach(t => (t.hp = 0)); Object.keys(BUILDINGS).forEach(id => (st.built[id] = true)); st.hens = Math.max(st.hens, 12); st.hives = Math.max(st.hives, 5);
    Object.entries(BUILDINGS).forEach(([id, b]) => b.cap && (st.stock[id] = b.cap / 2)); }
  if (p === 'reset') { st = fresh(); }
  render(); hint();
});

render(); hint();
