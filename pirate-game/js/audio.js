// Tiny procedural sound engine — all effects are synthesized with the Web
// Audio API, so there are no audio files to load. Browsers require a user
// gesture before audio can start, so call Sound.unlock() from a click.

const Sound = {
  ctx: null,
  master: null,
  muted: false,
  volume: 0.3,

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null; // audio just won't play; the game still works
    }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  },

  // A single shaped oscillator note. opts: {freq, dur, type, vol, slideTo, delay}
  _blip(opts) {
    if (!this.ctx || this.muted) return;
    const { freq, dur = 0.15, type = "sine", vol = 0.3, slideTo = 0, delay = 0 } = opts;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  // A burst of filtered noise — good for booms and splashes.
  _noise(dur, vol, cutoff) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = cutoff || 1200;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.3;
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
  },

  // ---- The actual effects ----
  cannon() {
    this._noise(0.22, 0.45, 800);
    this._blip({ freq: 160, slideTo: 50, dur: 0.2, type: "square", vol: 0.22 });
  },
  hit() {
    this._noise(0.12, 0.3, 2000);
  },
  explosion() {
    this._noise(0.55, 0.6, 520);
    this._blip({ freq: 90, slideTo: 30, dur: 0.45, type: "sawtooth", vol: 0.28 });
  },
  coin() {
    this._blip({ freq: 880, dur: 0.07, type: "square", vol: 0.15 });
    this._blip({ freq: 1320, dur: 0.09, type: "square", vol: 0.13, delay: 0.06 });
  },
  bomb() {
    this._blip({ freq: 300, slideTo: 60, dur: 0.3, type: "sawtooth", vol: 0.28 });
    this._noise(0.3, 0.4, 500);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this._blip({ freq: f, dur: 0.2, type: "triangle", vol: 0.24, delay: i * 0.12 }));
  },
  lose() {
    [392, 311, 247].forEach((f, i) =>
      this._blip({ freq: f, dur: 0.32, type: "sawtooth", vol: 0.24, delay: i * 0.16 }));
  },
};
