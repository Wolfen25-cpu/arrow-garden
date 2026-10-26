// Sanity check for the level generator. Run with: node tools/check-levels.mjs [count]
// Verifies every level is solvable, deterministic and well-formed.

import { generateLevel } from '../js/generator.js';
import { levelConfig } from '../js/levels.js';
import { DIRS, buildGrid, exitPath, reversed, solve } from '../js/game.js';
import { exitPath3, solidId, solve3, surface } from '../js/game3d.js';

const count = Number(process.argv[2] ?? 100);
let failures = 0;

const fail = (level, message) => {
  failures++;
  console.error(`  ✗ nivel ${level}: ${message}`);
};

for (let level = 1; level <= count; level++) {
  const started = performance.now();
  const data = generateLevel(level);
  const ms = performance.now() - started;
  const cfg = levelConfig(level);
  const { size, arrows } = data;

  if (data.is3d) {
    const solid = solidId(data);
    const geo = surface(solid);
    if (!solve3(solid, arrows).solvable) fail(level, 'sin solución');
    if (JSON.stringify(generateLevel(level)) !== JSON.stringify(data)) fail(level, 'no determinista');
    const used = new Set();
    for (const arrow of arrows) {
      if (arrow.cells.length < 1 || arrow.cells.length > cfg.maxLength) fail(level, `largo inválido ${arrow.cells.length}`);
      if (!exitPath3(solid, arrow)) fail(level, 'una pared bloquea la salida');
      arrow.cells.forEach((c, i) => {
        if (!Number.isInteger(c) || c < 0 || c >= geo.cellCount) fail(level, 'celda fuera del cubo');
        if (used.has(c)) fail(level, 'flechas superpuestas');
        used.add(c);
        if (i > 0 && !geo.inPlane(arrow.cells[i - 1]).some((d) => geo.step(arrow.cells[i - 1], d).cell === c)) {
          fail(level, 'cuerpo no contiguo');
        }
      });
      if (!geo.inPlane(arrow.cells[arrow.cells.length - 1]).includes(arrow.dir)) fail(level, 'la cabeza no va por su cara');
      if (arrow.cells.length > 1) {
        const [a, b] = arrow.cells.slice(-2);
        const reached = geo.inPlane(a).map((d) => geo.step(a, d)).find((r) => r.cell === b);
        if (reached?.dir !== arrow.dir) fail(level, 'la cabeza no apunta en su dirección');
      }
    }
    const crossing = arrows.filter((a) => new Set(a.cells.map((c) => geo.faceOf(c))).size > 1).length;
    console.log(
      `nivel ${String(level).padStart(2)}  ${solid} ${geo.dims.join('×')}  flechas ${String(arrows.length).padStart(2)}` +
        `  cruzan arista ${String(crossing).padStart(2)}  cobertura ${Math.round((used.size / geo.cellCount) * 100)}%` +
        `  profundidad ${data.depth}/${cfg.minDepth}  ${ms.toFixed(0)} ms  ${cfg.tier}  3D`,
    );
    continue;
  }

  const obstacles = data.obstacles ?? [];
  if (!solve(size, arrows, obstacles).solvable) fail(level, 'sin solución');
  if (JSON.stringify(generateLevel(level)) !== JSON.stringify(data)) fail(level, 'no determinista');

  const grid = buildGrid(size, []);
  for (const o of obstacles) {
    if (o.x < 0 || o.y < 0 || o.x >= size || o.y >= size) fail(level, 'obstáculo fuera del tablero');
    if (grid[o.y * size + o.x] !== -1) fail(level, 'obstáculos superpuestos');
    grid[o.y * size + o.x] = -5;
  }
  const paths = buildGrid(size, [], obstacles);
  for (const arrow of arrows) {
    if (arrow.cells.length < 1 || arrow.cells.length > cfg.maxLength) fail(level, `largo inválido ${arrow.cells.length}`);
    for (let i = 0; i < arrow.cells.length; i++) {
      const c = arrow.cells[i];
      if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) fail(level, 'celda fuera del tablero');
      if (data.mask && !data.mask[c.y * size + c.x]) fail(level, 'celda fuera de la figura');
      if (grid[c.y * size + c.x] === -5) fail(level, 'flecha sobre un obstáculo');
      else if (grid[c.y * size + c.x] !== -1) fail(level, 'flechas superpuestas');
      grid[c.y * size + c.x] = arrow.id;
      if (i > 0) {
        const p = arrow.cells[i - 1];
        if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) !== 1) fail(level, 'cuerpo no contiguo');
      }
    }
    if (!exitPath(size, paths, arrow) && !(arrow.both && exitPath(size, paths, reversed(arrow)))) {
      fail(level, 'camino de salida en bucle');
    }
    if (arrow.cells.length > 1) {
      const [a, b] = arrow.cells.slice(-2);
      const { dx, dy } = DIRS[arrow.dir];
      if (b.x - a.x !== dx || b.y - a.y !== dy) fail(level, 'la cabeza no apunta en su dirección');
    }
  }

  const covered = arrows.reduce((n, a) => n + a.cells.length, 0);
  const open = data.mask ? data.mask.reduce((n, v) => n + v, 0) : size * size;
  const bent = arrows.filter((a) => new Set(a.cells.map((c) => c.x)).size > 1 && new Set(a.cells.map((c) => c.y)).size > 1).length;
  const bends = arrows.reduce((n, a) => n + a.cells.slice(2).filter((c, i) => {
    const [p, q] = [a.cells[i], a.cells[i + 1]];
    return c.x - q.x !== q.x - p.x || c.y - q.y !== q.y - p.y;
  }).length, 0);
  const longest = Math.max(...arrows.map((a) => a.cells.length));
  console.log(
    `nivel ${String(level).padStart(2)}  ${size}×${size}  flechas ${String(arrows.length).padStart(2)}` +
      `  curvas ${String(bent).padStart(2)}/${String(bends).padStart(2)}  máx ${longest}  cobertura ${Math.round((covered / open) * 100)}%` +
      `  profundidad ${data.depth}/${cfg.minDepth}  ${ms.toFixed(0)} ms` +
      `  ${cfg.tier}` +
      (data.shape ? `  figura ${data.shape}` : '') +
      (data.maxErrors ? `  errores ${data.maxErrors}` : '') +
      (arrows.some((a) => a.both) ? `  dobles ${arrows.filter((a) => a.both).length}` : '') +
      (obstacles.length ? `  obstáculos ${obstacles.map((o) => (o.kind === 'hole' ? 'O' : '↻')).join('')}` : ''),
  );
}

if (failures) {
  console.error(`\n${failures} problema(s) encontrados`);
  process.exit(1);
}
console.log('\nTodos los niveles tienen solución y son deterministas.');
