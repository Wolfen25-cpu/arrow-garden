// Soft synthesized sounds with the Web Audio API. No audio files.

// Major pentatonic steps: any of them sound pleasant together.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19];
// A streak of exits without a bump plays this melody: it climbs and falls over the scale
// (indices into PENTATONIC) instead of sticking on the top note, and each pass through
// it moves to a nearby key so long streaks keep changing.
const CONTOUR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
const KEYS = [0, 5, 2, 7];
const HARMONY_FROM = 5; // a soft fifth joins in
const SPARKLE_FROM = 10; // and later a high glint
const MILESTONE = 5; // every fifth exit in a row adds a little flourish

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.streak = 0; // exits in a row without a bump
  }

  // Browsers only allow audio after a user gesture, so call this from input handlers.
  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3200;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(filter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, { at = 0, dur = 0.35, type = 'sine', gain = 0.1, slide = 1 } = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  resetStreak() {
    this.streak = 0;
  }

  exit() {
    const i = this.streak++;
    const key = KEYS[Math.floor(i / CONTOUR.length) % KEYS.length];
    const freq = 392 * 2 ** ((PENTATONIC[CONTOUR[i % CONTOUR.length]] + key) / 12);
    this.tone(freq, { dur: 0.45, type: 'triangle', gain: 0.09, slide: 1.02 });
    this.tone(freq * 2, { dur: 0.25, gain: 0.025 });
    if (this.streak >= HARMONY_FROM) this.tone(freq * 2 ** (7 / 12), { at: 0.02, dur: 0.4, gain: 0.03 });
    if (this.streak >= SPARKLE_FROM) this.tone(freq * 4, { at: 0.06, dur: 0.2, gain: 0.014 });
    if (this.streak % MILESTONE === 0) {
      this.tone(freq * 2, { at: 0.1, dur: 0.22, type: 'triangle', gain: 0.035 });
      this.tone(freq * 2 * 2 ** (4 / 12), { at: 0.18, dur: 0.3, type: 'triangle', gain: 0.035 });
    }
  }

  // A bump ends the streak, so the melody starts again from the bottom.
  bump() {
    this.streak = 0;
    this.tone(160, { dur: 0.18, gain: 0.14, slide: 0.75 });
  }

  // Out of errors: a gentle falling phrase, never harsh.
  lose() {
    [7, 4, 0].forEach((step, i) => {
      this.tone(392 * 2 ** (step / 12), { at: i * 0.14, dur: 0.5, type: 'triangle', gain: 0.06, slide: 0.98 });
    });
  }

  win() {
    [0, 4, 7, 12, 16].forEach((step, i) => {
      this.tone(523.25 * 2 ** (step / 12), { at: i * 0.1, dur: 0.7, type: 'triangle', gain: 0.07 });
    });
  }
}

export function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}
