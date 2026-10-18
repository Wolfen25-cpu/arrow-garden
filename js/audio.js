// Soft synthesized sounds with the Web Audio API. No audio files.

// Major pentatonic steps: consecutive exits climb a scale that always sounds pleasant.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const STREAK_RESET_MS = 2500;

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.streak = 0;
    this.lastExit = 0;
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
    const now = performance.now();
    if (now - this.lastExit > STREAK_RESET_MS) this.streak = 0;
    this.lastExit = now;
    const step = PENTATONIC[Math.min(this.streak, PENTATONIC.length - 1)];
    this.streak++;
    const freq = 392 * 2 ** (step / 12);
    this.tone(freq, { dur: 0.45, type: 'triangle', gain: 0.09, slide: 1.02 });
    this.tone(freq * 2, { dur: 0.25, gain: 0.025 });
  }

  bump() {
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
