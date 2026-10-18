// Pure game model: no DOM, no canvas. Shared by the UI and the level generator.
//
// An arrow is { id, cells, dir, color } where `cells` runs tail → head and
// `dir` is where the head points. Arrows slide like a snake: the body follows
// the head, so only the straight ray in front of the head can block them.

export const DIRS = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
};

export const DIR_NAMES = Object.keys(DIRS);

export const headOf = (arrow) => arrow.cells[arrow.cells.length - 1];

export function buildGrid(size, arrows) {
  const grid = new Int16Array(size * size).fill(-1);
  for (const arrow of arrows) {
    for (const c of arrow.cells) grid[c.y * size + c.x] = arrow.id;
  }
  return grid;
}

// Cells from just past the head to the board edge, in travel order.
export function rayCells(size, arrow) {
  const { dx, dy } = DIRS[arrow.dir];
  const head = headOf(arrow);
  const cells = [];
  for (let x = head.x + dx, y = head.y + dy; x >= 0 && y >= 0 && x < size && y < size; x += dx, y += dy) {
    cells.push({ x, y });
  }
  return cells;
}

// Index along the ray of the first occupied cell, or -1 when the way out is clear.
export function blockIndex(size, grid, arrow) {
  const ray = rayCells(size, arrow);
  for (let i = 0; i < ray.length; i++) {
    const id = grid[ray[i].y * size + ray[i].x];
    if (id !== -1 && id !== arrow.id) return i;
  }
  return -1;
}

export function freeArrows(size, arrows) {
  const grid = buildGrid(size, arrows);
  return arrows.filter((a) => blockIndex(size, grid, a) === -1);
}

// Removing an arrow only ever frees cells, so greedily removing every free
// arrow, round after round, finds a solution whenever one exists.
// `depth` is the number of rounds: a rough measure of how tangled a board is.
export function solve(size, arrows) {
  const grid = buildGrid(size, arrows);
  let remaining = arrows;
  let depth = 0;
  while (remaining.length) {
    const free = remaining.filter((a) => blockIndex(size, grid, a) === -1);
    if (!free.length) return { solvable: false, depth };
    for (const a of free) {
      for (const c of a.cells) grid[c.y * size + c.x] = -1;
    }
    remaining = remaining.filter((a) => !free.includes(a));
    depth++;
  }
  return { solvable: true, depth };
}

export class Game {
  constructor({ level, size, arrows }) {
    this.level = level;
    this.size = size;
    this.initial = arrows;
    this.restart();
  }

  restart() {
    this.arrows = this.initial.slice();
    this.moves = 0;
    this.history = [];
  }

  get isWon() {
    return this.arrows.length === 0;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  arrowAt(x, y) {
    return this.arrows.find((a) => a.cells.some((c) => c.x === x && c.y === y)) ?? null;
  }

  // Every tap counts as a move. Returns what happened so render and audio can react:
  // `distance` is how many free cells lie ahead (to the edge, or to the blocker).
  tap(id) {
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow) return null;

    const block = blockIndex(this.size, buildGrid(this.size, this.arrows), arrow);
    this.moves++;
    if (block !== -1) return { type: 'blocked', arrow, distance: block };

    this.history.push({ arrows: this.arrows, moves: this.moves - 1 });
    this.arrows = this.arrows.filter((a) => a !== arrow);
    return { type: 'exit', arrow, distance: rayCells(this.size, arrow).length };
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.arrows = previous.arrows;
    this.moves = previous.moves;
    return true;
  }

  // A free arrow, preferring the one whose removal frees the most others.
  hint() {
    const free = freeArrows(this.size, this.arrows);
    if (free.length <= 1) return free[0] ?? null;
    let best = free[0];
    let bestGain = -1;
    for (const arrow of free) {
      const rest = this.arrows.filter((a) => a !== arrow);
      const gain = freeArrows(this.size, rest).length;
      if (gain > bestGain) {
        best = arrow;
        bestGain = gain;
      }
    }
    return best;
  }
}
