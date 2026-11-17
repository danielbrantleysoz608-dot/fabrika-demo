// Фоновая музыка «Фермы деда» — своя, сгенерирована кодом (Web Audio API), без файлов и чужих треков.
// Четыре сезонные темы: гитара/укулеле (перебор, синтез Karplus-Strong), флейта, мягкий бас,
// шейкер и лёгкий бит; зимой — колокольчики и тёплый пэд. Каждая тема — бесшовный цикл 70–90 с.
// Мелодии строятся детерминированно (seed), поэтому цикл каждый раз звучит одинаково.
import { audioCtx, musicOut, sfx } from './sfx.js';

/* ---------- Темы сезонов ---------- */
// prog — аккорды по ступеням мажора (0 = I, 5 = IV, 7 = V, 9 = vi …), секции по 8 тактов: A A' B A
export const THEMES = {
  spring: { bpm: 96, key: 60, bars: 32, seed: 11, A: [0, 7, 9, 5], B: [5, 7, 0, 9], lead: 'flute', strum: 'folk', drums: 'soft', octave: 12 },
  summer: { bpm: 108, key: 62, bars: 32, seed: 23, A: [0, 5, 7, 5], B: [9, 5, 0, 7], lead: 'whistle', strum: 'bouncy', drums: 'bright', octave: 12 },
  autumn: { bpm: 86, key: 57, bars: 32, seed: 37, A: [0, 9, 5, 7], B: [9, 4, 5, 7], lead: 'flute', strum: 'gentle', drums: 'brush', octave: 12 },
  winter: { bpm: 72, key: 55, bars: 24, seed: 41, A: [0, 9, 5, 7], B: [5, 0, 9, 7], lead: 'bells', strum: 'gentle', drums: 'none', octave: 24, pad: true },
};
export const seasonTheme = (season) => ({ early: 'spring', spring: 'spring', summer: 'summer', autumn: 'autumn', late: 'autumn', winter: 'winter' }[season] || 'spring');
export const loopSeconds = (name) => { const t = THEMES[name]; return (t.bars * 4 * 60) / t.bpm; };

const MINOR = new Set([2, 4, 9]);                 // ii, iii, vi — минорные
const chordOf = (deg) => (MINOR.has(deg) ? [0, 3, 7] : [0, 4, 7]).map(x => x + deg);
const PENTA = [0, 2, 4, 7, 9];                     // мажорная пентатоника — уютно и без «кислых» нот
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- Партитура: заранее строим все такты темы ---------- */
const RHYTHMS = [   // восьмые: 1 — нота, 0 — продолжение/пауза
  [1, 0, 1, 0, 1, 1, 1, 0], [1, 0, 0, 1, 1, 0, 1, 0], [1, 1, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 1, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1, 1, 0], [1, 0, 1, 0, 0, 0, 0, 0],
];
function buildScore(name) {
  const T = THEMES[name], r = rng(T.seed);
  const sectionBars = 8, progA = [...T.A, ...T.A], progB = [...T.B, ...T.B];
  const sections = T.bars === 24 ? ['A', 'B', 'A'] : ['A', 'A2', 'B', 'A'];
  // мотив на 2 такта для A и для B: ритм + «направление» мелодии
  const motif = (len) => Array.from({ length: len }, () => ({ rh: RHYTHMS[Math.floor(r() * RHYTHMS.length)], steps: Array.from({ length: 8 }, () => Math.floor(r() * 5) - 2) }));
  const mA = motif(2), mB = motif(2);
  const bars = [];
  for (const sec of sections) {
    const prog = sec === 'B' ? progB : progA, mot = sec === 'B' ? mB : mA;
    let pos = 2; // индекс в пентатонике (с запасом на октавы)
    for (let b = 0; b < sectionBars; b++) {
      const deg = prog[b], chord = chordOf(deg);
      const mm = mot[b % 2];
      const notes = [];
      const last = b % 2 === 1;                    // конец фразы — длинная нота на тонике аккорда
      for (let e = 0; e < 8; e++) {
        if (!mm.rh[e]) continue;
        if (last && e >= 4) { notes.push({ e, deg: chord[0] + 12, len: 8 - e }); break; }
        pos = Math.max(0, Math.min(9, pos + mm.steps[e] + (sec === 'A2' && e === 0 ? 1 : 0)));
        let semi = PENTA[pos % 5] + 12 * Math.floor(pos / 5);
        // на сильных долях — ближайший звук аккорда
        if (e % 4 === 0) { const ct = chord.map(c => ((c % 12) + 12) % 12); const pc = semi % 12; const best = ct.reduce((a, c) => (Math.abs(c - pc) < Math.abs(a - pc) ? c : a), ct[0]); semi = semi - pc + best; }
        const next = mm.rh.findIndex((v, i) => i > e && v);
        notes.push({ e, deg: semi, len: (next < 0 ? 8 : next) - e });
      }
      bars.push({ deg, chord, notes, sec, end: b === sectionBars - 1 });
    }
  }
  return bars;
}
const SCORES = {};
const score = (name) => (SCORES[name] ||= buildScore(name));

/* ---------- Инструменты ---------- */
const plucks = new WeakMap(); // кэш звуков струны для каждого контекста
function pluckBuffer(ac, midi) {
  let cache = plucks.get(ac); if (!cache) plucks.set(ac, cache = {});
  if (cache[midi]) return cache[midi];
  const sr = 22050, f = hz(midi), N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 1.4);
  const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const ring = new Float32Array(N); const r = rng(midi * 7 + 1);
  for (let i = 0; i < N; i++) ring[i] = r() * 2 - 1;
  let idx = 0, prev = 0;
  for (let i = 0; i < len; i++) {                     // Karplus-Strong: затухающая «струна»
    const cur = ring[idx];
    const avg = 0.5 * (cur + prev) * 0.996;
    prev = cur; ring[idx] = avg; d[i] = cur; idx = (idx + 1) % N;
  }
  return (cache[midi] = buf);
}
// один общий фильтр на все струны (меньше узлов — легче для телефона)
const pluckBus = new WeakMap();
function pluckOut(ac, out) {
  let lp = pluckBus.get(out);
  if (!lp) { lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(out); pluckBus.set(out, lp); }
  return lp;
}
function pluck(ac, out, midi, t, vol) {
  const s = ac.createBufferSource(); s.buffer = pluckBuffer(ac, midi);
  const g = ac.createGain(); g.gain.value = vol;
  s.connect(g).connect(pluckOut(ac, out)); s.start(t); s.stop(t + 1.4);
}
function flute(ac, out, midi, t, dur, vol, kind = 'flute') {
  const f = hz(midi);
  const o1 = ac.createOscillator(), o2 = ac.createOscillator();
  o1.type = 'sine'; o2.type = kind === 'whistle' ? 'sine' : 'triangle';
  o1.frequency.value = f; o2.frequency.value = kind === 'whistle' ? f * 2 : f;
  const vib = ac.createOscillator(), vg = ac.createGain();
  vib.frequency.value = 5.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.004, t + Math.min(0.25, dur));
  vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  const g = ac.createGain(), g2 = ac.createGain(); g2.gain.value = kind === 'whistle' ? 0.12 : 0.35;
  const end = t + dur;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
  g.gain.setValueAtTime(vol * 0.85, Math.max(t + 0.07, end - 0.12)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  o1.connect(g); o2.connect(g2).connect(g); g.connect(lp).connect(out);
  [o1, o2, vib].forEach(o => { o.start(t); o.stop(end + 0.15); });
  // «дыхание» в начале ноты
  const n = noiseBuf(ac), ns = ac.createBufferSource(); ns.buffer = n;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2;
  const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  ns.connect(bp).connect(ng).connect(out); ns.start(t); ns.stop(t + 0.1);
}
function bell(ac, out, midi, t, vol) {
  const f = hz(midi);
  [[1, 1, 2.2], [2.76, 0.4, 1.2], [5.4, 0.18, 0.7], [8.93, 0.08, 0.4]].forEach(([k, v, d]) => {
    const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f * k;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
  });
}
function bass(ac, out, midi, t, dur, vol) {
  const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = hz(midi); lp.type = 'lowpass'; lp.frequency.value = 500;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function pad(ac, out, midis, t, dur, vol) {
  midis.forEach((m, i) => [-6, 6].forEach(det => {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = det;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }));
}
const noises = new WeakMap();
function noiseBuf(ac) {
  if (noises.get(ac)) return noises.get(ac);
  const b = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate), d = b.getChannelData(0); const r = rng(5);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  noises.set(ac, b); return b;
}
function shaker(ac, out, t, vol) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf(ac);
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  s.connect(hp).connect(g).connect(out); s.start(t); s.stop(t + 0.08);
}
function kick(ac, out, t, vol) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
}
// лёгкое «комнатное» эхо: короткий моно-отклик — дёшево для телефона
function reverb(ac) {
  const len = Math.floor(ac.sampleRate * 1.1), ir = ac.createBuffer(1, len, ac.sampleRate); const r = rng(9);
  const d = ir.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * (1 - i / len) ** 3;
  const c = ac.createConvolver(); c.buffer = ir; return c;
}

/* ---------- Один такт темы ---------- */
const STRUMS = { // доли такта (в восьмых), где звучит перебор; u — «вверх» (обратный порядок струн)
  folk: [[0, 'd'], [2, 'd'], [3, 'u'], [5, 'u'], [6, 'd']],
  bouncy: [[0, 'd'], [2, 'd'], [3, 'u'], [4, 'd'], [6, 'd'], [7, 'u']],
  gentle: [[0, 'd'], [4, 'd'], [6, 'u']],
};
export function playBar(ac, out, name, barIndex, t0, skip = {}) {
  const T = THEMES[name], bars = score(name), bar = bars[barIndex % bars.length];
  const e8 = 30 / T.bpm;                 // длительность восьмой, с
  const swing = (e) => (e % 2 ? e8 * 0.08 : 0);
  const root = T.key + bar.deg;
  // аккорд: укулеле-голоса в среднем регистре
  const voices = bar.chord.map(c => T.key + c + (c < 3 ? 12 : 0)).sort((a, b) => a - b);
  if (!skip.strum) for (const [e, dir] of STRUMS[T.strum]) {
    const vs = dir === 'u' ? [...voices].reverse() : voices;
    vs.forEach((m, i) => pluck(ac, out, m, t0 + e * e8 + swing(e) + i * 0.018, dir === 'u' ? 0.16 : 0.22));
  }
  // бас: на 1 и 3 долю (зимой — только на 1)
  bass(ac, out, root - 24 + (bar.deg > 7 ? -12 : 0), t0, e8 * 3.6, 0.3);
  if (T.drums !== 'none') bass(ac, out, root - 24 + 7 + (bar.deg > 7 ? -12 : 0), t0 + e8 * 4, e8 * 3.4, 0.22);
  // ударные
  if (T.drums !== 'none' && !skip.drums) {
    for (let e = 1; e < 8; e += 2) shaker(ac, out, t0 + e * e8 + swing(e), T.drums === 'brush' ? 0.025 : 0.04);
    if (T.drums === 'bright' || T.drums === 'soft') { kick(ac, out, t0, T.drums === 'bright' ? 0.32 : 0.22); kick(ac, out, t0 + e8 * 4, 0.18); }
  }
  // пэд (зима)
  if (T.pad) pad(ac, out, voices.map(v => v - 12), t0, e8 * 8.2, 0.035);
  // мелодия; в первом проходе секции «A» флейта отдыхает каждый второй раз, чтобы не надоедала
  const rest = bar.sec === 'A' && barIndex < 8 && T.bars === 32 && barIndex % 4 >= 2;
  if (!rest && !skip.lead) for (const nt of bar.notes) {
    const m = T.key + T.octave + nt.deg, t = t0 + nt.e * e8 + swing(nt.e), dur = nt.len * e8 * 0.95;
    if (T.lead === 'bells') bell(ac, out, m, t, 0.13);
    else flute(ac, out, m, t, dur, T.lead === 'whistle' ? 0.12 : 0.15, T.lead);
  }
  if (name === 'winter' && barIndex % 4 === 3) bell(ac, out, T.key + 31, t0 + e8 * 6, 0.05); // колокольчики саней
}

/* ---------- Плеер: планировщик с упреждением и плавная смена сезона ---------- */
let current = null;  // { name, gain, bar, next }
let timer = null, wanted = null, master = null;

function ensureMaster(ac) {
  if (master) return master;
  const out = musicOut();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  const dry = ac.createGain(); dry.gain.value = 0.85;
  const wet = ac.createGain(); wet.gain.value = 0.22;
  const rv = reverb(ac);
  master = ac.createGain();
  master.connect(dry).connect(comp); master.connect(rv).connect(wet).connect(comp);
  comp.connect(out);
  return master;
}

function tickScheduler() {
  const ac = audioCtx(); if (!ac || !current) return;
  const T = THEMES[current.name], barLen = (4 * 60) / T.bpm;
  while (current.next < ac.currentTime + 0.6) {
    playBar(ac, current.gain, current.name, current.bar, current.next);
    current.bar = (current.bar + 1) % T.bars;
    current.next += barLen;
  }
}

function startTheme(name) {
  const ac = audioCtx(); if (!ac) return;
  const m = ensureMaster(ac);
  const now = ac.currentTime;
  // старая тема плавно затихает (уже запланированные ноты доигрывают)
  if (current) { const old = current.gain; old.gain.cancelScheduledValues(now); old.gain.setValueAtTime(old.gain.value, now); old.gain.linearRampToValueAtTime(0, now + 2.5); setTimeout(() => old.disconnect(), 4000); }
  const g = ac.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 2.5); g.connect(m);
  const startAt = current ? Math.max(now + 0.1, current.next) : now + 0.15;
  current = { name, gain: g, bar: 0, next: startAt };
  if (!timer) timer = setInterval(tickScheduler, 150);
  tickScheduler();
}

export const music = {
  // вызывать только из обработчика тапа (кнопка «Играть») — иначе браузер не даст звук
  start(season) { wanted = seasonTheme(season); if (sfx.settings.music) startTheme(wanted); },
  setSeason(season) {
    const name = seasonTheme(season);
    wanted = name;
    if (!sfx.settings.music || !current || current.name === name) return;
    startTheme(name);
  },
  stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (current) { const ac = audioCtx(); const g = current.gain; if (ac) g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8); setTimeout(() => g.disconnect(), 1500); current = null; }
  },
  // включить/выключить музыку из настроек
  enable(on) { sfx.set('music', on); if (on && wanted) startTheme(wanted); else if (!on) this.stop(); },
  get playing() { return !!current; },
};

// Предпрослушка/проверка: отрисовать тему в OfflineAudioContext (используется в тестах)
export async function renderOffline(name, seconds = loopSeconds(name), sampleRate = 22050, skip = {}) {
  const ac = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  const g = ac.createGain(); g.gain.value = 0.85; const rv = reverb(ac); const wet = ac.createGain(); wet.gain.value = 0.22;
  g.connect(comp); g.connect(rv).connect(wet).connect(comp); comp.connect(ac.destination);
  const T = THEMES[name], barLen = (4 * 60) / T.bpm;
  for (let b = 0, t = 0.05; t < seconds; b++, t += barLen) playBar(ac, g, name, b % T.bars, t, skip);
  return ac.startRendering();
}
