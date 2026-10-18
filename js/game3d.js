// Pure model for cube levels: no DOM, no canvas. Same interface as Game (game.js), so
// main.js can treat both alike.
//
// The board is the surface of an N×N×N cube: six faces, each an N×N grid. A cell is an
// index (face * N² + v * N + u). Arrows are like the flat ones (tail → head, straight or
// bent) except that their bodies may run over an edge onto the next face. An arrow leaves
// by sliding straight off the edge of the face its head is on, when that line is empty.
// Removing an arrow only frees cells, so the greedy solver stays complete.

// Directions are 3D unit vectors, named by axis.
export const DIRS3 = {
  'x+': [1, 0, 0],
  'x-': [-1, 0, 0],
  'y+': [0, 1, 0],
  'y-': [0, -1, 0],
  'z+': [0, 0, 1],
  'z-': [0, 0, -1],
};

export const DIR3_NAMES = Object.keys(DIRS3);

const nameOf = ([x, y, z]) => DIR3_NAMES.find((k) => {
  const d = DIRS3[k];
  return d[0] === x && d[1] === y && d[2] === z;
});

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a) => [-a[0], -a[1], -a[2]];

// Faces of the cube [0, N]³: outward normal, a corner and the two axes spanning it.
// The corner is scaled by N in `surface()`.
const FACE_DEFS = [
  { n: 'x+', o: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: 'x-', o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: 'y+', o: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: 'y-', o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: 'z+', o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: 'z-', o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] },
];

const surfaces = new Map();

// Geometry helpers for an N-sized cube, cached per size.
export function surface(size) {
  if (surfaces.has(size)) return surfaces.get(size);
  const faces = FACE_DEFS.map((f) => ({ ...f, normal: DIRS3[f.n], corner: f.o.map((c) => c * size) }));
  const cellCount = 6 * size * size;

  const faceOf = (cell) => Math.floor(cell / (size * size));
  const centre = (cell) => {
    const f = faces[faceOf(cell)];
    const r = cell % (size * size);
    return add(add(f.corner, f.u, (r % size) + 0.5), f.v, Math.floor(r / size) + 0.5);
  };
  // Where a point on face `fi` lies in that face's grid, or -1 off the face.
  const locate = (fi, p) => {
    const f = faces[fi];
    const rel = add(p, f.corner, -1);
    const u = Math.floor(dot(rel, f.u));
    const v = Math.floor(dot(rel, f.v));
    return u < 0 || v < 0 || u >= size || v >= size ? -1 : fi * size * size + v * size + u;
  };
  const faceIndex = (dirName) => faces.findIndex((f) => f.n === dirName);

  // One cell on from `cell` heading `dir` (a name). Over an edge the walk carries on
  // down the next face, so the direction changes too.
  const step = (cell, dir) => {
    const fi = faceOf(cell);
    const p = centre(cell);
    const d = DIRS3[dir];
    const same = locate(fi, add(p, d));
    if (same !== -1) return { cell: same, dir };
    const normal = faces[fi].normal;
    const next = faceIndex(dir);
    return { cell: locate(next, add(add(p, d, 0.5), normal, -0.5)), dir: nameOf(neg(normal)) };
  };

  // The four directions that run along a cell's face.
  const inPlane = (cell) => {
    const f = faces[faceOf(cell)];
    return [nameOf(f.u), nameOf(neg(f.u)), nameOf(f.v), nameOf(neg(f.v))];
  };

  // Straight on from `cell` across its own face, up to (not past) the face's edge.
  const lineOut = (cell, dir) => {
    const fi = faceOf(cell);
    const cells = [];
    for (let p = add(centre(cell), DIRS3[dir]); ; p = add(p, DIRS3[dir])) {
      const next = locate(fi, p);
      if (next === -1) return cells;
      cells.push(next);
    }
  };

  const geometry = { size, faces, cellCount, faceOf, centre, step, inPlane, lineOut, faceIndex };
  surfaces.set(size, geometry);
  return geometry;
}

export function buildGrid3(size, arrows) {
  const grid = new Int16Array(6 * size * size).fill(-1);
  for (const arrow of arrows) for (const c of arrow.cells) grid[c] = arrow.id;
  return grid;
}

export const headOf3 = (arrow) => arrow.cells[arrow.cells.length - 1];

// The way out: straight from the head to the edge of its face.
export const exitPath3 = (size, arrow) => surface(size).lineOut(headOf3(arrow), arrow.dir);

// Index along the way out of the first arrow in the way, or -1 when it is clear.
export function blockIndex3(size, grid, arrow) {
  const path = exitPath3(size, arrow);
  for (let i = 0; i < path.length; i++) if (grid[path[i]] !== -1) return i;
  return -1;
}

export function freeArrows3(size, arrows) {
  const grid = buildGrid3(size, arrows);
  return arrows.filter((a) => blockIndex3(size, grid, a) === -1);
}

export function solve3(size, arrows) {
  const grid = buildGrid3(size, arrows);
  let remaining = arrows;
  let depth = 0;
  while (remaining.length) {
    const free = remaining.filter((a) => blockIndex3(size, grid, a) === -1);
    if (!free.length) return { solvable: false, depth };
    for (const a of free) for (const c of a.cells) grid[c] = -1;
    remaining = remaining.filter((a) => !free.includes(a));
    depth++;
  }
  return { solvable: true, depth };
}

export class Game3D {
  constructor({ level, size, arrows, maxErrors = 0, tier = null }) {
    this.is3d = true;
    this.level = level;
    this.size = size;
    this.initial = arrows;
    this.shape = null;
    this.maxErrors = maxErrors;
    this.tier = tier;
    this.mechanics = ['cube'];
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

  arrowAtCell(cell) {
    return this.arrows.find((a) => a.cells.includes(cell)) ?? null;
  }

  // Same result shape as Game.tap; `path` lists the cells of the way out.
  tap(id) {
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow || this.isLost) return null;

    const path = exitPath3(this.size, arrow);
    const at = blockIndex3(this.size, buildGrid3(this.size, this.arrows), arrow);
    this.moves++;
    if (at !== -1) {
      this.errors++;
      return { type: 'blocked', arrow, distance: at, path };
    }

    this.history.push({ arrows: this.arrows, moves: this.moves - 1 });
    this.arrows = this.arrows.filter((a) => a !== arrow);
    return { type: 'exit', arrow, distance: path.length, path };
  }

  // For hints: the arrow leaves as it is, or not at all.
  exitWay(arrow) {
    return blockIndex3(this.size, buildGrid3(this.size, this.arrows), arrow) === -1 ? arrow : null;
  }

  pathOf(arrow) {
    return exitPath3(this.size, arrow);
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
    const free = freeArrows3(this.size, this.arrows);
    if (free.length <= 1) return free[0] ?? null;
    let best = free[0];
    let bestGain = -1;
    for (const arrow of free) {
      const gain = freeArrows3(this.size, this.arrows.filter((a) => a !== arrow)).length;
      if (gain > bestGain) {
        best = arrow;
        bestGain = gain;
      }
    }
    return best;
  }
}
