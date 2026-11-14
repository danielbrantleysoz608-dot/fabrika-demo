// SVG-сцена фермы в стиле мультика «Ферма с нуля»:
// плоский вектор, тёмные контуры, вид сбоку-сверху, смена сезонов.
// viewBox 460×890 — вертикальный кадр; важное держим в x 25..435.

import { MONTHS } from './data.js';

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

function background(m) {
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
    if (x > 330 && x < 440) continue; // здесь домик соседа
    woods += `<circle cx="${x}" cy="${287 - r() * 6}" r="${rr}"/>`;
  }
  s += `<g fill="${p.woods}">${woods}</g>`;
  // домик соседа на горизонте
  s += `<g transform="translate(372 262)">
    <rect x="0" y="12" width="28" height="20" fill="#ffffff" ${OLt}/>
    <path d="M-4 13 L14 -1 L32 13z" fill="#d8453a" ${OLt}/>
    <rect x="10" y="20" width="7" height="12" fill="#c58a5a"/>
    ${winter ? '<path d="M-2 12 L14 0 L30 12 L26 11 L14 3 L2 11z" fill="#fff"/>' : ''}
  </g>
  <g stroke="#ffffff" stroke-width="2.4"><path d="M330 292 H460 M330 286 H460"/>
    ${Array.from({ length: 11 }, (_, i) => `<path d="M${334 + i * 12} 282 V296"/>`).join('')}</g>
  <g transform="translate(438 270)"><rect x="-2" y="6" width="5" height="14" fill="#2f3b4a"/><circle cx="0" cy="3" r="3.5" fill="#2f3b4a"/></g>`;
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
  return s;
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

function house(m) {
  const winter = m.season === 'winter';
  return `<g id="house">
    <ellipse cx="98" cy="414" rx="84" ry="6" fill="#000" opacity=".12"/>
    <rect x="128" y="282" width="15" height="34" fill="#c5523c" ${OL}/>
    <rect x="125" y="278" width="21" height="7" fill="#a8412f" ${OL}/>
    <path d="M14 338 L98 270 L182 338z" fill="#8a603f" ${OL}/>
    <path d="M34 331 L98 280 L162 331z" fill="#4e3423"/>
    <g stroke="#a67a52" stroke-width="4">
      <path d="M98 281 L50 331 M98 281 L74 331 M98 281 L98 331 M98 281 L122 331 M98 281 L146 331"/>
      <path d="M60 314 H136" stroke-width="3"/></g>
    <path d="M14 338 L98 270 L182 338" fill="none" stroke="#a67a52" stroke-width="7" stroke-linejoin="round"/>
    <path d="M14 338 L98 270 L182 338" fill="none" ${OL}/>
    ${winter ? '<path d="M18 334 L98 272 L178 334 L168 333 L98 282 L28 333z" fill="#fff" stroke="#c6d6e1" stroke-width="1.2"/>' : ''}
    <rect x="26" y="336" width="144" height="76" fill="#f4e5c4" ${OL}/>
    <path d="M27 352 H169 M27 368 H169 M27 384 H169 M27 400 H169" stroke="#e2cfa6" stroke-width="1.5"/>
    <rect x="38" y="350" width="34" height="30" fill="#4d8fd3" stroke="#fff" stroke-width="4"/>
    <rect x="38" y="350" width="34" height="30" fill="none" ${OLt}/>
    <g ${OLt}><rect x="31" y="355" width="48" height="8" fill="#c2905e" transform="rotate(-14 55 359)"/>
      <rect x="32" y="368" width="46" height="8" fill="#b9845a" transform="rotate(10 55 372)"/></g>
    <rect x="116" y="350" width="38" height="32" fill="#4d8fd3" stroke="#fff" stroke-width="4"/>
    <path d="M135 350 V382 M116 366 H154" stroke="#fff" stroke-width="3"/>
    <rect x="114" y="348" width="42" height="36" fill="none" ${OLt}/>
    <rect x="84" y="360" width="26" height="52" fill="#a8693c" ${OL}/>
    <circle cx="104" cy="388" r="2.4" fill="#f2c94c"/>
    ${winter ? '<g class="smoke"><circle cx="136" cy="262" r="8"/><circle cx="142" cy="244" r="11"/><circle cx="134" cy="222" r="14"/></g>' : ''}
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
  return `<g id="field">${s}</g>`;
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
};

function slot(id, label, price, small = false) {
  const s = SLOTS[id];
  const area = s.area ? `<path d="${s.area}" class="slot-area"/>` : '';
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
const LEVEL_POS = { coop: [40, 560], greenhouse: [46, 444], garden: [214, 432], apiary: [262, 606], cow: [334, 384], stall: [350, 566] };
function levelTag([x, y], L, id) {
  return `<g class="lvl-badge" data-tap="bld" data-id="${id}"><rect x="${x - 13}" y="${y - 9}" width="26" height="17" rx="8.5" fill="#2f8a2f" stroke="#1f5e2a" stroke-width="2"/>
    <text class="lvl-tag" x="${x}" y="${y + 3.5}" text-anchor="middle">ур.${L}</text></g>`;
}

/* ---------- Значки «готово к сбору» ---------- */

const READY_POS = { coop: [196, 540], greenhouse: [150, 446], garden: [323, 444], apiary: [232, 590], cow: [362, 360] };
const READY_ICON = {
  coop: '<ellipse cx="0" cy="0" rx="5.5" ry="7" fill="#f6ead3" stroke="#3b2a1f" stroke-width="1.4"/>',
  greenhouse: '<rect x="-3.5" y="-8" width="7" height="16" rx="3.5" fill="#3e9a4e" stroke="#3b2a1f" stroke-width="1.4"/>',
  garden: '<circle r="6" fill="#e5322b" stroke="#3b2a1f" stroke-width="1.4"/><path d="M-3 -6 l3 2 l3 -2" stroke="#3e9a4e" stroke-width="2" fill="none"/>',
  apiary: '<path d="M-5 -7 h10 v3 h-10z M-6 -4 h12 v11 h-12z" fill="#f2b632" stroke="#3b2a1f" stroke-width="1.4"/>',
  cow: '<path d="M-5 -7 h10 l-1 14 h-8z" fill="#fff" stroke="#3b2a1f" stroke-width="1.4"/>',
};
const kfmt = (a) => (a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'к' : a >= 1000 ? (a / 1e3).toFixed(1) + 'к' : a).toString().replace('.', ',');
function readyBadge(id, amount) {
  amount = kfmt(amount);
  const [x, y] = READY_POS[id];
  return `<g class="ready" data-tap="bld" data-id="${id}" transform="translate(${x} ${y})">
    <g class="bob"><path d="M0 16 l-6 -8 h12z" fill="#fbf3e3" stroke="#8a5a3c" stroke-width="1.8"/>
    <rect x="-24" y="-14" width="48" height="24" rx="12" fill="#fbf3e3" stroke="#8a5a3c" stroke-width="2"/>
    <g transform="translate(-11 -2)">${READY_ICON[id]}</g>
    <text x="9" y="3" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="11" fill="#e8891a">${amount}</text></g></g>`;
}

/* ---------- Сборка сцены ---------- */

// Слои: bg (меняется раз в месяц), obj (постройки/мусор/слоты — при изменении состояния),
// ready (значки сбора — каждую секунду), fx (эффекты). Так анимации не перезапускаются на каждом тике.
export function renderScene(svg, st, catalog, layers = 'all') {
  const m = MONTHS[st.month];
  if (!svg.querySelector('#bg')) svg.innerHTML = '<g id="bg"></g><g id="obj"></g><g id="ready"></g><g id="fx"></g>';
  if (svg.dataset.month !== String(st.month)) {
    svg.dataset.month = st.month;
    let s = background(m);
    s += tree(8, 470, m.trees, .9) + tree(225, 404, m.trees) + tree(458, 520, m.trees, .8);
    s += `<path d="M86 412 L106 412 L196 560 L258 642 L230 642 L170 560z" fill="${PAL[m.season].roadL}" opacity=".9"/>`;
    s += house(m) + barn(m);
    svg.querySelector('#bg').innerHTML = s;
    layers = 'all';
  }
  const b = st.built;
  const clean = st.clean >= 1;
  if (layers === 'all') {
    let s = field(m, st);
    if (b.cow) s += cow();
    if (b.greenhouse) s += greenhouse(m, st);
    if (b.omshanik) s += omshanik(m);
    if (b.coop) s += coop(m, st) + hens(st);
    if (b.fence) s += fence();
    if (b.apiary) s += apiary(m, st);
    if (b.stall) s += stall(m);
    if (st.fox) s += fox();
    if (m.season === 'autumn') s += `<g class="leaves">${[60, 160, 260, 360, 420].map((x, i) => `<path d="M${x} ${300 + i * 40} q8 -8 16 0 q-8 8 -16 0z" fill="${i % 2 ? '#e5933a' : '#f3c94a'}" stroke="#3b2a1f" stroke-width="1" style="animation-delay:${-i * 1.3}s"/>`).join('')}</g>`;
    if (m.season === 'winter') s += `<g class="snowfall">${Array.from({ length: 36 }, (_, i) => { const r = rng(i + 3); return `<circle cx="${r() * W}" cy="${r() * 700}" r="${1.5 + r() * 2}" fill="#fff" style="animation-delay:${-r() * 8}s"/>`; }).join('')}</g>`;
    if (!clean) s += st.trash.filter(t => t.hp > 0).map(trashItem).join('');
    if (clean && st.canBuild) {
      for (const id of ['greenhouse', 'garden', 'coop', 'fence', 'omshanik', 'apiary', 'stall', 'cow', 'stove']) {
        const c = catalog[id];
        if (b[id] || (c.requires && !b[c.requires]) || (c.tier || 0) > (st.tier || 0)) continue;
        if (id === 'garden' && st.flags?.fieldSold) continue;
        s += slot(id, c.name.split(' ')[0], c.price, id === 'stove');
      }
    }
    if (st.lv) for (const [id, L] of Object.entries(st.lv)) if (L > 0 && LEVEL_POS[id] && catalog[id].kind !== 'once') s += levelTag(LEVEL_POS[id], L, id);
    svg.querySelector('#obj').innerHTML = s;
  }
  let r = '';
  if (clean) for (const id of Object.keys(READY_POS)) {
    const amt = Math.floor(st.stock[id] || 0);
    if (b[id] && amt > 0) r += readyBadge(id, amt);
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
