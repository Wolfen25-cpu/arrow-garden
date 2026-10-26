// Pure game model: no DOM, no canvas. Shared by the UI and the level generator.
//
// An arrow is { id, cells, dir, color, both? } where `cells` runs tail → head and
// `dir` is where the head points. Arrows slide like a snake: the body follows
// the head, so only the path in front of the head can block them.
// A double arrow (`both`) may also leave backwards, tail first.
//
// Obstacles are fixed cells { x, y, kind: 'turn' | 'hole', dir? }: a turn sends an arrow
// on in its own direction, a hole swallows the arrow. Neither ever moves, so removing an
// arrow still only frees cells and the greedy solver below stays complete.

export const DIRS = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
};

export const DIR_NAMES = Object.keys(DIRS);

export const headOf = (arrow) => arrow.cells[arrow.cells.length - 1];

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// Grid codes: -1 empty, ≥ 0 an arrow id, TURN - dirIndex a turn, HOLE a hole.
const TURN = -10;
const HOLE = -20;

// The same arrow travelling the other way: the tail becomes the head.
export function reversed(arrow) {
  const { cells } = arrow;
  let dir = OPPOSITE[arrow.dir];
  if (cells.length > 1) {
    const dx = cells[0].x - cells[1].x;
    const dy = cells[0].y - cells[1].y;
    dir = DIR_NAMES.find((d) => DIRS[d].dx === dx && DIRS[d].dy === dy);
  }
  return { ...arrow, cells: cells.slice().reverse(), dir };
}

export function buildGrid(size, arrows, obstacles = []) {
  const grid = new Int16Array(size * size).fill(-1);
  for (const o of obstacles) {
    grid[o.y * size + o.x] = o.kind === 'hole' ? HOLE : TURN - DIR_NAMES.indexOf(o.dir);
  }
  for (const arrow of arrows) {
    for (const c of arrow.cells) grid[c.y * size + c.x] = arrow.id;
  }
  return grid;
}

// The way out from the head, in travel order: it follows turns and stops at the board
// edge or in a hole (`hole: true`, the hole is the last cell). null when the arrow can
// never leave: its path loops, or meets a turn head-on.
export function exitPath(size, grid, arrow) {
  let dir = arrow.dir;
  let { x, y } = headOf(arrow);
  const cells = [];
  const seen = new Set();
  for (;;) {
    x += DIRS[dir].dx;
    y += DIRS[dir].dy;
    if (x < 0 || y < 0 || x >= size || y >= size) return { cells, hole: false };
    cells.push({ x, y });
    const code = grid[y * size + x];
    if (code === HOLE) return { cells, hole: true };
    if (code <= TURN && code > HOLE) {
      const turn = DIR_NAMES[TURN - code];
      if (turn === OPPOSITE[dir]) return null;
      dir = turn;
      const key = (y * size + x) * 4 + DIR_NAMES.indexOf(dir);
      if (seen.has(key)) return null;
      seen.add(key);
    }
  }
}

// Index along the path of the first arrow in the way, or -1 when the way out is clear.
// Its own body counts too: after a turn the path can come back across it.
export function blockIndex(size, grid, arrow) {
  const path = exitPath(size, grid, arrow);
  if (!path) return 0;
  for (let i = 0; i < path.cells.length; i++) {
    if (grid[path.cells[i].y * size + path.cells[i].x] >= 0) return i;
  }
  return -1;
}

// Whether a tap at `point` (board coordinates, cell centres on integers) is nearer the
// tail end of the arrow than the head end. Measured along the body, so bends count: the
// nearest cell decides, and on the middle cell (or a one-cell arrow) the side of it does.
export function nearTail(arrow, point) {
  const { cells } = arrow;
  const dist = (c) => Math.hypot(point.x - c.x, point.y - c.y);
  if (cells.length === 1) {
    const { dx, dy } = DIRS[arrow.dir];
    return (point.x - cells[0].x) * dx + (point.y - cells[0].y) * dy < 0;
  }
  let i = 0;
  cells.forEach((c, k) => {
    if (dist(c) < dist(cells[i])) i = k;
  });
  const middle = (cells.length - 1) / 2;
  if (i !== middle) return i < middle;
  return dist(cells[i - 1]) < dist(cells[i + 1]);
}

// How the arrow would leave right now (itself, or reversed for a double arrow), or null if stuck.
export function exitWay(size, grid, arrow) {
  if (blockIndex(size, grid, arrow) === -1) return arrow;
  if (!arrow.both) return null;
  const back = reversed(arrow);
  return blockIndex(size, grid, back) === -1 ? back : null;
}

export function freeArrows(size, arrows, obstacles = []) {
  const grid = buildGrid(size, arrows, obstacles);
  return arrows.filter((a) => exitWay(size, grid, a));
}

// Removing an arrow only ever frees cells, so greedily removing every free
// arrow, round after round, finds a solution whenever one exists.
// `depth` is the number of rounds: a rough measure of how tangled a board is.
export function solve(size, arrows, obstacles = []) {
  const grid = buildGrid(size, arrows, obstacles);
  let remaining = arrows;
  let depth = 0;
  while (remaining.length) {
    const free = remaining.filter((a) => exitWay(size, grid, a));
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
  // `mask` (picture levels) marks the cells that belong to the figure; null means the whole board.
  // `maxErrors` > 0 limits how many bumps are allowed before the level must start over.
  constructor({ level, size, arrows, shape = null, mask = null, maxErrors = 0, tier = null, obstacles = [] }) {
    this.level = level;
    this.size = size;
    this.initial = arrows;
    this.shape = shape;
    this.mask = mask;
    this.maxErrors = maxErrors;
    this.tier = tier;
    this.obstacles = obstacles;
    // Special rules on this board, for one-time explanations.
    this.mechanics = [];
    if (arrows.some((a) => a.both)) this.mechanics.push('double');
    if (obstacles.some((o) => o.kind === 'turn')) this.mechanics.push('turn');
    if (obstacles.some((o) => o.kind === 'hole')) this.mechanics.push('hole');
    if (arrows.some((a) => a.cells.length > 4)) this.mechanics.push('long');
    this.restart();
  }

  restart() {
    this.arrows = this.initial.slice();
    this.moves = 0;
    this.errors = 0;
    this.history = [];
  }

  get isWon() {
    return this.arrows.length === 0;
  }

  get isLost() {
    return this.maxErrors > 0 && this.errors >= this.maxErrors;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  grid() {
    return buildGrid(this.size, this.arrows, this.obstacles);
  }

  arrowAt(x, y) {
    return this.arrows.find((a) => a.cells.some((c) => c.x === x && c.y === y)) ?? null;
  }

  // Every tap counts as a move. A double arrow heads for the end nearest `point` (where
  // the tap landed); without a point it takes whichever end is free.
  // Returns what happened so render and audio can react:
  // `path` is the way out (through turns, maybe into a hole) and `distance` how many
  // of its cells are free (all of them on an exit, up to the blocker on a bump).
  // A bump counts as an error; undo never gives errors back.
  tap(id, point = null) {
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow || this.isLost) return null;

    const grid = this.grid();
    const chosen = arrow.both && point ? (nearTail(arrow, point) ? reversed(arrow) : arrow) : null;
    const way = chosen ? (blockIndex(this.size, grid, chosen) === -1 ? chosen : null) : exitWay(this.size, grid, arrow);
    this.moves++;
    if (!way) {
      this.errors++;
      const shown = chosen ?? arrow; // a double arrow bumps the way it was sent
      const path = exitPath(this.size, grid, shown);
      return { type: 'blocked', arrow: shown, distance: blockIndex(this.size, grid, shown), path: path?.cells ?? [] };
    }

    // `arrow` in the result is the moving version: reversed when a double arrow backs out.
    this.history.push({ arrows: this.arrows, moves: this.moves - 1 });
    this.arrows = this.arrows.filter((a) => a !== arrow);
    const { cells, hole } = exitPath(this.size, grid, way);
    return { type: 'exit', arrow: way, distance: cells.length, path: cells, hole };
  }

  // The way a resting arrow would leave now and its path, for drawing hints.
  exitWay(arrow) {
    return exitWay(this.size, this.grid(), arrow);
  }

  pathOf(arrow) {
    return exitPath(this.size, this.grid(), arrow);
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
    const free = freeArrows(this.size, this.arrows, this.obstacles);
    if (free.length <= 1) return free[0] ?? null;
    let best = free[0];
    let bestGain = -1;
    for (const arrow of free) {
      const rest = this.arrows.filter((a) => a !== arrow);
      const gain = freeArrows(this.size, rest, this.obstacles).length;
      if (gain > bestGain) {
        best = arrow;
        bestGain = gain;
      }
    }
    return best;
  }
}
