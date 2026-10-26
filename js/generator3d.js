// 3D level generation, same idea as generator.js: arrows are added one at a time on
// the solid's surface and kept only if the greedy solver still clears every side.

import { createRng, hashSeed } from './rng.js';
import { exitPath3, solve3, solidId, surface } from './game3d.js';
import { attemptsFor, bendPlan, lengthBonus, passes } from './generator.js';

const CANDIDATES_PER_CELL = 6;
const PALETTE_SIZE = 12;

const perpendicular = (geo, cell, dir) => geo.inPlane(cell).filter((d) => d[0] !== dir[0]);

export function generateLevel3d(cfg) {
  const solid = solidId(cfg);
  const geo = surface(solid);
  let best = null;
  for (let attempt = 0; attempt < attemptsFor(cfg); attempt++) {
    const rng = createRng(hashSeed(cfg.seed, 'cube', attempt));
    const arrows = buildSurface(cfg, geo, rng);
    const { depth } = solve3(solid, arrows);
    const coverage = arrows.reduce((n, a) => n + a.cells.length, 0) / geo.cellCount;
    const fit = depth > cfg.maxDepth ? 2 * cfg.maxDepth - depth : depth;
    const score = fit + coverage * 4;
    if (!best || score > best.score) best = { arrows, depth, score, rng };
    if (depth >= cfg.minDepth && depth <= cfg.maxDepth) break;
  }

  assignColors(best.arrows, geo, best.rng);
  return {
    level: cfg.level,
    size: cfg.size,
    is3d: true,
    solid,
    arrows: best.arrows,
    depth: best.depth,
    maxErrors: cfg.maxErrors,
    tier: cfg.tier,
  };
}

function buildSurface(cfg, geo, rng) {
  const grid = new Int16Array(geo.cellCount).fill(-1);
  const arrows = [];
  const target = Math.round(geo.cellCount * cfg.fill);
  let covered = 0;
  const starts = rng.shuffle(Array.from({ length: geo.cellCount }, (_, i) => i));
  const spread = (cfg.size ?? Math.max(...geo.dims)) * 0.5;

  for (const [start, pass] of passes(cfg, starts)) {
    if (covered >= target) break;
    if (grid[start] !== -1) continue;
    const candidates = [];
    for (let i = 0; i < CANDIDATES_PER_CELL; i++) {
      const arrow = randomArrow(arrows.length, start, pass, geo, rng, grid);
      const path = arrow && exitPath3(geo.id, arrow);
      if (path) candidates.push({ arrow, score: path.length + lengthBonus(pass, arrow) + rng.next() * spread });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const { arrow } of candidates) {
      arrows.push(arrow);
      const { solvable, depth } = solve3(geo.id, arrows);
      if (solvable && depth <= cfg.maxDepth) {
        for (const c of arrow.cells) grid[c] = arrow.id;
        covered += arrow.cells.length;
        break;
      }
      arrows.pop();
    }
  }
  return arrows;
}

// A random walk from `start` (the tail) with up to `cfg.bends` 90° bends. It may run
// over an edge onto the next side, which is what ties the sides together.
function randomArrow(id, start, cfg, geo, rng, grid) {
  const length = rng.int(cfg.minLength, cfg.maxLength);
  const turn = bendPlan(cfg, length, rng);
  let walk = rng.pick(geo.inPlane(start));
  let dir = walk;
  const cells = [start];
  for (let step = 1; step < length; step++) {
    const here = cells[cells.length - 1];
    if (turn(step)) walk = rng.pick(perpendicular(geo, here, walk));
    const next = geo.step(here, walk);
    if (next.cell < 0 || grid[next.cell] !== -1 || cells.includes(next.cell)) break;
    cells.push(next.cell);
    walk = next.dir;
    dir = walk;
  }
  if (cells.length < cfg.minLength) return null;
  return { id, cells, dir, color: 0 };
}

// Neighbouring arrows never share a colour (same scheme as the flat boards).
function assignColors(arrows, geo, rng) {
  const owner = new Int16Array(geo.cellCount).fill(-1);
  for (const a of arrows) for (const c of a.cells) owner[c] = a.id;
  const colorOf = new Map();
  const offset = rng.int(0, PALETTE_SIZE - 1);
  arrows.forEach((arrow, i) => {
    const near = new Set();
    for (const c of arrow.cells) {
      for (const d of geo.inPlane(c)) {
        const other = owner[geo.step(c, d).cell];
        if (other !== -1 && colorOf.has(other)) near.add(colorOf.get(other));
      }
    }
    let color = (offset + i * 5) % PALETTE_SIZE;
    for (let k = 0; k < PALETTE_SIZE && near.has(color); k++) color = (color + 1) % PALETTE_SIZE;
    arrow.color = color;
    colorOf.set(arrow.id, color);
  });
}
