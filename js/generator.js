// Procedural level generation. Every board it returns is solvable:
// arrows are added one at a time and kept only if the greedy solver still
// clears the whole board, so a valid exit order always exists.

import { createRng, hashSeed } from './rng.js';
import { levelConfig } from './levels.js';
import { shapeMask } from './shapes.js';
import { generateLevel3d } from './generator3d.js';
import { DIRS, DIR_NAMES, buildGrid, exitPath, solve } from './game.js';

export const PALETTE_SIZE = 12;

const ATTEMPTS = 12;
// A picture only reads when most of it is drawn, so coverage counts more there.
const SHAPE_COVERAGE = 0.85;
const CANDIDATES_PER_CELL = 6;

const PERPENDICULAR = {
  up: ['left', 'right'],
  down: ['left', 'right'],
  left: ['up', 'down'],
  right: ['up', 'down'],
};

export function generateLevel(level) {
  const cfg = levelConfig(level);
  if (cfg.is3d) return generateLevel3d(cfg);
  const mask = cfg.shape ? shapeMask(cfg.shape, cfg.size) : null;
  let best = null;

  // Several seeded attempts; keep the best fit for the level. Still deterministic.
  for (let attempt = 0; attempt < attemptsFor(cfg); attempt++) {
    const rng = createRng(hashSeed(cfg.seed, attempt));
    const obstacles = placeObstacles(cfg, rng);
    const arrows = buildBoard(cfg, mask, obstacles, rng);
    const { depth } = solve(cfg.size, arrows, obstacles);
    const coverage = arrows.reduce((n, a) => n + a.cells.length, 0) / (openCells(cfg.size, mask) - obstacles.length);
    // Easy levels cap the depth too: a board past `maxDepth` scores as if it fell short.
    const fit = depth > cfg.maxDepth ? 2 * cfg.maxDepth - depth : depth;
    const score = fit + coverage * (mask ? 10 : 1);
    if (!best || score > best.score) best = { arrows, obstacles, depth, score, rng };
    if (depth >= cfg.minDepth && depth <= cfg.maxDepth && (!mask || coverage >= SHAPE_COVERAGE)) break;
  }

  assignColors(best.arrows, cfg.size, best.rng);
  return {
    level,
    size: cfg.size,
    arrows: best.arrows,
    depth: best.depth,
    shape: cfg.shape,
    mask,
    maxErrors: cfg.maxErrors,
    tier: cfg.tier,
    obstacles: best.obstacles,
  };
}

// Turns and holes go on inner cells, never touching each other, so every one of them
// has room around it to matter. Only rolls the RNG when the level has obstacles.
function placeObstacles(cfg, rng) {
  const { size, turns = 0, holes = 0 } = cfg;
  if (!turns && !holes) return [];
  const inner = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) inner.push({ x, y });
  rng.shuffle(inner);
  const placed = [];
  for (const c of inner) {
    if (placed.length === turns + holes) break;
    if (placed.some((o) => Math.abs(o.x - c.x) <= 1 && Math.abs(o.y - c.y) <= 1)) continue;
    placed.push(placed.length < turns ? { ...c, kind: 'turn', dir: rng.pick(DIR_NAMES) } : { ...c, kind: 'hole' });
  }
  return placed;
}

const openCells = (size, mask) => (mask ? mask.reduce((n, v) => n + v, 0) : size * size);

function buildBoard(cfg, mask, obstacles, rng) {
  const { size } = cfg;
  const grid = new Int16Array(size * size).fill(-1);
  // Cells outside a picture are walled off (-2), so arrows never start or grow there.
  if (mask) {
    for (let i = 0; i < grid.length; i++) if (!mask[i]) grid[i] = -2;
  }
  for (const o of obstacles) grid[o.y * size + o.x] = -3; // obstacles hold no arrows either
  const paths = buildGrid(size, [], obstacles); // where turns and holes send arrows
  const arrows = [];
  const target = Math.round((openCells(size, mask) - obstacles.length) * cfg.fill);
  let covered = 0;

  const starts = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) starts.push({ x, y });
  rng.shuffle(starts);

  for (const [start, pass] of passes(cfg, starts)) {
    if (covered >= target) break;
    if (grid[start.y * size + start.x] !== -1) continue;

    // Favour arrows with a long way to travel: they cross more of the board
    // and create more dependencies, which makes the puzzle interesting.
    const candidates = [];
    for (let i = 0; i < CANDIDATES_PER_CELL; i++) {
      const arrow = randomArrow(arrows.length, start, pass, rng, grid);
      const path = arrow && exitPath(size, paths, arrow);
      if (path) candidates.push({ arrow, score: path.cells.length + lengthBonus(pass, arrow) + rng.next() * size * 0.5 });
    }
    candidates.sort((a, b) => b.score - a.score);

    // Keep an arrow only if the board stays solvable and no more tangled than the level allows.
    for (const { arrow } of candidates) {
      arrows.push(arrow);
      const { solvable, depth } = solve(size, arrows, obstacles);
      if (solvable && depth <= cfg.maxDepth) {
        for (const c of arrow.cells) grid[c.y * size + c.x] = arrow.id;
        covered += arrow.cells.length;
        break;
      }
      arrows.pop();
    }
  }
  return arrows;
}

// Winding levels (several bends allowed) also favour long bodies, not just long rays,
// and get more attempts: long arrows fill a board in fewer pieces, so deep boards are rarer.
const winding = (cfg) => (cfg.bends ?? 1) > 1;
export const lengthBonus = (cfg, arrow) => (winding(cfg) ? arrow.cells.length : 0);
export const attemptsFor = (cfg) => (winding(cfg) ? ATTEMPTS * 3 : ATTEMPTS);

// Start cells to try, each with the settings to grow an arrow there. Winding levels take
// a second pass with short, straight arrows to fill the gaps the long ones leave.
export function* passes(cfg, starts) {
  for (const start of starts) yield [start, cfg];
  if (!winding(cfg)) return;
  const filler = { ...cfg, minLength: Math.min(cfg.minLength, 2), maxLength: 3, bends: 0, bendChance: 0 };
  for (const start of starts) yield [start, filler];
}

// Decides at which steps of a walk the arrow turns. With one bend allowed (the first
// act) it rolls exactly as it always did, so those boards never change. With more, each
// straight run is at least two cells, so the arrow still reads as a few clear strokes.
// A bend at step 1 would just be a straight arrow, so bends start at step 2.
export function bendPlan(cfg, length, rng) {
  if (cfg.bends === 0) return () => false;
  if ((cfg.bends ?? 1) <= 1) {
    const bendStep = length >= 3 && rng.chance(cfg.bendChance) ? rng.int(2, length - 1) : 0;
    return (step) => step === bendStep;
  }
  let bends = 0;
  let last = 0;
  return (step) => {
    if (bends >= cfg.bends || step - last < 2 || !rng.chance(cfg.bendChance * 0.6)) return false;
    bends++;
    last = step;
    return true;
  };
}

// A random walk from `start` (the tail) with up to `cfg.bends` 90° bends.
// If it runs into a wall, another arrow or itself it stops early, as long as the
// result is still long enough.
function randomArrow(id, start, cfg, rng, grid) {
  const { size } = cfg;
  const length = rng.int(cfg.minLength, cfg.maxLength);
  const turn = bendPlan(cfg, length, rng);

  let walk = rng.pick(DIR_NAMES);
  let dir = walk;
  const cells = [start];

  for (let step = 1; step < length; step++) {
    if (turn(step)) walk = rng.pick(PERPENDICULAR[walk]);
    const prev = cells[cells.length - 1];
    const x = prev.x + DIRS[walk].dx;
    const y = prev.y + DIRS[walk].dy;
    if (x < 0 || y < 0 || x >= size || y >= size || grid[y * size + x] !== -1) break;
    if (cells.some((c) => c.x === x && c.y === y)) break;
    cells.push({ x, y });
    dir = walk;
  }

  if (cells.length < cfg.minLength) return null;
  const arrow = { id, cells, dir, color: 0 };
  // Only roll when doubles are on, so levels without them keep their exact boards.
  if (cfg.doubleChance && rng.chance(cfg.doubleChance)) arrow.both = true;
  return arrow;
}

// Neighbouring arrows never share a colour; the starting hue varies per level.
function assignColors(arrows, size, rng) {
  const grid = buildGrid(size, arrows);
  const colorOf = new Map();
  const offset = rng.int(0, PALETTE_SIZE - 1);

  arrows.forEach((arrow, i) => {
    const near = new Set();
    for (const c of arrow.cells) {
      for (const { dx, dy } of Object.values(DIRS)) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const other = grid[y * size + x];
        if (other !== -1 && colorOf.has(other)) near.add(colorOf.get(other));
      }
    }
    // Step by 5 (coprime with 12) so consecutive arrows get distant hues.
    let color = (offset + i * 5) % PALETTE_SIZE;
    for (let k = 0; k < PALETTE_SIZE && near.has(color); k++) color = (color + 1) % PALETTE_SIZE;
    arrow.color = color;
    colorOf.set(arrow.id, color);
  });
}
