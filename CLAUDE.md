# CLAUDE.md

Arrow Garden (arrow-garden): a relaxing arrow puzzle for the browser, published on GitHub Pages.

## Project rules

- **No build step, no frameworks, no npm dependencies.** Plain HTML, CSS and ES modules that run
  as-is from GitHub Pages. Do not add a bundler, TypeScript or a `package.json` for runtime code.
- **Relaxing by design**: no timers, no lives, no fail states. A blocked move bounces and costs
  nothing but a move on the counter.
- **Every generated level must be solvable.** Any generator change must keep `solve()` passing;
  run `node tools/check-levels.mjs 30` before committing.
- **Levels are deterministic**: level N always produces the same board (seeded RNG). Never use
  `Math.random()` in `generator.js`, `levels.js` or `game.js` (it is fine in `render.js` for particles).
- **All user-facing text is in Spanish.** Code, identifiers and comments are in English.
- **Mobile first and accessible**: touch targets ≥ 48px, honour `prefers-reduced-motion`
  (`renderer.calm`), keep text contrast in both themes, label icon buttons with `aria-label`.
- **Offline-first saves**: localStorage is the source of truth; the cloud is optional and must
  never block or break play. The game must work with an empty `firebase-config.js`.
- **CSP**: `index.html` has a Content-Security-Policy. No inline scripts or styles, and no new
  third-party origins (fonts, CDNs) unless the CSP is updated on purpose.
- Small, focused commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`).

## Architecture

```
main.js ── wires everything; owns `state` (progress + settings), the current `Game`
  │          and `mode`: 'home' (start screen) | 'levels' (level grid) | 'play' | 'tutorial'
  │          Flow: Inicio → Jugar → Niveles → level. `maxLevel` is the first level not yet
  │          completed (can be LEVEL_COUNT + 1), so completed = maxLevel - 1.
  ├─ tutorial.js ─── fixed 3×3 board + scripted steps (target arrow, expected result, text)
  ├─ generator.js ── generateLevel(n) → { level, size, arrows, depth }
  │    ├─ levels.js   levelConfig(n): size, arrow lengths, bend chance, fill, min depth, seed
  │    └─ rng.js      createRng(seed), hashSeed(...)
  ├─ game.js ─────── pure model (no DOM): Game, solve(), freeArrows(), rayCells(), DIRS
  ├─ render.js ───── Canvas 2D renderer; animations only, never mutates the game
  ├─ input.js ────── pointer tap → board cell
  ├─ audio.js ────── Web Audio synth (Sound) + vibrate()
  ├─ ui.js ───────── DOM: home screen, top bar, controls, tutorial coach, settings dialog,
  │                  win overlay, keyboard shortcuts
  ├─ storage.js ──── localStorage load/save, sanitize(), mergeProgress()
  └─ account.js ──── account dialog → cloud.js (Firebase, lazy-loaded from gstatic CDN)
```

### Core model

- An arrow is `{ id, cells, dir, color }`. `cells` runs **tail → head**, 1–4 cells, straight or
  with one 90° bend. `dir` is the head direction (`up | right | down | left`). `color` is a palette
  index (0–11); the actual colours live in `render.js` (`PALETTES.light` / `.dark`).
- Arrows move like a snake: the body follows the head. So **only the straight ray from the head to
  the edge** decides whether an arrow can leave (`blockIndex`).
- Removing an arrow only frees cells, so the greedy round-by-round solver in `solve()` is complete.
  `depth` (number of rounds) measures difficulty.
- `Game.tap(id)` returns `{ type: 'exit' | 'blocked', arrow, distance }`. The model updates
  immediately; the renderer keeps exiting arrows alive as ghost animations, so players can tap
  quickly. Undo is a stack of `{ arrows, moves }` snapshots.

### Generator

Arrows are added one by one at random empty cells (preferring long rays) and kept only if the
board stays solvable. Several seeded attempts per level; the first that reaches `minDepth` wins,
otherwise the most tangled one. Then neighbours get distinct colours.

### Rendering

- Board geometry is in **cell units**; `toPx()` converts. Each arrow travels along a *track*
  (virtual point behind the tail → its cells → straight past the head), so a slide is just an
  offset along the track.
- The rAF loop runs only while something animates (`requestDraw()`).
- Theme colours come from CSS custom properties (`--board`, `--board-edge`, `--dot`); call
  `renderer.readTheme()` after changing `data-theme`.

### Persistence

- localStorage key `arrowGarden.v1`. Always go through `sanitize()` when reading untrusted data
  (stored JSON or cloud documents).
- On completing a level the saved `level` already points to the next one, so a reload continues.
- Cloud: Firestore document `users/{uid}` with the fields listed in `SYNCED` (`cloud.js`).
  **If you add a synced field, update `firestore.rules` (`validProgress`) too.**
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
node tools/check-levels.mjs 30     # verify levels: solvable, deterministic, well-formed
```

Changing `LEVEL_COUNT` in `levels.js` adds levels; the curve keeps going and caps at 10×10.
