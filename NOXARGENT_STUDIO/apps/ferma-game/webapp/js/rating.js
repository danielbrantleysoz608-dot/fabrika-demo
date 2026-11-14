// Рейтинг (заглушка этапа 2 — полная версия на этапе 4)
export function submitScore() {}
export function openRating({ openLayer }) {
  openLayer('<div class="dialog"><h3>Рейтинг</h3><p>Скоро!</p><button class="btn wide" data-act="close">Ок</button></div>', 'screen dim', true);
}
