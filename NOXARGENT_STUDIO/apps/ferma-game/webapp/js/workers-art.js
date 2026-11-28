// Портреты и фигурки работников — в том же плоском стиле, что и ферма (контур #3b2a1f, яркие заливки).
const OL = 'stroke="#3b2a1f" stroke-width="2" stroke-linejoin="round"';
const LOOK = {
  helper:    { skin: '#f6c9a0', shirt: '#3fa34d', pants: '#3f5f8f', hair: '#8b5a36', hat: 'cap', hatC: '#2f6fb5' },
  henwife:   { skin: '#f3c39b', shirt: '#e2603a', pants: '#e2603a', hair: '#6b4426', hat: 'kerchief', hatC: '#d8392d', apron: '#fff' },
  beekeeper: { skin: '#eebd96', shirt: '#f4efe4', pants: '#d9c9a3', hair: '#cfcfcf', hat: 'veil', hatC: '#f4efe4', beard: '#e6e6e6' },
  milkmaid:  { skin: '#f6cfa8', shirt: '#4a90d9', pants: '#4a90d9', hair: '#f2c84b', hat: 'kerchiefW', hatC: '#ffffff', apron: '#fff', braids: true },
  seller:    { skin: '#f0c19a', shirt: '#ffffff', pants: '#5b6b7a', hair: '#3b2a1f', hat: 'visor', hatC: '#d8392d', apron: '#d8392d' },
  driver:    { skin: '#eab48c', shirt: '#7b8a99', pants: '#3f4a56', hair: '#4a3426', hat: 'flat', hatC: '#5b6168', mustache: true },
};

function hatSvg(l, cx, top, r) {
  const c = l.hatC;
  if (l.hat === 'cap') return `<path d="M${cx - r} ${top + r * .55} Q${cx} ${top - r * .35} ${cx + r} ${top + r * .55}z" fill="${c}" ${OL}/><path d="M${cx + r * .2} ${top + r * .5} h${r * .95} v${r * .18} h-${r * .95}z" fill="${c}" ${OL}/>`;
  if (l.hat === 'kerchief' || l.hat === 'kerchiefW') {
    const dots = l.hat === 'kerchief' ? [[-.4, .1], [0, -.15], [.4, .1], [-.15, .3], [.2, .32]].map(([dx, dy]) => `<circle cx="${cx + dx * r}" cy="${top + r * .25 + dy * r}" r="${r * .07}" fill="#fff"/>`).join('') : '';
    return `<path d="M${cx - r * 1.05} ${top + r * .75} Q${cx - r} ${top - r * .2} ${cx} ${top - r * .15} Q${cx + r} ${top - r * .2} ${cx + r * 1.05} ${top + r * .75} Q${cx} ${top + r * .35} ${cx - r * 1.05} ${top + r * .75}z" fill="${c}" ${OL}/>${dots}`;
  }
  if (l.hat === 'veil') return `<ellipse cx="${cx}" cy="${top + r * .2}" rx="${r * 1.35}" ry="${r * .28}" fill="${c}" ${OL}/><path d="M${cx - r * .7} ${top + r * .1} Q${cx} ${top - r * .7} ${cx + r * .7} ${top + r * .1}z" fill="${c}" ${OL}/>
    <path d="M${cx - r * 1.25} ${top + r * .3} L${cx - r * 1.1} ${top + r * 1.6} H${cx + r * 1.1} L${cx + r * 1.25} ${top + r * .3}" fill="#3b2a1f" fill-opacity=".18" stroke="#3b2a1f" stroke-width="1" stroke-dasharray="2 2"/>`;
  if (l.hat === 'visor') return `<path d="M${cx - r * .95} ${top + r * .35} Q${cx} ${top + r * .05} ${cx + r * .95} ${top + r * .35} v${r * .2} H${cx - r * .95}z" fill="${c}" ${OL}/><path d="M${cx + r * .3} ${top + r * .52} h${r * .9} l-${r * .2} ${r * .16} h-${r * .7}z" fill="${c}" ${OL}/>`;
  if (l.hat === 'flat') return `<path d="M${cx - r * 1.02} ${top + r * .5} Q${cx - r * .7} ${top - r * .2} ${cx + r * .3} ${top - r * .05} Q${cx + r * 1.3} ${top + r * .2} ${cx + r * 1.2} ${top + r * .55}z" fill="${c}" ${OL}/>`;
  return '';
}

// Портрет для карточки (квадрат 72×72)
export function workerPortrait(id) {
  const l = LOOK[id]; if (!l) return '';
  const cx = 36, cy = 34, r = 15;
  return `<svg viewBox="0 0 72 72" class="w-portrait" aria-hidden="true">
    <circle cx="36" cy="36" r="35" fill="#bfe3fb"/><path d="M1 52 Q36 40 71 52 V72 H1z" fill="#8fd068"/>
    <path d="M12 72 Q14 52 36 50 Q58 52 60 72z" fill="${l.shirt}" ${OL}/>
    ${l.apron ? `<path d="M26 54 Q36 52 46 54 L48 72 H24z" fill="${l.apron}" ${OL}/>` : ''}
    ${l.braids ? `<path d="M${cx - r} ${cy} q-4 10 -1 18 M${cx + r} ${cy} q4 10 1 18" stroke="${l.hair}" stroke-width="5" stroke-linecap="round" fill="none"/>` : ''}
    <path d="M${cx - r} ${cy - 2} Q${cx} ${cy - r - 6} ${cx + r} ${cy - 2}z" fill="${l.hair}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${l.skin}" ${OL}/>
    ${l.beard ? `<path d="M${cx - r * .85} ${cy + 3} Q${cx} ${cy + r * 1.6} ${cx + r * .85} ${cy + 3} Q${cx} ${cy + 8} ${cx - r * .85} ${cy + 3}z" fill="${l.beard}" ${OL}/>` : ''}
    <circle cx="${cx - 5}" cy="${cy - 1}" r="1.8" fill="#2a1d16"/><circle cx="${cx + 5}" cy="${cy - 1}" r="1.8" fill="#2a1d16"/>
    <circle cx="${cx - 9}" cy="${cy + 4}" r="2.6" fill="#f08f86" opacity=".55"/><circle cx="${cx + 9}" cy="${cy + 4}" r="2.6" fill="#f08f86" opacity=".55"/>
    ${l.mustache ? `<path d="M${cx - 7} ${cy + 6} q3.5 -3 7 0 q3.5 -3 7 0 q-3.5 3 -7 1 q-3.5 2 -7 -1z" fill="${l.hair}"/>` : `<path d="M${cx - 4} ${cy + 6} q4 4 8 0" stroke="#2a1d16" stroke-width="1.8" fill="none" stroke-linecap="round"/>`}
    ${hatSvg(l, cx, cy - r - 2, r)}
  </svg>`;
}

// Маленькая фигурка на ферме (ноги внизу в точке x,y; высота ~38)
export function workerFigure(id, x, y) {
  const l = LOOK[id]; if (!l) return '';
  const r = 7, cy = y - 30;
  return `<g class="worker-fig" data-tap="workers" transform="translate(0 0)">
    <ellipse cx="${x}" cy="${y + 1}" rx="10" ry="3" fill="#000" opacity=".15"/>
    <rect x="${x - 5}" y="${y - 10}" width="4" height="10" rx="2" fill="${l.pants}" stroke="#3b2a1f" stroke-width="1.4"/>
    <rect x="${x + 1}" y="${y - 10}" width="4" height="10" rx="2" fill="${l.pants}" stroke="#3b2a1f" stroke-width="1.4"/>
    <path d="M${x - 7} ${y - 8} Q${x - 8} ${y - 23} ${x} ${y - 23} Q${x + 8} ${y - 23} ${x + 7} ${y - 8}z" fill="${l.shirt}" stroke="#3b2a1f" stroke-width="1.6"/>
    ${l.apron ? `<path d="M${x - 4} ${y - 18} H${x + 4} L${x + 5} ${y - 8} H${x - 5}z" fill="${l.apron}" stroke="#3b2a1f" stroke-width="1"/>` : ''}
    <circle cx="${x}" cy="${cy}" r="${r}" fill="${l.skin}" stroke="#3b2a1f" stroke-width="1.6"/>
    ${l.beard ? `<path d="M${x - 5} ${cy + 2} Q${x} ${cy + 10} ${x + 5} ${cy + 2}z" fill="${l.beard}" stroke="#3b2a1f" stroke-width="1"/>` : ''}
    <circle cx="${x - 2.4}" cy="${cy}" r="1" fill="#2a1d16"/><circle cx="${x + 2.4}" cy="${cy}" r="1" fill="#2a1d16"/>
    <g transform="translate(${x} ${cy - r - 1}) scale(.47) translate(${-x} ${-(cy - r - 1)})">${hatSvg(l, x, cy - r - 1, 15)}</g>
    <rect x="${x - 11}" y="${y - 40}" width="22" height="44" fill="transparent"/>
  </g>`;
}
// где стоят фигурки на ферме деда
export const WORKER_SPOT = { helper: [238, 672], henwife: [190, 604], beekeeper: [244, 650], milkmaid: [316, 424], seller: [414, 652], driver: [298, 772] };
