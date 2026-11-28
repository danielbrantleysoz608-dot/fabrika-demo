// Один общий requestAnimationFrame-цикл на всю игру (вместо россыпи setInterval):
// тик фермы раз в секунду, автосохранение, сценки. Игра свернута — цикл стоит (rAF не крутится),
// «Экономия батареи» — не чаще 30 кадров в секунду.
const subs = new Set();
let raf = 0, last = 0;
export const loop = {
  eco: false,
  // fn(dt, now) — каждый кадр; вернуть отписку
  add(fn) { subs.add(fn); wake(); return () => subs.delete(fn); },
  // раз в ms миллисекунд (если игра была свернута — один раз сразу после возвращения)
  every(ms, fn) { let acc = 0; return loop.add((dt) => { acc += dt; if (acc >= ms) { acc = acc > ms * 3 ? 0 : acc - ms; fn(); } }); },
};
function frame(now) {
  raf = 0;
  if (document.hidden) return;
  const dt = now - last;
  if (loop.eco && dt < 31) { raf = requestAnimationFrame(frame); return; } // 30 fps
  last = now;
  for (const f of [...subs]) { try { f(Math.min(dt, 1000), now); } catch (e) { console.warn(e); } }
  if (subs.size) raf = requestAnimationFrame(frame);
}
function wake() { if (!raf && !document.hidden && subs.size) { last = performance.now(); raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', wake);
