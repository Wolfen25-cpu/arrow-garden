// Pure model for 3D levels: no DOM, no canvas. Same interface as Game (game.js), so
// main.js can treat both alike.
//
// The board is the surface of a solid made of unit cubes (a cube, a box, a shape with
// holes: see solids.js), one cell per exposed cube face. Arrows are like the flat ones
// (tail → head, straight or bent) except that their bodies may run over an edge onto the
// next side. An arrow leaves by sliding straight across its flat stretch and off the rim,
// when that line is empty; a wall rising in the way would hold it forever, so the
// generator never makes one. Removing an arrow only frees cells, so the greedy solver
// stays complete.

import { solidOf } from './solids.js';

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

// The six orientations a cell can face: outward normal and the two axes spanning it.
const FACE_DEFS = [
  { n: 'x+', u: [0, 0, 1], v: [0, 1, 0] },
  { n: 'x-', u: [0, 0, 1], v: [0, 1, 0] },
  { n: 'y+', u: [1, 0, 0], v: [0, 0, 1] },
  { n: 'y-', u: [1, 0, 0], v: [0, 0, 1] },
  { n: 'z+', u: [1, 0, 0], v: [0, 1, 0] },
  { n: 'z-', u: [1, 0, 0], v: [0, 1, 0] },
];

const surfaces = new Map();

// Geometry of a solid's surface (see solids.js), cached per solid. Cells are numbered by
// orientation, then layer, row (v) and column (u): on a cube, face·N² + v·N + u.
export function surface(id) {
  if (surfaces.has(id)) return surfaces.get(id);
  const { dims, filled } = solidOf(id);
  const solid = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2] && filled(x, y, z);

  const cells = []; // { voxel, face, normal, u, v, corner }
  const index = new Map();
  const key = (p, fi) => `${p}|${fi}`;
  FACE_DEFS.forEach((f, fi) => {
    const normal = DIRS3[f.n];
    const axis = normal.findIndex((c) => c !== 0);
    const here = [];
    for (let x = 0; x < dims[0]; x++) {
      for (let y = 0; y < dims[1]; y++) {
        for (let z = 0; z < dims[2]; z++) {
          const p = [x, y, z];
          if (solid(p) && !solid(add(p, normal))) here.push(p);
        }
      }
    }
    here.sort((a, b) => a[axis] - b[axis] || dot(a, f.v) - dot(b, f.v) || dot(a, f.u) - dot(b, f.u));
    for (const voxel of here) {
      // The cell's corner with the smallest u and v, on the face plane.
      const corner = voxel.map((c, i) => c + Math.max(0, normal[i]));
      index.set(key(voxel, fi), cells.length);
      cells.push({ voxel, face: fi, normal, u: f.u, v: f.v, corner });
    }
  });
  const faceIndex = (dirName) => FACE_DEFS.findIndex((f) => f.n === dirName);
  const cellAt = (voxel, dirName) => index.get(key(voxel, faceIndex(dirName))) ?? -1;

  const faceOf = (cell) => cells[cell].face;
  const centre = (cell) => {
    const c = cells[cell];
    return add(add(c.corner, c.u, 0.5), c.v, 0.5);
  };

  // One cell on from `cell` heading `dir` (a name). The walk follows the surface: up a
  // wall in front (a concave edge), on across the same plane, or over the rim and down
  // the next side (a convex edge), so the direction may change too.
  const step = (cell, dir) => {
    const { voxel, normal } = cells[cell];
    const d = DIRS3[dir];
    const up = nameOf(normal);
    const wall = add(add(voxel, d), normal);
    if (solid(wall)) return { cell: cellAt(wall, nameOf(neg(d))), dir: up, edge: 'concave' };
    const ahead = add(voxel, d);
    if (solid(ahead)) return { cell: cellAt(ahead, up), dir, edge: null };
    return { cell: cellAt(voxel, dir), dir: nameOf(neg(normal)), edge: 'convex' };
  };

  // The four directions that run along a cell's face.
  const inPlane = (cell) => {
    const f = FACE_DEFS[faceOf(cell)];
    return [nameOf(f.u), nameOf(neg(f.u)), nameOf(f.v), nameOf(neg(f.v))];
  };

  // Straight on from `cell` across its own flat stretch, up to (not past) the rim where
  // it can slide off. null when a wall rises in the way: no arrow ever leaves like that.
  const lineOut = (cell, dir) => {
    const out = [];
    for (let at = cell; ;) {
      const next = step(at, dir);
      if (next.edge === 'convex') return out;
      if (next.edge === 'concave') return null;
      out.push(next.cell);
      at = next.cell;
    }
  };

  const geometry = { id, dims, cells, cellCount: cells.length, faceOf, centre, step, inPlane, lineOut, solid };
  surfaces.set(id, geometry);
  return geometry;
}

// The solid a 3D level is played on (older saves and levels only knew the cube's size).
export const solidId = ({ solid, size }) => solid ?? `cube${size}`;

export function buildGrid3(solid, arrows) {
  const grid = new Int16Array(surface(solid).cellCount).fill(-1);
  for (const arrow of arrows) for (const c of arrow.cells) grid[c] = arrow.id;
  return grid;
}

export const headOf3 = (arrow) => arrow.cells[arrow.cells.length - 1];

// The way out: straight from the head to the rim of its flat stretch (null past a wall).
export const exitPath3 = (solid, arrow) => surface(solid).lineOut(headOf3(arrow), arrow.dir);

// Index along the way out of the first arrow in the way, or -1 when it is clear.
// Its own body counts too: a winding arrow can point back across itself.
export function blockIndex3(solid, grid, arrow) {
  const path = exitPath3(solid, arrow);
  if (!path) return 0;
  for (let i = 0; i < path.length; i++) if (grid[path[i]] !== -1) return i;
  return -1;
}

export function freeArrows3(solid, arrows) {
  const grid = buildGrid3(solid, arrows);
  return arrows.filter((a) => blockIndex3(solid, grid, a) === -1);
}

export function solve3(solid, arrows) {
  const grid = buildGrid3(solid, arrows);
  let remaining = arrows;
  let depth = 0;
  while (remaining.length) {
    const free = remaining.filter((a) => blockIndex3(solid, grid, a) === -1);
    if (!free.length) return { solvable: false, depth };
    for (const a of free) for (const c of a.cells) grid[c] = -1;
    remaining = remaining.filter((a) => !free.includes(a));
    depth++;
  }
  return { solvable: true, depth };
}

export class Game3D {
  constructor({ level, size, solid, arrows, maxErrors = 0, tier = null }) {
    this.is3d = true;
    this.level = level;
    this.size = size;
    this.solid = solidId({ solid, size });
    this.initial = arrows;
    this.shape = null;
    this.maxErrors = maxErrors;
    this.tier = tier;
    this.mechanics = ['cube'];
    if (!this.solid.startsWith('cube')) this.mechanics.push('solid');
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

  arrowAtCell(cell) {
    return this.arrows.find((a) => a.cells.includes(cell)) ?? null;
  }

  // Same result shape as Game.tap; `path` lists the cells of the way out.
  tap(id) {
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow || this.isLost) return null;

    const path = exitPath3(this.solid, arrow) ?? [];
    const at = blockIndex3(this.solid, buildGrid3(this.solid, this.arrows), arrow);
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
    return blockIndex3(this.solid, buildGrid3(this.solid, this.arrows), arrow) === -1 ? arrow : null;
  }

  pathOf(arrow) {
    return exitPath3(this.solid, arrow) ?? [];
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
    const free = freeArrows3(this.solid, this.arrows);
    if (free.length <= 1) return free[0] ?? null;
    let best = free[0];
    let bestGain = -1;
    for (const arrow of free) {
      const gain = freeArrows3(this.solid, this.arrows.filter((a) => a !== arrow)).length;
      if (gain > bestGain) {
        best = arrow;
        bestGain = gain;
      }
    }
    return best;
  }
}
