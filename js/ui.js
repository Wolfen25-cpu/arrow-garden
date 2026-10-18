// DOM side of the game: screens, buttons, labels, overlays. Text comes from i18n.js.

import { getLang, t } from './i18n.js';

const $ = (id) => document.getElementById(id);

const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ICON_CHECK = '<svg class="tile-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z"/></svg>';
const ICON_PICTURE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="6.5" r="3"/><circle cx="12" cy="17.5" r="3"/><circle cx="6.5" cy="12" r="3"/><circle cx="17.5" cy="12" r="3"/></svg>';
const TILE_TONES = 8;
const NOTICE_MS = 3200;

export function createUI(handlers) {
  const el = {
    home: $('home'),
    lang: $('btn-lang'),
    langLabel: $('lang-label'),
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
    tier: $('tier-label'),
    moves: $('moves-label'),
    lives: $('lives-label'),
    notice: $('level-notice'),
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
  el.lang.addEventListener('click', () => handlers.onLanguage(getLang() === 'es' ? 'en' : 'es'));
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
  for (const radio of document.querySelectorAll('input[name="lang"]')) {
    radio.addEventListener('change', () => handlers.onLanguage(radio.value));
  }
  if (!('vibrate' in navigator)) el.swVibration.closest('.row').hidden = true;

  // The overlay's main button moves on after a win, or retries after running out of errors.
  // The last overlay and coach message are kept so a language change can redraw them.
  let overlayAction = handlers.onWinNext;
  let overlay = null;
  let coach = null;
  let noticeTimer = 0;
  el.winNext.addEventListener('click', () => overlayAction());
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

  const ui = {
    // Applies the current language to the static page text and to whatever is on screen.
    translate() {
      const lang = getLang();
      document.documentElement.lang = lang;
      document.querySelector('meta[name="description"]').content = t('meta.description');
      for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
      for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
      // The switch is written in the language it switches to.
      el.langLabel.textContent = t('lang.switch');
      el.langLabel.lang = lang === 'es' ? 'en' : 'es';
      el.lang.setAttribute('aria-label', t('lang.switchLabel'));
      const radio = document.querySelector(`input[name="lang"][value="${lang}"]`);
      if (radio) radio.checked = true;
      el.notice.hidden = true;
      if (!el.coach.hidden) el.level.textContent = t('game.tutorial');
      if (coach) ui.setCoach(coach.key, { done: coach.done, focus: false });
      if (overlay && !el.win.hidden) {
        if (overlay.kind === 'win') ui.showWin(overlay.args);
        else ui.showLose(overlay.args);
      }
    },

    showHome({ level, tutorialDone }) {
      showScreen('home');
      el.homeProgress.textContent = level > 1 ? t('home.continue', { n: level }) : t('home.start');
      el.tutorial.classList.toggle('is-new', !tutorialDone);
      el.tutorial.setAttribute('aria-label', t(tutorialDone ? 'home.tutorial' : 'home.tutorialNew'));
      // Keep focus on the language switch when it was just used.
      if (document.activeElement !== el.lang) el.play.focus({ preventScroll: true });
    },

    // One tile per level: completed (pastel + check), open, or locked.
    // `info(n)` → { shape, maxErrors } adds a badge for picture and limited levels.
    showLevels({ total, unlocked, completed, current, info }) {
      showScreen('levels');
      el.levelsSummary.textContent = t('levels.summary', { done: Math.min(completed, total), total });
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
        const { shapeLabel, maxErrors, tier } = info(n);
        const badge = maxErrors
          ? `<span class="tile-badge">${ICON_HEART}${maxErrors}</span>`
          : shapeLabel ? `<span class="tile-badge">${ICON_PICTURE}</span>` : '';
        tile.innerHTML = (locked ? ICON_LOCK : `<span>${n}</span>${done ? ICON_CHECK : ''}`) + badge +
          `<span class="tile-tier" data-tier="${tier}"></span>`;
        const status = locked ? t('levels.locked') : done ? t('levels.done') : '';
        const extra = maxErrors ? t('levels.limit', { n: maxErrors }) : shapeLabel ? t('levels.picture', { name: shapeLabel }) : '';
        tile.setAttribute('aria-label', t('levels.tile', { n }) + status + extra + t('levels.tier', { name: t(`tier.${tier}`) }));
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
      if (!on) coach = null;
      if (on) {
        el.level.textContent = t('game.tutorial');
        el.moves.classList.add('is-hidden');
        el.lives.hidden = true;
        el.tier.hidden = true;
        el.notice.hidden = true;
      }
    },

    // `key` is an i18n key (see tutorial.js).
    setCoach(key, { done = false, focus = true } = {}) {
      coach = { key, done };
      el.coachText.textContent = t(key);
      el.coachSkip.hidden = done;
      el.coachDone.hidden = !done;
      if (done && focus) el.coachDone.focus({ preventScroll: true });
    },

    setLevel(level, unlocked) {
      el.level.textContent = t('game.level', { n: level });
      el.prev.disabled = level <= 1;
      el.next.disabled = level >= unlocked;
    },

    // Difficulty pill next to the move counter.
    setTier(tier) {
      el.tier.hidden = !tier;
      if (!tier) return;
      el.tier.dataset.tier = tier;
      el.tier.textContent = t(`tier.${tier}`);
    },

    setMoves(moves, visible) {
      el.moves.textContent = t('game.moves', { n: moves });
      el.moves.classList.toggle('is-hidden', !visible);
    },

    // Hearts left before the level starts over; hidden on levels without a limit.
    setLives(errors, maxErrors) {
      el.lives.hidden = !maxErrors;
      if (!maxErrors) return;
      const left = Math.max(0, maxErrors - errors);
      el.lives.innerHTML = Array.from({ length: maxErrors }, (_, i) =>
        ICON_HEART.replace('<svg', `<svg class="${i < left ? 'is-full' : ''}"`)).join('');
      el.lives.setAttribute('aria-label', t('game.lives', { left, max: maxErrors }));
    },

    // Short message over the board when a level starts, e.g. its error limit.
    notice(text) {
      clearTimeout(noticeTimer);
      el.notice.hidden = !text;
      if (!text) return;
      el.notice.textContent = text;
      noticeTimer = setTimeout(() => {
        el.notice.hidden = true;
      }, NOTICE_MS);
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

    // `shape` is a shape id; its name is looked up here so it follows the language.
    showWin(args) {
      const { moves, isLast, shape } = args;
      overlay = { kind: 'win', args };
      el.winTitle.textContent = t(isLast ? 'win.titleLast' : 'win.title');
      el.winDetail.textContent = isLast
        ? t('win.solvedLast', { n: moves })
        : shape ? t('win.solvedPicture', { n: moves, name: t(`shape.${shape}`) }) : t('win.solved', { n: moves });
      el.winNext.textContent = t(isLast ? 'win.again' : 'win.next');
      overlayAction = handlers.onWinNext;
      el.win.classList.remove('is-lost');
      el.win.hidden = false;
      el.winNext.focus({ preventScroll: true });
    },

    showLose(args) {
      overlay = { kind: 'lose', args };
      el.winTitle.textContent = t('lose.title');
      el.winDetail.textContent = t('lose.detail', { n: args.maxErrors });
      el.winNext.textContent = t('lose.retry');
      overlayAction = handlers.onRetry;
      el.win.classList.add('is-lost');
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
  return ui;
}
