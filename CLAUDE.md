# CLAUDE.md

Arrow Garden (arrow-garden): a relaxing arrow puzzle for the browser, published on GitHub Pages.

## Project rules

- **No build step, no frameworks, no npm dependencies.** Plain HTML, CSS and ES modules that run
  as-is from GitHub Pages. Do not add a bundler, TypeScript or a `package.json` for runtime code.
- **Relaxing by design**: no timers. A blocked move bounces and costs only a move on the counter,
  except on the few levels with an error limit (`maxErrors`, see `levels.js`): there a bump also
  uses up a heart, and running out just restarts the same board. Keep limits rare and gentle.
  The tutorial never has a limit.
- **Every generated level must be solvable.** Any generator change must keep `solve()` passing;
  run `node tools/check-levels.mjs 150` before committing.
- **Levels are deterministic**: level N always produces the same board (seeded RNG). Levels
  1–100 are pinned by `ACT_ONE` in `levels.js`; new options only roll the RNG when a level uses them. Never use
  `Math.random()` in `generator.js`, `levels.js` or `game.js` (it is fine in `render.js` for particles).
- **User-facing text is in Spanish and English**, all of it in `js/i18n.js` (`t(key, params)`).
  Never hard-code a visible string: add the key to **both** `es` and `en`. Static HTML uses
  `data-i18n` (text) / `data-i18n-aria` (aria-label); Spanish stays in the HTML as the fallback.
  Code, identifiers and comments are in English.
- **Mobile first and accessible**: touch targets ≥ 48px, honour `prefers-reduced-motion`
  (`renderer.calm`), keep text contrast in both themes, label icon buttons with `aria-label`.
- **Offline-first saves**: localStorage is the source of truth; the cloud is optional and must
  never block or break play. The game must work with an empty `firebase-config.js`.
- **CSP**: `index.html` has a Content-Security-Policy. No inline scripts or styles, and no new
  third-party origins (fonts, CDNs) unless the CSP is updated on purpose.
- Small, focused commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`).

## Architecture

```
main.js ── wires everything; owns `state` (progress + settings), the current `Game` (or
  │          `Game3D`), the active renderer (`flat` 2D or `cube` 3D, swapped by `useRenderer`)
  │          and `mode`: 'home' (start screen) | 'levels' (level grid) | 'play' | 'tutorial'
  │          Flow: Inicio → Jugar → Niveles → level. `maxLevel` is the first level not yet
  │          completed (can be LEVEL_COUNT + 1), so completed = maxLevel - 1.
  ├─ tutorial.js ─── fixed 3×3 board + scripted steps (target arrow, expected result, text)
  ├─ generator.js ── generateLevel(n) → { level, size, arrows, depth, shape, mask, maxErrors,
  │    │              tier, obstacles }; 3D levels delegate to generator3d.js (`is3d`, `solid`)
  │    ├─ levels.js   levelConfig(n): size, shape, tier, maxErrors, arrow lengths, bends, bend
  │    │              chance, fill, min/max depth, doubleChance, turns, holes, is3d/solid, seed.
  │    │              1–10 intro; then a seeded tier per level (easy | medium | hard | expert),
  │    │              harder tiers likelier towards 100. Second act 101–150: hard | expert |
  │    │              master only, arrows up to 7 cells with up to 3 bends
  │    ├─ generator3d.js  arrows on a solid's surface (bodies may cross edges)
  │    ├─ solids.js   voxel solids for 3D levels: cube3/cube4, boxes, shapes with holes
  │    ├─ shapes.js   ASCII pictures (heart, house, wolf…) → shapeMask(id, size)
  │    └─ rng.js      createRng(seed), hashSeed(...)
  ├─ game.js ─────── pure model (no DOM): Game, solve(), exitPath(), exitWay(), reversed(), DIRS
  ├─ game3d.js ───── pure 3D model: surface(solid) geometry, Game3D (same interface as Game), solve3()
  ├─ render.js ───── Canvas 2D renderer; animations only, never mutates the game
  ├─ render3d.js ─── Canvas 2D orthographic view of the solid, cell by cell; drag/arrow keys turn it
  ├─ input.js ────── pointer tap → renderer.pick() → arrow id; drag → renderer.rotate()
  ├─ audio.js ────── Web Audio synth (Sound) + vibrate()
  ├─ ui.js ───────── DOM: home screen, top bar, controls, tutorial coach, settings dialog,
  │                  win overlay, keyboard shortcuts; translate() redraws texts
  ├─ i18n.js ─────── STRINGS.es / .en, t(), setLang(), shapeName()
  ├─ storage.js ──── localStorage load/save, sanitize(), mergeProgress()
  └─ account.js ──── account dialog → cloud.js (Firebase, lazy-loaded from gstatic CDN)
```

### Core model

- An arrow is `{ id, cells, dir, color, both? }`. `cells` runs **tail → head**, 1–4 cells, straight
  or with one 90° bend (levels 1–100); from 101 up to 7 cells and `bends` bends, each straight
  run ≥ 2 cells (`bendPlan` in generator.js). `dir` is the head direction (`up | right | down | left`). `color` is a
  palette index (0–11); the actual colours live in `render.js` (`PALETTES.light` / `.dark`).
  `both` marks a double arrow that may also leave tail first (`reversed()`). A tap sends it
  towards the end nearest the touch (`nearTail()` on `renderer.boardPoint()`), bumping if
  that way is blocked; the solver and hints treat it as free when either end is (`exitWay()`).
- Arrows move like a snake: the body follows the head. So **only the path from the head**
  decides whether an arrow can leave (`exitPath` + `blockIndex`).
- Obstacles `{ x, y, kind: 'turn' | 'hole', dir? }` are fixed cells encoded in the grid
  (`buildGrid(size, arrows, obstacles)`): a turn redirects the path, a hole ends it. A path
  that loops or meets a turn head-on is `null` (never removable; the generator rejects it).
- **Invariant:** removing an arrow only frees cells, so the greedy round-by-round solver in
  `solve()` is complete. Every new mechanic must keep this true. `depth` (rounds) measures difficulty.
- 3D levels: the board is the surface of a voxel solid (`solids.js`; `cube3`/`cube4` are the old
  cube levels), one cell per exposed cube face, numbered by orientation, layer, v, u (on a cube
  exactly `face·N² + v·N + u`, so the old boards never changed). Arrows are `{ id, cells, dir,
  color }` like flat ones, but `dir` is a 3D axis name (`x± | y± | z±`) and bodies may run over
  an edge: `surface(id).step()` climbs a wall (concave), goes on across the plane, or over the
  rim (convex). An arrow leaves straight across its flat stretch and off the rim (`exitPath3`);
  a wall in the way makes the path `null` (never removable; the generator rejects it). Same
  invariant and solver shape (`solve3`).
- `Game.tap(id)` returns `{ type: 'exit' | 'blocked', arrow, distance, path, hole? }` (or `null`
  once `isLost`); `arrow` is the moving version (reversed for a double backing out). A bump increments `errors`; undo never refunds it, restart resets it. The model updates
  immediately; the renderer keeps exiting arrows alive as ghost animations, so players can tap
  quickly. Undo is a stack of `{ arrows, moves }` snapshots.

### Generator

Arrows are added one by one at random empty cells (preferring long rays) and kept only if the
board stays solvable and its depth stays ≤ `maxDepth` (keeps easy levels easy). Several seeded
attempts per level; the first within `minDepth`–`maxDepth` wins, otherwise the best fit. Then neighbours get distinct colours.

Obstacles are placed first on inner cells (never touching), then arrows are generated around
them. Every special roll (doubles, obstacles) only happens when the level has that mechanic, so
other levels keep their exact boards.

Special levels: pictures every 4th from 11 (100 = dragon), error limits on ≡ 1 mod 4 from 13,
3D on 14, 24 … 94, doubles from 21, turns from 31, holes from 41 (never on pictures or 3D).
Second act: solids on 104, 108, 114, 118 … 148 and the finale 150 (`menger`). Winding levels
(`bends` > 1) get 3× the attempts, favour long bodies and fill gaps with a pass of short arrows.
The first time a mechanic appears on a device, `introduceLevel()` explains it (`state.tips`).

Picture levels pass a `mask` (flat 0/1 array): cells outside it are walled off during
generation, coverage is measured against the mask, and attempts must also cover ≥ 85% of it
so the figure reads. The renderer draws the board as the mask's silhouette. Rays still run
to the real board edge, through the empty cells outside the picture.

### Rendering

- Board geometry is in **cell units**; `toPx()` converts. Each arrow travels along a *track*
  (virtual point behind the tail → its cells → its exit path, turns included → straight on),
  so a slide is just an offset along the track. Head directions come from the track
  (`trackDir`); an arrow entering a hole is clipped at the hole (`paintArrow`).
- Both renderers expose the same API (`setGame`, `playExit(result)`, `playBounce(result)`,
  `showHint`, `clearHint`, `requestDraw`, `readTheme`, `calm`, `pick`, `tapSlop`); the 3D one
  adds `rotate(dx, dy)`. The inactive renderer holds `game = null` and draws nothing.
- 3D: only cells turned towards the camera are drawn, far to near (solids with holes are not
  convex). Each cell is painted through its own affine transform and clipped to itself (grown
  by `SEAM` px so neighbours show no seam; a nearer cell repaints the overlap). Arrows are flat
  2D arrows on the surface and never stick out. Tracks are sampled every half cell; a segment
  on a cell round an edge is unfolded flat past that edge (`unfolder`), where the clip hides
  it; only cells in `near[cell]` count. `pick()` inverts each visible cell's parallelogram,
  nearest first, so it does not depend on the last frame.
- 3D colours: light shading and arrow shadows are mixed into opaque colours (`tint()`), never
  laid over as translucent films, which would double up along cell edges and show as lines.
  Cells wholly hidden behind the solid (`hidden()`, a ray per corner) are not painted either,
  for the same reason. `visibleCells()` is cached per orientation.
- 3D zoom: pinch (two fingers also move the view), mouse wheel, the +/− buttons (`#zoom`, 3D
  levels only) and the + − 0 keys. `zoomBy(factor, x, y)` keeps that screen point still; the
  pan is clamped so the solid never leaves the board. Zoom resets with each level.
- 3D turning is a trackball: `orientation` is a rotation matrix and each drag pre-multiplies
  a turn about the screen axes, so the solid always follows the finger. Speed scales with the
  solid's size on screen (`TURN_PER_DIAMETER`).
- The rAF loop runs only while something animates (`requestDraw()`).
- Theme colours come from CSS custom properties (`--board`, `--board-edge`, `--dot`); call
  `renderer.readTheme()` after changing `data-theme`.

### Persistence

- localStorage key `arrowGarden.v1`. Always go through `sanitize()` when reading untrusted data
  (stored JSON or cloud documents).
- On completing a level the saved `level` already points to the next one, so a reload continues.
- Cloud: Firestore document `users/{uid}` with the fields listed in `SYNCED` (`cloud.js`).
  **If you add a synced field, update `firestore.rules` (`validProgress`) too.**
- `lang` and `tutorialDone` are device-only: saved locally, never synced (adding them to the
  cloud would need a `firestore.rules` change and a republish of the rules).
- Merge rule: `maxLevel` = max of both; `level` from the newer `progressAt`; settings from the
  newer `settingsAt`.

## Conventions

- 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- Modules export plain functions or a small class; no globals. DOM lookups by `id` live in
  `ui.js` / `account.js` only.
- Every `localStorage` access is wrapped in try/catch.
- Comments explain *why*, not *what*; keep them short.

## Commands

```bash
python -m http.server 8000         # serve locally (ES modules need http://)
node tools/check-levels.mjs 150    # verify levels: solvable, deterministic, well-formed
```

Changing `LEVEL_COUNT` in `levels.js` lengthens the second act (its tiers are weighted over
101…`LEVEL_COUNT`, so those boards change); levels 1–100 stay fixed by `ACT_ONE`.
