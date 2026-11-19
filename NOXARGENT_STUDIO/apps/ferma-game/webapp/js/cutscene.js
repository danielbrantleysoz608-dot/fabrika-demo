// Сценки после важных решений: 3–6 секунд, рисуются тем же движком (SVG-спрайты фермы), без видео.
// Камера плавно подъезжает к месту действия (CSS-transform у <svg> — дёшево для слабых телефонов),
// актёры двигаются по таймлайну в requestAnimationFrame (≤ 20 элементов, меняем только transform/opacity).
// Тап по экрану — ускорить ×3, «Пропустить» — сразу к итогу. В конце — надпись с последствиями.
import { workerFigure } from './workers-art.js';
import { factoryArt, sprinklerOne, SPRINKLER_POS, solarCell } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const OL = 'stroke="#3b2a1f" stroke-width="1.6" stroke-linejoin="round"';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const seg = (t, a, b) => clamp((t - a) / (b - a));          // доля отрезка [a, b] секунд
const lerp = (a, b, k) => a + (b - a) * k;
const pop = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2); // появление с «прыжком» (easeOutBack)
const along = (pts, k) => { // точка на ломаной, k 0…1
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
  let d = clamp(k) * tot;
  for (let i = 0; i < L.length; i++) { if (d <= L[i] || i === L.length - 1) { const f = L[i] ? clamp(d / L[i]) : 1; return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f), pts[i + 1][0] < pts[i][0] ? -1 : 1]; } d -= L[i]; }
  return [...pts[pts.length - 1], 1];
};

/* ---------- спрайты (нарисованы вокруг точки 0,0 — «ноги» / низ) ---------- */
const truck = (c = '#d8392d') => `<g><rect x="-18" y="-17" width="25" height="14" rx="2" fill="${c}" ${OL}/>
  <path d="M7 -13 h8 l5 6 v4 h-13z" fill="#efe6d2" ${OL}/><path d="M9 -12 h5 l3.5 4.5 h-8.5z" fill="#bfe4ff"/>
  <circle cx="-11" cy="-2" r="3.6" fill="#3b2a1f"/><circle cx="12" cy="-2" r="3.6" fill="#3b2a1f"/><circle cx="-11" cy="-2" r="1.3" fill="#aaa"/><circle cx="12" cy="-2" r="1.3" fill="#aaa"/></g>`;
const person = (id, helmet = false) => `<g>${workerFigure(id, 0, 0).replace('data-tap="workers"', '')}${helmet ? `<path d="M-8.5 -36 a8.5 8 0 0 1 17 0z" fill="#f2c230" ${OL}/><rect x="-10" y="-37" width="20" height="2.6" rx="1.3" fill="#f2c230" ${OL}/>` : ''}</g>`;
// фермер как на аватарке: соломенная шляпа, красная рубашка, синий комбинезон; рука — отдельно (машет)
const farmer = () => `<g><ellipse cy="1" rx="10" ry="3" fill="#000" opacity=".15"/>
  <rect x="-5" y="-10" width="4" height="10" rx="2" fill="#3f6fb5" ${OL}/><rect x="1" y="-10" width="4" height="10" rx="2" fill="#3f6fb5" ${OL}/>
  <path d="M-7 -8 Q-8 -23 0 -23 Q8 -23 7 -8z" fill="#d8392d" ${OL}/><path d="M-4.5 -19 H4.5 V-8 H-4.5z" fill="#3f6fb5" stroke="#3b2a1f" stroke-width="1"/>
  <circle cy="-30" r="7" fill="#f6c9a0" ${OL}/><circle cx="-2.4" cy="-30" r="1" fill="#2a1d16"/><circle cx="2.4" cy="-30" r="1" fill="#2a1d16"/>
  <path d="M-3 -26.5 q3 2.5 6 0" stroke="#2a1d16" stroke-width="1" fill="none"/>
  <ellipse cy="-36" rx="13" ry="3.4" fill="#f2c84b" ${OL}/><path d="M-7 -36 q7 -11 14 0z" fill="#f2c84b" ${OL}/>
  <g class="arm"><path d="M6 -20 l8 -10" stroke="#d8392d" stroke-width="4" stroke-linecap="round"/><circle cx="14.5" cy="-31" r="2.6" fill="#f6c9a0" ${OL}/></g></g>`;
const signBoard = (t) => `<g><rect x="-1.5" y="-30" width="3" height="20" fill="#7b5236"/><rect x="-31" y="-48" width="62" height="19" rx="3" fill="#fffaf0" ${OL}/>
  <text y="-34.5" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="10" fill="#c0392b">${t}</text></g>`;
const coin = () => `<g><circle r="5.5" fill="#f3c94a" ${OL}/><text y="3" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="900" font-size="7" fill="#8a5a0c">₽</text></g>`;
const egg = () => '<ellipse rx="3.6" ry="4.6" fill="#fff4dc" stroke="#3b2a1f" stroke-width="1.2"/>';
const beetle = () => `<g><ellipse rx="4.6" ry="3.6" fill="#f2c84b" ${OL}/><path d="M-3 -1.5 h6 M-3 1.5 h6 M0 -3.6 v7.2" stroke="#3b2a1f" stroke-width="1"/><circle cx="5" r="1.8" fill="#3b2a1f"/></g>`;
const hen = () => `<g><ellipse cy="-6" rx="8" ry="6" fill="#fff" ${OL}/><circle cx="7" cy="-12" r="4" fill="#fff" ${OL}/><path d="M7 -16.5 l2 -2.5 l1.5 2.5z" fill="#d8392d"/><path d="M11 -12 l3 1 l-3 1z" fill="#f2a530"/><circle cx="8" cy="-12.5" r=".9" fill="#2a1d16"/><path d="M-2 0 v3 M2 0 v3" stroke="#f2a530" stroke-width="1.4"/></g>`;
const tent = (c) => `<g><path d="M-22 0 L0 -34 L22 0z" fill="${c}" ${OL}/><path d="M-22 0 L0 -34 L22 0" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="5 6" opacity=".7"/><rect x="-7" y="-14" width="14" height="14" fill="#5b3a26"/><path d="M0 -34 v-8 l8 3 l-8 3" fill="#d8392d" stroke="#3b2a1f" stroke-width="1"/></g>`;
const wallet = () => `<g><rect x="-15" y="-11" width="30" height="22" rx="4" fill="#8a5a3c" ${OL}/><rect x="4" y="-4" width="11" height="8" rx="2" fill="#a8693c" ${OL}/><circle cx="9" r="1.6" fill="#f3c94a"/></g>`;
const cloud = (c = '#cfe3b8') => `<g>${[[-14, 0, 11], [0, -6, 14], [14, 0, 11], [-5, 6, 10], [8, 6, 10]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#7f9a6a" stroke-width="1.2"/>`).join('')}</g>`;
const roller = () => `<g><rect x="-16" y="-20" width="26" height="14" rx="3" fill="#f2c230" ${OL}/><rect x="-6" y="-30" width="12" height="11" fill="#bfe4ff" ${OL}/>
  <rect x="8" y="-12" width="14" height="12" rx="6" fill="#7d8288" ${OL}/><circle cx="-10" cy="-4" r="4" fill="#3b2a1f"/></g>`;

/* ---------- сцены ---------- */
// focus — куда подъезжает камера (x, y, w, h в координатах сцены 460×890); hide — что из настоящей фермы спрятать на время
const FACTORY_ROAD = [[330, 452], [300, 392], [262, 312]];
function factoryScene(kind) {
  return {
    loc: 'river', dur: 4.8, focus: [170, 200, 290, 280], hide: ['#story-factory', '#thanks'],
    build(add) {
      const yes = kind !== 'no';
      const a = {};
      if (yes) {
        a.road = add(`<path d="M304 440 L356 440 L268 306 L254 306z" fill="#9a9488" opacity=".85"/>`);
        a.fac = add(factoryArt(kind === 'deal'));
        a.smoke = [0, 1, 2, 3].map(() => add(`<circle r="8" fill="${kind === 'deal' ? '#f4f6f8' : '#8d939a'}" stroke="#5c6168" stroke-width=".8"/>`));
        a.stall = add(`<g><rect x="-16" y="-20" width="32" height="6" fill="#d8392d" ${OL}/><rect x="-14" y="-14" width="28" height="14" fill="#f8efd9" ${OL}/>${[-8, -2, 4, 10].map(x => `<ellipse cx="${x - 1}" cy="-16" rx="2.6" ry="3.2" fill="#fff4dc" stroke="#3b2a1f" stroke-width=".8"/>`).join('')}</g>`);
        a.workers = [0, 1, 2].map(() => add(person('driver', true)));
        a.eggs = [0, 1, 2].map(() => add(egg()));
        if (kind === 'deal') a.hand = add('<text text-anchor="middle" font-size="22">🤝</text>');
      } else {
        a.people = ['milkmaid', 'henwife', 'beekeeper'].map(id => add(person(id)));
        a.sign = add(signBoard('СПАСИБО!'));
        a.farmer = add(farmer());
      }
      a.trucks = [0, 1].map(i => add(truck(i ? '#4a90d9' : '#d8392d')));
      return (t) => {
        // грузовики едут от моста вверх к заводу (уменьшаются — уезжают вдаль)
        a.trucks.forEach((tr, i) => {
          const k = seg(t, 0.4 + i * 0.5, 2.6 + i * 0.5);
          if (yes || k < 0.55) {
            const [x, y] = along(FACTORY_ROAD, yes ? ease(k) : k);
            const s = lerp(1, 0.55, yes ? ease(k) : k);
            tr.set(x, y, s, -1, k > 0 && k < 1 || (yes && k >= 1) ? 1 : k > 0 ? 1 : 0);
            if (yes && k >= 1) tr.op(1 - seg(t, 3.2, 3.6));
          } else { // отказ: постояли, развернулись и уехали обратно через мост — к соседу
            const k2 = ease(seg(t, 2.4 + i * 0.4, 4.4 + i * 0.4));
            const [x0, y0] = along(FACTORY_ROAD, 0.55);
            const [x, y] = along([[x0, y0], [330, 452], [520, 470]], k2);
            tr.set(x, y, lerp(0.75, 1, k2), 1, 1);
          }
        });
        if (yes) {
          // завод «вырастает» из-за горизонта
          const g = ease(seg(t, 1.1, 2.6));
          a.road.op(seg(t, 0.2, 0.9));
          a.fac.el.setAttribute('transform', `translate(0 306) scale(1 ${Math.max(0.001, g)}) translate(0 -306)`);
          a.fac.op(g > 0 ? 1 : 0);
          a.smoke.forEach((c, i) => {
            const k = ((t - 2.5 - i * 0.45) % 1.8) / 1.8;
            if (t < 2.5 + i * 0.45) return c.op(0);
            c.set(272 + k * 14, 232 - k * 34, 0.6 + k, 1, (1 - k) * 0.9);
          });
          a.stall.set(408, 428, pop(seg(t, 2.6, 3.0)), 1, seg(t, 2.6, 2.7));
          a.workers.forEach((w, i) => {
            const k = ease(seg(t, 0.3 + i * 0.25, 3.0 + i * 0.25));
            w.set(lerp(480 + i * 18, 352 + i * 14, k), 432 + (i % 2) * 4 + Math.sin(t * 16 + i) * (k < 1 ? 1 : 0), 0.85, -1, 1);
          });
          // рабочие покупают яйца: яйца прыгают к рабочим, монетки — к прилавку
          a.eggs.forEach((e, i) => {
            const k = seg(t, 3.4 + i * 0.3, 3.9 + i * 0.3);
            e.set(lerp(408, 352 + i * 14, k), 412 - Math.sin(k * Math.PI) * 18, 1, 1, k > 0 && k < 1 ? 1 : 0);
          });
          if (a.hand) a.hand.set(262, 228, pop(seg(t, 2.8, 3.3)), 1, seg(t, 2.8, 2.9) * (1 - seg(t, 4.6, 5)));
        } else {
          a.people.forEach((p, i) => {
            const k = ease(seg(t, 0.2 + i * 0.2, 2.0 + i * 0.2));
            p.set(lerp(490 + i * 20, 318 + i * 22, k), 552 + Math.sin(t * 16 + i) * (k < 1 ? 1 : 0), 0.9, -1, 1);
          });
          a.sign.set(340, 552, pop(seg(t, 2.0, 2.5)), 1, seg(t, 2.0, 2.1));
          a.farmer.set(272, 432, 1, 1, 1);
          a.farmer.el.querySelector('.arm').setAttribute('transform', `rotate(${Math.sin(t * 9) * 22} 6 -20)`);
        }
      };
    },
  };
}
const SCENES = {
  factory_yes: factoryScene('yes'),
  factory_no: factoryScene('no'),
  factory_deal: factoryScene('deal'),
  // поливалки: фермер расставляет, включаются брызги, грядки зеленеют
  sprinklers: {
    loc: 'home', dur: 4.8, focus: [180, 400, 280, 190], hide: ['#sprinklers'],
    build(add) {
      const green = add('<polygon points="206,420 440,420 456,560 190,560" fill="#4fbf3a"/>');
      const sp = SPRINKLER_POS.map(([x, y]) => add(sprinklerOne(0, 0, 0)));
      const f = add(farmer());
      const route = [[180, 506], ...SPRINKLER_POS.map(([x]) => [x - 14, 506]), [470, 506]];
      return (t) => {
        // фермер идёт вдоль грядок и ставит поливалки по одной
        const k = seg(t, 0.2, 3.4), [x, y, dir] = along(route, k);
        f.set(x, y + Math.sin(t * 16) * 1.2, 1, dir, 1 - seg(t, 3.6, 4));
        f.el.querySelector('.arm').setAttribute('transform', `rotate(${Math.sin(t * 7) * 10} 6 -20)`);
        sp.forEach((s, i) => {
          const at = 0.2 + 3.2 * (i + 1) / (route.length - 1) - 0.1;
          s.set(SPRINKLER_POS[i][0], SPRINKLER_POS[i][1], pop(seg(t, at, at + 0.35)), 1, seg(t, at, at + 0.05));
          s.el.querySelector('.spray').style.display = t > 3.3 ? '' : 'none';
        });
        green.op(0.35 * ease(seg(t, 3.3, 4.4)));
      };
    },
  },
  // солнечные панели: одна за другой на крыше, в доме загорается свет
  solar: {
    loc: 'home', dur: 4.2, focus: [0, 236, 240, 190], hide: ['#solar'],
    build(add) {
      const cells = [0, 1, 2, 3].map(i => add(`<g transform="translate(98 270) rotate(39)"><g>${solarCell(i)}</g></g>`));
      const glow = add('<g><rect x="38" y="350" width="34" height="30" fill="#ffe27a"/><rect x="116" y="350" width="38" height="32" fill="#ffe27a"/></g>');
      const bulb = add('<text text-anchor="middle" font-size="22">💡</text>');
      const sun = add('<g><circle r="9" fill="#ffd34d" stroke="#e8a21a" stroke-width="1.5"/>' + [0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M0 -12 v-5" transform="rotate(${a})" stroke="#e8a21a" stroke-width="2" stroke-linecap="round"/>`).join('') + '</g>');
      return (t) => {
        sun.set(206, 262, 1, 1, seg(t, 0, 0.4)); sun.el.firstElementChild.setAttribute('r', 9 + Math.sin(t * 6) * 1);
        cells.forEach((c, i) => { const k = seg(t, 0.7 + i * 0.45, 1.05 + i * 0.45); c.el.firstElementChild.firstElementChild.setAttribute('transform', `translate(${25 + i * 19} 11) scale(${pop(k)}) translate(${-(25 + i * 19)} -11)`); c.op(k > 0 ? 1 : 0); });
        glow.op(0.75 * seg(t, 2.9, 3.3) * (0.85 + 0.15 * Math.sin(t * 10)));
        bulb.set(98, 340, pop(seg(t, 2.9, 3.3)), 1, seg(t, 2.9, 3.0));
      };
    },
  },
  // ярмарка: палатки и флажки на дороге, очередь покупателей, монеты летят в кошелёк
  fair: {
    loc: 'home', dur: 4.8, focus: [170, 540, 290, 200], hide: [],
    build(add) {
      const flags = add(`<path d="M196 646 Q248 660 280 646 Q312 660 352 646" fill="none" stroke="#5b3a26" stroke-width="1.2"/>${[208, 224, 240, 256, 268, 292, 308, 324, 340].map((x, i) => `<path d="M${x} ${652 + (i % 4 === 1 || i % 4 === 2 ? 4 : 0)} l4 8 l4 -8z" fill="${['#d8392d', '#f2c230', '#4a90d9', '#3fae4f'][i % 4]}"/>`).join('')}`);
      const tents = ['#e2603a', '#4a90d9', '#3fae4f'].map(c => add(tent(c)));
      const ppl = ['milkmaid', 'driver', 'henwife', 'beekeeper', 'seller'].map(id => add(person(id)));
      const coins = Array.from({ length: 6 }, () => add(coin()));
      const w = add(wallet());
      return (t) => {
        tents.forEach((tn, i) => tn.set(214 + i * 66, 684, pop(seg(t, 0.4 + i * 0.3, 0.8 + i * 0.3)), 1, seg(t, 0.4 + i * 0.3, 0.45 + i * 0.3)));
        flags.op(seg(t, 1.3, 1.7));
        ppl.forEach((p, i) => {
          const k = ease(seg(t, 1.2 + i * 0.2, 3.0 + i * 0.2));
          p.set(lerp(490 + i * 26, 240 + i * 26, k), 716 + Math.sin(t * 16 + i) * (k < 1 ? 1 : 0), 0.9, -1, 1);
        });
        w.set(300, 612, pop(seg(t, 2.6, 3.0)), 1, seg(t, 2.6, 2.7));
        coins.forEach((c, i) => {
          const k = seg(t, 2.9 + i * 0.18, 3.5 + i * 0.18), x0 = 240 + (i % 5) * 26;
          c.set(lerp(x0, 300, ease(k)), lerp(690, 612, ease(k)) - Math.sin(k * Math.PI) * 40, 1, 1, k > 0 && k < 1 ? 1 : 0);
        });
        if (t > 3) w.el.firstElementChild.setAttribute('transform', `scale(${1 + 0.08 * Math.max(0, Math.sin(t * 14))})`);
      };
    },
  },
  // дорога до трассы: каток катит асфальт
  road: {
    loc: 'home', dur: 4.0, focus: [0, 560, 460, 180], hide: ['#hwy', '#signs'],
    build(add) {
      const asph = add('<rect x="-200" y="640" width="1" height="48" fill="#757b82"/>');
      const dash = add('<path d="M-10 664 H470" stroke="#fff" stroke-width="3.5" stroke-dasharray="20 16"/>');
      const r = add(roller());
      const sign = add(signBoard('ТРАССА →'));
      return (t) => {
        const k = ease(seg(t, 0.4, 3.2)), x = lerp(-30, 490, k);
        r.set(x, 672 + Math.sin(t * 30) * 0.6, 1.2, 1, 1);
        asph.el.setAttribute('width', Math.max(1, x + 200 - 8));
        dash.op(seg(t, 3.0, 3.5));
        sign.set(436, 728, pop(seg(t, 3.3, 3.7)), 1, seg(t, 3.3, 3.4));
      };
    },
  },
};
// колорадский жук: жуки бегут по грядкам; дальше — химия (облако), руками (фермер) или куры
function beetleScene(kind) {
  return {
    loc: 'home', dur: 4.6, focus: [180, 400, 280, 190], hide: [],
    build(add) {
      const B = Array.from({ length: 9 }, (_, i) => ({ el: add(beetle()), x: 220 + (i * 29) % 210, y: 432 + (i * 37) % 112, ph: i * 1.7 }));
      const cl = kind === 'chem' ? add(cloud()) : null;
      const f = kind === 'hand' ? add(farmer()) : null;
      const hens = kind === 'hens' ? [0, 1, 2].map(() => add(hen())) : [];
      return (t) => {
        B.forEach((b, i) => {
          let x = b.x + Math.sin(t * 2.3 + b.ph) * 14, y = b.y + Math.cos(t * 1.9 + b.ph) * 8, o = 1, s = 1;
          if (kind === 'chem') { const k = seg(t, 2.6, 4.0); const dx = x - 330, dy = y - 490; x += dx * k * 2.2; y += dy * k * 2.2; o = 1 - k; }
          else {
            const hit = kind === 'hand' ? (f ? Math.abs(x - lerp(180, 470, seg(t, 1.8, 4.2))) < 14 && t > 1.8 : false)
              : hens.some((_, j) => Math.abs(x - lerp(170 - j * 30, 480, seg(t, 1.6 + j * 0.2, 4.2 + j * 0.2))) < 12 && Math.abs(y - (450 + j * 40)) < 30);
            if (hit) b.gone = b.gone ?? t;
            if (b.gone !== undefined) { s = 1 - seg(t, b.gone, b.gone + 0.25); o = s; }
          }
          b.el.set(x, y, 1.6 * s, Math.cos(t * 2.3 + b.ph) > 0 ? 1 : -1, o);
        });
        if (cl) cl.set(330, 490, 0.3 + 2.4 * ease(seg(t, 2.3, 3.6)), 1, seg(t, 2.3, 2.5) * (1 - seg(t, 3.8, 4.6)) * 0.85);
        if (f) { const [x, y, d] = along([[180, 500], [470, 500]], seg(t, 1.8, 4.2)); f.set(x, y + Math.sin(t * 16) * 1.2, 1, d, seg(t, 1.6, 1.8)); f.el.querySelector('.arm').setAttribute('transform', `rotate(${Math.sin(t * 12) * 30} 6 -20)`); }
        hens.forEach((h, j) => { const k = seg(t, 1.6 + j * 0.2, 4.2 + j * 0.2); h.set(lerp(170 - j * 30, 480, k), 450 + j * 40 + Math.abs(Math.sin(t * 14 + j)) * -3, 1.2, 1, k > 0 && k < 1 ? 1 : 0); });
      };
    },
  };
}
SCENES.beetle_chem = beetleScene('chem');
SCENES.beetle_hand = beetleScene('hand');
SCENES.beetle_hens = beetleScene('hens');

// какое решение → какая сценка (id события → [сценка для варианта 0, 1, 2])
export const CUT_FOR = {
  factory: ['factory_yes', 'factory_no', 'factory_deal'],
  dry_summer: ['sprinklers'],
  dry_again: ['sprinklers'],
  solar: ['solar'],
  farm_fair: ['fair', 'fair', 'fair'],
  beetle: ['beetle_chem', 'beetle_hand', 'beetle_hens'],
  road: ['road'],
};
export const sceneFor = (st, evId, i) => { const v = CUT_FOR[evId]?.[i]; return typeof v === 'function' ? v(st) : v || null; };
export const sceneInfo = (key) => SCENES[key];

/* ---------- проигрыватель ---------- */
// svg — сцена игры, app — #app; render(loc) — перерисовать ферму на нужной локации; caption — итог («+15% к продажам, −10 🤝»)
export function playCutscene({ key, svg, app, caption, setLoc, onDone }) {
  const sc = SCENES[key];
  if (!sc) { onDone?.(); return; }
  const prevLoc = setLoc(sc.loc);
  const scroll = svg.closest('.farm-scroll'); if (scroll) scroll.scrollTop = 0;
  const g = document.createElementNS(NS, 'g'); g.setAttribute('id', 'cut'); g.setAttribute('pointer-events', 'none');
  svg.appendChild(g);
  // настоящие постройки прячем через CSS — даже если ферма перерисуется посреди сценки
  const css = document.createElement('style');
  css.textContent = sc.hide.length ? sc.hide.map(sel => `#app.cut #scene ${sel}`).join(',') + '{visibility:hidden}' : '';
  document.head.appendChild(css);
  const add = (html) => {
    const el = document.createElementNS(NS, 'g'); el.innerHTML = html; el.setAttribute('opacity', '0'); g.appendChild(el);
    const a = { el,
      set(x, y, s = 1, dir = 1, o = 1) { el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(s * dir).toFixed(3)} ${s.toFixed(3)})`); el.setAttribute('opacity', o.toFixed(2)); },
      op(o) { el.setAttribute('opacity', clamp(o).toFixed(2)); } };
    return a;
  };
  let step;
  try { step = sc.build(add); } catch (e) { console.warn(e); step = null; }

  // камера: подъезжаем к focus (CSS transform у svg; origin — левый верхний угол)
  const r = svg.getBoundingClientRect(), A = app.getBoundingClientRect(), m = svg.getScreenCTM();
  const [fx, fy, fw, fh] = sc.focus;
  const sx = Math.min(A.width / (fw * m.a), A.height * 0.78 / (fh * m.d));
  const s = clamp(sx, 1, 2.2);
  const px = m.a * (fx + fw / 2) + m.e - r.left, py = m.d * (fy + fh / 2) + m.f - r.top;
  // ферма всегда закрывает экран целиком: сдвиг не больше, чем позволяет увеличенная картинка
  const tx = clamp((A.left + A.width / 2) - r.left - s * px, A.right - r.left - s * r.width, A.left - r.left);
  const ty = clamp((A.top + A.height * 0.47) - r.top - s * py, A.bottom - r.top - s * r.height, A.top - r.top);
  svg.style.transformOrigin = '0 0';
  svg.style.transition = 'transform 1.1s cubic-bezier(.45,0,.25,1)';
  requestAnimationFrame(() => { svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; });
  app.classList.add('cut');

  // интерфейс: тап — быстрее, «Пропустить», надпись-итог
  const ui = document.createElement('div');
  ui.className = 'cutui';
  ui.innerHTML = `<div class="cut-cap" hidden></div><div class="cut-hint">тап — быстрее</div><button class="btn cut-skip">Пропустить ⏭</button>`;
  app.appendChild(ui);
  let speed = 1, t = 0, last = performance.now(), done = false, capShown = false, raf = 0;
  ui.addEventListener('pointerdown', (e) => { if (e.target.closest('.cut-skip')) return; speed = 3; ui.querySelector('.cut-hint').textContent = 'быстрее ×3'; });
  ui.querySelector('.cut-skip').addEventListener('click', () => finish());
  const frames = [];
  const loop = (now) => {
    if (done) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; frames.push(now);
    t += dt * speed;
    try { if (!step) return finish(); step(Math.min(t, sc.dur)); } catch (e) { console.warn(e); return finish(); }
    if (!capShown && t >= sc.dur - 1.4 && caption) { capShown = true; const c = ui.querySelector('.cut-cap'); c.innerHTML = caption; c.hidden = false; }
    if (t >= sc.dur + 0.4) return finish();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  playCutscene.last = { key, frames };

  function finish() {
    if (done) return; done = true;
    cancelAnimationFrame(raf);
    // fps для самопроверки (window.__cutFps)
    if (frames.length > 10) window.__cutFps = (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000);
    css.remove(); g.remove(); ui.remove();
    svg.style.transition = 'transform .45s ease-out'; svg.style.transform = '';
    app.classList.remove('cut');
    setTimeout(() => { svg.style.transition = ''; svg.style.transformOrigin = ''; if (prevLoc !== sc.loc) setLoc(prevLoc, true); onDone?.(); }, 380);
  }
  return finish;
}

// повтор / сценки выключены: короткая анимация на карте без остановки игры
export function quickEffect({ key, svg, st, floatText, puff, text }) {
  const sc = SCENES[key];
  if (!sc || (st.loc || 'home') !== sc.loc) return;
  const [fx, fy, fw, fh] = sc.focus, x = fx + fw / 2, y = fy + fh / 2;
  puff(svg, x, y);
  if (text) setTimeout(() => floatText(svg, x, y - 20, text, '#2f7a35'), 150);
}
