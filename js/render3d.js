// Canvas 2D renderer for 3D levels: the surface of a solid (a cube, a box, a shape with
// holes), seen through an orthographic camera the player turns by dragging. Same public
// API as Renderer (render.js), so main.js can swap them. Like Renderer, it never changes
// game state: an arrow that has left the model keeps sliding here as a ghost until it fades.
//
// Each visible cell is drawn through its own affine transform, so arrows are flat 2D
// arrows painted on the surface (foreshortened with it) and clipped to the cell: nothing
// sticks out whichever way the solid is turned. Solids with holes are not convex, so
// cells are painted far to near. Tracks are sampled every half cell, so a body bending
// over an edge has a point on that edge; seen from one cell, the part on a cell round an
// edge is unfolded flat beyond that edge, where the clip hides it.

import { DIRS3, DIR3_NAMES, surface } from './game3d.js';
import { PALETTES } from './render.js';

// Arrow geometry, in cells (same proportions as the flat boards).
const SHAFT = 0.32;
const TAIL_INSET = 0.3;
const HEAD_LENGTH = 0.36;
const HEAD_HALF_WIDTH = 0.3;

const LIGHT = normalize([-0.45, 0.75, 0.55]); // in view space
const HINT_DURATION = 3200;
// Dragging across the whole solid (its diameter on screen) turns it about this far.
const TURN_PER_DIAMETER = 2.6; // radians
// Cells are filled and clipped a little past their outline, so neighbours never show a seam.
const SEAM = 0.6; // px
// Zooming in makes small cells big enough to tap on a phone.
const MAX_ZOOM = 3.5;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const bounceCurve = (p) => (p < 0.35 ? easeOutCubic(p / 0.35) : 1 - easeOutBack((p - 0.35) / 0.65));

function normalize([x, y, z]) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nameOf = (d) => DIR3_NAMES.find((k) => DIRS3[k].every((c, i) => c === d[i]));

// 3×3 rotation matrices as arrays of rows.
const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const rotX = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const rotY = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const apply = (m, v) => m.map((row) => dot(row, v));

// Gram–Schmidt, so rounding errors from many small turns never skew the solid.
function orthonormal([r0, r1]) {
  const a = normalize(r0);
  const b = normalize(add(r1, a, -dot(r1, a)));
  return [a, b, [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]];
}

// Starting view: a little from above and to the side, so three sides show.
const START_VIEW = mul(rotX(0.5), rotY(-0.62));

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.geo = null;
    this.near = null; // per cell: the cells whose arrows may show on it
    this.anims = new Map(); // arrow id → slide or bounce animation
    this.tracks = new WeakMap(); // resting tracks, cached per arrow
    this.hint = null;
    this.intro = null;
    this.raf = 0;
    this.w = 0;
    this.h = 0;
    this.orientation = START_VIEW;
    this.zoom = 1;
    this.pan = [0, 0]; // screen px the solid's centre is moved by while zoomed
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  get calm() {
    return this.motionQuery.matches;
  }

  // How far a finger may wander and still count as a tap (dragging turns the solid).
  get tapSlop() {
    return 10;
  }

  readTheme() {
    const style = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme === 'dark';
    this.colors = {
      board: style.getPropertyValue('--board').trim(),
      edge: style.getPropertyValue('--board-edge').trim(),
      dot: style.getPropertyValue('--dot').trim(),
      shade: dark ? [0, 0, 0] : [90, 64, 30],
      shadow: dark ? { rgb: [0, 0, 0], a: 0.35 } : { rgb: [90, 64, 30], a: 0.16 },
      palette: dark ? PALETTES.dark : PALETTES.light,
    };
    this.tints = new Map(); // shaded colours, cached by colour and shade
    this.requestDraw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.layout();
    this.requestDraw();
  }

  layout() {
    if (!this.game) return;
    // Seen from any angle the solid spans at most its bounding box's diagonal.
    this.scale = (this.zoom * Math.min(this.w, this.h) * 0.94) / Math.hypot(...this.geo.dims);
    // Zoomed in, the centre may move just far enough for every edge to reach the middle.
    const reach = (this.zoom - 1) * 0.5;
    this.pan = [
      Math.max(-reach * this.w, Math.min(reach * this.w, this.pan[0])),
      Math.max(-reach * this.h, Math.min(reach * this.h, this.pan[1])),
    ];
    this.ox = this.w / 2 + this.pan[0];
    this.oy = this.h / 2 + this.pan[1];
  }

  // Zooms by `factor` keeping the point (x, y) on screen still (the centre by default).
  zoomBy(factor, x = this.w / 2, y = this.h / 2) {
    if (!this.game) return;
    const zoom = Math.max(1, Math.min(MAX_ZOOM, this.zoom * factor));
    const k = zoom / this.zoom;
    this.pan = [(this.pan[0] + this.w / 2 - x) * k + x - this.w / 2, (this.pan[1] + this.h / 2 - y) * k + y - this.h / 2];
    this.zoom = zoom;
    this.layout();
    this.requestDraw();
  }

  // Moves the zoomed view by (dx, dy) screen px.
  panBy(dx, dy) {
    if (!this.game) return;
    this.pan = [this.pan[0] + dx, this.pan[1] + dy];
    this.layout();
    this.requestDraw();
  }

  resetZoom() {
    this.zoom = 1;
    this.pan = [0, 0];
    this.layout();
    this.requestDraw();
  }

  setGame(game, { entrance = true } = {}) {
    this.game = game;
    this.geo = game ? surface(game.solid) : null;
    this.near = game ? this.neighbourhoods() : null;
    this.anims.clear();
    this.tracks = new WeakMap();
    this.hint = null;
    this.orientation = START_VIEW;
    this.zoom = 1;
    this.pan = [0, 0];
    this.intro = game && entrance && !this.calm ? { start: performance.now() } : null;
    this.layout();
    this.requestDraw();
  }

  // Trackball turn: the solid follows the finger whatever way it is facing. A horizontal
  // drag spins it around the screen's vertical axis, a vertical drag around the screen's
  // horizontal axis (screen y grows downwards, view y upwards, hence the sign).
  rotate(dx, dy) {
    // Speed follows the solid's size on screen, so it feels like grabbing its surface.
    const radius = (this.scale * Math.hypot(...this.geo.dims)) / 2;
    const k = TURN_PER_DIAMETER / (2 * radius);
    const turn = mul(rotY(dx * k), rotX(dy * k));
    this.orientation = orthonormal(mul(turn, this.orientation));
    this.requestDraw();
  }

  // World (the solid's box from the origin) → view space; the viewer looks down −z.
  view(p) {
    const { dims } = this.geo;
    return apply(this.orientation, [p[0] - dims[0] / 2, p[1] - dims[1] / 2, p[2] - dims[2] / 2]);
  }

  viewDir(d) {
    return apply(this.orientation, d);
  }

  screen(p) {
    const [x, y] = this.view(p);
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  // For every cell, the cells whose track segments can show on it: itself, the four
  // cells round its sides and the flat diagonal ones (an arrowhead pokes past a corner).
  neighbourhoods() {
    const { geo } = this;
    return geo.cells.map((_, cell) => {
      const set = new Set([cell]);
      for (const d of geo.inPlane(cell)) {
        const next = geo.step(cell, d);
        set.add(next.cell);
        if (next.edge) continue;
        for (const side of geo.inPlane(next.cell)) {
          if (side[0] === d[0]) continue;
          const corner = geo.step(next.cell, side);
          if (!corner.edge) set.add(corner.cell);
        }
      }
      return set;
    });
  }

  // Cells turned towards the viewer, far to near: the order to paint them in.
  // Cached per orientation: it only changes when the solid turns.
  visibleCells() {
    if (this.visible?.orientation === this.orientation && this.visible.geo === this.geo) return this.visible.cells;
    const { geo } = this;
    const depth = geo.cells.map((_, cell) => this.view(geo.centre(cell))[2]);
    const cells = geo.cells
      .map((_, cell) => cell)
      .filter((cell) => this.viewDir(geo.cells[cell].normal)[2] > 0.02 && !this.hidden(cell))
      .sort((a, b) => depth[a] - depth[b]);
    this.visible = { orientation: this.orientation, geo, cells };
    return cells;
  }

  // Whether a cell lies wholly behind other parts of the solid (inside a tunnel, say).
  // Such a cell would be painted over anyway, but its colour would still seep through
  // the soft edges between the cells in front, so it is not painted at all. A cell counts
  // as hidden when its centre and four points near its corners are all blocked.
  hidden(cell) {
    const { geo } = this;
    const { corner, u, v, normal } = geo.cells[cell];
    const toward = this.orientation[2]; // the viewer's direction, in world space
    const { dims } = geo;
    const limit = Math.hypot(...dims);
    const blocked = (a, b) => {
      let p = add(add(add(corner, u, a), v, b), normal, 0.01);
      for (let t = 0; t < limit; t += 0.2) {
        p = add(p, toward, 0.2);
        const voxel = p.map(Math.floor);
        if (voxel.some((c, i) => c < 0 || c >= dims[i])) return false;
        if (geo.solid(voxel)) return true;
      }
      return false;
    };
    return [[0.5, 0.5], [0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]].every(([a, b]) => blocked(a, b));
  }

  // Screen corners of a cell: its corner, and the ends of its u and v sides.
  cellFrame(cell) {
    const { corner, u, v } = this.geo.cells[cell];
    return [this.screen(corner), this.screen(add(corner, u)), this.screen(add(corner, v))];
  }

  // The arrow under a point: the nearest visible cell it lands on. A cell seen
  // orthographically is a parallelogram, so this is a 2×2 inverse.
  pick(px, py) {
    if (!this.game) return null;
    for (const cell of this.visibleCells().slice().reverse()) {
      const [[ax, ay], [bx, by], [cx, cy]] = this.cellFrame(cell);
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(det) < 1e-6) continue;
      const s = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
      const t = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / det;
      if (s < 0 || t < 0 || s >= 1 || t >= 1) continue;
      return this.game.arrowAtCell(cell)?.id ?? null;
    }
    return null;
  }

  playExit({ arrow, path }) {
    const travel = path.length + arrow.cells.length + 0.6;
    this.anims.set(arrow.id, {
      type: 'exit',
      arrow,
      track: this.buildTrack(arrow, path, travel),
      travel,
      edgeAt: path.length + 0.5, // offset at which the head slides off the rim
      start: performance.now(),
      duration: this.calm ? 140 : Math.min(900, 300 + travel * 55),
    });
    if (this.hint?.id === arrow.id) this.hint = null;
    this.requestDraw();
  }

  playBounce({ arrow, distance, path }) {
    this.anims.set(arrow.id, {
      type: 'bounce',
      arrow,
      track: this.buildTrack(arrow, path.slice(0, distance + 1)),
      reach: this.calm ? 0.08 : distance + 0.18,
      start: performance.now(),
      duration: this.calm ? 160 : 380 + distance * 40,
    });
    this.requestDraw();
  }

  showHint(arrow, { persistent = false } = {}) {
    this.hint = { id: arrow.id, start: performance.now(), persistent };
    this.requestDraw();
  }

  clearHint() {
    this.hint = null;
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      this.draw(now);
    });
  }

  // The polyline an arrow travels along, sampled every half cell: a virtual point behind
  // the tail, its cells, its way out, then straight on off the rim. `on[i]` is the cell
  // segment i lies on. Position s (in cells) maps to index 2s; the head rests at s = length.
  buildTrack(arrow, path = [], extra = 0) {
    const { geo } = this;
    const cells = [...arrow.cells, ...path];
    const toward = (a, b) => DIRS3[geo.inPlane(a).find((d) => geo.step(a, d).cell === b)];
    const pts = [];
    const on = [];
    const tail = cells[0];
    const out = cells.length > 1 ? toward(tail, cells[1]) : DIRS3[arrow.dir];
    pts.push(add(geo.centre(tail), out, -1), add(geo.centre(tail), out, -0.5));
    on.push(tail, tail);
    cells.forEach((cell, i) => {
      const p = geo.centre(cell);
      pts.push(p);
      if (i === cells.length - 1) return;
      pts.push(add(p, toward(cell, cells[i + 1]), 0.5)); // a midpoint, or a point on the edge
      on.push(cell, cells[i + 1]);
    });
    const end = cells[cells.length - 1];
    for (let k = 1; k <= 2 * (Math.ceil(extra) + 1); k++) {
      pts.push(add(geo.centre(end), DIRS3[arrow.dir], k * 0.5));
      on.push(end);
    }
    return { pts, on };
  }

  restingTrack(arrow) {
    let track = this.tracks.get(arrow);
    if (!track) {
      track = this.buildTrack(arrow);
      this.tracks.set(arrow, track);
    }
    return track;
  }

  hintState(now) {
    if (!this.hint) return null;
    const elapsed = now - this.hint.start;
    if (!this.hint.persistent && elapsed > HINT_DURATION) {
      this.hint = null;
      return null;
    }
    const pulse = 0.5 - 0.5 * Math.cos((elapsed / 900) * Math.PI * 2);
    const fade = this.hint.persistent ? 1 : 1 - clamp01((elapsed - HINT_DURATION + 600) / 600);
    return { id: this.hint.id, strength: Math.max(0.05, pulse) * fade };
  }

  draw(now) {
    const { ctx, game } = this;
    if (!game || !this.w) return;

    // Work out every arrow's pose first; then each cell paints its share of them.
    let active = false;
    const hint = this.hintState(now);
    if (hint) active = true;
    const poses = [];
    const live = new Set();
    let introDone = true;

    game.arrows.forEach((arrow, index) => {
      live.add(arrow.id);
      let offset = 0;
      let track = this.restingTrack(arrow);
      const anim = this.anims.get(arrow.id);
      if (anim?.type === 'bounce') {
        const p = clamp01((now - anim.start) / anim.duration);
        offset = bounceCurve(p) * anim.reach;
        track = anim.track;
        if (p >= 1) this.anims.delete(arrow.id);
        else active = true;
      } else if (anim) {
        this.anims.delete(arrow.id); // an undo brought an exiting arrow back
      }
      let alpha = 1;
      if (this.intro) {
        alpha = clamp01((now - this.intro.start - index * 22) / 320);
        if (alpha < 1) introDone = false;
      }
      poses.push({ arrow, track, offset, alpha, glow: hint?.id === arrow.id ? hint.strength : 0 });
    });

    if (this.intro) {
      if (introDone) this.intro = null;
      else active = true;
    }

    for (const [id, anim] of this.anims) {
      if (anim.type !== 'exit' || live.has(id)) continue;
      const p = clamp01((now - anim.start) / anim.duration);
      if (p >= 1) {
        this.anims.delete(id); // finished: draw nothing, or a faint last frame would linger
        continue;
      }
      active = true;
      const offset = easeInOutQuad(p) * anim.travel;
      const alpha = 1 - clamp01((offset - anim.edgeAt) / (anim.arrow.cells.length + 0.2));
      poses.push({ arrow: anim.arrow, track: anim.track, offset, alpha, glow: 0 });
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const reach = this.posesByCell(poses);
    const hinted = hint ? poses.find((p) => p.arrow.id === hint.id) : null;
    const hintPath = new Set(hinted ? this.game.pathOf(hinted.arrow) : []);
    const cells = this.visibleCells();
    for (const cell of cells) this.drawUnderlay(cell);
    for (const cell of cells) {
      this.drawCell(cell, reach.get(cell) ?? [], hintPath.has(cell) ? hinted : null, hint);
    }

    if (active) this.requestDraw();
  }

  // Which poses may show on each cell: the cells near every drawn segment of an arrow.
  posesByCell(poses) {
    const reach = new Map();
    for (const pose of poses) {
      const { pts, on } = pose.track;
      const last = pts.length - 2;
      const from = Math.max(0, Math.floor((1 - TAIL_INSET + pose.offset) * 2));
      const to = Math.min(last, Math.floor((pose.arrow.cells.length + pose.offset) * 2));
      const seen = new Set();
      for (let i = from; i <= to; i++) {
        for (const cell of this.near[on[i]]) {
          if (seen.has(cell)) continue;
          seen.add(cell);
          if (!reach.has(cell)) reach.set(cell, []);
          reach.get(cell).push(pose);
        }
      }
    }
    return reach;
  }

  // A cell's screen transform (cell coordinates 0–1 across), how far to grow it by SEAM
  // px along u and v, and how much the light shades it.
  cellView(cell) {
    const [[ax, ay], [bx, by], [cx, cy]] = this.cellFrame(cell);
    const m = [bx - ax, by - ay, cx - ax, cy - ay, ax, ay];
    // The two sides along u are |A×B| / |A| px apart.
    const area = Math.abs(m[0] * m[3] - m[1] * m[2]) || 1;
    const light = Math.max(0, dot(this.viewDir(this.geo.cells[cell].normal), LIGHT));
    return {
      m,
      gu: Math.min(0.1, (SEAM * Math.hypot(m[2], m[3])) / area),
      gv: Math.min(0.1, (SEAM * Math.hypot(m[0], m[1])) / area),
      shade: Math.round(16 * (1 - light)) / 100,
    };
  }

  // `hex` darkened by the light's shade, and then by `film` ({ rgb, a }) if given.
  // Shading and shadows are mixed into opaque colours, not laid over as translucent
  // films: a film doubles up along the soft edges between cells and shows as a line.
  tint(hex, shade, film = null) {
    const key = `${hex}|${shade}|${film ? 'film' : ''}`;
    let rgb = this.tints.get(key);
    if (!rgb) {
      const mix = (a, b, k) => a.map((c, i) => c + (b[i] - c) * k);
      let c = mix([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), this.colors.shade, shade);
      if (film) c = mix(c, film.rgb, film.a);
      rgb = `rgb(${c.map(Math.round).join(', ')})`;
      this.tints.set(key, rgb);
    }
    return rgb;
  }

  // Board colour under a whole grown cell, so the soft edges between cells never let the
  // page show through. Painted for every cell before any of them gets its arrows.
  drawUnderlay(cell) {
    const { ctx, dpr } = this;
    const { m, gu, gv, shade } = this.cellView(cell);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(...m);
    ctx.fillStyle = this.tint(this.colors.board, shade);
    ctx.fillRect(-gu, -gv, 1 + 2 * gu, 1 + 2 * gv);
  }

  // One cell: its board, then its share of the arrows nearby in cell coordinates,
  // clipped to the cell grown by SEAM (so an arrow crossing into the next cell has no
  // gap), then an outline on the sides where the surface folds.
  drawCell(cell, poses, hinted, hint) {
    const { ctx, dpr, geo } = this;
    const info = geo.cells[cell];
    const { m, gu, gv, shade } = this.cellView(cell);
    const local = (shift = 0) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, dpr * shift);
      ctx.transform(...m);
    };

    ctx.save();
    local();
    ctx.fillStyle = this.tint(this.colors.board, shade);
    ctx.fillRect(0, 0, 1, 1);
    ctx.beginPath();
    ctx.rect(-gu, -gv, 1 + 2 * gu, 1 + 2 * gv);
    ctx.clip();

    ctx.fillStyle = this.tint(this.colors.dot, shade);
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.055, 0, Math.PI * 2);
    ctx.fill();

    if (hinted) this.drawPathDot(hinted.arrow, hint.strength, shade);
    const toLocal = this.unfolder(cell);
    for (const pose of poses) {
      const shape = this.arrowShape(pose, cell, toLocal);
      if (shape) this.paintShape(shape, pose, local, shade);
    }
    ctx.restore();

    // Outline the sides where the surface folds. Each side as [start, end] in cell
    // coordinates and the way across it.
    const sides = [
      [[1, 0], [1, 1], info.u],
      [[0, 0], [0, 1], info.u.map((c) => -c)],
      [[0, 1], [1, 1], info.v],
      [[0, 0], [1, 0], info.v.map((c) => -c)],
    ];
    const toScreen = ([x, y]) => [m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    for (const [a, b, d] of sides) {
      if (!geo.step(cell, nameOf(d)).edge) continue;
      ctx.moveTo(...toScreen(a));
      ctx.lineTo(...toScreen(b));
    }
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.colors.edge;
    ctx.stroke();
  }

  // Maps a point lying on cell `from` into `cell`'s coordinates. On the same plane nothing
  // changes; a cell round a fold (a rim or a crease) is unfolded flat beyond that edge,
  // outside the clip. A cell facing the other way never shows here: null.
  unfolder(cell) {
    const here = this.geo.cells[cell];
    return (p, from) => {
      let q = p;
      if (from !== cell) {
        const other = this.geo.cells[from];
        const cosine = dot(other.normal, here.normal);
        if (cosine < -0.5) return null;
        if (cosine < 0.5) {
          const depth = -dot(add(p, here.corner, -1), here.normal);
          q = add(add(p, here.normal, depth), other.normal, depth);
        }
      }
      const rel = add(q, here.corner, -1);
      return [dot(rel, here.u), dot(rel, here.v)];
    };
  }

  // The arrow's body as polylines and its head as a triangle, in `cell` coordinates.
  // Null when no part of it lies near this cell.
  arrowShape({ arrow, track: { pts, on }, offset }, cell, toLocal) {
    const near = this.near[cell];
    const last = pts.length - 2;
    const s0 = 1 - TAIL_INSET + offset;
    const s1 = arrow.cells.length + offset;
    const at = (s) => {
      const i = Math.max(0, Math.min(last, Math.floor(s * 2)));
      return add(pts[i], add(pts[i + 1], pts[i], -1), s * 2 - i);
    };
    const mapped = (p, i) => (near.has(on[i]) ? toLocal(p, on[i]) : null);

    const runs = [];
    let run = null;
    for (let i = Math.max(0, Math.floor(s0 * 2)); i <= Math.min(last, Math.ceil(s1 * 2) - 1); i++) {
      const a = Math.max(s0, i / 2);
      const b = Math.min(s1, (i + 1) / 2);
      if (b <= a) continue;
      const pa = mapped(at(a), i);
      const pb = pa && mapped(at(b), i);
      if (!pb) {
        run = null;
        continue;
      }
      if (!run) {
        run = [pa];
        runs.push(run);
      }
      run.push(pb);
    }

    let head = null;
    const hi = Math.max(0, Math.min(last, Math.floor(s1 * 2)));
    const p = mapped(at(s1), hi);
    if (p) {
      const ahead = toLocal(add(at(s1), add(pts[hi + 1], pts[hi], -1), 2), on[hi]);
      const len = Math.hypot(ahead[0] - p[0], ahead[1] - p[1]);
      const [dx, dy] = [(ahead[0] - p[0]) / len, (ahead[1] - p[1]) / len];
      const base = [p[0] - dx * 0.04, p[1] - dy * 0.04];
      head = [
        [p[0] + dx * HEAD_LENGTH, p[1] + dy * HEAD_LENGTH],
        [base[0] - dy * HEAD_HALF_WIDTH, base[1] + dx * HEAD_HALF_WIDTH],
        [base[0] + dy * HEAD_HALF_WIDTH, base[1] - dx * HEAD_HALF_WIDTH],
      ];
    }
    return runs.length || head ? { runs, head } : null;
  }

  // Same look as the flat boards: a soft shadow, then the arrow; a glow for hints.
  paintShape({ runs, head }, { arrow, alpha, glow }, local, shade) {
    if (alpha <= 0) return;
    const { ctx } = this;
    const color = this.tint(this.colors.palette[arrow.color], shade);
    const body = (style, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (const points of runs) {
        ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    };
    const paint = (style) => {
      body(style, SHAFT);
      if (!head) return;
      ctx.fillStyle = style;
      ctx.lineWidth = 0.1; // rounds the arrowhead corners
      ctx.beginPath();
      head.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.globalAlpha = alpha * 0.35 * glow;
      body(color, SHAFT + 0.4 * glow);
      ctx.globalAlpha = alpha;
    }
    local(this.scale * 0.05);
    paint(this.tint(this.colors.board, shade, this.colors.shadow));
    local();
    paint(color);
    ctx.globalAlpha = 1;
  }

  // A soft dot on a cell along the way out, shown with a hint.
  drawPathDot(arrow, strength, shade) {
    const { ctx } = this;
    ctx.globalAlpha = 0.6 * strength;
    ctx.fillStyle = this.tint(this.colors.palette[arrow.color], shade);
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
