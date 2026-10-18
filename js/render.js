// Canvas 2D renderer. Draws the board from the game model and plays the
// slide, bounce and hint animations. It never changes game state: an arrow
// that has left the model keeps animating here as a "ghost" until it is gone.

import { DIRS } from './game.js';

// Pastel hues, slightly deeper on the light theme so they read on cream.
export const PALETTES = {
  light: ['#ef8f86', '#f3a76a', '#e6bf4f', '#86c77f', '#4fbfae', '#62aee6',
    '#8695ec', '#ac88e6', '#e489c2', '#d39a6a', '#9ccb5a', '#6fc3d6'],
  dark: ['#ffb3ab', '#ffcb9a', '#fbe28f', '#b6e7a8', '#93e1d3', '#a4d1fb',
    '#b9c2ff', '#d3b8ff', '#ffb8e1', '#f0c9a4', '#cfeaa0', '#a7e3ef'],
};

// Arrow geometry, in cells.
const SHAFT = 0.32;
const TAIL_INSET = 0.3;
const HEAD_LENGTH = 0.36;
const HEAD_HALF_WIDTH = 0.3;

const HINT_DURATION = 3200;
const PARTICLES_PER_BURST = 16;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

// Forward to the blocker, then spring back with a slight overshoot.
const bounceCurve = (p) => (p < 0.35 ? easeOutCubic(p / 0.35) : 1 - easeOutBack((p - 0.35) / 0.65));

// The polyline an arrow travels along: a virtual point behind the tail, its
// own cells, its way out (`path`, which may turn), then straight on. Points are
// one cell apart, so a distance travelled maps directly onto an index.
function buildTrack(arrow, path = [], extra = 0) {
  const { cells } = arrow;
  const first = cells.length > 1
    ? { dx: cells[1].x - cells[0].x, dy: cells[1].y - cells[0].y }
    : DIRS[arrow.dir];
  const track = [{ x: cells[0].x - first.dx, y: cells[0].y - first.dy }, ...cells, ...path];
  const end = track[track.length - 1];
  const before = track[track.length - 2];
  const { dx, dy } = path.length ? { dx: end.x - before.x, dy: end.y - before.y } : DIRS[arrow.dir];
  for (let k = 1; k <= Math.ceil(extra) + 1; k++) track.push({ x: end.x + dx * k, y: end.y + dy * k });
  return track;
}

// Unit direction of the track ahead of position `s` (or behind it, pointing back).
function trackDir(track, s, back = false) {
  const last = track.length - 2;
  const i = Math.max(0, Math.min(last, back ? Math.ceil(s) - 1 : Math.floor(s)));
  const a = track[i];
  const b = track[i + 1];
  return back ? { dx: a.x - b.x, dy: a.y - b.y } : { dx: b.x - a.x, dy: b.y - a.y };
}

function pointAt(track, s) {
  const i = Math.min(track.length - 2, Math.max(0, Math.floor(s)));
  const f = s - i;
  const a = track[i];
  const b = track[i + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Double arrows carry a head at the tail too, so their body reaches the tail cell's centre.
const insetOf = (arrow) => (arrow.both ? 0 : TAIL_INSET);

// Points of the arrow body between track positions s0 (tail end) and s1 (head end).
function bodyPoints(track, s0, s1) {
  const points = [pointAt(track, s0)];
  for (let k = Math.floor(s0) + 1; k < s1; k++) points.push(track[k]);
  points.push(pointAt(track, s1));
  return points;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.anims = new Map(); // arrow id → slide or bounce animation
    this.tracks = new WeakMap(); // resting tracks, cached per arrow
    this.particles = [];
    this.hint = null;
    this.intro = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.w = 0;
    this.h = 0;
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  // Reduced motion: near-instant moves, no particles, no entrance.
  get calm() {
    return this.motionQuery.matches;
  }

  readTheme() {
    const style = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme === 'dark';
    this.colors = {
      board: style.getPropertyValue('--board').trim(),
      edge: style.getPropertyValue('--board-edge').trim(),
      dot: style.getPropertyValue('--dot').trim(),
      shadow: dark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(90, 64, 30, 0.16)',
      turn: style.getPropertyValue('--accent').trim(),
      hole: dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(70, 50, 30, 0.45)',
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
    const n = this.game.size;
    this.cell = Math.max(12, Math.floor(Math.min(this.w, this.h) / (n + 0.7)));
    this.boardPx = this.cell * n;
    this.ox = Math.round((this.w - this.boardPx) / 2);
    this.oy = Math.round((this.h - this.boardPx) / 2);
  }

  setGame(game, { entrance = true } = {}) {
    this.game = game;
    this.anims.clear();
    this.particles = [];
    this.hint = null;
    this.intro = entrance && !this.calm ? { start: performance.now() } : null;
    this.layout();
    this.requestDraw();
  }

  // The arrow under a point, or null. Shared with Renderer3D so input can stay generic.
  pick(px, py) {
    const cell = this.cellAt(px, py);
    return cell ? this.game.arrowAt(cell.x, cell.y)?.id ?? null : null;
  }

  // Where a point falls on the board, in cells with cell centres on integers.
  boardPoint(px, py) {
    return { x: (px - this.ox) / this.cell - 0.5, y: (py - this.oy) / this.cell - 0.5 };
  }

  // How far a finger may wander and still count as a tap.
  get tapSlop() {
    return this.cell * 0.8;
  }

  cellAt(px, py) {
    if (!this.game) return null;
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    const n = this.game.size;
    return x >= 0 && y >= 0 && x < n && y < n ? { x, y } : null;
  }

  // `result` is what Game.tap returned: the moving arrow, its path and whether it ends in a hole.
  playExit({ arrow, path, hole }) {
    const distance = path.length;
    const travel = distance + arrow.cells.length + 0.6;
    this.anims.set(arrow.id, {
      type: 'exit',
      arrow,
      track: buildTrack(arrow, path, travel),
      travel,
      // Offset at which the head crosses the board edge, or reaches the hole's centre.
      edgeAt: hole ? distance : distance + 0.5,
      clip: hole ? arrow.cells.length + distance : Infinity,
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
      track: buildTrack(arrow, path.slice(0, distance + 1)),
      reach: this.calm ? 0.08 : distance + 0.18,
      start: performance.now(),
      duration: this.calm ? 160 : 380 + distance * 40,
    });
    this.requestDraw();
  }

  // A persistent hint keeps pulsing until replaced or cleared (used by the tutorial).
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

  draw(now) {
    const { ctx, game } = this;
    if (!game || !this.w) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBoard();
    this.drawObstacles();

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
      let scale = 1;
      if (this.intro) {
        const p = clamp01((now - this.intro.start - index * 22) / 320);
        alpha = p;
        scale = 0.7 + 0.3 * easeOutBack(p);
        if (p < 1) introDone = false;
      }

      const glow = hint?.id === arrow.id ? hint.strength : 0;
      if (glow) this.drawRay(arrow, glow);
      this.paintArrow(arrow, track, offset, { alpha, scale, glow });
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
      const offset = easeInOutQuad(p) * anim.travel;
      if (!anim.burst && offset >= anim.edgeAt) {
        anim.burst = true;
        this.burst(anim);
      }
      const fade = 1 - clamp01((offset - anim.edgeAt) / (anim.arrow.cells.length + 0.2));
      this.paintArrow(anim.arrow, anim.track, offset, { alpha: fade }, anim.clip);
      active = true;
    }

    if (this.drawParticles(now)) active = true;
    this.lastFrame = now;
    if (active) this.requestDraw();
  }

  // A little puff of petals where the arrow leaves the board (or drops into a hole).
  burst(anim) {
    if (this.calm) return;
    const { arrow } = anim;
    const s = arrow.cells.length + anim.edgeAt;
    const { dx, dy } = trackDir(anim.track, s);
    const [x, y] = this.toPx(pointAt(anim.track, s));
    const heading = Math.atan2(dy, dx);
    const color = this.colors.palette[arrow.color];
    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      const angle = heading + (Math.random() - 0.5) * 2.2;
      const speed = this.cell * (1.5 + Math.random() * 3.5);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: this.cell * (0.05 + Math.random() * 0.07),
        life: 500 + Math.random() * 450,
        age: 0,
        color,
      });
    }
  }

  drawParticles(now) {
    if (!this.particles.length) return false;
    const { ctx } = this;
    const dt = Math.min(50, now - (this.lastFrame || now));
    const drag = Math.pow(0.04, dt / 1000); // velocity left after dt
    ctx.save();
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vx *= drag;
      p.vy *= drag;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - 0.5 * t), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.restore();
    return this.particles.length > 0;
  }

  // Draws an arrow slid `offset` cells along `track`. Past `clip` (a hole) the body is
  // swallowed, and the front head goes first.
  paintArrow(arrow, track, offset, opts, clip = Infinity) {
    const length = arrow.cells.length;
    const s1 = length + offset;
    const s0 = Math.min(1 - insetOf(arrow) + offset, clip);
    if (s0 >= clip) return;
    const end = Math.min(s1, clip);
    const front = s1 <= clip ? trackDir(track, s1) : null;
    const back = arrow.both ? trackDir(track, s0, true) : null;
    this.drawArrow(arrow, bodyPoints(track, s0, end), { ...opts, front, back });
  }

  restingTrack(arrow) {
    let track = this.tracks.get(arrow);
    if (!track) {
      track = buildTrack(arrow);
      this.tracks.set(arrow, track);
    }
    return track;
  }

  hintState(now) {
    if (!this.hint) return null;
    const { persistent } = this.hint;
    const elapsed = now - this.hint.start;
    if (!persistent && elapsed > HINT_DURATION) {
      this.hint = null;
      return null;
    }
    const pulse = 0.5 - 0.5 * Math.cos((elapsed / 900) * Math.PI * 2);
    const fade = persistent ? 1 : 1 - clamp01((elapsed - HINT_DURATION + 600) / 600);
    return { id: this.hint.id, strength: Math.max(0.05, pulse) * fade };
  }

  toPx(p) {
    return [this.ox + (p.x + 0.5) * this.cell, this.oy + (p.y + 0.5) * this.cell];
  }

  drawBoard() {
    const { ctx, cell, game } = this;
    const pad = cell * 0.18;
    const { mask } = game;
    if (mask) {
      this.drawSilhouette(mask, pad);
    } else {
      ctx.beginPath();
      ctx.roundRect(this.ox - pad, this.oy - pad, this.boardPx + pad * 2, this.boardPx + pad * 2, cell * 0.45);
      ctx.fillStyle = this.colors.board;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.colors.edge;
      ctx.stroke();
    }

    ctx.fillStyle = this.colors.dot;
    const r = Math.max(1.5, cell * 0.055);
    for (let y = 0; y < game.size; y++) {
      for (let x = 0; x < game.size; x++) {
        if (mask && !mask[y * game.size + x]) continue;
        const [px, py] = this.toPx({ x, y });
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Turns: an outlined tile with a chevron pointing where arrows are sent.
  // Holes: a dark sunken disc that swallows arrows.
  drawObstacles() {
    const { ctx, cell } = this;
    for (const o of this.game.obstacles) {
      const [px, py] = this.toPx(o);
      ctx.save();
      ctx.translate(px, py);
      if (o.kind === 'hole') {
        ctx.fillStyle = this.colors.hole;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, cell * 0.05);
        ctx.strokeStyle = this.colors.edge;
        ctx.stroke();
      } else {
        const { dx, dy } = DIRS[o.dir];
        ctx.rotate(Math.atan2(dy, dx));
        ctx.strokeStyle = this.colors.turn;
        ctx.fillStyle = this.colors.turn;
        ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.beginPath();
        ctx.roundRect(-cell * 0.36, -cell * 0.36, cell * 0.72, cell * 0.72, cell * 0.16);
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, cell * 0.08);
        ctx.beginPath();
        ctx.moveTo(-cell * 0.08, -cell * 0.17);
        ctx.lineTo(cell * 0.12, 0);
        ctx.lineTo(-cell * 0.08, cell * 0.17);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Picture levels: overlapping rounded cells merge into the figure's outline.
  // Painting the edge colour slightly larger first gives it a border without inner seams.
  drawSilhouette(mask, pad) {
    const { ctx, cell, game } = this;
    const shape = (grow) => {
      ctx.beginPath();
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const x = this.ox + (i % game.size) * cell - pad - grow;
        const y = this.oy + Math.floor(i / game.size) * cell - pad - grow;
        ctx.roundRect(x, y, cell + (pad + grow) * 2, cell + (pad + grow) * 2, cell * 0.4);
      }
    };
    shape(2);
    ctx.fillStyle = this.colors.edge;
    ctx.fill();
    shape(0);
    ctx.fillStyle = this.colors.board;
    ctx.fill();
  }

  // Soft dots along the way out, shown with a hint (backwards when a double arrow leaves that way).
  drawRay(arrow, strength) {
    const { ctx, cell } = this;
    const way = this.game.exitWay(arrow) ?? arrow;
    ctx.save();
    ctx.globalAlpha = 0.6 * strength;
    ctx.fillStyle = this.colors.palette[arrow.color];
    for (const c of this.game.pathOf(way)?.cells ?? []) {
      const [px, py] = this.toPx(c);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // `front` / `back` are the unit directions of the heads at each end (null: no head there).
  drawArrow(arrow, points, { alpha = 1, scale = 1, glow = 0, front = DIRS[arrow.dir], back = null } = {}) {
    if (alpha <= 0) return;
    const { ctx, cell } = this;
    const color = this.colors.palette[arrow.color];
    const heads = [];
    if (front) heads.push({ at: points[points.length - 1], ...front });
    if (back) heads.push({ at: points[0], ...back });

    const shaft = () => {
      ctx.beginPath();
      ctx.moveTo(...this.toPx(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(...this.toPx(points[i]));
    };
    const arrowhead = ({ at, dx: ux, dy: uy }) => {
      const tip = { x: at.x + ux * HEAD_LENGTH, y: at.y + uy * HEAD_LENGTH };
      const base = { x: at.x - ux * 0.04, y: at.y - uy * 0.04 };
      ctx.beginPath();
      ctx.moveTo(...this.toPx(tip));
      ctx.lineTo(...this.toPx({ x: base.x - uy * HEAD_HALF_WIDTH, y: base.y + ux * HEAD_HALF_WIDTH }));
      ctx.lineTo(...this.toPx({ x: base.x + uy * HEAD_HALF_WIDTH, y: base.y - ux * HEAD_HALF_WIDTH }));
      ctx.closePath();
    };
    const paint = (style, width) => {
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = width;
      shaft();
      ctx.stroke();
      ctx.lineWidth = cell * 0.1; // rounds the arrowhead corners
      for (const head of heads) {
        arrowhead(head);
        ctx.fill();
        ctx.stroke();
      }
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (scale !== 1) {
      const xs = arrow.cells.map((c) => c.x);
      const ys = arrow.cells.map((c) => c.y);
      const [cx, cy] = this.toPx({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    if (glow) {
      ctx.globalAlpha = alpha * 0.35 * glow;
      ctx.lineWidth = cell * (SHAFT + 0.4 * glow);
      ctx.strokeStyle = color;
      shaft();
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    ctx.translate(0, cell * 0.05);
    paint(this.colors.shadow, cell * SHAFT);
    ctx.translate(0, -cell * 0.05);
    paint(color, cell * SHAFT);

    ctx.restore();
  }
}
