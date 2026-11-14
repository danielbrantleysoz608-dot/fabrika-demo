// Короткие звуки без файлов (Web Audio). Включаются после первого тапа (требование браузеров).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('ferma-muted') === '1'; } catch { /* приватный режим */ }

function ac() {
  if (muted) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.25, from = 3000, to = 600 } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}

export const sfx = {
  whoosh: () => noise(0.28, { vol: 0.3, from: 900, to: 3500 }),          // хлам улетает
  snip: () => { noise(0.07, { vol: 0.35, from: 5000, to: 4000 }); noise(0.09, { vol: 0.25, from: 2500, to: 1500 }); }, // бурьян
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.08 }); tone(1319, 0.18, { type: 'square', vol: 0.08, delay: 0.07 }); },
  build: () => { tone(392, 0.12, { type: 'triangle' }); tone(523, 0.12, { type: 'triangle', delay: 0.1 }); tone(659, 0.22, { type: 'triangle', delay: 0.2 }); },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.15, delay: i * 0.12 })),
  error: () => tone(180, 0.15, { type: 'sawtooth', vol: 0.08 }),
  click: () => tone(660, 0.04, { type: 'triangle', vol: 0.08 }),
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('ferma-muted', muted ? '1' : '0'); } catch { /* */ } return muted; },
};
