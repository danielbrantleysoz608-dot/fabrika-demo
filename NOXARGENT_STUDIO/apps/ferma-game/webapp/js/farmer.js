// Фермер-помощник: соломенная шляпа с красной лентой, красная рубашка, синий комбинезон.
// mood: 'wink' | 'happy' | 'worried'
export function farmerSVG(mood = 'wink') {
  const OL = 'stroke="#3b2a1f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
  const eyes = {
    wink: `<path d="M70 104 l9 -7 l9 7" fill="none" stroke="#2a1d16" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <ellipse cx="112" cy="101" rx="6.5" ry="8" fill="#2a1d16"/><circle cx="114" cy="98" r="2.2" fill="#fff"/>`,
    happy: `<path d="M68 104 q9 -9 18 0 M104 104 q9 -9 18 0" fill="none" stroke="#2a1d16" stroke-width="4" stroke-linecap="round"/>`,
    worried: `<ellipse cx="79" cy="102" rx="6" ry="7.5" fill="#2a1d16"/><ellipse cx="112" cy="102" rx="6" ry="7.5" fill="#2a1d16"/>
              <circle cx="81" cy="99" r="2" fill="#fff"/><circle cx="114" cy="99" r="2" fill="#fff"/>`,
  }[mood];
  const brows = mood === 'worried'
    ? '<path d="M68 86 l18 -5 M104 81 l18 5" stroke="#7a4e2e" stroke-width="4.5" stroke-linecap="round"/>'
    : '<path d="M68 84 l18 3 M104 82 l9 -5 l10 4" fill="none" stroke="#7a4e2e" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>';
  const mouth = mood === 'worried'
    ? '<path d="M84 132 q12 -8 24 0" fill="none" stroke="#2a1d16" stroke-width="4" stroke-linecap="round"/>'
    : `<path d="M78 124 Q96 150 120 122z" fill="#8f2228" ${OL}/><path d="M88 134 q10 -8 22 -2 q-8 10 -22 2z" fill="#ef6f6f"/>`;
  return `<svg viewBox="0 0 190 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <!-- тело -->
    <path d="M22 200 V176 Q22 150 58 146 H134 Q170 150 170 176 V200z" fill="#e2403a" ${OL}/>
    <path d="M78 146 L96 168 L114 146" fill="#c9332e"/>
    <path d="M62 200 V170 H130 V200z" fill="#3f6fc4" ${OL}/>
    <path d="M48 150 L66 172 M144 150 L126 172" stroke="#3f6fc4" stroke-width="11" stroke-linecap="round"/>
    <circle cx="70" cy="174" r="5" fill="#ffd23f" stroke="#3b2a1f" stroke-width="2"/>
    <circle cx="122" cy="174" r="5" fill="#ffd23f" stroke="#3b2a1f" stroke-width="2"/>
    <rect x="84" y="182" width="24" height="14" rx="3" fill="#335ea8"/>
    <!-- шея и голова -->
    <rect x="84" y="128" width="24" height="22" fill="#d5ab86"/>
    <ellipse cx="52" cy="108" rx="10" ry="12" fill="#f3c8a2" ${OL}/>
    <ellipse cx="140" cy="108" rx="10" ry="12" fill="#f3c8a2" ${OL}/>
    <path d="M52 80 Q52 142 96 144 Q140 142 140 80z" fill="#f3c8a2" ${OL}/>
    <path d="M54 80 Q52 100 62 104 L64 80z M138 80 Q140 100 130 104 L128 80z" fill="#7a4e2e"/>
    <circle cx="68" cy="122" r="9" fill="#f29c8a" opacity=".85"/><circle cx="124" cy="122" r="9" fill="#f29c8a" opacity=".85"/>
    <ellipse cx="96" cy="114" rx="6" ry="7.5" fill="#d9a684"/>
    ${brows}${eyes}${mouth}
    <!-- шляпа -->
    <path d="M58 76 V36 Q58 22 96 20 Q134 22 134 36 V76z" fill="#ecc96f" ${OL}/>
    <rect x="58" y="56" width="76" height="12" fill="#d5503c" stroke="#3b2a1f" stroke-width="2.4"/>
    <ellipse cx="96" cy="78" rx="90" ry="15" fill="#e8c46a" ${OL}/>
    <ellipse cx="96" cy="74" rx="84" ry="9" fill="#f2d688" opacity=".6"/>
    <path d="M34 76 l-3 8 M48 78 l-2 9 M144 78 l2 9 M158 76 l3 8 M70 80 l-1 8 M122 80 l1 8" stroke="#c9a14e" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="86" cy="28" rx="18" ry="5" fill="#f5dc96" opacity=".7"/>
  </svg>`;
}
