// Важные подсказки фермера — по центру экрана: затемнение, крупный фермер, облачко,
// текст печатается по буквам. Тап по облачку — показать весь текст, второй тап — закрыть.
// «Пропустить ▶» закрывает сразу. Пока подсказка открыта — игра на паузе (см. onPause/onResume).
import { farmerSVG } from './farmer.js';

const queue = [];
let current = null;   // { html, mood, onClose }
let typing = null;    // таймер печати
let el = null;
let hooks = { onPause() {}, onResume() {}, onTap() {} };

export const isOpen = () => !!current;
export function init(h) { hooks = { ...hooks, ...h }; }

// Разбиваем HTML на «шаги»: тег целиком или одна буква — так при печати не ломаются <b>…</b>
function tokens(html) {
  const out = [];
  const re = /(<[^>]+>|&[a-z#0-9]+;|[\s\S])/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'coach';
  el.innerHTML = `<div class="coach-dim"></div>
    <div class="coach-box">
      <div class="coach-bubble" role="dialog" aria-live="polite">
        <div class="coach-text"></div>
        <div class="coach-foot"><span class="coach-hint">тап — дальше</span><button class="coach-skip" type="button">Пропустить ▶</button></div>
      </div>
      <div class="coach-farmer"></div>
    </div>`;
  document.querySelector('#app').appendChild(el);
  // тап по облачку / фермеру / затемнению: допечатать → закрыть.
  // Считаем только нажатия, начатые уже на подсказке (не «хвост» тапа, который её открыл).
  el.addEventListener('pointerdown', () => { el.dataset.down = Date.now(); });
  el.addEventListener('click', (e) => {
    if (!current || !(+el.dataset.down > +el.dataset.opened)) return;
    if (e.target.closest('.coach-skip')) { hooks.onTap(); return close(); }
    hooks.onTap();
    if (typing) finishTyping(); else close();
  });
  return el;
}

function finishTyping() {
  clearInterval(typing); typing = null;
  if (!el || !current) return;
  el.classList.remove('show'); // анимация появления больше не нужна — облачко точно видно целиком
  el.querySelector('.coach-text').innerHTML = current.html;
  el.querySelector('.coach-hint').textContent = 'тап — закрыть';
}

function open(item) {
  ensureEl();
  current = item;
  el.querySelector('.coach-farmer').innerHTML = farmerSVG(item.mood || 'wink');
  const text = el.querySelector('.coach-text');
  text.innerHTML = '';
  el.querySelector('.coach-hint').textContent = 'тап — показать всё';
  el.dataset.opened = Date.now();
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  hooks.onPause();
  const tk = tokens(item.html);
  let i = 0;
  const started = Date.now(), maxMs = tk.length * 28 + 1000;
  clearInterval(typing);
  typing = setInterval(() => {
    // теги и сущности добавляем без задержки, буквы — по одной
    let chunk = '';
    while (i < tk.length && (tk[i][0] === '<' || tk[i][0] === '&')) chunk += tk[i++];
    if (i < tk.length) chunk += tk[i++];
    text.innerHTML = tk.slice(0, i).join('');
    if (i >= tk.length || Date.now() - started > maxMs) finishTyping(); // таймер тормозили (фон) — допечатываем сразу
  }, 28);
}

// Свернули Telegram посреди печати (таймеры и анимации там замирают) — при сворачивании и при возврате
// сразу показываем весь текст, чтобы облачко не осталось пустым или недопечатанным.
document.addEventListener('visibilitychange', () => { if (current && typing) finishTyping(); else if (el) el.classList.remove('show'); });

export function close() {
  if (!current) return;
  clearInterval(typing); typing = null;
  const done = current.onClose;
  current = null;
  if (queue.length) { open(queue.shift()); } else {
    // окно подсказки удаляем из DOM целиком — никаких скрытых копий кнопок
    el.remove(); el = null;
    hooks.onResume();
  }
  if (done) done();
}

// show(html, { mood, onClose }) — встаёт в очередь, если подсказка уже открыта
export function show(html, opts = {}) {
  const item = { html, ...opts };
  if (current) queue.push(item); else open(item);
}
export function clear() { queue.length = 0; close(); }
