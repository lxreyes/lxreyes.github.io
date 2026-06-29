/**
 * Tiny synthesized sound engine built on the Web Audio API.
 * No audio files needed — every sound is generated from oscillators and noise.
 * The AudioContext must be created/resumed after a user gesture (the start
 * click), which is why we lazily init on the first play.
 */
class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // A short burst of filtered noise — the basis for gunfire and impacts.
  _noise(duration, { type = 'lowpass', freq = 1200, gain = 0.5, attack = 0.001 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    src.connect(filter).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  _tone(freq, duration, { type = 'square', gain = 0.3, slideTo = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  // The player's gun — punchy.
  shoot() {
    this._noise(0.12, { type: 'lowpass', freq: 1800, gain: 0.6 });
    this._tone(180, 0.1, { type: 'square', gain: 0.25, slideTo: 60 });
  }

  // A distant/teammate shot — quieter and duller. `level` scales with distance.
  shootDistant(level = 0.3) {
    this._noise(0.1, { type: 'lowpass', freq: 900, gain: 0.5 * level });
  }

  hit() { // your bullet connects
    this._tone(900, 0.05, { type: 'sine', gain: 0.25, slideTo: 1300 });
  }

  kill() {
    this._tone(660, 0.08, { type: 'triangle', gain: 0.3 });
    this._tone(990, 0.12, { type: 'triangle', gain: 0.25 });
  }

  hurt() { // you take damage
    this._noise(0.18, { type: 'lowpass', freq: 500, gain: 0.5 });
    this._tone(120, 0.18, { type: 'sawtooth', gain: 0.2, slideTo: 70 });
  }

  reload() {
    this._tone(300, 0.05, { type: 'square', gain: 0.2 });
    setTimeout(() => this._tone(420, 0.06, { type: 'square', gain: 0.2 }), 180);
  }

  empty() { // dry fire
    this._tone(140, 0.04, { type: 'square', gain: 0.15 });
  }

  respawn() {
    this._tone(420, 0.1, { type: 'sine', gain: 0.25, slideTo: 740 });
  }

  explosion() {
    this._noise(0.45, { type: 'lowpass', freq: 700, gain: 0.7 });
    this._tone(90, 0.4, { type: 'sawtooth', gain: 0.4, slideTo: 40 });
  }

  boost() {
    this._tone(300, 0.3, { type: 'sine', gain: 0.3, slideTo: 1200 });
    this._noise(0.2, { type: 'highpass', freq: 600, gain: 0.25 });
  }

  powerup() {
    // Bright rising arpeggio.
    this._tone(523, 0.08, { type: 'triangle', gain: 0.28 });
    setTimeout(() => this._tone(784, 0.08, { type: 'triangle', gain: 0.28 }), 70);
    setTimeout(() => this._tone(1046, 0.14, { type: 'triangle', gain: 0.28 }), 140);
  }

  matchEnd(win) {
    if (win) {
      this._tone(523, 0.12, { type: 'triangle', gain: 0.3 });
      setTimeout(() => this._tone(659, 0.12, { type: 'triangle', gain: 0.3 }), 120);
      setTimeout(() => this._tone(784, 0.22, { type: 'triangle', gain: 0.3 }), 240);
    } else {
      this._tone(330, 0.18, { type: 'sawtooth', gain: 0.3, slideTo: 160 });
      setTimeout(() => this._tone(220, 0.3, { type: 'sawtooth', gain: 0.3, slideTo: 110 }), 180);
    }
  }
}
