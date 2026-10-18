// Canvas 2D renderer for cube levels: the six faces of the cube, each a grid of arrows,
// seen through an orthographic camera the player turns by dragging. Same public API as
// Renderer (render.js), so main.js can swap them. Like Renderer, it never changes game
// state: an arrow that has left the model keeps sliding here as a ghost until it fades.
//
// Each visible face is drawn through its own affine transform, so arrows are flat 2D
// arrows painted on the face (foreshortened with it) and clipped to its outline: nothing
// sticks out whichever way the cube is turned. Tracks are sampled every half cell, so a
// body bending over an edge has a point on that edge; seen from one face, the part on a
// neighbouring face is unfolded flat beyond the edge, where the clip hides it.

import { DIRS3, surface } from './game3d.js';
import { PALETTES } from './render.js';

// Arrow geometry, in cells (same proportions as the flat boards).
const SHAFT = 0.32;
const TAIL_INSET = 0.3;
const HEAD_LENGTH = 0.36;
const HEAD_HALF_WIDTH = 0.3;

const LIGHT = normalize([-0.45, 0.75, 0.55]); // in view space
const HINT_DURATION = 3200;
// Dragging across the whole cube (two radii on screen) turns it about this far.
const TURN_PER_DIAMETER = 2.6; // radians

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

// 3×3 rotation matrices as arrays of rows.
const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const rotX = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const rotY = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const apply = (m, v) => m.map((row) => dot(row, v));

// Gram–Schmidt, so rounding errors from many small turns never skew the cube.
function orthonormal([r0, r1]) {
  const a = normalize(r0);
  const b = normalize(add(r1, a, -dot(r1, a)));
  return [a, b, [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]];
}

// Starting view: a little from above and to the side, so three faces show.
const START_VIEW = mul(rotX(0.5), rotY(-0.62));

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
    this.orientation = START_VIEW;
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
    // Seen from any angle the cube spans at most its space diagonal (√3 sides).
    this.scale = (Math.min(this.w, this.h) * 0.94) / (this.game.size * Math.sqrt(3));
    this.ox = this.w / 2;
    this.oy = this.h / 2;
  }

  setGame(game, { entrance = true } = {}) {
    this.game = game;
    this.geo = game ? surface(game.size) : null;
    this.anims.clear();
    this.tracks = new WeakMap();
    this.hint = null;
    this.orientation = START_VIEW;
    this.intro = game && entrance && !this.calm ? { start: performance.now() } : null;
    this.layout();
    this.requestDraw();
  }

  // Trackball turn: the cube follows the finger whatever way it is facing. A horizontal
  // drag spins it around the screen's vertical axis, a vertical drag around the screen's
  // horizontal axis (screen y grows downwards, view y upwards, hence the sign).
  rotate(dx, dy) {
    // Speed follows the cube's size on screen, so it feels like grabbing its surface.
    const radius = (this.scale * this.game.size * Math.sqrt(3)) / 2;
    const k = TURN_PER_DIAMETER / (2 * radius);
    const turn = mul(rotY(dx * k), rotX(dy * k));
    this.orientation = orthonormal(mul(turn, this.orientation));
    this.requestDraw();
  }

  // World (cube corner at the origin) → view space; the viewer looks down −z.
  view(p) {
    const half = this.game.size / 2;
    return apply(this.orientation, [p[0] - half, p[1] - half, p[2] - half]);
  }

  viewDir(d) {
    return apply(this.orientation, d);
  }

  screen(p) {
    const [x, y] = this.view(p);
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  visibleFaces() {
    return this.geo.faces.map((f) => this.viewDir(f.normal)[2] > 0.02);
  }

  // Screen corners of a face: its corner, and the ends of its u and v sides.
  faceFrame(f) {
    const { size } = this.game;
    return [this.screen(f.corner), this.screen(add(f.corner, f.u, size)), this.screen(add(f.corner, f.v, size))];
  }

  // The arrow under a point: find the visible face it lands on, then the cell. A face of
  // a cube seen orthographically is a parallelogram, so this is a 2×2 inverse.
  pick(px, py) {
    if (!this.game) return null;
    const { size } = this.game;
    const visible = this.visibleFaces();
    for (let fi = 0; fi < 6; fi++) {
      if (!visible[fi]) continue;
      const [[ax, ay], [bx, by], [cx, cy]] = this.faceFrame(this.geo.faces[fi]);
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

    // Work out every arrow's pose first; then each face paints its share of them.
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
    const visible = this.visibleFaces();
    this.geo.faces.forEach((face, fi) => {
      if (visible[fi]) this.drawFace(face, fi, poses, hint);
    });

    if (active) this.requestDraw();
  }

  // One face: its board, then its share of every arrow in face coordinates (cells),
  // clipped to the face, then a light-dependent shade over the lot.
  drawFace(face, fi, poses, hint) {
    const { ctx, dpr, game } = this;
    const { size } = game;
    const frame = this.faceFrame(face);
    const [[ax, ay], [bx, by], [cx, cy]] = frame;
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + cx - ax, by + cy - ay);
      ctx.lineTo(cx, cy);
      ctx.closePath();
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    outline();
    ctx.fillStyle = this.colors.board;
    ctx.fill();

    ctx.save();
    outline();
    ctx.clip();
    // Face coordinates: (u, v) in cells, (0, 0) at the face's corner.
    const m = [(bx - ax) / size, (by - ay) / size, (cx - ax) / size, (cy - ay) / size, ax, ay];
    const local = (shift = 0) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, dpr * shift);
      ctx.transform(...m);
    };
    local();

    ctx.fillStyle = this.colors.dot;
    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        ctx.beginPath();
        ctx.arc(u + 0.5, v + 0.5, 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const toLocal = this.unfolder(fi);
    if (hint) {
      const pose = poses.find((p) => p.arrow.id === hint.id);
      if (pose) this.drawPath(pose.arrow, hint.strength, fi, toLocal);
    }
    for (const pose of poses) {
      const shape = this.arrowShape(pose, fi, toLocal);
      if (shape) this.paintShape(shape, pose, local);
    }
    ctx.restore();

    // Shade by the light, over arrows too, so the faces read as one solid.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    outline();
    const light = Math.max(0, dot(this.viewDir(face.normal), LIGHT));
    ctx.fillStyle = `rgba(${this.colors.shade}, ${(0.16 * (1 - light)).toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.colors.edge;
    ctx.stroke();
  }

  // Maps a point lying on face `from` into face `fi`'s coordinates. A neighbouring face
  // is unfolded flat beyond the shared edge (outside the clip); the opposite face never
  // shows on this one, so it maps to null.
  unfolder(fi) {
    const face = this.geo.faces[fi];
    return (p, from) => {
      let q = p;
      if (from !== fi) {
        const other = this.geo.faces[from];
        if (dot(other.normal, face.normal) < -0.5) return null;
        const depth = -dot(add(p, face.corner, -1), face.normal);
        q = add(add(p, face.normal, depth), other.normal, depth);
      }
      const rel = add(q, face.corner, -1);
      return [dot(rel, face.u), dot(rel, face.v)];
    };
  }

  // The arrow's body as polylines and its head as a triangle, in face `fi` coordinates.
  // Null when no part of it can touch this face.
  arrowShape({ arrow, track: { pts, faces }, offset }, fi, toLocal) {
    const near = (f) => f === fi || dot(this.geo.faces[f].normal, this.geo.faces[fi].normal) > -0.5;
    const last = pts.length - 2;
    const s0 = 1 - TAIL_INSET + offset;
    const s1 = arrow.cells.length + offset;
    const at = (s) => {
      const i = Math.max(0, Math.min(last, Math.floor(s * 2)));
      return add(pts[i], add(pts[i + 1], pts[i], -1), s * 2 - i);
    };

    let touches = false;
    const runs = [];
    let run = null;
    for (let i = Math.max(0, Math.floor(s0 * 2)); i <= Math.min(last, Math.ceil(s1 * 2) - 1); i++) {
      const a = Math.max(s0, i / 2);
      const b = Math.min(s1, (i + 1) / 2);
      if (b <= a) continue;
      if (!near(faces[i])) {
        run = null;
        continue;
      }
      if (faces[i] === fi) touches = true;
      if (!run) {
        run = [toLocal(at(a), faces[i])];
        runs.push(run);
      }
      run.push(toLocal(at(b), faces[i]));
    }

    let head = null;
    const hi = Math.max(0, Math.min(last, Math.floor(s1 * 2)));
    if (near(faces[hi])) {
      const p = toLocal(at(s1), faces[hi]);
      const ahead = toLocal(add(at(s1), add(pts[hi + 1], pts[hi], -1), 2), faces[hi]);
      const len = Math.hypot(ahead[0] - p[0], ahead[1] - p[1]);
      const [dx, dy] = [(ahead[0] - p[0]) / len, (ahead[1] - p[1]) / len];
      const base = [p[0] - dx * 0.04, p[1] - dy * 0.04];
      head = [
        [p[0] + dx * HEAD_LENGTH, p[1] + dy * HEAD_LENGTH],
        [base[0] - dy * HEAD_HALF_WIDTH, base[1] + dx * HEAD_HALF_WIDTH],
        [base[0] + dy * HEAD_HALF_WIDTH, base[1] - dx * HEAD_HALF_WIDTH],
      ];
      if (faces[hi] === fi) touches = true;
    }
    return touches ? { runs, head } : null;
  }

  // Same look as the flat boards: a soft shadow, then the arrow; a glow for hints.
  paintShape({ runs, head }, { arrow, alpha, glow }, local) {
    if (alpha <= 0) return;
    const { ctx } = this;
    const color = this.colors.palette[arrow.color];
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
    paint(this.colors.shadow);
    local();
    paint(color);
    ctx.globalAlpha = 1;
  }

  // Soft dots along the way out, shown with a hint.
  drawPath(arrow, strength, fi, toLocal) {
    const { ctx, geo } = this;
    ctx.globalAlpha = 0.6 * strength;
    ctx.fillStyle = this.colors.palette[arrow.color];
    for (const cell of this.game.pathOf(arrow)) {
      if (geo.faceOf(cell) !== fi) continue;
      const [x, y] = toLocal(geo.centre(cell), fi);
      ctx.beginPath();
      ctx.arc(x, y, 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
