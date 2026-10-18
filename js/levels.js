// Difficulty curve: turns a level number into generator parameters.

import { hashSeed } from './rng.js';
import { SHAPE_IDS, shapeSize } from './shapes.js';

// Number of levels shipped. The curve below keeps working past it (capped at 10×10).
export const LEVEL_COUNT = 50;

const SIZES = [4, 4, 5, 5, 6, 6, 7, 8, 9, 10];
// Past the first ten, sizes wander so not every board is a full 10×10.
const LATE_SIZES = [8, 9, 10, 9, 10, 10, 8, 10];
const MAX_SIZE = 10;

// Every fourth level from 11 is a picture; the last level is always one too.
function shapeFor(level) {
  if (level < 11) return null;
  if (level === LEVEL_COUNT) return 'butterfly';
  if ((level - 11) % 4 !== 0) return null;
  return SHAPE_IDS[((level - 11) / 4) % SHAPE_IDS.length];
}

// Some levels allow only a few bumps before starting over: 3, then 2 from level 37.
function errorLimit(level) {
  if (level < 13 || level % 4 !== 1) return 0;
  return level >= 37 ? 2 : 3;
}

export function levelConfig(level) {
  const i = Math.max(0, level - 1);
  const t = Math.min(1, i / (SIZES.length - 1)); // 0 → 1 across the first ten levels
  const late = Math.max(0, level - SIZES.length); // levels past the first ten
  const shape = shapeFor(level);

  return {
    level,
    size: shape ? shapeSize(shape) : SIZES[i] ?? LATE_SIZES[(late - 1) % LATE_SIZES.length] ?? MAX_SIZE,
    shape,
    maxErrors: errorLimit(level),
    minLength: i < 3 || shape ? 1 : 2, // single cells fill the thin parts of a picture
    maxLength: Math.min(4, 2 + Math.floor(i / 3)),
    bendChance: 0.3 + 0.45 * t,
    // Pictures are filled more so the figure reads; late boards get denser.
    fill: shape ? 0.92 : Math.min(0.9, 0.5 + 0.35 * t + 0.002 * late),
    // Solver rounds required. Pictures have fewer cells, so they ask for less.
    minDepth: shape ? 5 : Math.min(12, 2 + Math.floor(i * 0.6), 8 + Math.floor(late / 10)),
    seed: hashSeed('arrow-garden', level),
  };
}
