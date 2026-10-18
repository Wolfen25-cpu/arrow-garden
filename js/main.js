// Entry point: wires the game model, renderer, input, audio and UI together.

import { Game } from './game.js';
import { generateLevel } from './generator.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';

const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);
let game;

function startLevel(level) {
  game = new Game(generateLevel(level));
  renderer.setGame(game);
}

function handleTap(cell) {
  if (game.isWon) return;
  const arrow = game.arrowAt(cell.x, cell.y);
  if (!arrow) return;

  const result = game.tap(arrow.id);
  if (result.type === 'exit') {
    renderer.playExit(arrow, result.distance);
  } else {
    renderer.playBounce(arrow, result.distance);
  }
}

attachInput(canvas, renderer, handleTap);
startLevel(1);
