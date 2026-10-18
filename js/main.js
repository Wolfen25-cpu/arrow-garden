// Entry point: wires the game model, renderer, input, audio and UI together.

import { Game } from './game.js';
import { generateLevel } from './generator.js';
import { LEVEL_COUNT } from './levels.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { Sound, vibrate } from './audio.js';
import { loadState, mergeProgress, saveState } from './storage.js';
import { createUI } from './ui.js';
import * as cloud from './cloud.js';
import { setupAccount } from './account.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);
const sound = new Sound();
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const state = loadState();
let game;
let winTimer = 0;
let cloudUser = null;
let cloudStart = null;
let pushTimer = 0;

const ui = createUI({
  onPrev: () => startLevel(state.level - 1),
  onNext: () => startLevel(state.level + 1),
  onUndo: undo,
  onHint: hint,
  onRestart: restart,
  onToggleSound: () => {
    sound.unlock();
    changeSettings({ muted: !state.muted });
  },
  onSettingsChange: changeSettings,
  onWinNext: () => startLevel(nextLevel()),
});

const account = setupAccount({ ensureCloud });

const nextLevel = () => (state.level >= LEVEL_COUNT ? 1 : state.level + 1);

function startLevel(level) {
  clearTimeout(winTimer);
  ui.hideWin();
  state.level = Math.min(Math.max(1, level), state.maxLevel, LEVEL_COUNT);
  game = new Game(generateLevel(state.level));
  renderer.setGame(game);
  sound.resetStreak();
  persist();
  refresh();
}

function persist() {
  saveState(state);
  schedulePush();
}

// ---------- Cloud sync (optional) ----------

function ensureCloud() {
  cloudStart ??= cloud.start(onUserChange).catch((err) => {
    cloudStart = null;
    throw err;
  });
  return cloudStart;
}

async function onUserChange(user) {
  cloudUser = user;
  account.setUser(user);
  state.account = Boolean(user);
  if (!user) {
    saveState(state);
    return;
  }
  try {
    const remote = await cloud.pull(user.uid);
    const level = state.level;
    Object.assign(state, mergeProgress(state, remote));
    applySettings();
    // Jump to the synced level only if it would not interrupt a game in progress.
    if (state.level !== level && game.moves === 0) startLevel(state.level);
    else {
      state.level = level;
      persist();
      refresh();
    }
    await pushNow();
  } catch (err) {
    console.warn('Cloud sync failed', err);
    account.setStatus('No se pudo sincronizar ahora. Se intentará de nuevo al avanzar.', true);
  }
}

function schedulePush() {
  if (!cloudUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().catch((err) => console.warn('Cloud save failed', err)), 1500);
}

function pushNow() {
  clearTimeout(pushTimer);
  return cloudUser ? cloud.push(cloudUser.uid, state) : Promise.resolve();
}

function changeSettings(changes) {
  Object.assign(state, changes, { settingsAt: Date.now() });
  persist();
  applySettings();
  refresh();
}

function applySettings() {
  sound.muted = state.muted;
  applyTheme();
  ui.setSettings(state);
}

function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1d2030' : '#f4ede1';
  renderer.readTheme();
}

function refresh() {
  ui.setLevel(state.level, Math.min(state.maxLevel, LEVEL_COUNT));
  ui.setMoves(game.moves, state.showMoves);
  ui.setUndo(game.canUndo && !game.isWon);
}

function handleTap(cell) {
  sound.unlock();
  if (game.isWon) return;
  const arrow = game.arrowAt(cell.x, cell.y);
  if (!arrow) return;

  const result = game.tap(arrow.id);
  if (result.type === 'exit') {
    renderer.playExit(arrow, result.distance);
    sound.exit();
    if (game.isWon) completeLevel();
  } else {
    renderer.playBounce(arrow, result.distance);
    sound.bump();
    if (state.vibration) vibrate(18);
  }
  refresh();
}

function completeLevel() {
  state.maxLevel = Math.max(state.maxLevel, Math.min(state.level + 1, LEVEL_COUNT));
  state.progressAt = Date.now();
  // Save as if already on the next level, so a reload continues from there.
  const current = state.level;
  state.level = nextLevel();
  persist();
  state.level = current;
  const isLast = state.level >= LEVEL_COUNT;
  // Let the last arrow finish leaving before celebrating.
  winTimer = setTimeout(() => {
    sound.win();
    ui.showWin({ moves: game.moves, isLast });
    ui.announce(isLast ? '¡Has completado todos los niveles!' : `¡Nivel ${state.level} completado!`);
  }, renderer.calm ? 150 : 700);
}

function undo() {
  if (game.isWon || !game.undo()) return;
  renderer.clearHint();
  renderer.requestDraw();
  refresh();
}

function hint() {
  if (game.isWon) return;
  const arrow = game.hint();
  if (arrow) renderer.showHint(arrow);
}

function restart() {
  if (game.isWon) return;
  game.restart();
  sound.resetStreak();
  renderer.setGame(game);
  refresh();
}

darkQuery.addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pushTimer) pushNow().catch(() => {});
});

attachInput(canvas, renderer, handleTap);
applySettings();
startLevel(state.level);

// Reconnect players who were signed in last time; offline is fine, it just retries later.
if (cloud.cloudEnabled && state.account) ensureCloud().catch(() => {});
