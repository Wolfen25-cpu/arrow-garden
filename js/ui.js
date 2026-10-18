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
    sound: $('btn-sound'),
    status: $('sr-status'),
    settingsBtn: $('btn-settings'),
    settings: $('settings'),
    swSound: $('sw-sound'),
    swVibration: $('sw-vibration'),
    swMoves: $('sw-moves'),
    win: $('win'),
    winTitle: $('win-title'),
    winDetail: $('win-detail'),
    winNext: $('btn-win-next'),
  };

  el.prev.addEventListener('click', handlers.onPrev);
  el.next.addEventListener('click', handlers.onNext);
  el.undo.addEventListener('click', handlers.onUndo);
  el.hint.addEventListener('click', handlers.onHint);
  el.restart.addEventListener('click', handlers.onRestart);
  el.sound.addEventListener('click', handlers.onToggleSound);

  // Settings dialog
  el.settingsBtn.addEventListener('click', () => el.settings.showModal());
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    // Close when tapping the backdrop (the dialog element itself, outside its content).
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  const toggle = (sw, key, invert = false) => {
    sw.addEventListener('click', () => {
      const checked = sw.getAttribute('aria-checked') !== 'true';
      handlers.onSettingsChange({ [key]: invert ? !checked : checked });
    });
  };
  toggle(el.swSound, 'muted', true);
  toggle(el.swVibration, 'vibration');
  toggle(el.swMoves, 'showMoves');
  for (const radio of document.querySelectorAll('input[name="theme"]')) {
    radio.addEventListener('change', () => handlers.onSettingsChange({ theme: radio.value }));
  }
  if (!('vibrate' in navigator)) el.swVibration.closest('.row').hidden = true;

  el.winNext.addEventListener('click', handlers.onWinNext);

  document.addEventListener('keydown', (e) => {
    if (e.altKey || !el.win.hidden || e.target.closest('input, dialog')) return;
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

    setSettings({ muted, vibration, showMoves, theme }) {
      el.sound.setAttribute('aria-pressed', String(muted));
      el.sound.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido');
      el.swSound.setAttribute('aria-checked', String(!muted));
      el.swVibration.setAttribute('aria-checked', String(vibration));
      el.swMoves.setAttribute('aria-checked', String(showMoves));
      const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
      if (radio) radio.checked = true;
    },

    showWin({ moves, isLast }) {
      el.winTitle.textContent = isLast ? '¡Jardín completado!' : '¡Nivel completado!';
      el.winDetail.textContent = isLast
        ? `Has resuelto todos los niveles. Último nivel en ${plural(moves, 'movimiento', 'movimientos')}.`
        : `Resuelto en ${plural(moves, 'movimiento', 'movimientos')}.`;
      el.winNext.textContent = isLast ? 'Jugar de nuevo' : 'Siguiente nivel';
      el.win.hidden = false;
      el.winNext.focus({ preventScroll: true });
    },

    hideWin() {
      el.win.hidden = true;
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
