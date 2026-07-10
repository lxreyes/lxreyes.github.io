// ============================================================
// sfx.js — tiny synthesized sound effects (no audio files).
// Uses the Web Audio API: each sound is a short oscillator sweep.
// ============================================================

const SFX = (() => {
  let ctx = null;
  let muted = false;

  // Browsers only allow audio after a user gesture, so we create
  // the AudioContext lazily on the first key press.
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { /* no audio support — game still works */ }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (ctx && typeof MUSIC !== 'undefined') MUSIC.ensure(ctx);
  }

  function tone(freqStart, freqEnd, dur, type, vol) {
    if (muted || !ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* never let audio crash the game */ }
  }

  return {
    ensure,
    toggleMute() { muted = !muted; return muted; },
    swing()  { tone(320, 140, 0.08, 'triangle', 0.12); },
    hit()    { tone(170, 110, 0.07, 'square', 0.12); },
    crit()   { tone(500, 200, 0.12, 'square', 0.15); },
    hurt()   { tone(120, 60, 0.25, 'sawtooth', 0.18); },
    coin()   { tone(900, 1500, 0.07, 'sine', 0.12); },
    heart()  { tone(500, 900, 0.15, 'sine', 0.12); },
    door()   { tone(200, 90, 0.15, 'triangle', 0.1); },
    death()  { tone(300, 50, 0.7, 'sawtooth', 0.2); },
    bossHit(){ tone(90, 60, 0.12, 'square', 0.18); },
    win() {
      tone(520, 520, 0.12, 'square', 0.12);
      setTimeout(() => tone(660, 660, 0.12, 'square', 0.12), 130);
      setTimeout(() => tone(780, 780, 0.25, 'square', 0.12), 260);
    },
    select() { tone(440, 660, 0.06, 'square', 0.08); },
    buy()    { tone(700, 1100, 0.12, 'sine', 0.12); },
    denied() { tone(160, 120, 0.15, 'square', 0.1); },
    chest()  { tone(400, 800, 0.15, 'triangle', 0.13); },
    blessing() {
      tone(600, 600, 0.1, 'sine', 0.12);
      setTimeout(() => tone(900, 900, 0.2, 'sine', 0.12), 110);
    },
    dash()     { tone(600, 200, 0.12, 'triangle', 0.12); },
    special()  { tone(300, 700, 0.18, 'square', 0.12); },
    elevator() { tone(180, 50, 1.4, 'sawtooth', 0.09); },
    clank()    { tone(100, 55, 0.18, 'square', 0.16); },
    unlock() {
      tone(500, 500, 0.1, 'square', 0.1);
      setTimeout(() => tone(750, 750, 0.18, 'square', 0.1), 120);
    },
    type()   { tone(700, 500, 0.03, 'square', 0.05); },
    blackout() {
      tone(120, 35, 1.2, 'sawtooth', 0.16);
      setTimeout(() => tone(80, 30, 1.0, 'triangle', 0.12), 250);
    },
    potion() { tone(300, 600, 0.25, 'sine', 0.13); },
    curse() {
      tone(220, 90, 0.5, 'sawtooth', 0.15);
      setTimeout(() => tone(180, 70, 0.4, 'sawtooth', 0.12), 180);
    },
    turret() { tone(880, 700, 0.05, 'square', 0.08); },
    gem()    { tone(1100, 1800, 0.12, 'sine', 0.12); },
  };
})();


// ============================================================
// MUSIC — a tiny generative score, no audio files.
// A bass heartbeat and minor-scale arpeggios, scheduled a little
// ahead of the clock. The mood follows where you are, a combat
// layer kicks in when enemies are around, and big moments spike
// the excitement (which then cools off on its own).
// ============================================================
const MUSIC = (() => {
  let ctx = null;
  let master = null;
  let mood = null;
  let params = { bpm: 70, root: 45, dark: 0.3 };
  let nextTime = 0;
  let step = 0;
  let muted = false;
  let excitement = 0;   // spikes on events, cools over ~4s
  let combat = false;   // enemies on screen
  let lastClock = 0;

  const MOODS = {
    menu:     { bpm: 60,  root: 49, dark: 0.2, sparse: true },
    surface:  { bpm: 70,  root: 47, dark: 0.3 },
    floor0:   { bpm: 84,  root: 45, dark: 0.4 },
    floor1:   { bpm: 88,  root: 43, dark: 0.45 },
    floor2:   { bpm: 92,  root: 41, dark: 0.5 },
    floor3:   { bpm: 96,  root: 40, dark: 0.6 },
    floor4:   { bpm: 100, root: 38, dark: 0.7 },
    floor5:   { bpm: 92,  root: 36, dark: 0.8 },
    fight:    { bpm: 112, root: 37, dark: 0.7 },   // arena / gauntlet
    guardian: { bpm: 118, root: 34, dark: 0.85 },  // keymaster duels
    boss:     { bpm: 126, root: 33, dark: 0.9 },
    blackout: { bpm: 112, root: 34, dark: 1 },
  };

  const SCALE = [0, 2, 3, 5, 7, 10];   // natural minor, no sixth
  const PROG = [0, -4, -2, -5];        // a slow, sad progression

  function ensure(sharedCtx) {
    if (master || !sharedCtx) return;
    ctx = sharedCtx;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    nextTime = ctx.currentTime + 0.1;
    lastClock = ctx.currentTime;
    setInterval(schedule, 150);
  }

  function setMood(m) {
    if (m !== mood && MOODS[m]) {
      mood = m;
      params = MOODS[m];
    }
  }

  function setCombat(c) { combat = !!c; }

  // A jolt of excitement: pain, bells, blackouts, big reveals.
  function excite(amount) {
    excitement = Math.min(1, excitement + amount);
  }

  function note(midi, t, dur, type, vol) {
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch (e) { /* music must never crash the game */ }
  }

  // A dry percussive tick (no noise buffer needed).
  function tick(t, vol, low) {
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = low ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(low ? 70 : 2600, t);
      if (low) osc.frequency.exponentialRampToValueAtTime(40, t + 0.09);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (low ? 0.12 : 0.04));
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch (e) {}
  }

  // Schedule a few hundred ms of score ahead of the clock.
  function schedule() {
    if (!ctx) return;
    const now = ctx.currentTime;
    excitement = Math.max(0, excitement - (now - lastClock) * 0.25);
    lastClock = now;
    if (muted) {
      nextTime = Math.max(nextTime, now + 0.05);
      return;
    }

    // how hard the music leans in right now
    const intensity = Math.min(1,
      (combat ? 0.45 : 0) + excitement + Math.max(0, params.dark - 0.3) * 0.4);
    const bpm = params.bpm * (1 + intensity * 0.16);
    const spb = 60 / bpm / 2; // eighth notes
    const volMul = 0.95 + intensity * 0.85;

    while (nextTime < now + 0.45) {
      const bar = Math.floor(step / 16);
      const root = params.root + PROG[bar % PROG.length];
      const st = step % 16;

      // the bass heartbeat
      if (st % 4 === 0) {
        note(root - 12, nextTime, spb * 3.4, 'triangle', 0.14 * volMul);
      }
      // wandering arpeggio, denser when things are loud
      const arpChance = (params.sparse ? 0.35 : 0.75) + intensity * 0.2;
      if ((!params.sparse || st % 2 === 0) && Math.random() < arpChance) {
        const deg = SCALE[Math.floor(Math.random() * SCALE.length)];
        note(root + 12 + deg, nextTime, spb * 1.6,
          params.dark > 0.6 ? 'square' : 'sine',
          (0.045 + params.dark * 0.02) * volMul);
      }
      // combat percussion: hats on the off-beats, a thump on the one
      if (intensity > 0.35 && st % 2 === 1) {
        tick(nextTime, 0.05 * intensity, false);
      }
      if (intensity > 0.55 && st % 8 === 0) {
        tick(nextTime, 0.2 * intensity, true);
      }
      // a low, wrong pulse when things are bad
      if (params.dark >= 0.85 && st % 8 === 4) {
        note(root - 23.7, nextTime, spb * 2, 'sawtooth', 0.07 * volMul);
      }
      step++;
      nextTime += spb;
    }
  }

  return {
    ensure,
    setMood,
    setCombat,
    excite,
    toggleMute() { muted = !muted; return muted; },
  };
})();
