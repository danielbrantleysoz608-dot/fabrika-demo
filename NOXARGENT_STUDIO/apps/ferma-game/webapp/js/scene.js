// SVG-сцена фермы в стиле мультика «Ферма с нуля»:
// плоский вектор, тёмные контуры, вид сбоку-сверху, смена сезонов.
// viewBox 460×890 — вертикальный кадр; важное держим в x 25..435.

import { workerFigure, WORKER_SPOT } from './workers-art.js';
import { monthOf } from './data.js';

export const W = 460, H = 890;
const OL = 'stroke="#3b2a1f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const OLt = 'stroke="#3b2a1f" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"';

const PAL = {
  early:  { skyT: '#6db8ef', skyB: '#cfe7f6', hillA: '#9ab874', hillB: '#86a862', woods: '#6e9550', ground: '#a7b66c', band: '#9dad63', road: '#a87a50', roadL: '#bb8d61', tuft: '#7b8e4c', sun: 1 },
  spring: { skyT: '#55b0f1', skyB: '#c9e7f8', hillA: '#8cc767', hillB: '#72b553', woods: '#559a42', ground: '#8dc95a', band: '#84c053', road: '#b98856', roadL: '#cb9b69', tuft: '#5b9a3a', sun: 1 },
  summer: { skyT: '#35a6f3', skyB: '#bfe5fa', hillA: '#7cc45c', hillB: '#5cae47', woods: '#43913a', ground: '#5ebd46', band: '#55b33f', road: '#c49561', roadL: '#d4a874', tuft: '#3c8b30', sun: 1 },
  autumn: { skyT: '#79b4dd', skyB: '#e9e3cd', hillA: '#bdb560', hillB: '#a69b4c', woods: '#c47f39', ground: '#b7b761', band: '#abab58', road: '#a77650', roadL: '#b98a5f', tuft: '#8a8740', sun: .8 },
  late:   { skyT: '#8fb0c8', skyB: '#dfe3df', hillA: '#a5a777', hillB: '#929466', woods: '#7d6f55', ground: '#a3a571', band: '#999b68', road: '#97704f', roadL: '#a98260', tuft: '#7a7b52', sun: .6 },
  winter: { skyT: '#8eb0cc', skyB: '#dde7ef', hillA: '#e8eef3', hillB: '#d5e0e8', woods: '#8b9a93', ground: '#eef3f7', band: '#e4ebf1', road: '#cfd9e1', roadL: '#e2e9ef', tuft: '#b4c3ce', sun: .5 },
};

// детерминированный псевдорандом, чтобы трава/цветы не «прыгали» при перерисовке
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- Фон: небо, холмы, земля, дорога, луг ---------- */

function cloud(x, y, s, fill) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><g class="cloud">
    <path d="M-40 12 h80 a14 14 0 0 0 0-26 a18 18 0 0 0-30-14 a22 22 0 0 0-38 6 a16 16 0 0 0-12 34z" fill="${fill}"/>
    <path d="M-40 12 h80" stroke="#d9e6ee" stroke-width="3" opacity=".7"/></g></g>`;
}

function background(m, loc = 'home') {
  const p = PAL[m.season];
  const winter = m.season === 'winter';
  const r = rng(7);
  let s = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.skyT}"/><stop offset="1" stop-color="${p.skyB}"/></linearGradient>
    <radialGradient id="halo"><stop offset=".45" stop-color="#fff7c2" stop-opacity=".9"/><stop offset="1" stop-color="#fff7c2" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="-200" y="-400" width="${W + 400}" height="${300 + 400}" fill="url(#sky)"/>`;
  // солнце
  s += `<g opacity="${p.sun}"><circle cx="372" cy="196" r="62" fill="url(#halo)"/>
    <circle cx="372" cy="196" r="27" fill="#ffe24a" stroke="#f3c534" stroke-width="3"/>
    <circle cx="364" cy="188" r="9" fill="#fff3a6" opacity=".7"/></g>`;
  const cf = winter ? '#eef2f5' : '#ffffff';
  s += `<g class="clouds">${cloud(110, 200, 1, cf)}${cloud(268, 168, .9, cf)}${winter ? cloud(420, 140, .8, cf) : ''}</g>`;
  // дальние холмы
  s += `<path d="M-60 300 C 20 250, 90 262, 160 276 S 300 248, 380 262 S 470 258, 520 270 V 320 H -60z" fill="${p.hillA}"/>`;
  s += `<path d="M-60 296 C 60 276, 140 288, 230 282 S 400 274, 520 286 V 320 H -60z" fill="${p.hillB}"/>`;
  // лесополоса
  let woods = '';
  for (let x = -20; x < W + 20; x += 13) {
    const rr = 7 + r() * 6;
    if (loc === 'home' && x > 330 && x < 440) continue; // здесь домик соседа
    woods += `<circle cx="${x}" cy="${287 - r() * 6}" r="${rr}"/>`;
  }
  s += `<g fill="${p.woods}">${woods}</g>`;
  // домик соседа на горизонте (виден только с фермы деда)
  if (loc === 'home') s += `<g transform="translate(372 262)">
    <rect x="0" y="12" width="28" height="20" fill="#ffffff" ${OLt}/>
    <path d="M-4 13 L14 -1 L32 13z" fill="#d8453a" ${OLt}/>
    <rect x="10" y="20" width="7" height="12" fill="#c58a5a"/>
    ${winter ? '<path d="M-2 12 L14 0 L30 12 L26 11 L14 3 L2 11z" fill="#fff"/>' : ''}
  </g>
  <g stroke="#ffffff" stroke-width="2.4"><path d="M330 292 H460 M330 286 H460"/>
    ${Array.from({ length: 11 }, (_, i) => `<path d="M${334 + i * 12} 282 V296"/>`).join('')}</g>
  <g transform="translate(438 270)"><rect x="-2" y="6" width="5" height="14" fill="#2f3b4a"/><circle cx="0" cy="3" r="3.5" fill="#2f3b4a"/></g>`;
  const far = s; s = ''; // дальний план (небо, холмы) отдельно — между ним и землёй рисуем город и завод
  // земля
  s += `<rect x="-200" y="292" width="${W + 400}" height="${H}" fill="${p.ground}"/>`;
  for (let i = 0; i < 8; i++) {
    const y = 300 + i * 74;
    s += `<rect x="-200" y="${y}" width="${W + 400}" height="30" fill="${p.band}" opacity=".55"/>`;
  }
  // травинки
  let tufts = '';
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = 300 + r() * 580;
    if (y > 636 && y < 694) continue;
    tufts += `<path d="M${x - 4} ${y - 6} L${x} ${y} L${x + 4} ${y - 7}"/>`;
  }
  s += `<g stroke="${p.tuft}" stroke-width="1.6" fill="none" stroke-linecap="round">${tufts}</g>`;
  // дорога
  s += `<rect x="-200" y="640" width="${W + 400}" height="48" fill="${p.road}"/>
    <rect x="-200" y="640" width="${W + 400}" height="4" fill="#3b2a1f" opacity=".35"/>
    <rect x="-200" y="684" width="${W + 400}" height="4" fill="#3b2a1f" opacity=".25"/>
    <path d="M-200 656 H${W + 200} M-200 672 H${W + 200}" stroke="${p.roadL}" stroke-width="3"/>`;
  if (m.season === 'early') {
    s += [[70, 664, 24], [230, 668, 30], [395, 660, 22]].map(([x, y, w]) =>
      `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="5" fill="#bfe1f3" stroke="#8fbcd6" stroke-width="1.5"/>`).join('');
  }
  // цветы на лугу
  const fl = { spring: ['#ffd93b'], summer: ['#ffffff', '#ff5a4f', '#8f6cf0', '#ffd93b'], autumn: ['#ffd25a'] }[m.season];
  if (fl) {
    let f = '';
    const n = m.season === 'summer' ? 70 : m.season === 'spring' ? 30 : 14;
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = 700 + r() * 150, c = fl[i % fl.length];
      f += `<circle cx="${x}" cy="${y}" r="3.4" fill="${c}" stroke="#3b2a1f" stroke-width=".8"/><circle cx="${x}" cy="${y}" r="1.2" fill="#f7a823"/>`;
    }
    s += f;
  }
  // снег: пятна весной, сугробы зимой
  if (m.season === 'early') s += snowPatches([[60, 760, 46], [210, 790, 38], [360, 740, 42], [120, 460, 30], [300, 845, 52], [440, 420, 26], [180, 330, 24]]);
  if (winter) s += snowPatches([[80, 740, 60], [330, 780, 70], [200, 850, 64]], '#ffffff');
  // высокая трава по низу кадра
  let g = `M-20 ${H}`;
  for (let x = -20; x <= W + 20; x += 9) g += ` L${x + 4} ${H - 28 - r() * 26} L${x + 9} ${H - 6}`;
  g += ` L${W + 20} ${H}z`;
  const tall = winter ? '#c9d5de' : m.season === 'autumn' || m.season === 'late' ? '#9a9548' : m.season === 'early' ? '#7f8f4d' : '#3f8f31';
  s += `<path d="${g}" fill="${tall}"/>`;
  return { far, near: s };
}

function snowPatches(list, fill = '#f6fafc') {
  return list.map(([x, y, w]) =>
    `<path d="M${x - w} ${y} q${w * .3} -${w * .22} ${w * .9} -${w * .18} q${w * .7} -${w * .05} ${w * 1.1} ${w * .1} q-${w * .4} ${w * .2} -${w * 1.1} ${w * .2} q-${w * .6} 0 -${w * .9} -${w * .12}z" fill="${fill}" stroke="#c6d6e1" stroke-width="1.2"/>`).join('');
}

/* ---------- Деревья ---------- */

function tree(x, y, mode, scale = 1) {
  const trunk = `<path d="M${x - 5} ${y} L${x - 3} ${y - 50} L${x - 22} ${y - 82} M${x - 3} ${y - 50} L${x + 2} ${y - 92} M${x + 1} ${y - 62} L${x + 24} ${y - 86} M${x - 12} ${y - 66} L${x - 26} ${y - 64} M${x + 14} ${y - 74} L${x + 18} ${y - 98}" stroke="#6a4a33" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M${x - 6} ${y} L${x - 3} ${y - 52} L${x + 3} ${y - 52} L${x + 5} ${y}z" fill="#6a4a33" ${OLt}/>`;
  let crown = '';
  const blob = (fill, extra = '') => `<g ${OL}><circle cx="${x}" cy="${y - 92}" r="34" fill="${fill}"/><circle cx="${x - 26}" cy="${y - 74}" r="24" fill="${fill}"/><circle cx="${x + 26}" cy="${y - 76}" r="25" fill="${fill}"/></g>
    <g fill="${fill}"><circle cx="${x}" cy="${y - 92}" r="32"/><circle cx="${x - 26}" cy="${y - 74}" r="22"/><circle cx="${x + 26}" cy="${y - 76}" r="23"/></g>${extra}`;
  const dots = (c, n, rr = 3.2, seed = 3) => { const r = rng(seed + x); let d = ''; for (let i = 0; i < n; i++) d += `<circle cx="${x - 40 + r() * 80}" cy="${y - 118 + r() * 60}" r="${rr}" fill="${c}"/>`; return d; };
  if (mode === 'buds') crown = dots('#9bd862', 26, 4.2);
  if (mode === 'blossom') crown = blob('#fbe1ec', dots('#f39ac1', 24, 4) + dots('#7cc35a', 10, 3, 9));
  if (mode === 'full') crown = blob('#4fa83f', dots('#6cc255', 12, 5));
  if (mode === 'apples') crown = blob('#4fa83f', dots('#e23b2e', 18, 3.8));
  if (mode === 'autumn') crown = blob('#e5933a', dots('#f3c94a', 18, 5) + dots('#cf5a2a', 10, 4, 5));
  if (mode === 'snow') crown = `<path d="M${x - 24} ${y - 84} l10 -2 M${x + 2} ${y - 94} l6 1 M${x + 22} ${y - 88} l8 -2" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})">${trunk}${crown}</g>`;
}

/* ---------- Постройки ---------- */

// Дом деда меняется по этапам ремонта (0 — заброшен … 5 — живой дом)
function house(m, stage = 0) {
  const winter = m.season === 'winter';
  const roofOk = stage >= 1, winOk = stage >= 2, porch = stage >= 3, stoveOk = stage >= 4, rooms = stage >= 5;
  // крыша: дыры со стропилами → целая черепица
  const roof = roofOk
    ? `<path d="M14 338 L98 270 L182 338z" fill="#c4553e" ${OL}/>
       <g stroke="#a8412f" stroke-width="2.4" fill="none">${[290, 302, 314, 326].map((y, i) => `<path d="M${98 - (y - 270) * 1.235} ${y} H${98 + (y - 270) * 1.235}"/>`).join('')}</g>
       <path d="M14 338 L98 270 L182 338" fill="none" stroke="#8f3426" stroke-width="7" stroke-linejoin="round"/>
       <path d="M14 338 L98 270 L182 338" fill="none" ${OL}/>`
    : `<path d="M14 338 L98 270 L182 338z" fill="#8a603f" ${OL}/>
       <path d="M34 331 L98 280 L162 331z" fill="#4e3423"/>
       <g stroke="#a67a52" stroke-width="4"><path d="M98 281 L50 331 M98 281 L74 331 M98 281 L98 331 M98 281 L122 331 M98 281 L146 331"/><path d="M60 314 H136" stroke-width="3"/></g>
       <path d="M14 338 L98 270 L182 338" fill="none" stroke="#a67a52" stroke-width="7" stroke-linejoin="round"/>
       <path d="M14 338 L98 270 L182 338" fill="none" ${OL}/>`;
  const glass = rooms ? '#ffd96b' : '#4d8fd3';
  // окна: доски → чистые стёкла с занавесками (а после комнат — тёплый свет и цветы)
  const leftWin = winOk
    ? `<rect x="38" y="350" width="34" height="30" fill="${glass}" stroke="#fff" stroke-width="4"/><path d="M55 350 V380 M38 365 H72" stroke="#fff" stroke-width="3"/>
       <path d="M40 352 q6 10 0 26 M70 352 q-6 10 0 26" stroke="#e2403a" stroke-width="5" fill="none" opacity=".85"/>
       <rect x="36" y="348" width="38" height="34" fill="none" ${OLt}/>`
    : `<rect x="38" y="350" width="34" height="30" fill="#4d8fd3" stroke="#fff" stroke-width="4"/><rect x="38" y="350" width="34" height="30" fill="none" ${OLt}/>
       <g ${OLt}><rect x="31" y="355" width="48" height="8" fill="#c2905e" transform="rotate(-14 55 359)"/><rect x="32" y="368" width="46" height="8" fill="#b9845a" transform="rotate(10 55 372)"/></g>`;
  const rightWin = `<rect x="116" y="350" width="38" height="32" fill="${winOk ? glass : '#4d8fd3'}" stroke="#fff" stroke-width="4"/>
    <path d="M135 350 V382 M116 366 H154" stroke="#fff" stroke-width="3"/>
    ${winOk ? '<path d="M118 352 q6 10 0 28 M152 352 q-6 10 0 28" stroke="#e2403a" stroke-width="5" fill="none" opacity=".85"/>' : ''}
    <rect x="114" y="348" width="42" height="36" fill="none" ${OLt}/>`;
  const flowers = rooms ? `<g ${OLt}><rect x="34" y="381" width="42" height="7" fill="#a8693c"/><rect x="112" y="383" width="46" height="7" fill="#a8693c"/></g>
    ${[40, 50, 60, 70, 118, 128, 138, 148].map((x, i) => `<circle cx="${x}" cy="${i < 4 ? 379 : 381}" r="3.5" fill="${['#e2403a', '#ffd23f', '#f39ac1', '#ffffff'][i % 4]}" stroke="#3b2a1f" stroke-width=".8"/>`).join('')}` : '';
  // крыльцо: навес, ступени, перила
  const porchSvg = porch ? `<g ${OLt}><path d="M76 352 L118 352 L124 362 L70 362z" fill="#c4553e"/>
      <rect x="74" y="362" width="4" height="50" fill="#8b5a36"/><rect x="116" y="362" width="4" height="50" fill="#8b5a36"/>
      <rect x="70" y="404" width="54" height="8" fill="#b9844f"/><rect x="74" y="412" width="46" height="6" fill="#a8743f"/><rect x="78" y="418" width="38" height="5" fill="#9a6838"/></g>
      <path d="M78 392 H116" stroke="#8b5a36" stroke-width="2.4"/>` : '';
  const smoke = stoveOk || winter ? '<g class="smoke"><circle cx="136" cy="262" r="8"/><circle cx="142" cy="244" r="11"/><circle cx="134" cy="222" r="14"/></g>' : '';
  return `<g id="house" data-tap="house">
    <rect x="10" y="262" width="176" height="160" fill="transparent"/>
    <ellipse cx="98" cy="414" rx="84" ry="6" fill="#000" opacity=".12"/>
    <rect x="128" y="282" width="15" height="34" fill="${stoveOk ? '#b8432f' : '#c5523c'}" ${OL}/>
    <rect x="125" y="278" width="21" height="7" fill="#a8412f" ${OL}/>
    ${stoveOk ? '<path d="M128 292 h15 M128 302 h15" stroke="#8f3426" stroke-width="1.6"/>' : ''}
    ${roof}
    ${winter ? '<path d="M18 334 L98 272 L178 334 L168 333 L98 282 L28 333z" fill="#fff" stroke="#c6d6e1" stroke-width="1.2"/>' : ''}
    <rect x="26" y="336" width="144" height="76" fill="${rooms ? '#f8ecd2' : '#f4e5c4'}" ${OL}/>
    <path d="M27 352 H169 M27 368 H169 M27 384 H169 M27 400 H169" stroke="#e2cfa6" stroke-width="1.5"/>
    ${leftWin}${rightWin}${flowers}
    <rect x="84" y="360" width="26" height="52" fill="${porch ? '#7d4a2a' : '#a8693c'}" ${OL}/>
    <circle cx="104" cy="388" r="2.4" fill="#f2c94c"/>
    ${porchSvg}${smoke}
  </g>`;
}

function barn(m) {
  const winter = m.season === 'winter';
  let planks = '';
  for (let x = 284; x < 444; x += 12) planks += `M${x} 324 V410 `;
  return `<g id="barn">
    <ellipse cx="358" cy="414" rx="96" ry="6" fill="#000" opacity=".12"/>
    <rect x="270" y="320" width="176" height="92" fill="#8b6346" ${OL}/>
    <path d="${planks}" stroke="#76523a" stroke-width="2"/>
    <path d="M256 326 L358 272 L460 326 L452 330 L358 282 L264 330z" fill="#8e7d6c" ${OL}/>
    <path d="M276 322 L358 280 L440 322z" fill="#9e7353" ${OLt}/>
    ${winter ? '<path d="M258 324 L358 273 L458 324 L446 324 L358 280 L270 324z" fill="#fff" stroke="#c6d6e1" stroke-width="1.2"/>' : ''}
    <rect x="282" y="338" width="28" height="74" fill="#4a3122" ${OLt}/>
    <rect x="406" y="338" width="28" height="74" fill="#4a3122" ${OLt}/>
    <rect x="322" y="344" width="72" height="68" fill="#a07a58" ${OL}/>
    <path d="M358 344 V412 M324 346 L356 410 M356 346 L324 410 M360 346 L392 410 M392 346 L360 410" stroke="#7b583d" stroke-width="3"/>
  </g>`;
}

function field(m, st) {
  if (st.flags?.fieldSold) {
    return `<g id="field"><polygon points="206,420 440,420 456,560 190,560" fill="#c9a36a" stroke="#5a3a24" stroke-width="3" stroke-linejoin="round"/>
      <path d="M215 470 H440 M210 510 H448" stroke="#b28c55" stroke-width="3"/>
      <g transform="translate(323 470)"><rect x="-3" y="0" width="6" height="34" fill="#7b5236"/>
      <rect x="-46" y="-18" width="92" height="22" rx="4" fill="#f8efd9" stroke="#8a5a3c" stroke-width="2.5"/>
      <text y="-3" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="11" fill="#5b3a26">УЧАСТОК СОСЕДА</text></g></g>`;
  }
  const cleared = st.fieldClear;
  const poly = '206,420 440,420 456,560 190,560';
  let s = `<polygon points="${poly}" fill="${cleared ? '#9b6c45' : '#8f7d4f'}" stroke="#5a3a24" stroke-width="3" stroke-linejoin="round"/>`;
  if (!cleared) {
    // бурьян
    const r = rng(11); let w = '';
    for (let i = 0; i < 150; i++) {
      const t = r(), y = 428 + t * 126, xl = 206 - t * 16, xr = 440 + t * 16, x = xl + 6 + r() * (xr - xl - 12);
      const c = ['#6f6a3c', '#a59158', '#7c8a45', '#bfa56c'][i % 4];
      w += `<path d="M${x - 4} ${y} L${x - 1} ${y - 12} M${x + 2} ${y} L${x + 1} ${y - 15} M${x + 5} ${y} L${x + 5} ${y - 10}" stroke="${c}"/>`;
    }
    s += `<g stroke-width="2" stroke-linecap="round">${w}</g>`;
  } else if (st.built.garden) {
    s += gardenBeds(m);
  } else {
    let f = ''; for (let i = 1; i < 7; i++) { const y = 420 + i * 20, t = (y - 420) / 140; f += `<path d="M${208 - t * 16} ${y} H${438 + t * 16}"/>`; }
    s += `<g stroke="#8a5d3a" stroke-width="2">${f}</g>`;
  }
  // огород построен — тап по грядкам открывает его карточку (или собирает урожай)
  return st.built?.garden ? `<g id="field" data-tap="bld" data-id="garden">${s}</g>` : `<g id="field">${s}</g>`;
}

function gardenBeds(m) {
  let s = '';
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const y0 = 428 + i * 22, t0 = (y0 - 420) / 140, t1 = (y0 + 14 - 420) / 140;
    s += `<polygon points="${210 - t0 * 16},${y0} ${436 + t0 * 16},${y0} ${436 + t1 * 16},${y0 + 14} ${210 - t1 * 16},${y0 + 14}" fill="#5f3b22"/>`;
    const n = 18, xl = 214 - t0 * 16, xr = 432 + t0 * 16;
    for (let j = 0; j < n; j++) {
      const x = xl + (j + .5) * (xr - xl) / n, y = y0 + 7;
      if (m.season === 'winter') { s += `<ellipse cx="${x}" cy="${y}" rx="6" ry="3" fill="#fff"/>`; continue; }
      if (m.season === 'early') continue;
      if (m.name === 'Апрель') { s += `<circle cx="${x}" cy="${y}" r="1.8" fill="#9fdc6a"/>`; continue; }
      if (m.name === 'Май') { s += `<path d="M${x} ${y + 3} l-3 -6 M${x} ${y + 3} l3 -6" stroke="#7fd45a" stroke-width="2"/>`; continue; }
      if (m.season === 'summer') {
        const kind = i % 3;
        s += `<circle cx="${x}" cy="${y - 2}" r="5" fill="#4ea83c"/>`;
        s += kind === 0 ? `<circle cx="${x}" cy="${y - 1}" r="3" fill="#e5322b"/>` : kind === 1 ? `<circle cx="${x}" cy="${y - 4}" r="2.4" fill="#ffd23a"/>` : '';
        continue;
      }
      if (m.season === 'autumn') { s += j % 3 === 0 ? `<circle cx="${x}" cy="${y}" r="5" fill="#f08a24" stroke="#3b2a1f" stroke-width="1"/>` : `<circle cx="${x}" cy="${y}" r="2.5" fill="#9a8a3c"/>`; continue; }
    }
  }
  return s;
}

function greenhouse(m, st) {
  const winter = m.season === 'winter';
  const frames = ['#3f78c9', '#d24b3c', '#3e9a4e', '#2f4f7a', '#e0a33a'];
  let panes = '';
  for (let i = 0; i < 5; i++) {
    const x = 42 + i * 21;
    panes += `<rect x="${x}" y="466" width="21" height="38" fill="${winter ? '#e3eef5' : '#cfe9f6'}" stroke="${frames[i]}" stroke-width="3.5"/>
      <path d="M${x + 4} ${470} l8 10" stroke="#fff" stroke-width="2" opacity=".8"/>`;
  }
  let roof = '';
  for (let i = 0; i < 5; i++) {
    const x0 = 42 + i * 21, x1 = 58 + i * 15;
    roof += `<polygon points="${x0},466 ${x0 + 21},466 ${x1 + 15},440 ${x1},440" fill="${winter ? '#ffffff' : '#d8eef8'}" stroke="${frames[(i + 2) % 5]}" stroke-width="3"/>`;
  }
  const plants = winter && !st.built.stove ? '' : `<g fill="#4ea83c">${[52, 70, 92, 112, 132].map(x => `<circle cx="${x}" cy="497" r="6"/><circle cx="${x + 4}" cy="490" r="4"/>`).join('')}</g>`;
  const stove = st.built.stove ? `<g id="stove" data-tap="bld" data-id="stove">
      <rect x="132" y="418" width="7" height="26" fill="#5b6168" ${OLt}/>
      <rect x="128" y="414" width="15" height="6" fill="#474c52" ${OLt}/>
      <g class="smoke small"><circle cx="136" cy="404" r="5"/><circle cx="140" cy="392" r="7"/></g></g>` : '';
  return `<g id="greenhouse" data-tap="bld" data-id="greenhouse" transform="translate(38 432) scale(.82) translate(-38 -432)">
    <ellipse cx="96" cy="507" rx="62" ry="5" fill="#000" opacity=".12"/>
    ${plants}${roof}${panes}
    <rect x="42" y="440" width="105" height="64" fill="none" stroke="none"/>
    <path d="M42 466 L58 440 H133 L147 466 V504 H42z" fill="none" ${OL}/>
    ${stove}</g>`;
}

function coop(m, st) {
  const winter = m.season === 'winter';
  let planks = '';
  for (let x = 46; x < 168; x += 11) planks += `M${x} 552 V600 `;
  return `<g id="coop" data-tap="bld" data-id="coop">
    <ellipse cx="106" cy="603" rx="84" ry="6" fill="#000" opacity=".12"/>
    <rect x="36" y="548" width="136" height="54" fill="#8b6346" ${OL}/>
    <path d="${planks}" stroke="#76523a" stroke-width="2"/>
    <path d="M24 552 L104 512 L184 552 L176 556 L104 520 L32 556z" fill="#d6463a" ${OL}/>
    <path d="M44 549 L104 520 L164 549z" fill="#9e7353" ${OLt}/>
    ${winter ? '<path d="M26 550 L104 513 L182 550 L172 551 L104 520 L36 551z" fill="#fff"/>' : ''}
    <circle cx="104" cy="536" r="8" fill="#f1dfb2" stroke="#a5402f" stroke-width="3"/>
    <rect x="92" y="570" width="22" height="32" fill="#3e2a1d" ${OLt}/>
    <rect x="172" y="568" width="22" height="18" fill="#e2bf5c" ${OLt}/>
    <path d="M92 602 L84 612 H112 L114 602" fill="#a07a58" ${OLt}/>
  </g>`;
}

function hens(st) {
  const n = Math.min(st.hens, 8);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = 40 + i * 24 + (i % 2) * 6, y = 618 + (i % 3) * 5, brown = i % 3 === 1;
    s += `<g transform="translate(${x} ${y})"><g class="hen" style="animation-delay:${-i * .7}s">
      <ellipse cx="0" cy="0" rx="8" ry="6" fill="${brown ? '#c8763e' : '#ffffff'}" ${OLt}/>
      <circle cx="7" cy="-5" r="4" fill="${brown ? '#c8763e' : '#ffffff'}" ${OLt}/>
      <path d="M6 -10 l2 -3 l2 3" fill="#e23b2e"/><path d="M11 -5 l4 1 l-4 1z" fill="#f4a42a"/>
      <path d="M-2 6 v4 M2 6 v4" stroke="#f4a42a" stroke-width="1.5"/></g></g>`;
  }
  return `<g id="hens">${s}</g>`;
}

function fence() {
  let s = '';
  const posts = [];
  for (let x = 20; x <= 236; x += 27) posts.push(x);
  s += `<path d="M20 612 H236 M20 636 H236" stroke="#8e6a4a" stroke-width="3"/>`;
  let mesh = '';
  for (let x = 20; x < 236; x += 8) mesh += `M${x} 612 l8 24 M${x + 8} 612 l-8 24 `;
  s += `<path d="${mesh}" stroke="#cfd3d6" stroke-width="1" opacity=".9"/>`;
  s += posts.map(x => `<rect x="${x - 3}" y="604" width="6" height="36" fill="#8e5a35" ${OLt}/>`).join('');
  s += `<rect x="18" y="594" width="5" height="44" fill="#8e5a35" ${OLt}/><rect x="233" y="594" width="5" height="44" fill="#8e5a35" ${OLt}/>`;
  return `<g id="fence" data-tap="bld" data-id="fence">${s}</g>`;
}

function stall(m) {
  let stripes = '';
  for (let i = 0; i < 9; i++) stripes += `<rect x="${352 + i * 10}" y="612" width="5" height="24" fill="#fff"/>`;
  return `<g id="stall" data-tap="bld" data-id="stall">
    <ellipse cx="398" cy="640" rx="52" ry="5" fill="#000" opacity=".12"/>
    <rect x="432" y="566" width="5" height="44" fill="#7b5236" ${OLt}/>
    <rect x="344" y="560" width="104" height="36" rx="4" fill="#f8efd9" stroke="#8a5a3c" stroke-width="3"/>
    <text x="396" y="577" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="14" fill="#c8362b">ЯЙЦА</text>
    <text x="396" y="591" text-anchor="middle" font-family="'Marck Script', cursive" font-size="12" fill="#5b3a26">деревенские</text>
    <g fill="#f4e8d2" stroke="#b9a07c" stroke-width="1">${[356, 366, 376, 386, 396, 406].map(x => `<ellipse cx="${x}" cy="603" rx="4" ry="5"/>`).join('')}</g>
    <rect x="414" y="596" width="10" height="12" rx="2" fill="#f2b632" ${OLt}/><rect x="426" y="598" width="9" height="10" rx="2" fill="#e5532f" ${OLt}/>
    <rect x="346" y="607" width="100" height="6" fill="#8b5a36" ${OLt}/>
    <rect x="350" y="612" width="92" height="24" fill="#d8392d" ${OLt}/>${stripes}
    <rect x="350" y="612" width="92" height="24" fill="none" ${OLt}/>
    <rect x="352" y="636" width="5" height="6" fill="#7b5236"/><rect x="435" y="636" width="5" height="6" fill="#7b5236"/>
  </g>`;
}

function apiary(m, st) {
  const colors = ['#f2c84b', '#6fa8dc', '#ef8a6a', '#9ccc65', '#f2c84b'];
  const n = Math.min(st.hives, 5) || 3;
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = 258 + i * 18, y = 616 + (i % 2) * 4;
    s += `<g transform="translate(${x} ${y})">
      <rect x="0" y="0" width="15" height="9" fill="${colors[i]}" ${OLt}/><rect x="0" y="9" width="15" height="9" fill="${colors[i]}" ${OLt}/>
      <rect x="-2" y="-4" width="19" height="5" fill="#8b5a36" ${OLt}/>
      <rect x="5" y="14" width="5" height="2" fill="#3b2a1f"/>
      ${m.season === 'winter' ? '<rect x="-2" y="-7" width="19" height="4" rx="2" fill="#fff"/>' : ''}</g>`;
  }
  const bees = m.season === 'summer' ? `<g class="bees">${[0, 1, 2, 3].map(i => `<circle cx="${270 + i * 14}" cy="${606 - (i % 2) * 6}" r="2" fill="#2b2b2b" style="animation-delay:${-i * .4}s"/>`).join('')}</g>` : '';
  return `<g id="apiary" data-tap="bld" data-id="apiary">${s}${bees}</g>`;
}

function omshanik(m) {
  return `<g id="omshanik" data-tap="bld" data-id="omshanik">
    <path d="M262 600 Q262 568 300 566 Q338 568 340 600z" fill="${m.season === 'winter' ? '#fff' : '#6b9a42'}" ${OL}/>
    <rect x="278" y="578" width="44" height="22" fill="#8b6346" ${OLt}/>
    <rect x="292" y="584" width="16" height="16" fill="#a8693c" ${OLt}/>
    <rect x="276" y="570" width="48" height="9" rx="2" fill="#f8efd9" stroke="#8a5a3c" stroke-width="1.5"/>
    <text x="300" y="577" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="6.5" fill="#5b3a26">ОМШАНИК</text>
  </g>`;
}

function cow() {
  return `<g id="cow" data-tap="bld" data-id="cow" transform="translate(330 380)">
    <ellipse cx="28" cy="36" rx="30" ry="4" fill="#000" opacity=".12"/>
    <g ${OLt}><rect x="6" y="22" width="5" height="14" fill="#fff"/><rect x="16" y="22" width="5" height="14" fill="#fff"/>
      <rect x="34" y="22" width="5" height="14" fill="#fff"/><rect x="44" y="22" width="5" height="14" fill="#fff"/>
      <rect x="2" y="2" width="50" height="24" rx="10" fill="#fff"/></g>
    <circle cx="16" cy="10" r="6" fill="#2b2b2b"/><circle cx="36" cy="18" r="5" fill="#2b2b2b"/><circle cx="44" cy="7" r="3.5" fill="#2b2b2b"/>
    <ellipse cx="26" cy="27" rx="5" ry="3" fill="#f4a3b4"/>
    <g ${OLt}><rect x="48" y="-8" width="20" height="18" rx="7" fill="#fff"/><ellipse cx="66" cy="6" rx="7" ry="5" fill="#f4a3b4"/></g>
    <circle cx="57" cy="-1" r="2" fill="#2b2b2b"/>
    <path d="M52 -8 l-3 -6 M62 -8 l3 -6" stroke="#c9a36a" stroke-width="2.4" stroke-linecap="round"/>
  </g>`;
}


/* ---------- Постройки после целей: луг, холмы, горизонт ---------- */

// Сыроварня — на лугу у дороги
function cheese(m) {
  const winter = m.season === 'winter';
  return `<g id="cheese" data-tap="bld" data-id="cheese">
    <ellipse cx="180" cy="776" rx="56" ry="5" fill="#000" opacity=".12"/>
    <rect x="138" y="726" width="84" height="48" fill="#f7f1e2" ${OL}/>
    <path d="M128 730 L180 698 L232 730z" fill="#3f78c9" ${OL}/>
    ${winter ? '<path d="M131 728 L180 699 L229 728 L220 727 L180 705 L140 727z" fill="#fff"/>' : ''}
    <rect x="168" y="746" width="24" height="28" fill="#a8693c" ${OLt}/>
    <rect x="146" y="740" width="16" height="14" fill="#cfe9f6" ${OLt}/><rect x="198" y="740" width="16" height="14" fill="#cfe9f6" ${OLt}/>
    <g transform="translate(180 716)"><path d="M-13 6 L13 6 L13 -2 L-9 -8z" fill="#ffd23f" ${OLt}/><circle cx="-2" cy="0" r="2" fill="#e8a21a"/><circle cx="6" cy="2" r="1.6" fill="#e8a21a"/></g>
    <rect x="148" y="760" width="12" height="8" rx="3" fill="#ffd23f" ${OLt}/>
  </g>`;
}

// Пасека-поле — поле медоносов с рядом ульев
function honeyfield(m) {
  const r = rng(21); let fl = '';
  const col = m.season === 'winter' ? '#fff' : m.season === 'summer' || m.trees === 'blossom' ? '#ffd23f' : m.season === 'autumn' ? '#d9a84a' : '#b9d97a';
  for (let i = 0; i < 70; i++) fl += `<circle cx="${252 + r() * 180}" cy="${712 + r() * 70}" r="${2 + r() * 1.6}" fill="${col}"/>`;
  const colors = ['#f2c84b', '#6fa8dc', '#ef8a6a', '#9ccc65', '#f2c84b', '#6fa8dc'];
  let hives = '';
  for (let i = 0; i < 6; i++) {
    const x = 262 + i * 28, y = 746 + (i % 2) * 6;
    hives += `<g transform="translate(${x} ${y})"><rect x="0" y="0" width="17" height="10" fill="${colors[i]}" ${OLt}/><rect x="0" y="10" width="17" height="10" fill="${colors[i]}" ${OLt}/><rect x="-2" y="-4" width="21" height="5" fill="#8b5a36" ${OLt}/></g>`;
  }
  return `<g id="honeyfield" data-tap="bld" data-id="honeyfield">
    <path d="M248 708 H436 L440 792 H244z" fill="${m.season === 'winter' ? '#e8eff4' : '#7bbf4f'}" stroke="#5a3a24" stroke-width="2.5" stroke-linejoin="round"/>
    ${fl}${hives}
    ${m.season === 'summer' ? `<g class="bees">${[0, 1, 2, 3, 4].map(i => `<circle cx="${280 + i * 30}" cy="${730 - (i % 2) * 8}" r="2" fill="#2b2b2b" style="animation-delay:${-i * .3}s"/>`).join('')}</g>` : ''}
  </g>`;
}

// Трактор на дороге (едет туда-сюда)
function tractorVehicle() {
  return `<g class="tractor-drive" transform="translate(0 0)"><g transform="translate(300 652)">
    <rect x="0" y="0" width="34" height="16" rx="3" fill="#d6463a" ${OL}/>
    <rect x="18" y="-14" width="16" height="16" fill="#d6463a" ${OL}/><rect x="21" y="-11" width="10" height="9" fill="#cfe9f6"/>
    <rect x="4" y="-8" width="4" height="8" fill="#555"/>
    <circle cx="27" cy="18" r="9" fill="#2f2f33" ${OL}/><circle cx="27" cy="18" r="3" fill="#f2c84b"/>
    <circle cx="6" cy="20" r="6" fill="#2f2f33" ${OL}/><circle cx="6" cy="20" r="2" fill="#f2c84b"/>
  </g></g>`;
}

// Дальний план: поля на холмах, город, щит марки, завод
function farItems(m, st) {
  const b = st.built; let s = '';
  if (b.shop) {
    s += `<g id="shop" data-tap="bld" data-id="shop">
      <rect x="30" y="236" width="26" height="54" fill="#c9d3dc" ${OLt}/><rect x="58" y="214" width="30" height="76" fill="#e8d3b4" ${OLt}/>
      <rect x="92" y="244" width="24" height="46" fill="#b7c4cf" ${OLt}/><rect x="118" y="228" width="28" height="62" fill="#e2c7c1" ${OLt}/>
      ${[0, 1, 2, 3, 4].map(i => `<rect x="${63 + (i % 2) * 12}" y="${222 + Math.floor(i / 2) * 14}" width="7" height="8" fill="#ffd96b"/>`).join('')}
      <rect x="52" y="200" width="44" height="14" rx="3" fill="#d8392d" stroke="#3b2a1f" stroke-width="1.5"/>
      <text x="74" y="210" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="7.5" fill="#fff">ФЕРМА ДЕДА</text>
    </g>`;
  }
  if (b.factory) {
    s += `<g id="factory" data-tap="bld" data-id="factory">
      <rect x="352" y="168" width="12" height="70" fill="#a8412f" ${OLt}/><rect x="372" y="180" width="12" height="58" fill="#a8412f" ${OLt}/>
      <path d="M352 168 h12 M372 180 h12" stroke="#fff" stroke-width="3"/>
      <path d="M318 290 V238 L342 222 V238 L366 222 V238 L390 222 V238 L414 222 V290z" fill="#8f9aa5" ${OL}/>
      ${[0, 1, 2, 3].map(i => `<rect x="${326 + i * 22}" y="252" width="12" height="10" fill="#ffd96b" stroke="#3b2a1f" stroke-width="1"/>`).join('')}
      <g class="smoke"><circle cx="358" cy="156" r="7"/><circle cx="364" cy="140" r="9"/><circle cx="378" cy="168" r="6"/></g>
    </g>`;
  }
  if (b.tractor) {
    const c = m.season === 'winter' ? ['#f4f8fb', '#e3ebf1'] : m.season === 'summer' ? ['#e9c24a', '#d9a93a'] : m.season === 'autumn' || m.season === 'late' ? ['#b88a52', '#a3773f'] : ['#8fd068', '#6fb94e'];
    let rows = '';
    for (let i = 0; i < 6; i++) rows += `<path d="M${168 + i * 6} ${292} L${196 + i * 22} 262" stroke="${c[1]}" stroke-width="5"/>`;
    s += `<g id="tractor" data-tap="bld" data-id="tractor"><path d="M160 294 L190 262 H322 L340 294z" fill="${c[0]}" stroke="#5a3a24" stroke-width="2" stroke-linejoin="round"/>${rows}</g>`;
  }
  if (b.brand) {
    s += `<g id="brand" data-tap="bld" data-id="brand">
      <rect x="206" y="226" width="5" height="34" fill="#7b5236" ${OLt}/><rect x="252" y="226" width="5" height="34" fill="#7b5236" ${OLt}/>
      <rect x="186" y="196" width="92" height="38" rx="5" fill="#f8efd9" stroke="#8a5a3c" stroke-width="3"/>
      <text x="232" y="214" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="12" fill="#c8362b">ФЕРМА ДЕДА</text>
      <text x="232" y="227" text-anchor="middle" font-family="'Marck Script', cursive" font-size="10" fill="#5b3a26">с 1956 года</text>
    </g>`;
  }
  return s;
}

/* ---------- Доска заказов (на лугу у прилавка) ---------- */
function orderBoard(st) {
  const done = st.ordersDone || 0, total = st.ordersActive || 0;
  const notes = [0, 1, 2].map(i => {
    const x = 332 + i * 24, filled = i < total;
    return filled ? `<g transform="rotate(${[-4, 3, -2][i]} ${x + 10} 724)"><rect x="${x}" y="712" width="20" height="24" fill="${i < done ? '#dff2d8' : '#fffaf0'}" stroke="#8a5a3c" stroke-width="1.2"/>
      <path d="M${x + 4} ${720} h12 M${x + 4} ${725} h9 M${x + 4} ${730} h11" stroke="#b9a07c" stroke-width="1.4"/><circle cx="${x + 10}" cy="714" r="2" fill="#d8392d"/></g>` : '';
  }).join('');
  const badge = done ? `<g class="board-badge"><circle cx="400" cy="700" r="11" fill="#d8392d" stroke="#fff" stroke-width="2.5"/><text x="400" y="704.5" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="12" fill="#fff">${done}</text></g>` : '';
  return `<g id="board" data-tap="board">
    <rect x="312" y="690" width="100" height="78" fill="transparent"/>
    <ellipse cx="363" cy="766" rx="44" ry="5" fill="#000" opacity=".12"/>
    <rect x="332" y="728" width="6" height="38" fill="#7b5236" ${OLt}/><rect x="388" y="728" width="6" height="38" fill="#7b5236" ${OLt}/>
    <rect x="322" y="700" width="82" height="44" rx="4" fill="#b9844f" ${OL}/>
    <rect x="326" y="704" width="74" height="36" rx="3" fill="#a8743f"/>
    <rect x="334" y="692" width="58" height="13" rx="3" fill="#f8efd9" stroke="#8a5a3c" stroke-width="1.6"/>
    <text x="363" y="702" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="8.5" fill="#5b3a26">ЗАКАЗЫ</text>
    ${notes}${badge}</g>`;
}

/* ---------- Мусор (уборка) ---------- */

function trashItem(t) {
  const { x, y } = t;
  let g = '';
  switch (t.type) {
    case 'weeds': g = `<g stroke-linecap="round" stroke-width="3"><path d="M${x - 10} ${y} L${x - 14} ${y - 20} M${x - 4} ${y} L${x - 4} ${y - 26} M${x + 3} ${y} L${x + 8} ${y - 24} M${x + 9} ${y} L${x + 16} ${y - 16}" stroke="#3b2a1f" stroke-width="5"/><path d="M${x - 10} ${y} L${x - 14} ${y - 20} M${x - 4} ${y} L${x - 4} ${y - 26} M${x + 3} ${y} L${x + 8} ${y - 24} M${x + 9} ${y} L${x + 16} ${y - 16}" stroke="#a89a52"/></g><circle cx="${x - 4}" cy="${y - 27}" r="3.5" fill="#8d6b9e" ${OLt}/>`; break;
    case 'tire': g = `<ellipse cx="${x}" cy="${y}" rx="15" ry="9" fill="#2f2f33" ${OL}/><ellipse cx="${x}" cy="${y - 1}" rx="7" ry="4" fill="#9cad6a"/>`; break;
    case 'planks': g = `<g ${OLt}><rect x="${x - 22}" y="${y - 6}" width="44" height="7" fill="#b98a5c" transform="rotate(-8 ${x} ${y})"/><rect x="${x - 18}" y="${y - 12}" width="40" height="7" fill="#a5774c" transform="rotate(12 ${x} ${y})"/><rect x="${x - 20}" y="${y - 1}" width="38" height="7" fill="#c49768"/></g>`; break;
    case 'barrel': g = `<g ${OL}><rect x="${x - 10}" y="${y - 24}" width="20" height="26" rx="4" fill="#9a5b3a"/></g><path d="M${x - 10} ${y - 16} h20 M${x - 10} ${y - 6} h20" stroke="#6b6b6b" stroke-width="2.5"/><ellipse cx="${x}" cy="${y - 24}" rx="10" ry="3" fill="#7a4428" ${OLt}/>`; break;
    case 'cart': g = `<g ${OL}><path d="M${x - 24} ${y - 22} h40 l-6 16 h-30z" fill="#8a6a4a"/><circle cx="${x - 14}" cy="${y - 2}" r="7" fill="#5a4030"/><path d="M${x + 16} ${y - 18} l14 -8" fill="none"/></g><circle cx="${x - 14}" cy="${y - 2}" r="2" fill="#3b2a1f"/>`; break;
    case 'bags': g = `<g ${OLt}><path d="M${x - 16} ${y} q-4 -18 6 -20 q10 2 8 20z" fill="#cbb48a"/><path d="M${x - 2} ${y} q-2 -14 8 -16 q10 2 8 16z" fill="#b89f73"/></g>`; break;
    case 'bucket': g = `<g ${OLt}><path d="M${x - 8} ${y - 14} h16 l-3 14 h-10z" fill="#9aa3a8"/></g><path d="M${x - 8} ${y - 14} q8 -10 16 0" fill="none" stroke="#3b2a1f" stroke-width="1.4"/>`; break;
  }
  return `<g class="trash ${t.type === 'weeds' ? 'is-weeds' : 'is-junk'}" data-tap="trash" data-id="${t.id}">
    <circle class="tap-ring" cx="${x}" cy="${y - 10}" r="19"/>
    <circle cx="${x}" cy="${y - 8}" r="24" fill="transparent"/><g class="trash-art">${g}</g></g>`;
}

/* ---------- Слоты под стройку ---------- */

const SLOTS = {
  greenhouse: { x: 92,  y: 462, area: 'M40 453 L53 432 H115 L126 453 V485 H40z' },
  garden:     { x: 323, y: 490, area: null },
  coop:       { x: 104, y: 560, area: 'M36 548 L104 514 L172 548 V602 H36z' },
  fence:      { x: 214, y: 618, area: 'M20 612 H236 V638 H20z' },
  omshanik:   { x: 300, y: 582, area: 'M262 600 Q262 568 300 566 Q338 568 340 600z' },
  apiary:     { x: 300, y: 624, area: 'M256 612 H346 V638 H256z' },
  stall:      { x: 396, y: 596, area: 'M344 560 H448 V640 H344z' },
  cow:        { x: 362, y: 394, area: 'M326 372 H402 V418 H326z' },
  stove:      { x: 120, y: 428, area: null },
  cheese:     { x: 180, y: 738, area: 'M128 730 L180 698 L232 730 V776 H128z' },
  honeyfield: { x: 340, y: 748, area: 'M248 708 H436 L440 792 H244z' },
  tractor:    { x: 250, y: 276, area: 'M160 294 L190 262 H322 L340 294z' },
  shop:       { x: 88,  y: 246, area: 'M30 200 H146 V290 H30z' },
  brand:      { x: 232, y: 214, area: 'M186 196 H278 V260 H186z' },
  factory:    { x: 366, y: 252, area: 'M318 170 H414 V292 H318z' },
};

function slot(id, label, price, small = false) {
  const s = SLOTS[id];
  const area = s.area ? `<path d="${s.area}" class="slot-area"${s.areaT ? ` transform="${s.areaT}"` : ''}/>` : '';
  const r = small ? 11 : 14;
  return `<g class="slot" data-tap="slot" data-id="${id}">${area}
    <circle cx="${s.x}" cy="${s.y}" r="${r + 10}" fill="transparent"/>
    <circle class="slot-pin" cx="${s.x}" cy="${s.y}" r="${r}" fill="#3fa34d" stroke="#1f5e2a" stroke-width="2.5"/>
    <path d="M${s.x - r * .45} ${s.y} H${s.x + r * .45} M${s.x} ${s.y - r * .45} V${s.y + r * .45}" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
    ${small ? '' : `<g class="slot-tag"><rect x="${s.x - 40}" y="${s.y + r + 3}" width="80" height="16" rx="8" fill="#fbf3e3" stroke="#8a5a3c" stroke-width="1.6"/>
    <text x="${s.x}" y="${s.y + r + 15}" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="700" font-size="9.5" fill="#5b3a26">${label}</text></g>`}
  </g>`;
}

/* ---------- Значок уровня постройки ---------- */
const LEVEL_POS = { coop: [40, 560], greenhouse: [46, 444], garden: [214, 432], apiary: [262, 606], cow: [334, 384], stall: [350, 566],
  cheese: [140, 724], honeyfield: [262, 716], tractor: [176, 280], shop: [42, 228], brand: [192, 200], factory: [326, 232] };
function levelTag([x, y], L, id) {
  return `<g class="lvl-badge" data-tap="bld" data-id="${id}"><rect x="${x - 13}" y="${y - 9}" width="26" height="17" rx="8.5" fill="#2f8a2f" stroke="#1f5e2a" stroke-width="2"/>
    <text class="lvl-tag" x="${x}" y="${y + 3.5}" text-anchor="middle">ур.${L}</text></g>`;
}

/* ---------- Значки «готово к сбору» ---------- */

const READY_POS = { coop: [196, 540], greenhouse: [150, 446], garden: [323, 444], apiary: [232, 590], cow: [362, 360],
  cheese: [214, 704], honeyfield: [400, 716], tractor: [286, 250], shop: [128, 238], factory: [398, 206] };
const READY_ICON = {
  coop: '<ellipse cx="0" cy="0" rx="5.5" ry="7" fill="#f6ead3" stroke="#3b2a1f" stroke-width="1.4"/>',
  greenhouse: '<rect x="-3.5" y="-8" width="7" height="16" rx="3.5" fill="#3e9a4e" stroke="#3b2a1f" stroke-width="1.4"/>',
  garden: '<circle r="6" fill="#e5322b" stroke="#3b2a1f" stroke-width="1.4"/><path d="M-3 -6 l3 2 l3 -2" stroke="#3e9a4e" stroke-width="2" fill="none"/>',
  apiary: '<path d="M-5 -7 h10 v3 h-10z M-6 -4 h12 v11 h-12z" fill="#f2b632" stroke="#3b2a1f" stroke-width="1.4"/>',
  cow: '<path d="M-5 -7 h10 l-1 14 h-8z" fill="#fff" stroke="#3b2a1f" stroke-width="1.4"/>',
  cheese: '<path d="M-7 5 L7 5 L7 -2 L-5 -6z" fill="#ffd23f" stroke="#3b2a1f" stroke-width="1.4"/>',
  honeyfield: '<path d="M-5 -7 h10 v3 h-10z M-6 -4 h12 v11 h-12z" fill="#f2b632" stroke="#3b2a1f" stroke-width="1.4"/>',
  tractor: '<path d="M-6 6 L0 -7 L6 6z" fill="#e9c24a" stroke="#3b2a1f" stroke-width="1.4"/>',
  shop: '<rect x="-6" y="-6" width="12" height="12" rx="2" fill="#d8392d" stroke="#3b2a1f" stroke-width="1.4"/>',
  factory: '<rect x="-6" y="-5" width="12" height="10" fill="#8f9aa5" stroke="#3b2a1f" stroke-width="1.4"/>',
};
const kfmt = (a) => (a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'к' : a >= 1000 ? (a / 1e3).toFixed(1) + 'к' : a).toString().replace('.', ',');
// Пузырь урожая: иконка продукта + число. Невидимая зона нажатия ≥ 44×44 px не качается вместе с пузырём.
const READY_EMOJI = { coop: '🥚', greenhouse: '🥒', garden: '🍅', apiary: '🍯', cow: '🥛', cheese: '🧀', honeyfield: '🍯', tractor: '🌾', shop: '🛒', factory: '🏭' };
function readyBadge(id, amount, fresh, full) {
  const txt = kfmt(amount);
  const w = 34 + String(txt).length * 7.5;
  const [x, y] = READY_POS[id];
  // «свежее»: созрело за последние 5 минут — собери сейчас и получи +20%
  const star = fresh ? `<g class="fresh-star" transform="translate(${w / 2 - 2} -14)"><path d="M0 -6 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8z" fill="#ffe24a" stroke="#b8801a" stroke-width="1.4"/></g>` : '';
  return `<g class="ready${fresh ? ' fresh' : ''}${full ? ' full' : ''}" data-tap="bld" data-id="${id}" transform="translate(${x} ${y})">
    <rect class="hit" x="${-w / 2 - 10}" y="-26" width="${w + 20}" height="50" fill="transparent"/>
    <g class="bob"><path d="M0 16 l-6 -8 h12z" fill="#fbf3e3" stroke="#8a5a3c" stroke-width="1.8"/>
    <rect class="pill" x="${-w / 2}" y="-14" width="${w}" height="26" rx="13" fill="#fbf3e3" stroke="${full ? '#d8392d' : '#8a5a3c'}" stroke-width="2.2"/>
    <text x="${-w / 2 + 14}" y="4.5" text-anchor="middle" font-size="14">${READY_EMOJI[id] || '📦'}</text>
    <text x="${-w / 2 + 26}" y="4" text-anchor="start" font-family="Rubik, sans-serif" font-weight="800" font-size="12" fill="#e8891a">${txt}</text>${star}</g></g>`;
}

/* ---------- Сборка сцены ---------- */

// Слои: bg (меняется раз в месяц), obj (постройки/мусор/слоты — при изменении состояния),
// ready (значки сбора — каждую секунду), fx (эффекты). Так анимации не перезапускаются на каждом тике.
export function renderScene(svg, st, catalog, layers = 'all') {
  const m = monthOf(st.month);
  const loc = st.loc || 'home';
  if (!svg.querySelector('#bg')) svg.innerHTML = '<g id="bg"></g><g id="far"></g><g id="near"></g><g id="obj"></g><g id="ready"></g><g id="fx"></g>';
  const bgKey = `${loc}|${st.month}|${st.house || 0}`; // фон: при смене локации, месяца и при ремонте дома
  if (svg.dataset.month !== bgKey) {
    svg.dataset.month = bgKey;
    const bg = background(m, loc);
    let s = bg.near;
    if (loc === 'home') {
      s += tree(8, 470, m.trees, .9) + tree(225, 404, m.trees) + tree(458, 520, m.trees, .8);
      s += `<path d="M86 412 L106 412 L196 560 L258 642 L230 642 L170 560z" fill="${PAL[m.season].roadL}" opacity=".9"/>`;
      s += house(m, st.house || 0) + barn(m);
    } else s += LOC_NEAR[loc](m);
    svg.querySelector('#bg').innerHTML = bg.far + (LOC_FAR[loc] ? LOC_FAR[loc](m) : '');
    svg.querySelector('#near').innerHTML = s;
    layers = 'all';
  }
  const b = st.built;
  const clean = st.clean >= 1;
  if (layers === 'all') {
    let s = '';
    if (loc === 'home') {
      s += field(m, st);
      if (b.cow) s += cow();
      if (b.greenhouse) s += greenhouse(m, st);
      if (b.omshanik) s += omshanik(m);
      if (b.coop) s += coop(m, st) + hens(st);
      if (b.fence) s += fence();
      if (b.apiary) s += apiary(m, st);
      if (b.stall) s += stall(m);
      if (st.fox) s += fox();
      if (st.dog) s += puppy(st.dog);
      for (const w of st.workers || []) if (WORKER_SPOT[w]) s += workerFigure(w, ...WORKER_SPOT[w]);
      if (clean && st.canBuild) s += orderBoard(st) + creek(m);
    } else s += LOC_OBJ[loc](m, st);
    svg.querySelector('#far').innerHTML = '';
    if (m.season === 'autumn') s += `<g class="leaves">${[60, 160, 260, 360, 420].map((x, i) => `<path d="M${x} ${300 + i * 40} q8 -8 16 0 q-8 8 -16 0z" fill="${i % 2 ? '#e5933a' : '#f3c94a'}" stroke="#3b2a1f" stroke-width="1" style="animation-delay:${-i * 1.3}s"/>`).join('')}</g>`;
    if (m.season === 'winter') s += `<g class="snowfall">${Array.from({ length: 36 }, (_, i) => { const r = rng(i + 3); return `<circle cx="${r() * W}" cy="${r() * 700}" r="${1.5 + r() * 2}" fill="#fff" style="animation-delay:${-r() * 8}s"/>`; }).join('')}</g>`;
    if (!clean && loc === 'home') s += st.trash.filter(t => t.hp > 0).map(trashItem).join('');
    if (clean && st.canBuild) {
      for (const id of Object.keys(SLOTS)) {
        const c = catalog[id];
        if ((c.loc || 'home') !== loc) continue;
        if (b[id] || (c.requires && !b[c.requires]) || (c.tier || 0) > (st.tier || 0)) continue;
        if (id === 'garden' && st.flags?.fieldSold) continue;
        s += slot(id, SHORT[id] || c.name.split(' ')[0].replace('«', ''), c.price, id === 'stove');
      }
    }
    if (st.lv) for (const [id, L] of Object.entries(st.lv)) if (L > 0 && LEVEL_POS[id] && catalog[id].kind !== 'once' && (catalog[id].loc || 'home') === loc) s += levelTag(LEVEL_POS[id], L, id);
    svg.querySelector('#obj').innerHTML = s;
  }
  let r = '';
  if (clean) for (const id of Object.keys(READY_POS)) {
    if ((catalog[id]?.loc || 'home') !== loc) continue;
    const amt = Math.floor(st.stock[id] || 0);
    if (b[id] && amt > 0) r += readyBadge(id, amt, st.fresh?.[id], st.full?.[id]);
  }
  const rl = svg.querySelector('#ready');
  if (rl.dataset.html !== r) { rl.innerHTML = r; rl.dataset.html = r; }
}

function fox() {
  return `<g id="fox" transform="translate(246 600)"><g class="fox-sneak">
    <path d="M-22 4 q-14 -4 -18 -14 q10 2 18 6z" fill="#e8742a" ${OLt}/><path d="M-40 -10 l-4 -2 l5 5z" fill="#fff"/>
    <ellipse cx="-6" cy="2" rx="16" ry="8" fill="#e8742a" ${OLt}/>
    <path d="M6 -2 l12 -4 l4 6 l-8 6z" fill="#e8742a" ${OLt}/><path d="M18 -6 l3 -8 l3 9z M10 -6 l1 -8 l5 6z" fill="#e8742a" ${OLt}/>
    <path d="M22 2 l-6 2 l3 2z" fill="#fff"/><circle cx="15" cy="-1" r="1.4" fill="#2b2b2b"/>
    <path d="M-14 9 v6 M-4 9 v6 M2 8 v6" stroke="#3b2a1f" stroke-width="2.4" stroke-linecap="round"/></g></g>`;
}

// плавающий текст «+12 яиц» над точкой сцены
export function floatText(svg, x, y, text, color = '#e8891a') {
  const fx = svg.querySelector('#fx');
  if (!fx) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'float');
  g.innerHTML = `<text x="${x}" y="${y}" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="17"
    fill="${color}" stroke="#fffaf0" stroke-width="4" paint-order="stroke">${text}</text>`;
  fx.appendChild(g);
  setTimeout(() => g.remove(), 1100);
}

export function puff(svg, x, y) {
  const fx = svg.querySelector('#fx');
  if (!fx) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'puff');
  g.innerHTML = [[-10, -6, 9], [8, -10, 11], [0, 4, 10], [14, 2, 7], [-14, 6, 7]]
    .map(([dx, dy, r]) => `<circle cx="${x + dx}" cy="${y - 10 + dy}" r="${r}" fill="#fffaf0" stroke="#3b2a1f" stroke-width="1.4"/>`).join('');
  fx.appendChild(g);
  setTimeout(() => g.remove(), 600);
}

export const SLOT_POS = SLOTS;
export const READY_POSITIONS = READY_POS;


/* =====================================================================
   ЛОКАЦИИ: Река и луг · Райцентр · Агрохолдинг
   ===================================================================== */
const water = (m) => (m.season === 'winter' ? '#dce9f2' : '#6fb6ec');
const waterL = (m) => (m.season === 'winter' ? '#f4f9fc' : '#a9d8f6');

/* ---------- Река и луг ---------- */
function riverNear(m) {
  const w = water(m), wl = waterL(m);
  let s = '';
  // холм под мельницей
  s += `<path d="M300 400 Q385 300 470 390 L470 420 L300 420z" fill="${PAL[m.season].hillA}" opacity=".9"/>`;
  s += tree(30, 330, m.trees, .8) + tree(250, 335, m.trees, .7);
  // река
  s += `<path d="M-30 440 C 110 410, 250 470, 490 438 L490 512 C 260 540, 110 478, -30 506z" fill="${w}" stroke="#3b2a1f" stroke-width="2"/>`;
  s += `<g stroke="${wl}" stroke-width="3" stroke-linecap="round" fill="none" class="ripples">${[[40, 466], [150, 470], [230, 488], [330, 482], [410, 470]].map(([x, y]) => `<path d="M${x} ${y} q10 -5 20 0 q10 5 20 0"/>`).join('')}</g>`;
  // мостик
  s += `<g ${OLt}><path d="M300 446 L360 446 L362 506 L298 506z" fill="#b9844f"/></g>
    <path d="M300 456 H360 M300 466 H360 M300 476 H360 M300 486 H360 M300 496 H360" stroke="#8b5a36" stroke-width="2"/>
    <path d="M296 440 V512 M364 440 V512" stroke="#7b5236" stroke-width="5" stroke-linecap="round"/>`;
  // пруд с мостками — место для рыбалки
  s += `<g id="pond" data-tap="fish" data-spot="river">
    <ellipse cx="122" cy="616" rx="98" ry="42" fill="${w}" stroke="#3b2a1f" stroke-width="2"/>
    <ellipse cx="104" cy="610" rx="40" ry="10" fill="${wl}" opacity=".7"/>
    ${m.season !== 'winter' ? '<g fill="#5aa24a" stroke="#3b2a1f" stroke-width="1"><ellipse cx="70" cy="628" rx="12" ry="5"/><ellipse cx="150" cy="634" rx="10" ry="4"/></g><circle cx="74" cy="626" r="3" fill="#f39ac1"/>' : ''}
    <g stroke="#3b2a1f" stroke-width="1.4"><rect x="168" y="596" width="50" height="9" fill="#b9844f"/><rect x="172" y="605" width="5" height="18" fill="#7b5236"/><rect x="208" y="605" width="5" height="18" fill="#7b5236"/></g>
    <path d="M30 600 l-4 -22 M36 604 l2 -24 M42 606 l6 -20 M200 640 l-3 -20 M206 642 l4 -22" stroke="#6b8f3a" stroke-width="3" stroke-linecap="round"/>
    <rect x="20" y="570" width="210" height="90" fill="transparent"/>
    ${fishBadge('river', 118, 560)}
  </g>`;
  return s;
}
function cowshed(m) {
  const winter = m.season === 'winter';
  return `<g id="cowshed" data-tap="bld" data-id="cowshed">
    <ellipse cx="115" cy="414" rx="80" ry="6" fill="#000" opacity=".12"/>
    <rect x="48" y="334" width="134" height="78" fill="#c4553e" ${OL}/>
    <path d="M58 340 V406 M172 340 V406" stroke="#fff" stroke-width="4"/>
    <path d="M36 338 L115 292 L194 338 L186 342 L115 300 L44 342z" fill="#8f3426" ${OL}/>
    <path d="M56 336 L115 302 L174 336z" fill="#a8412f" ${OLt}/>
    ${winter ? '<path d="M38 336 L115 293 L192 336 L182 336 L115 300 L48 336z" fill="#fff"/>' : ''}
    <circle cx="115" cy="320" r="8" fill="#f1dfb2" stroke="#fff" stroke-width="3"/>
    <rect x="94" y="360" width="42" height="52" fill="#7d3a28" ${OLt}/>
    <path d="M94 360 L136 412 M136 360 L94 412" stroke="#fff" stroke-width="3"/>
    <rect x="94" y="360" width="42" height="52" fill="none" stroke="#fff" stroke-width="3"/>
    <g transform="translate(36 404) scale(.55)">${cow().replace(/<g id="cow"[^>]*>/, '<g>')}</g>
    <g transform="translate(150 410) scale(.5)">${cow().replace(/<g id="cow"[^>]*>/, '<g>')}</g>
  </g>`;
}
function mill(m) {
  return `<g id="mill" data-tap="bld" data-id="mill"><g transform="translate(-24 0)">
    <ellipse cx="386" cy="384" rx="40" ry="5" fill="#000" opacity=".15"/>
    <path d="M364 384 L372 300 L400 300 L408 384z" fill="#f4e5c4" ${OL}/>
    <path d="M366 302 L386 278 L406 302z" fill="#8a603f" ${OL}/>
    <rect x="379" y="350" width="14" height="34" fill="#a8693c" ${OLt}/>
    <rect x="380" y="318" width="12" height="12" fill="#4d8fd3" stroke="#fff" stroke-width="2"/>
    <g class="mill-blades">${[0, 90, 180, 270].map(a => `<g transform="rotate(${a} 386 296)"><rect x="383" y="244" width="6" height="52" fill="#b9844f" ${OLt}/><rect x="389" y="248" width="14" height="40" fill="#fbf3e3" stroke="#8a5a3c" stroke-width="1.4"/></g>`).join('')}
      <circle cx="386" cy="296" r="5" fill="#5b3a26"/></g>
  </g></g>`;
}
function riverObj(m, st) {
  const b = st.built; let s = '';
  if (b.cowshed) s += cowshed(m);
  if (b.mill) s += mill(m);
  if (b.cheese) s += `<g transform="translate(92 -370)">${cheese(m)}</g>`;
  if (b.honeyfield) s += `<g transform="translate(-6 -150)">${honeyfield(m)}</g>`;
  return s;
}

/* ---------- Райцентр ---------- */
function townFar(m) {
  const cols = ['#d7c3e6', '#c6dcef', '#f2d6b8', '#cfe5c6', '#f0c9c4', '#dcd2bf'];
  return `<g opacity=".95">${cols.map((c, i) => { const x = -10 + i * 80, h = 40 + (i % 3) * 18; return `<rect x="${x}" y="${292 - h}" width="70" height="${h}" fill="${c}" stroke="#3b2a1f" stroke-width="1.4"/>${[0, 1, 2].map(k => `<rect x="${x + 10 + k * 20}" y="${300 - h}" width="10" height="10" fill="#fffaf0" stroke="#3b2a1f" stroke-width="1"/>`).join('')}`; }).join('')}</g>`;
}
function townNear(m) {
  const snow = m.season === 'winter';
  let s = `<rect x="-200" y="292" width="${W + 400}" height="180" fill="${snow ? '#eef3f7' : '#e8dcc8'}"/>`;
  let tiles = ''; for (let x = -10; x < W; x += 30) tiles += `M${x} 292 V472 `; for (let y = 312; y < 472; y += 26) tiles += `M-10 ${y} H${W + 10} `;
  s += `<path d="${tiles}" stroke="${snow ? '#dfe7ee' : '#d6c7ae'}" stroke-width="1.5"/>`;
  s += `<rect x="-200" y="472" width="${W + 400}" height="74" fill="#8a8f96"/><rect x="-200" y="472" width="${W + 400}" height="5" fill="#6f747a"/>
    <path d="M-10 509 H470" stroke="#fff" stroke-width="4" stroke-dasharray="22 18"/>
    <rect x="-200" y="546" width="${W + 400}" height="8" fill="#c9bba3"/>`;
  // фонари
  s += [222, 440].map(x => `<g ${OLt}><rect x="${x - 3}" y="390" width="6" height="82" fill="#3e4a56"/><rect x="${x - 10}" y="380" width="20" height="12" rx="3" fill="#ffd96b"/></g>`).join('');
  s += tree(30, 640, m.trees, .7) + tree(445, 650, m.trees, .7);
  return s;
}
function townShop(m) {
  return `<g id="shop" data-tap="bld" data-id="shop">
    <rect x="22" y="262" width="186" height="210" fill="#c4553e" ${OL}/>
    <path d="${Array.from({ length: 9 }, (_, i) => `M22 ${282 + i * 22} H208`).join(' ')}" stroke="#a8412f" stroke-width="1.5"/>
    <rect x="36" y="248" width="158" height="30" rx="5" fill="#f8efd9" stroke="#8a5a3c" stroke-width="3"/>
    <text x="115" y="269" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="16" fill="#c8362b">ФЕРМА ДЕДА</text>
    <rect x="36" y="300" width="158" height="16" fill="#fff"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${36 + i * 20}" y="300" width="10" height="16" fill="#d8392d"/>`).join('')}
    <path d="M36 316 ${Array.from({ length: 8 }, (_, i) => `q5 8 10 0 q5 8 10 0`).join(' ')}" fill="#d8392d" stroke="#3b2a1f" stroke-width="1"/>
    <rect x="40" y="340" width="70" height="78" fill="#cfe9f6" stroke="#fff" stroke-width="4"/><rect x="38" y="338" width="74" height="82" fill="none" ${OLt}/>
    <g>${[['🥚', 52, 372], ['🍯', 82, 372], ['🧀', 52, 404], ['🥛', 84, 404]].map(([e, x, y]) => `<text x="${x}" y="${y}" font-size="18">${e}</text>`).join('')}</g>
    <rect x="128" y="348" width="56" height="124" fill="#7d4a2a" ${OLt}/><circle cx="174" cy="414" r="3" fill="#ffd23f"/>
  </g>`;
}
function townCafe(m) {
  return `<g id="cafe" data-tap="bld" data-id="cafe">
    <rect x="246" y="282" width="188" height="190" fill="#f6e7c8" ${OL}/>
    <rect x="276" y="266" width="128" height="26" rx="5" fill="#3fa34d" stroke="#1f5e2a" stroke-width="2.5"/>
    <text x="340" y="285" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="15" fill="#fff">КАФЕ</text>
    <rect x="256" y="310" width="168" height="14" fill="#fff"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${256 + i * 21}" y="310" width="10" height="14" fill="#3fa34d"/>`).join('')}
    <path d="M256 324 ${Array.from({ length: 8 }, () => 'q5 7 10.5 0 q5 7 10.5 0').join(' ')}" fill="#3fa34d" stroke="#1f5e2a" stroke-width="1"/>
    <rect x="262" y="340" width="70" height="66" fill="#cfe9f6" stroke="#fff" stroke-width="4"/><rect x="348" y="340" width="70" height="66" fill="#cfe9f6" stroke="#fff" stroke-width="4"/>
    <text x="284" y="380" font-size="22">🥧</text><text x="370" y="380" font-size="22">☕</text>
    ${[280, 392].map(x => `<g ${OLt}><rect x="${x - 2}" y="436" width="4" height="34" fill="#5b6168"/><path d="M${x - 24} 438 L${x} 420 L${x + 24} 438z" fill="#d8392d"/><ellipse cx="${x}" cy="452" rx="16" ry="4" fill="#fff"/></g>`).join('')}
  </g>`;
}
function townMarket(m) {
  const cols = [['#d8392d', '#fff'], ['#3f78c9', '#fff'], ['#e8a21a', '#fff'], ['#3fa34d', '#fff']];
  return `<g id="market" data-tap="bld" data-id="market">${cols.map(([a, b], i) => { const x = 30 + i * 100; return `<g>
      <rect x="${x + 4}" y="588" width="5" height="52" fill="#7b5236" ${OLt}/><rect x="${x + 79}" y="588" width="5" height="52" fill="#7b5236" ${OLt}/>
      <rect x="${x}" y="576" width="88" height="18" fill="${b}"/>${[0, 1, 2, 3].map(k => `<rect x="${x + k * 22}" y="576" width="11" height="18" fill="${a}"/>`).join('')}
      <rect x="${x}" y="576" width="88" height="18" fill="none" ${OLt}/>
      <rect x="${x + 2}" y="616" width="84" height="12" fill="#b9844f" ${OLt}/>
      <text x="${x + 12}" y="614" font-size="15">${['🍎', '🥕', '🧀', '🍯'][i]}${['🍐', '🥒', '🥖', '🥚'][i]}</text></g>`; }).join('')}
    <rect x="22" y="566" width="420" height="78" fill="transparent"/></g>`;
}
function townObj(m, st) {
  const b = st.built; let s = '';
  if (b.shop) s += `<g transform="translate(${TF.shop[1]} ${TF.shop[2]}) scale(${TF.shop[0]})">${townShop(m)}</g>`;
  if (b.cafe) s += `<g transform="translate(${TF.cafe[1]} ${TF.cafe[2]}) scale(${TF.cafe[0]})">${townCafe(m)}</g>`;
  if (b.market) s += townMarket(m);
  return s;
}

/* ---------- Агрохолдинг ---------- */
function fieldColors(m) {
  return m.season === 'winter' ? ['#f4f8fb', '#e3ebf1'] : m.season === 'summer' ? ['#e9c24a', '#d9a93a'] : m.season === 'autumn' || m.season === 'late' ? ['#b88a52', '#a3773f'] : ['#8fd068', '#6fb94e'];
}
function agroNear(m) {
  const [a, b] = fieldColors(m);
  let s = '';
  const fields = [['M-20 300 L210 300 L190 450 L-20 470z', 0], ['M232 300 L480 300 L480 470 L214 450z', 1], ['M-20 492 L200 474 L230 640 L-20 640z', 2]];
  for (const [d, i] of fields) {
    s += `<path d="${d}" fill="${i === 1 ? b : a}" stroke="#5a3a24" stroke-width="2"/>`;
    let rows = ''; for (let k = 0; k < 9; k++) rows += i === 2 ? `M${-20 + k * 28} 640 L${10 + k * 20} 490 ` : `M${(i ? 232 : -20) + k * 30} 300 L${(i ? 214 : -20) + k * 30 + (i ? -2 : 0)} 460 `;
    s += `<path d="${rows}" stroke="${i === 1 ? a : b}" stroke-width="5" opacity=".8"/>`;
  }
  s += `<path d="M210 300 L232 300 L214 450 L200 474 L230 640 L250 640 L222 468 L240 300z" fill="${PAL[m.season].roadL}"/>`;
  return s;
}
function agroTractor(m) {
  return `<g id="tractor" data-tap="bld" data-id="tractor"><g transform="translate(70 520) scale(1.9)">
    <rect x="0" y="0" width="34" height="16" rx="3" fill="#d6463a" ${OL}/>
    <rect x="18" y="-14" width="16" height="16" fill="#d6463a" ${OL}/><rect x="21" y="-11" width="10" height="9" fill="#cfe9f6"/>
    <rect x="4" y="-8" width="4" height="8" fill="#555"/>
    <circle cx="27" cy="18" r="9" fill="#2f2f33" ${OL}/><circle cx="27" cy="18" r="3" fill="#f2c84b"/>
    <circle cx="6" cy="20" r="6" fill="#2f2f33" ${OL}/><circle cx="6" cy="20" r="2" fill="#f2c84b"/></g>
    <rect x="40" y="480" width="150" height="110" fill="transparent"/></g>`;
}
function agroElevator(m) {
  const snow = m.season === 'winter';
  return `<g id="elevator" data-tap="bld" data-id="elevator">
    <ellipse cx="360" cy="434" rx="78" ry="6" fill="#000" opacity=".12"/>
    ${[300, 334, 368].map(x => `<rect x="${x}" y="300" width="30" height="132" fill="#d9dde1" ${OL}/><path d="M${x} 300 Q${x + 15} 286 ${x + 30} 300" fill="${snow ? '#fff' : '#c3c9cf'}" ${OLt}/><path d="M${x} 340 H${x + 30} M${x} 380 H${x + 30}" stroke="#b6bcc2" stroke-width="2"/>`).join('')}
    <rect x="402" y="250" width="30" height="182" fill="#f2d6b8" ${OL}/><path d="M402 250 L417 236 L432 250z" fill="#c4553e" ${OLt}/>
    <rect x="300" y="404" width="132" height="18" rx="3" fill="#f8efd9" stroke="#8a5a3c" stroke-width="2"/>
    <text x="366" y="417" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="10" fill="#5b3a26">ЭЛЕВАТОР</text>
  </g>`;
}
function agroBrand(m) {
  return `<g id="brand" data-tap="bld" data-id="brand">
    <rect x="70" y="250" width="6" height="58" fill="#7b5236" ${OLt}/><rect x="166" y="250" width="6" height="58" fill="#7b5236" ${OLt}/>
    <rect x="40" y="200" width="162" height="64" rx="6" fill="#f8efd9" stroke="#8a5a3c" stroke-width="3"/>
    <text x="121" y="228" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="18" fill="#c8362b">ФЕРМА ДЕДА</text>
    <text x="121" y="250" text-anchor="middle" font-family="'Marck Script', cursive" font-size="14" fill="#5b3a26">с 1956 года</text></g>`;
}
function agroFactory(m) {
  return `<g id="factory" data-tap="bld" data-id="factory">
    <rect x="300" y="500" width="14" height="80" fill="#a8412f" ${OLt}/><rect x="326" y="512" width="14" height="68" fill="#a8412f" ${OLt}/>
    <path d="M262 640 V580 L292 560 V580 L322 560 V580 L352 560 V580 L382 560 V640z" fill="#8f9aa5" ${OL}/>
    ${[0, 1, 2, 3].map(i => `<rect x="${272 + i * 28}" y="596" width="14" height="12" fill="#ffd96b" stroke="#3b2a1f" stroke-width="1"/>`).join('')}
    <g class="smoke"><circle cx="306" cy="490" r="7"/><circle cx="312" cy="474" r="9"/><circle cx="333" cy="502" r="6"/></g></g>`;
}
function agroObj(m, st) {
  const b = st.built; let s = '';
  if (b.brand) s += agroBrand(m);
  if (b.elevator) s += `<g transform="translate(-16 0)">${agroElevator(m)}</g>`;
  if (b.tractor) s += agroTractor(m);
  if (b.factory) s += agroFactory(m);
  return s;
}

// сдвиг/масштаб, чтобы фасады целиком влезали в экран телефона: [scale, tx, ty]
const TF = { shop: [.887, 20.5, 53.3], cafe: [.93, 16.2, 33], elevator: [1, -16, 0] };
const SHORT = { brand: 'Своя марка', tractor: 'Большие поля', honeyfield: 'Пасека-поле' };
const LOC_NEAR = { river: riverNear, town: townNear, agro: agroNear };
const LOC_FAR = { town: townFar };
const LOC_OBJ = { river: riverObj, town: townObj, agro: agroObj };

// Места построек в локациях (слот «＋», значок урожая, значок уровня)
const LOC_POS = {
  cowshed:    { slot: { x: 115, y: 362, area: 'M36 338 L115 292 L194 338 V412 H36z' }, ready: [172, 300], level: [56, 344] },
  mill:       { slot: { x: 362, y: 330, area: 'M332 250 H392 V386 H332z' }, ready: [390, 256], level: [338, 372] },
  cheese:     { slot: { x: 272, y: 368, area: 'M220 360 L272 328 L324 360 V406 H220z' }, ready: [306, 334], level: [234, 356] },
  honeyfield: { slot: { x: 334, y: 600, area: 'M238 558 H430 L434 642 H234z' }, ready: [394, 566], level: [252, 566] },
  shop:       { slot: { x: 115, y: 360, area: 'M22 248 H208 V472 H22z' }, ready: [180, 330], level: [46, 292] },
  cafe:       { slot: { x: 340, y: 370, area: 'M246 266 H434 V472 H246z' }, ready: [410, 336], level: [258, 296] },
  market:     { slot: { x: 230, y: 610, area: 'M22 566 H442 V644 H22z' }, ready: null, level: [52, 572] },
  tractor:    { slot: { x: 110, y: 560, area: 'M-20 492 L200 474 L230 640 L-20 640z' }, ready: [180, 500], level: [54, 506] },
  elevator:   { slot: { x: 366, y: 360, area: 'M296 236 H436 V436 H296z' }, ready: [330, 280], level: [312, 316] },
  brand:      { slot: { x: 121, y: 232, area: 'M40 200 H202 V300 H40z' }, ready: null, level: [56, 284] },
  factory:    { slot: { x: 322, y: 600, area: 'M262 556 H384 V642 H262z' }, ready: [360, 540], level: [272, 572] },
};
const tfPt = ([k, tx, ty], [x, y]) => [x * k + tx, y * k + ty];
for (const [id, t] of Object.entries(TF)) {
  const p = LOC_POS[id];
  p.ready = tfPt(t, p.ready); p.level = tfPt(t, p.level);
  const [x, y] = tfPt(t, [p.slot.x, p.slot.y]);
  p.slot = { x, y, area: p.slot.area, areaT: `translate(${t[1]} ${t[2]}) scale(${t[0]})` };
}
for (const [id, p] of Object.entries(LOC_POS)) {
  SLOTS[id] = p.slot;
  if (p.ready) READY_POS[id] = p.ready; else delete READY_POS[id];
  LEVEL_POS[id] = p.level;
}
READY_EMOJI.cowshed = '🥛'; READY_EMOJI.mill = '🥖'; READY_EMOJI.cafe = '🥧'; READY_EMOJI.elevator = '🌾'; READY_EMOJI.tractor = '🌾'; READY_EMOJI.shop = '📦';


/* ---------- Щенок у крыльца ---------- */
function puppy(d) {
  // d: { name, boosted, canPet }
  return `<g id="dog" data-tap="dog" class="${d.boosted ? 'dog-happy' : ''}"><g transform="translate(166 400)">
    <ellipse cx="0" cy="16" rx="24" ry="4" fill="#000" opacity=".15"/>
    <path class="dog-tail" d="M18 2 q12 -10 8 -18" stroke="#3b2a1f" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path class="dog-tail" d="M18 2 q12 -10 8 -18" stroke="#d99a55" stroke-width="4" stroke-linecap="round" fill="none"/>
    <ellipse cx="4" cy="4" rx="18" ry="11" fill="#d99a55" stroke="#3b2a1f" stroke-width="2"/>
    <ellipse cx="6" cy="8" rx="9" ry="5" fill="#fbe3bf"/>
    <rect x="-10" y="8" width="6" height="9" rx="3" fill="#d99a55" stroke="#3b2a1f" stroke-width="1.6"/>
    <rect x="12" y="8" width="6" height="9" rx="3" fill="#d99a55" stroke="#3b2a1f" stroke-width="1.6"/>
    <g class="dog-head"><circle cx="-14" cy="-6" r="12" fill="#d99a55" stroke="#3b2a1f" stroke-width="2"/>
      <path d="M-24 -14 q-8 6 -4 16 q6 -2 8 -10z" fill="#9b5f2c" stroke="#3b2a1f" stroke-width="1.6"/>
      <path d="M-6 -15 q8 4 6 14 q-6 -2 -9 -9z" fill="#9b5f2c" stroke="#3b2a1f" stroke-width="1.6"/>
      <ellipse cx="-20" cy="-1" rx="6" ry="4.5" fill="#fbe3bf"/>
      <circle cx="-24" cy="-3" r="2.4" fill="#2a1d16"/>
      ${d.boosted ? '<path d="M-19 -9 q2 -3 4 0 M-12 -9 q2 -3 4 0" stroke="#2a1d16" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M-22 2 q2 5 5 1" fill="#e8607a" stroke="#3b2a1f" stroke-width="1"/>'
        : '<circle cx="-17" cy="-8" r="2" fill="#2a1d16"/><circle cx="-10" cy="-8" r="2" fill="#2a1d16"/>'}
    </g>
    <rect x="-22" y="-28" width="44" height="40" fill="transparent"/>
    ${d.canPet ? '<g class="dog-ask"><circle cx="-14" cy="-30" r="11" fill="#fff" stroke="#e8607a" stroke-width="2"/><text x="-14" y="-25" text-anchor="middle" font-size="13">💗</text></g>' : ''}
    ${d.boosted ? '<g class="hearts"><text x="-30" y="-24" font-size="12">💕</text><text x="6" y="-30" font-size="10">💗</text></g>' : ''}
  </g></g>`;
}
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


/* ---------- Речка с мостками на ферме деда (рыбалка с самого начала) ---------- */
// бейдж «🎣 клюёт!» / «⏳ 12:40» — текст обновляет app.js каждую секунду (без перерисовки сцены)
function fishBadge(spot, x, y) {
  return `<g transform="translate(${x} ${y})"><g class="fish-badge" id="fishBadge-${spot}"><rect x="-38" y="-12" width="76" height="21" rx="10.5" fill="#fbf3e3" stroke="#2f6fb5" stroke-width="2"/>
    <text x="0" y="3.5" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="10.5" fill="#2f6fb5">🎣 РЫБАЛКА</text></g></g>`;
}
function creek(m) {
  const w = m.season === 'winter' ? '#dce9f2' : '#6fb6ec', wl = m.season === 'winter' ? '#f4f9fc' : '#a9d8f6';
  return `<g id="creek" data-tap="fish" data-spot="home"><g transform="translate(0 -24)">
    <path d="M118 806 C 112 770, 150 748, 214 746 C 270 744, 304 760, 300 806 Z" fill="${w}" stroke="#3b2a1f" stroke-width="2"/>
    <path d="M150 778 q12 -5 24 0 q12 5 24 0 M222 790 q10 -4 20 0 q10 4 20 0" stroke="${wl}" stroke-width="3" fill="none" stroke-linecap="round" class="ripples"/>
    <g stroke="#3b2a1f" stroke-width="1.5"><rect x="226" y="752" width="46" height="9" fill="#b9844f"/><rect x="230" y="761" width="5" height="16" fill="#7b5236"/><rect x="263" y="761" width="5" height="16" fill="#7b5236"/></g>
    <path d="M250 752 l-6 -24" stroke="#8b5a36" stroke-width="2.5" stroke-linecap="round"/><path d="M244 728 Q214 740 206 772" stroke="#3b2a1f" stroke-width="1" fill="none" opacity=".6"/>
    <g transform="translate(206 774)"><ellipse rx="3.5" ry="5" fill="#fff" stroke="#3b2a1f" stroke-width="1.2"/><path d="M-3.5 -1 A3.5 5 0 0 1 3.5 -1z" fill="#e2403a"/></g>
    <path d="M124 790 l-3 -20 M130 794 l2 -22 M292 790 l4 -20 M298 796 l-2 -18" stroke="#6b8f3a" stroke-width="3" stroke-linecap="round"/>
    ${fishBadge('home', 186, 734)}
    <rect x="112" y="720" width="196" height="88" fill="transparent"/>
  </g></g>`;
}
