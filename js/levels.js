// Difficulty curve: turns a level number into generator parameters.

import { createRng, hashSeed } from './rng.js';
import { shapeSize } from './shapes.js';

// Number of levels shipped. The curve below keeps working past it (capped at 10×10).
export const LEVEL_COUNT = 100;

// Levels 1–10 teach the game: small boards, short arrows, few dependencies.
const INTRO = 10;
const INTRO_SIZES = [4, 4, 4, 5, 5, 5, 6, 6, 6, 7];

// After the intro, each level draws a tier, so easy and hard boards are mixed.
// Harder tiers grow more likely towards the end (weights go from `from` to `to`).
const TIERS = {
  easy: { sizes: [6, 7], maxLength: 3, bendChance: 0.4, fill: 0.72, minDepth: 4, maxDepth: 7, from: 0.3, to: 0.1 },
  medium: { sizes: [7, 8], maxLength: 4, bendChance: 0.55, fill: 0.8, minDepth: 6, maxDepth: 10, from: 0.4, to: 0.25 },
  hard: { sizes: [9], maxLength: 4, bendChance: 0.7, fill: 0.86, minDepth: 9, maxDepth: Infinity, from: 0.22, to: 0.35 },
  expert: { sizes: [10], maxLength: 4, bendChance: 0.75, fill: 0.9, minDepth: 12, maxDepth: Infinity, from: 0.08, to: 0.3 },
};

// Every fourth level from 11 is a picture, in this order; the last level is the dragon.
const SHAPE_ORDER = [
  'cat', 'heart', 'house', 'fish', 'rabbit', 'flower', 'rocket', 'tree', 'turtle', 'star',
  'wolf', 'umbrella', 'boat', 'owl', 'apple', 'mushroom', 'anchor', 'cactus', 'bird', 'moon',
  'crown', 'ghost', 'butterfly',
];
const FINALE = 'dragon';

function shapeFor(level) {
  if (level === LEVEL_COUNT) return FINALE;
  if (level <= INTRO || (level - 11) % 4 !== 0) return null;
  return SHAPE_ORDER[((level - 11) / 4) % SHAPE_ORDER.length];
}

// The first levels after the intro stay easy or medium, so the step up is gentle.
const WARMUP = 15;

function tierFor(level) {
  if (level === LEVEL_COUNT) return 'expert'; // the dragon is the final challenge
  const p = Math.min(1, (level - INTRO - 1) / (LEVEL_COUNT - INTRO - 1));
  const entries = Object.entries(TIERS).map(([name, t]) => [name, t.from + (t.to - t.from) * p]);
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let roll = createRng(hashSeed('tier', level)).next() * total;
  let tier = 'medium';
  for (const [name, w] of entries) {
    roll -= w;
    if (roll < 0) {
      tier = name;
      break;
    }
  }
  return level <= WARMUP && tier !== 'easy' ? 'medium' : tier;
}

// Double arrows appear from level 21 on medium and harder boards,
// turns from level 31 and holes from level 41 (never on pictures).
const DOUBLES_FROM = 21;
const TURNS_FROM = 31;
const HOLES_FROM = 41;
const TURNS = { easy: 1, medium: 2, hard: 2, expert: 3 };
const HOLES = { easy: 1, medium: 1, hard: 2, expert: 2 };

// Cube levels: 14, 24, … 94 (never clashing with pictures ≡ 3 or limits ≡ 1 mod 4).
// Every face is a 3×3 grid at first, 4×4 from level 54.
const is3d = (level) => level >= 14 && level % 10 === 4 && level < LEVEL_COUNT;

// Some levels allow only a few bumps before starting over: 3, or 2 from level 50
// (expert boards keep 3, so they stay fair).
function errorLimit(level, tier) {
  if (level < 13 || level % 4 !== 1) return 0;
  return level < 50 || tier === 'expert' ? 3 : 2;
}

export function levelConfig(level) {
  const seed = hashSeed('arrow-garden', level);
  const shape = shapeFor(level);

  if (level <= INTRO && !shape) {
    const i = Math.max(0, level - 1);
    const minDepth = 2 + Math.floor(i / 3);
    return {
      level,
      size: INTRO_SIZES[i],
      shape: null,
      tier: 'intro',
      maxErrors: 0,
      minLength: i < 4 ? 1 : 2,
      maxLength: i < 3 ? 2 : 3,
      bendChance: i < 3 ? 0 : 0.15 + 0.03 * i, // bends appear once taps make sense
      fill: 0.5 + 0.02 * i,
      minDepth,
      maxDepth: minDepth + 2,
      doubleChance: 0,
      seed,
    };
  }

  const tier = tierFor(level);
  if (is3d(level)) {
    const size = level < 54 ? 3 : 4;
    const t = TIERS[tier];
    return {
      level,
      size,
      is3d: true,
      shape: null,
      tier,
      maxErrors: 0,
      minLength: 2,
      maxLength: t.maxLength,
      bendChance: t.bendChance,
      fill: t.fill,
      // Fewer cells per face than a flat board, so a little less depth is asked for.
      minDepth: Math.min(t.minDepth, size === 3 ? 6 : 9),
      maxDepth: t.maxDepth,
      seed,
    };
  }
  const t = TIERS[tier];
  const sizeRng = createRng(hashSeed('size', level));
  return {
    level,
    size: shape ? shapeSize(shape) : sizeRng.pick(t.sizes),
    shape,
    tier,
    maxErrors: shape ? 0 : errorLimit(level, tier),
    minLength: shape ? 1 : 2, // single cells fill the thin parts of a picture
    maxLength: t.maxLength,
    bendChance: t.bendChance,
    // Pictures are filled more so the figure reads, and ask for fewer rounds (fewer cells).
    fill: shape ? 0.92 : t.fill,
    minDepth: shape ? Math.min(t.minDepth, 8) : t.minDepth,
    maxDepth: shape ? t.maxDepth + 4 : t.maxDepth,
    doubleChance: !shape && level >= DOUBLES_FROM && tier !== 'easy' ? 0.12 : 0,
    turns: !shape && level >= TURNS_FROM ? TURNS[tier] : 0,
    holes: !shape && level >= HOLES_FROM ? HOLES[tier] : 0,
    seed,
  };
}
