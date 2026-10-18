// DOM side of the game: buttons, labels, overlays. All user-facing text lives here.

const $ = (id) => document.getElementById(id);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function createUI(handlers) {
  const el = {
    level: $('level-label'),
    moves: $('moves-label'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    undo: $('btn-undo'),
    hint: $('btn-hint'),
    restart: $('btn-restart'),
    status: $('sr-status'),
  };

  el.prev.addEventListener('click', handlers.onPrev);
  el.next.addEventListener('click', handlers.onNext);
  el.undo.addEventListener('click', handlers.onUndo);
  el.hint.addEventListener('click', handlers.onHint);
  el.restart.addEventListener('click', handlers.onRestart);

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.target.closest('input, dialog')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) handlers.onUndo();
    else if (key === 'h' && !e.ctrlKey && !e.metaKey) handlers.onHint();
    else if (key === 'r' && !e.ctrlKey && !e.metaKey) handlers.onRestart();
    else return;
    e.preventDefault();
  });

  return {
    setLevel(level, unlocked) {
      el.level.textContent = `Nivel ${level}`;
      el.prev.disabled = level <= 1;
      el.next.disabled = level >= unlocked;
    },

    setMoves(moves, visible) {
      el.moves.textContent = plural(moves, 'movimiento', 'movimientos');
      el.moves.classList.toggle('is-hidden', !visible);
    },

    setUndo(enabled) {
      el.undo.disabled = !enabled;
    },

    // Read out by screen readers.
    announce(text) {
      el.status.textContent = '';
      requestAnimationFrame(() => {
        el.status.textContent = text;
      });
    },
  };
}
