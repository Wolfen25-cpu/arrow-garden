// DOM side of the game: screens, buttons, labels, overlays. All user-facing text lives here.

const $ = (id) => document.getElementById(id);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ICON_CHECK = '<svg class="tile-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const TILE_TONES = 8;

export function createUI(handlers) {
  const el = {
    home: $('home'),
    app: $('app'),
    play: $('btn-play'),
    homeProgress: $('home-progress'),
    tutorial: $('btn-tutorial'),
    homeSettings: $('btn-home-settings'),
    homeAccount: $('btn-home-account'),
    levels: $('levels'),
    levelsBack: $('btn-levels-back'),
    levelsSummary: $('levels-summary'),
    levelGrid: $('level-grid'),
    toLevels: $('btn-to-levels'),
    level: $('level-label'),
    moves: $('moves-label'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    controls: $('controls'),
    undo: $('btn-undo'),
    hint: $('btn-hint'),
    restart: $('btn-restart'),
    coach: $('coach'),
    coachText: $('coach-text'),
    coachSkip: $('btn-coach-skip'),
    coachDone: $('btn-coach-done'),
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
    winLevels: $('btn-win-levels'),
  };

  const showScreen = (name) => {
    el.home.hidden = name !== 'home';
    el.levels.hidden = name !== 'levels';
    el.app.hidden = name !== 'game';
  };

  // Home screen
  el.play.addEventListener('click', handlers.onPlay);
  el.tutorial.addEventListener('click', handlers.onTutorial);
  el.homeSettings.addEventListener('click', () => el.settings.showModal());
  el.homeAccount.addEventListener('click', handlers.onAccount);

  // Level select
  el.levelsBack.addEventListener('click', handlers.onHome);

  // Game screen
  el.toLevels.addEventListener('click', handlers.onLevels);
  el.prev.addEventListener('click', handlers.onPrev);
  el.next.addEventListener('click', handlers.onNext);
  el.undo.addEventListener('click', handlers.onUndo);
  el.hint.addEventListener('click', handlers.onHint);
  el.restart.addEventListener('click', handlers.onRestart);
  el.coachSkip.addEventListener('click', handlers.onTutorialEnd);
  el.coachDone.addEventListener('click', handlers.onTutorialEnd);

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
  el.winLevels.addEventListener('click', handlers.onLevels);

  document.addEventListener('keydown', (e) => {
    if (e.altKey || el.app.hidden || !el.win.hidden || e.target.closest('input, dialog')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) handlers.onUndo();
    else if (key === 'h' && !e.ctrlKey && !e.metaKey) handlers.onHint();
    else if (key === 'r' && !e.ctrlKey && !e.metaKey) handlers.onRestart();
    else return;
    e.preventDefault();
  });

  return {
    showHome({ level, tutorialDone }) {
      showScreen('home');
      el.homeProgress.textContent = level > 1 ? `Continuar en el nivel ${level}` : 'Empieza en el nivel 1';
      el.tutorial.classList.toggle('is-new', !tutorialDone);
      el.tutorial.setAttribute('aria-label', tutorialDone ? 'Tutorial' : 'Tutorial (recomendado la primera vez)');
      el.play.focus({ preventScroll: true });
    },

    // One tile per level: completed (pastel + check), open, or locked.
    showLevels({ total, unlocked, completed, current }) {
      showScreen('levels');
      el.levelsSummary.textContent = `${Math.min(completed, total)} de ${total} niveles completados`;
      const tiles = [];
      for (let n = 1; n <= total; n++) {
        const locked = n > unlocked;
        const done = n <= completed;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'level-tile';
        tile.dataset.state = locked ? 'locked' : done ? 'done' : 'open';
        tile.dataset.tone = String((n - 1) % TILE_TONES);
        tile.disabled = locked;
        tile.innerHTML = locked ? ICON_LOCK : `<span>${n}</span>${done ? ICON_CHECK : ''}`;
        tile.setAttribute('aria-label', `Nivel ${n}${locked ? ', bloqueado' : done ? ', completado' : ''}`);
        if (n === current && !locked) {
          tile.classList.add('is-current');
          tile.setAttribute('aria-current', 'true');
        }
        tile.addEventListener('click', () => handlers.onPickLevel(n));
        const item = document.createElement('li');
        item.append(tile);
        tiles.push(item);
      }
      el.levelGrid.replaceChildren(...tiles);
      el.levelGrid.querySelector('.is-current')?.focus({ preventScroll: true });
    },

    showGame() {
      showScreen('game');
    },

    // Tutorial swaps the level controls for the coach panel.
    setTutorial(on) {
      el.controls.hidden = on;
      el.coach.hidden = !on;
      el.prev.classList.toggle('is-invisible', on);
      el.next.classList.toggle('is-invisible', on);
      if (on) {
        el.level.textContent = 'Tutorial';
        el.moves.classList.add('is-hidden');
      }
    },

    setCoach(text, { done = false } = {}) {
      el.coachText.textContent = text;
      el.coachSkip.hidden = done;
      el.coachDone.hidden = !done;
      if (done) el.coachDone.focus({ preventScroll: true });
    },

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
