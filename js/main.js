// Entry point: wires the game model, renderer, input, audio and UI together.

import { Game } from './game.js';
import { generateLevel } from './generator.js';
import { LEVEL_COUNT } from './levels.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { Sound, vibrate } from './audio.js';
import { loadState, saveState } from './storage.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);
const sound = new Sound();
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const state = loadState();
let game;

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
});

function startLevel(level) {
  state.level = Math.min(Math.max(1, level), state.maxLevel, LEVEL_COUNT);
  game = new Game(generateLevel(state.level));
  renderer.setGame(game);
  sound.resetStreak();
  persist();
  refresh();
}

function persist() {
  saveState(state);
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
  persist();
  setTimeout(() => sound.win(), renderer.calm ? 150 : 600);
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
  game.restart();
  sound.resetStreak();
  renderer.setGame(game);
  refresh();
}

darkQuery.addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

attachInput(canvas, renderer, handleTap);
applySettings();
startLevel(state.level);
