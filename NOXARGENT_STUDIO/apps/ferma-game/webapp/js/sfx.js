// Звуки действий — синтез в Web Audio, без файлов (игра грузится мгновенно).
// Общий аудиоконтекст для звуков и музыки: два канала с отдельной громкостью.
// Контекст создаётся только после первого тапа — браузеры блокируют автозвук.

let ctx = null, sfxBus = null, musicBus = null;
const store = (() => { try { return localStorage; } catch { return null; } })();
const load = (k, d) => { try { const v = store?.getItem(k); return v === null || v === undefined ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { store?.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };

// настройки звука (сохраняются)
const settings = {
  sounds: load('ferma-sounds', !load('ferma-muted', false)),
  music: load('ferma-music', true),
  volume: load('ferma-volume', 30),      // громкость музыки, % (по умолчанию 30)
};

export function audioCtx() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      sfxBus = ctx.createGain(); sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.connect(ctx.destination);
      applyVolumes();
    } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume();
  return ctx;
}
export const musicOut = () => (audioCtx() ? musicBus : null);

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(settings.sounds ? 0.9 : 0, t, 0.05);
  // музыка заметно тише звуков действий: 100% ползунка ≈ 0.5 по громкости
  musicBus.gain.setTargetAtTime(settings.music ? (settings.volume / 100) * 0.5 : 0, t, 0.3);
}

function tone(freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0, attack = 0.004 } = {}) {
  const a = audioCtx(); if (!a || !settings.sounds) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.25, from = 3000, to = 600, delay = 0, type = 'bandpass', q = 1 } = {}) {
  const a = audioCtx(); if (!a || !settings.sounds) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(sfxBus); src.start(t);
}

// колокольчик: неровные обертоны, как у настоящего металла
function bell(freq, { vol = 0.12, delay = 0, dur = 1.6 } = {}) {
  [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]].forEach(([k, v]) => tone(freq * k, dur / Math.sqrt(k), { vol: vol * v, delay, attack: 0.002 }));
}

export const sfx = {
  // мусор: «вжух» — шум, уходящий вверх
  whoosh: () => noise(0.3, { vol: 0.35, from: 700, to: 4200 }),
  // бурьян: «вжух» серпом + короткий срез
  snip: () => { noise(0.22, { vol: 0.28, from: 1200, to: 5000 }); noise(0.06, { vol: 0.3, from: 6000, to: 4500, delay: 0.12, type: 'highpass' }); },
  // сбор: «дзынь» монет — две звонкие ноты
  coin: () => { tone(1568, 0.09, { type: 'square', vol: 0.07 }); tone(2093, 0.28, { type: 'square', vol: 0.06, delay: 0.07 }); tone(2093, 0.3, { vol: 0.08, delay: 0.07 }); },
  // свежий сбор +20%: особый звонкий «блеск» — арпеджио вверх
  fresh: () => [1319, 1661, 1976, 2637].forEach((f, i) => { tone(f, 0.22, { type: 'triangle', vol: 0.11, delay: i * 0.055 }); tone(f * 2, 0.12, { vol: 0.03, delay: i * 0.055 + 0.01 }); }),
  // постройка: стук молотка — три удара
  build: () => [0, 0.16, 0.32].forEach((d, i) => { noise(0.07, { vol: 0.45, from: 2200, to: 900, delay: d, q: 2 }); tone(160 - i * 10, 0.09, { type: 'triangle', vol: 0.22, slide: -60, delay: d }); }),
  // новый месяц: колокольчик
  bell: () => { bell(1046, { vol: 0.14 }); bell(1568, { vol: 0.08, delay: 0.18 }); },
  // событие: шелест карточки
  card: () => { noise(0.18, { vol: 0.22, from: 4000, to: 2500, type: 'highpass' }); noise(0.14, { vol: 0.16, from: 3000, to: 5000, delay: 0.12, type: 'highpass' }); },
  // миллион и новые цели: фанфары
  fanfare: () => {
    const brass = (f, d, len, v = 0.1) => { tone(f, len, { type: 'sawtooth', vol: v * 0.5, delay: d, attack: 0.03 }); tone(f, len, { type: 'square', vol: v * 0.35, delay: d, attack: 0.03 }); tone(f * 2, len, { vol: v * 0.3, delay: d, attack: 0.03 }); };
    [[523, 0, 0.16], [659, 0.15, 0.16], [784, 0.3, 0.16], [1047, 0.45, 0.6]].forEach(([f, d, l]) => brass(f, d, l));
    [[523, 0.45], [659, 0.45], [784, 0.45]].forEach(([f, d]) => tone(f, 0.7, { type: 'triangle', vol: 0.06, delay: d, attack: 0.05 }));
    bell(2093, { vol: 0.07, delay: 0.5 });
  },
  error: () => tone(180, 0.15, { type: 'sawtooth', vol: 0.06 }),
  click: () => tone(700, 0.035, { type: 'triangle', vol: 0.06 }),
  splash: () => { noise(0.35, { vol: 0.3, from: 900, to: 300 }); noise(0.2, { vol: 0.18, from: 3000, to: 1500, delay: 0.05, type: 'highpass' }); },
  plop: () => tone(520, 0.12, { type: 'sine', vol: 0.12, slide: -260 }),
  woof: () => { tone(420, 0.09, { type: 'sawtooth', vol: 0.05, slide: -120 }); tone(380, 0.11, { type: 'sawtooth', vol: 0.05, slide: -140, delay: 0.16 }); },

  // настройки
  get muted() { return !settings.sounds; },
  get settings() { return { ...settings }; },
  set(key, value) { settings[key] = value; save('ferma-' + key, value); applyVolumes(); },
  toggle() { this.set('sounds', !settings.sounds); return !settings.sounds; },
  // пауза всего звука, когда игра свёрнута
  suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
};
