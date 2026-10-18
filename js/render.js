// Canvas 2D renderer. Draws the board from the game model and plays the
// slide, bounce and hint animations. It never changes game state: an arrow
// that has left the model keeps animating here as a "ghost" until it is gone.

import { DIRS, rayCells } from './game.js';

// Pastel hues, slightly deeper on the light theme so they read on cream.
const PALETTES = {
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

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

// Forward to the blocker, then spring back with a slight overshoot.
const bounceCurve = (p) => (p < 0.35 ? easeOutCubic(p / 0.35) : 1 - easeOutBack((p - 0.35) / 0.65));

// The polyline an arrow travels along: a virtual point behind the tail, its
// own cells, then straight on past the head. Points are one cell apart, so a
// distance travelled maps directly onto an index.
function buildTrack(arrow, extra) {
  const { cells } = arrow;
  const first = cells.length > 1
    ? { dx: cells[1].x - cells[0].x, dy: cells[1].y - cells[0].y }
    : DIRS[arrow.dir];
  const track = [{ x: cells[0].x - first.dx, y: cells[0].y - first.dy }, ...cells];
  const { dx, dy } = DIRS[arrow.dir];
  const head = cells[cells.length - 1];
  for (let k = 1; k <= Math.ceil(extra) + 1; k++) track.push({ x: head.x + dx * k, y: head.y + dy * k });
  return track;
}

function pointAt(track, s) {
  const i = Math.min(track.length - 2, Math.max(0, Math.floor(s)));
  const f = s - i;
  const a = track[i];
  const b = track[i + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Points of the arrow body after sliding `offset` cells along its track.
function bodyPoints(track, length, offset) {
  const s0 = 1 - TAIL_INSET + offset;
  const s1 = length + offset;
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
    this.hint = null;
    this.intro = null;
    this.raf = 0;
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
    this.hint = null;
    this.intro = entrance && !this.calm ? { start: performance.now() } : null;
    this.layout();
    this.requestDraw();
  }

  cellAt(px, py) {
    if (!this.game) return null;
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    const n = this.game.size;
    return x >= 0 && y >= 0 && x < n && y < n ? { x, y } : null;
  }

  playExit(arrow, distance) {
    const travel = distance + arrow.cells.length + 0.6;
    this.anims.set(arrow.id, {
      type: 'exit',
      arrow,
      track: buildTrack(arrow, travel),
      travel,
      edgeAt: distance + 0.5, // offset at which the head crosses the board edge
      start: performance.now(),
      duration: this.calm ? 140 : Math.min(900, 300 + travel * 55),
    });
    if (this.hint?.id === arrow.id) this.hint = null;
    this.requestDraw();
  }

  playBounce(arrow, distance) {
    this.anims.set(arrow.id, {
      type: 'bounce',
      arrow,
      track: buildTrack(arrow, distance + 1),
      reach: this.calm ? 0.08 : distance + 0.18,
      start: performance.now(),
      duration: this.calm ? 160 : 380 + distance * 40,
    });
    this.requestDraw();
  }

  showHint(arrow) {
    this.hint = { id: arrow.id, start: performance.now() };
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
      this.drawArrow(arrow, bodyPoints(track, arrow.cells.length, offset), { alpha, scale, glow });
    });

    if (this.intro) {
      if (introDone) this.intro = null;
      else active = true;
    }

    for (const [id, anim] of this.anims) {
      if (anim.type !== 'exit' || live.has(id)) continue;
      const p = clamp01((now - anim.start) / anim.duration);
      const offset = easeInOutQuad(p) * anim.travel;
      const fade = 1 - clamp01((offset - anim.edgeAt) / (anim.arrow.cells.length + 0.2));
      this.drawArrow(anim.arrow, bodyPoints(anim.track, anim.arrow.cells.length, offset), { alpha: fade });
      if (p >= 1) this.anims.delete(id);
      else active = true;
    }

    if (active) this.requestDraw();
  }

  restingTrack(arrow) {
    let track = this.tracks.get(arrow);
    if (!track) {
      track = buildTrack(arrow, 0);
      this.tracks.set(arrow, track);
    }
    return track;
  }

  hintState(now) {
    if (!this.hint) return null;
    const elapsed = now - this.hint.start;
    if (elapsed > HINT_DURATION) {
      this.hint = null;
      return null;
    }
    const pulse = 0.5 - 0.5 * Math.cos((elapsed / 900) * Math.PI * 2);
    const fade = 1 - clamp01((elapsed - HINT_DURATION + 600) / 600);
    return { id: this.hint.id, strength: Math.max(0.05, pulse) * fade };
  }

  toPx(p) {
    return [this.ox + (p.x + 0.5) * this.cell, this.oy + (p.y + 0.5) * this.cell];
  }

  drawBoard() {
    const { ctx, cell, game } = this;
    const pad = cell * 0.18;
    ctx.beginPath();
    ctx.roundRect(this.ox - pad, this.oy - pad, this.boardPx + pad * 2, this.boardPx + pad * 2, cell * 0.45);
    ctx.fillStyle = this.colors.board;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.colors.edge;
    ctx.stroke();

    ctx.fillStyle = this.colors.dot;
    const r = Math.max(1.5, cell * 0.055);
    for (let y = 0; y < game.size; y++) {
      for (let x = 0; x < game.size; x++) {
        const [px, py] = this.toPx({ x, y });
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Soft dots along the way out, shown with a hint.
  drawRay(arrow, strength) {
    const { ctx, cell } = this;
    ctx.save();
    ctx.globalAlpha = 0.6 * strength;
    ctx.fillStyle = this.colors.palette[arrow.color];
    for (const c of rayCells(this.game.size, arrow)) {
      const [px, py] = this.toPx(c);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawArrow(arrow, points, { alpha = 1, scale = 1, glow = 0 } = {}) {
    if (alpha <= 0) return;
    const { ctx, cell } = this;
    const color = this.colors.palette[arrow.color];
    const { dx, dy } = DIRS[arrow.dir];
    const head = points[points.length - 1];
    const tip = { x: head.x + dx * HEAD_LENGTH, y: head.y + dy * HEAD_LENGTH };
    const base = { x: head.x - dx * 0.04, y: head.y - dy * 0.04 };
    const left = { x: base.x - dy * HEAD_HALF_WIDTH, y: base.y + dx * HEAD_HALF_WIDTH };
    const right = { x: base.x + dy * HEAD_HALF_WIDTH, y: base.y - dx * HEAD_HALF_WIDTH };

    const shaft = () => {
      ctx.beginPath();
      ctx.moveTo(...this.toPx(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(...this.toPx(points[i]));
    };
    const arrowhead = () => {
      ctx.beginPath();
      ctx.moveTo(...this.toPx(tip));
      ctx.lineTo(...this.toPx(left));
      ctx.lineTo(...this.toPx(right));
      ctx.closePath();
    };
    const paint = (style, width) => {
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = width;
      shaft();
      ctx.stroke();
      ctx.lineWidth = cell * 0.1; // rounds the arrowhead corners
      arrowhead();
      ctx.fill();
      ctx.stroke();
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
