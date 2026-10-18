// Canvas 2D renderer for cube levels: the six faces of the cube, each a grid of arrows,
// seen through an orthographic camera the player turns by dragging. Same public API as
// Renderer (render.js), so main.js can swap them. Like Renderer, it never changes game
// state: an arrow that has left the model keeps sliding here as a ghost until it fades.
//
// Arrows are drawn on the cube's surface. Their tracks are sampled every half cell, so a
// body bending over an edge gets a point exactly on that edge and never cuts the corner.

import { DIRS3, surface } from './game3d.js';
import { PALETTES } from './render.js';

// Arrow geometry, in cells (same proportions as the flat boards).
const SHAFT = 0.3;
const TAIL_INSET = 0.3;
const HEAD_LENGTH = 0.36;
const HEAD_HALF_WIDTH = 0.3;

const LIGHT = normalize([-0.45, 0.75, 0.55]); // in view space
const HINT_DURATION = 3200;
const TURN_SPEED = 0.011; // radians per dragged pixel
const MAX_PITCH = 1.35;

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
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.geo = null;
    this.anims = new Map(); // arrow id → slide or bounce animation
    this.tracks = new WeakMap(); // resting tracks, cached per arrow
    this.hint = null;
    this.intro = null;
    this.raf = 0;
    this.w = 0;
    this.h = 0;
    this.yaw = -0.62;
    this.pitch = 0.5;
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  get calm() {
    return this.motionQuery.matches;
  }

  // How far a finger may wander and still count as a tap (dragging turns the cube).
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
      shade: dark ? '0, 0, 0' : '90, 64, 30',
      shadow: dark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(90, 64, 30, 0.16)',
      palette: dark ? PALETTES.dark : PALETTES.light,
    };
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
    // Seen from any angle the cube spans at most its space diagonal (√3 ≈ 1.73 sides);
    // in practice the views it can be turned to stay under ~1.6, plus room for heads.
    this.scale = (Math.min(this.w, this.h) * 0.92) / (this.game.size * 1.7);
    this.ox = this.w / 2;
    this.oy = this.h / 2;
  }

  setGame(game, { entrance = true } = {}) {
    this.game = game;
    this.geo = game ? surface(game.size) : null;
    this.anims.clear();
    this.tracks = new WeakMap();
    this.hint = null;
    this.intro = game && entrance && !this.calm ? { start: performance.now() } : null;
    this.layout();
    this.requestDraw();
  }

  // Turns the cube; called while the player drags (or presses the arrow keys).
  rotate(dx, dy) {
    this.yaw += dx * TURN_SPEED;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dy * TURN_SPEED));
    this.requestDraw();
  }

  // World (cube corner at the origin) → view space: yaw around y, then pitch around x.
  view(p) {
    const half = this.game.size / 2;
    const x = p[0] - half;
    const y = p[1] - half;
    const z = p[2] - half;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  }

  // Directions only rotate (no centring).
  viewDir([x, y, z]) {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  }

  screen(p) {
    const [x, y] = this.view(p);
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  visibleFaces() {
    return this.geo.faces.map((f) => this.viewDir(f.normal)[2] > 0.02);
  }

  // The arrow under a point: find the visible face it lands on, then the cell. A face of
  // a cube seen orthographically is a parallelogram, so this is a 2×2 inverse.
  pick(px, py) {
    if (!this.game) return null;
    const { size } = this.game;
    const visible = this.visibleFaces();
    for (let fi = 0; fi < 6; fi++) {
      if (!visible[fi]) continue;
      const f = this.geo.faces[fi];
      const [ax, ay] = this.screen(f.corner);
      const [bx, by] = this.screen(add(f.corner, f.u, size));
      const [cx, cy] = this.screen(add(f.corner, f.v, size));
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(det) < 1e-6) continue;
      const s = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
      const t = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / det;
      if (s < 0 || t < 0 || s >= 1 || t >= 1) continue;
      const cell = fi * size * size + Math.floor(t * size) * size + Math.floor(s * size);
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
      edgeAt: path.length + 0.5, // offset at which the head slides off its face
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
  // the tail, its cells, its way out, then straight on off the face. `faces[i]` is the face
  // segment i lies on. Position s (in cells) maps to index 2s; the head rests at s = length.
  buildTrack(arrow, path = [], extra = 0) {
    const { geo } = this;
    const cells = [...arrow.cells, ...path];
    const toward = (a, b) => DIRS3[geo.inPlane(a).find((d) => geo.step(a, d).cell === b)];
    const pts = [];
    const faces = [];
    const tail = cells[0];
    const out = cells.length > 1 ? toward(tail, cells[1]) : DIRS3[arrow.dir];
    const tailFace = geo.faceOf(tail);
    pts.push(add(geo.centre(tail), out, -1), add(geo.centre(tail), out, -0.5));
    faces.push(tailFace, tailFace);
    cells.forEach((cell, i) => {
      const p = geo.centre(cell);
      pts.push(p);
      if (i === cells.length - 1) return;
      pts.push(add(p, toward(cell, cells[i + 1]), 0.5)); // a midpoint, or a point on the edge
      faces.push(geo.faceOf(cell), geo.faceOf(cells[i + 1]));
    });
    const end = cells[cells.length - 1];
    const endFace = geo.faceOf(end);
    for (let k = 1; k <= 2 * (Math.ceil(extra) + 1); k++) {
      pts.push(add(geo.centre(end), DIRS3[arrow.dir], k * 0.5));
      faces.push(endFace);
    }
    return { pts, faces };
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
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const visible = this.visibleFaces();
    this.drawFaces(visible);

    let active = false;
    const hint = this.hintState(now);
    if (hint) active = true;
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
      const glow = hint?.id === arrow.id ? hint.strength : 0;
      if (glow) this.drawPath(arrow, glow, visible);
      this.paintArrow(arrow, track, offset, visible, { alpha, glow });
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
      this.paintArrow(anim.arrow, anim.track, offset, visible, { alpha });
    }

    if (active) this.requestDraw();
  }

  // Visible faces as boards: softly shaded by the light, with a dot in every cell.
  drawFaces(visible) {
    const { ctx, game, geo } = this;
    const { size } = game;
    geo.faces.forEach((f, fi) => {
      if (!visible[fi]) return;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) =>
        this.screen(add(add(f.corner, f.u, a * size), f.v, b * size)));
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = this.colors.board;
      ctx.fill();
      const light = Math.max(0, dot(this.viewDir(f.normal), LIGHT));
      ctx.fillStyle = `rgba(${this.colors.shade}, ${(0.14 * (1 - light)).toFixed(3)})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.colors.edge;
      ctx.stroke();

      ctx.fillStyle = this.colors.dot;
      const r = Math.max(1.5, this.scale * 0.055);
      for (let v = 0; v < size; v++) {
        for (let u = 0; u < size; u++) {
          const [x, y] = this.screen(add(add(f.corner, f.u, u + 0.5), f.v, v + 0.5));
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  // Soft dots along the way out, shown with a hint.
  drawPath(arrow, strength, visible) {
    const { ctx, geo } = this;
    ctx.save();
    ctx.globalAlpha = 0.6 * strength;
    ctx.fillStyle = this.colors.palette[arrow.color];
    for (const cell of this.game.pathOf(arrow)) {
      if (!visible[geo.faceOf(cell)]) continue;
      const [x, y] = this.screen(geo.centre(cell));
      ctx.beginPath();
      ctx.arc(x, y, this.scale * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draws an arrow slid `offset` cells along `track`, segment by segment so the parts on
  // faces turned away are skipped (an arrow bending over an edge shows only its near half).
  paintArrow(arrow, { pts, faces }, offset, visible, { alpha = 1, glow = 0 } = {}) {
    if (alpha <= 0) return;
    const last = pts.length - 2;
    const at = (s) => {
      const i = Math.max(0, Math.min(last, Math.floor(s * 2)));
      const f = s * 2 - i;
      return add(pts[i], add(pts[i + 1], pts[i], -1), f);
    };
    const s0 = 1 - TAIL_INSET + offset;
    const s1 = arrow.cells.length + offset;

    // Runs of consecutive visible segments become polylines.
    const runs = [];
    let run = null;
    const first = Math.max(0, Math.floor(s0 * 2));
    for (let i = first; i <= Math.min(last, Math.ceil(s1 * 2) - 1); i++) {
      const a = Math.max(s0, i / 2);
      const b = Math.min(s1, (i + 1) / 2);
      if (b <= a) continue;
      if (!visible[faces[i]]) {
        run = null;
        continue;
      }
      if (!run) {
        run = [at(a)];
        runs.push(run);
      }
      run.push(at(b));
    }

    // Head: on the face of the segment just ahead of it.
    const hi = Math.max(0, Math.min(last, Math.floor(s1 * 2)));
    const headFace = faces[hi];
    let head = null;
    if (visible[headFace]) {
      const d = normalize(add(pts[hi + 1], pts[hi], -1));
      const side = cross(this.geo.faces[headFace].normal, d);
      const p = at(s1);
      const base = add(p, d, -0.04);
      head = [add(p, d, HEAD_LENGTH), add(base, side, HEAD_HALF_WIDTH), add(base, side, -HEAD_HALF_WIDTH)]
        .map((q) => this.screen(q));
    }

    const { ctx, scale } = this;
    const color = this.colors.palette[arrow.color];
    const stroke = (style, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (const points of runs) {
        ctx.beginPath();
        points.forEach((q, i) => {
          const [x, y] = this.screen(q);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
    };
    const paint = (style, width) => {
      stroke(style, width);
      if (!head) return;
      ctx.fillStyle = style;
      ctx.lineWidth = scale * 0.1; // rounds the arrowhead corners
      ctx.beginPath();
      head.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.globalAlpha = alpha * 0.35 * glow;
      stroke(color, scale * (SHAFT + 0.4 * glow));
      ctx.globalAlpha = alpha;
    }
    ctx.translate(0, scale * 0.05);
    paint(this.colors.shadow, scale * SHAFT);
    ctx.translate(0, -scale * 0.05);
    paint(color, scale * SHAFT);
    ctx.restore();
  }
}
