// Difficulty curve: turns a level number into generator parameters.

import { hashSeed } from './rng.js';

// Number of levels shipped. The curve below keeps working past it (capped at 10×10).
export const LEVEL_COUNT = 10;

const SIZES = [4, 4, 5, 5, 6, 6, 7, 8, 9, 10];
const MAX_SIZE = 10;

export function levelConfig(level) {
  const i = Math.max(0, level - 1);
  const t = Math.min(1, i / (SIZES.length - 1)); // 0 → 1 across the first ten levels

  return {
    level,
    size: SIZES[i] ?? MAX_SIZE,
    minLength: i < 3 ? 1 : 2,
    maxLength: Math.min(4, 2 + Math.floor(i / 3)),
    bendChance: 0.2 + 0.4 * t,
    fill: 0.6 + 0.25 * t, // share of cells covered by arrows
    minDepth: Math.min(8, 2 + Math.floor(i * 0.6)), // solver rounds required
    seed: hashSeed('arrow-garden', level),
  };
}
