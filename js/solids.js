// 3D level shapes: solids built from unit cubes in an X×Y×Z box (y points up).
// The board is the solid's outer surface, one cell per exposed cube face.

const box = (dims, carve = () => false) => ({ dims, filled: (x, y, z) => !carve(x, y, z) });
const inside = (c, lo, hi) => c >= lo && c <= hi;

const SOLIDS = {
  tower: box([3, 5, 3]),
  slab: box([5, 5, 2]),
  notch: box([4, 4, 4], (x, y, z) => x >= 2 && y >= 2 && z >= 2),
  brick: box([6, 3, 4]),
  frame: box([5, 5, 2], (x, y) => inside(x, 1, 3) && inside(y, 1, 3)),
  stairs: box([4, 4, 4], (x, y, z) => y >= 4 - z),
  arch: box([6, 4, 3], (x, y) => inside(x, 2, 3) && y <= 1),
  plus: box([6, 6, 3], (x, y) => !inside(x, 2, 3) && !inside(y, 2, 3)),
  tunnel: box([5, 5, 4], (x, y) => inside(x, 1, 3) && inside(y, 1, 3)),
  // A stepped pyramid: each layer two cells narrower than the one below.
  pyramid: box([6, 3, 6], (x, y, z) => Math.min(x, z, 5 - x, 5 - z) < y),
  // Tunnels along all three axes: the last level.
  menger: box([6, 6, 6], (x, y, z) => [x, y, z].filter((c) => inside(c, 2, 3)).length >= 2),
};

// Second-act order of the solids; the last one closes the game.
export const SOLID_ORDER = [
  'tower', 'slab', 'notch', 'brick', 'frame', 'stairs', 'arch', 'plus', 'tunnel', 'pyramid', 'menger',
];

// `cube3`, `cube4`… are plain cubes (the first act's 3D levels).
export function solidOf(id) {
  const cube = /^cube(\d+)$/.exec(id);
  if (cube) {
    const n = Number(cube[1]);
    return box([n, n, n]);
  }
  return SOLIDS[id];
}
