/* ============================================================
   audio.js  —  tiny synthesized sound engine (WebAudio).
   All sounds are generated at runtime (oscillators + noise) —
   no audio files. Context is created on the first user gesture
   to satisfy browser autoplay rules. Toggle music with M.
   ============================================================ */

BB.Audio = {
  ctx: null,
  master: null,
  musicGain: null,
  enabled: true,
  musicOn: true,
  stepTime: 0,
  stepDur: 0.16,
  patternIndex: 0,
  // Am – F – C – G, one chord per bar (root + two chord tones for the arpeggio)
  chords: [
    [220.0, 261.6, 329.6],
    [174.6, 220.0, 261.6],
    [261.6, 329.6, 392.0],
    [196.0, 246.9, 293.7],
  ],

  init() {
    const resume = () => this.ensure();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "m") this.toggleMusic();
      resume();
    });
  },

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 1 : 0;
      this.musicGain.connect(this.master);
    } catch (e) {
      this.enabled = false;
    }
  },

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? 1 : 0;
  },

  _t() { return this.ctx.currentTime; },

  tone(freq, dur, type = "sine", vol = 0.3, slideTo = null, dest = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this._t();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.3, filt = 1200) {
    if (!this.enabled || !this.ctx) return;
    const t = this._t();
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filt;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  // schedule a tone at an absolute context time (for little melodic stingers)
  _toneAt(freq, t, dur, type, vol, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  // a quick sequence of notes (win/lose jingles)
  arp(freqs, step, dur, vol, type = "triangle") {
    if (!this.enabled || !this.ctx) return;
    const t0 = this._t();
    freqs.forEach((f, i) => this._toneAt(f, t0 + i * step, dur, type, vol));
  },

  // punchy kick drum for the music groove
  kick() {
    if (!this.enabled || !this.ctx) return;
    const t = this._t();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + 0.16);
  },

  play(name) {
    this.ensure();
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case "jump": this.tone(300, 0.16, "square", 0.16, 600); break;
      case "land": this.tone(150, 0.1, "sine", 0.18, 80); break;
      case "hit": this.noise(0.13, 0.32, 1900); this.tone(220, 0.1, "sawtooth", 0.14, 120); break;
      case "boom": this.noise(0.4, 0.5, 620); this.tone(90, 0.4, "sine", 0.3, 40); break;
      case "shoot": this.tone(520, 0.08, "square", 0.11, 300); break;
      case "laser": this.tone(900, 0.16, "sawtooth", 0.15, 280); break;
      case "whoosh": this.noise(0.16, 0.14, 900); break;
      case "death": this.tone(400, 0.5, "sawtooth", 0.24, 60); this.noise(0.3, 0.28, 900); break;
      case "click": this.tone(660, 0.06, "square", 0.14, 880); break;
      case "fight": this.tone(520, 0.18, "square", 0.2, 780); break;
      case "heal": this.tone(440, 0.18, "sine", 0.16, 660); break;
      case "win": this.arp([523.3, 659.3, 784.0, 1046.5], 0.10, 0.24, 0.22); break;
      case "lose": this.arp([392.0, 311.1, 261.6, 196.0], 0.12, 0.30, 0.20, "sawtooth"); break;
    }
  },

  // called every frame from the game loop to sequence the music:
  // kick + hats + bass + arpeggio over a looping 4-chord progression
  tick(dt) {
    if (!this.enabled || !this.ctx || !this.musicOn) return;
    this.stepTime += dt;
    if (this.stepTime < this.stepDur) return;
    this.stepTime -= this.stepDur;

    const step = this.patternIndex % 16;                       // 16 steps per bar
    const chord = this.chords[Math.floor(this.patternIndex / 16) % this.chords.length];

    if (step % 4 === 0) this.kick();                           // four-on-the-floor
    if (step % 2 === 1) this.noise(0.03, 0.05, 7000);          // hi-hat
    if (step === 0 || step === 8) this.tone(chord[0] / 2, this.stepDur * 2.4, "triangle", 0.13, null, this.musicGain); // bass
    // arpeggio, jumping up an octave in the back half of the bar
    const note = chord[step % 3] * (step < 8 ? 1 : 2);
    this.tone(note, this.stepDur * 0.85, "triangle", 0.075, null, this.musicGain);

    this.patternIndex++;
  },
};
