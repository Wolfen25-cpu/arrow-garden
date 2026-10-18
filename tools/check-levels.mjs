// Sanity check for the level generator. Run with: node tools/check-levels.mjs [count]
// Verifies every level is solvable, deterministic and well-formed.

import { generateLevel } from '../js/generator.js';
import { levelConfig } from '../js/levels.js';
import { DIRS, buildGrid, solve } from '../js/game.js';

const count = Number(process.argv[2] ?? 30);
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

  if (!solve(size, arrows).solvable) fail(level, 'sin solución');
  if (JSON.stringify(generateLevel(level)) !== JSON.stringify(data)) fail(level, 'no determinista');

  const grid = buildGrid(size, []);
  for (const arrow of arrows) {
    if (arrow.cells.length < 1 || arrow.cells.length > 4) fail(level, `largo inválido ${arrow.cells.length}`);
    for (let i = 0; i < arrow.cells.length; i++) {
      const c = arrow.cells[i];
      if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) fail(level, 'celda fuera del tablero');
      if (data.mask && !data.mask[c.y * size + c.x]) fail(level, 'celda fuera de la figura');
      if (grid[c.y * size + c.x] !== -1) fail(level, 'flechas superpuestas');
      grid[c.y * size + c.x] = arrow.id;
      if (i > 0) {
        const p = arrow.cells[i - 1];
        if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) !== 1) fail(level, 'cuerpo no contiguo');
      }
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
  console.log(
    `nivel ${String(level).padStart(2)}  ${size}×${size}  flechas ${String(arrows.length).padStart(2)}` +
      `  curvas ${String(bent).padStart(2)}  cobertura ${Math.round((covered / open) * 100)}%` +
      `  profundidad ${data.depth}/${cfg.minDepth}  ${ms.toFixed(0)} ms` +
      (data.shape ? `  figura ${data.shape}` : '') +
      (data.maxErrors ? `  errores ${data.maxErrors}` : ''),
  );
}

if (failures) {
  console.error(`\n${failures} problema(s) encontrados`);
  process.exit(1);
}
console.log('\nTodos los niveles tienen solución y son deterministas.');
