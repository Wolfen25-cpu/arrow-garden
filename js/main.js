// Entry point: wires the game model, renderer, input, audio and UI together.

import { Game } from './game.js';
import { generateLevel } from './generator.js';
import { LEVEL_COUNT } from './levels.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);
const state = { level: 1, maxLevel: 1, showMoves: true };
let game;

const ui = createUI({
  onPrev: () => startLevel(state.level - 1),
  onNext: () => startLevel(state.level + 1),
  onUndo: undo,
  onHint: hint,
  onRestart: restart,
});

function startLevel(level) {
  state.level = Math.min(Math.max(1, level), state.maxLevel, LEVEL_COUNT);
  game = new Game(generateLevel(state.level));
  renderer.setGame(game);
  refresh();
}

function refresh() {
  ui.setLevel(state.level, Math.min(state.maxLevel, LEVEL_COUNT));
  ui.setMoves(game.moves, state.showMoves);
  ui.setUndo(game.canUndo && !game.isWon);
}

function handleTap(cell) {
  if (game.isWon) return;
  const arrow = game.arrowAt(cell.x, cell.y);
  if (!arrow) return;

  const result = game.tap(arrow.id);
  if (result.type === 'exit') {
    renderer.playExit(arrow, result.distance);
    if (game.isWon) completeLevel();
  } else {
    renderer.playBounce(arrow, result.distance);
  }
  refresh();
}

function completeLevel() {
  state.maxLevel = Math.max(state.maxLevel, Math.min(state.level + 1, LEVEL_COUNT));
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
  renderer.setGame(game);
  refresh();
}

attachInput(canvas, renderer, handleTap);
startLevel(state.level);
