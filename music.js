/*
 * Shared procedural music engine for portfolio games.
 *
 * Each game picks a preset by name; the engine schedules melody, bass, and
 * drum patterns on a 16-step grid using a Web Audio look-ahead scheduler.
 * No audio files, no dependencies. Volume is shared via localStorage so the
 * mute state persists across games.
 */
(function () {
  if (window.Music) return;

  var N = {};
  // Generate equal-temperament note table from C2 to C6
  var noteNames = ['C', 'CS', 'D', 'DS', 'E', 'F', 'FS', 'G', 'GS', 'A', 'AS', 'B'];
  for (var oct = 1; oct <= 6; oct++) {
    for (var i = 0; i < 12; i++) {
      var midi = 12 * (oct + 1) + i;
      N[noteNames[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
    }
  }

  // -------- Presets --------
  // Each preset: { bpm, steps, melody[steps], bass[steps], kick[steps], snare[steps], hat[steps], mel{type,vol,dur}, bs{type,vol,dur} }
  // 0 in a pattern = rest, otherwise frequency in Hz.
  function arr(len, fill) { var a = []; for (var i = 0; i < len; i++) a.push(fill || 0); return a; }
  function mark(a, indices) { for (var i = 0; i < indices.length; i++) a[indices[i]] = 1; return a; }

  var PRESETS = {
    // 1. TOWER STACK — calm pentatonic stacker
    'tower-stack': {
      bpm: 96,
      steps: 16,
      melody: [N.E4, 0, 0, N.G4, 0, N.A4, 0, N.B4, 0, N.A4, 0, N.G4, 0, N.E4, 0, 0],
      bass:   [N.E2, 0, 0, 0, 0, 0, 0, 0, N.A2, 0, 0, 0, 0, 0, 0, 0],
      kick:   mark(arr(16), [0, 8]),
      hat:    mark(arr(16), [4, 12]),
      mel: { type: 'triangle', vol: 0.08, dur: 0.32 },
      bs:  { type: 'sine', vol: 0.10, dur: 0.55 }
    },

    // 2. TILE TAP — bouncy poppy arpeggio
    'tile-tap': {
      bpm: 128,
      steps: 16,
      melody: [N.A4, N.CS5, N.E5, N.A5, N.E5, N.CS5, N.A4, N.FS4, N.A4, N.CS5, N.FS5, N.A5, N.FS5, N.E5, N.CS5, N.A4],
      bass:   [N.A2, 0, 0, 0, N.E2, 0, 0, 0, N.FS2, 0, 0, 0, N.E2, 0, 0, 0],
      kick:   mark(arr(16), [0, 4, 8, 12]),
      hat:    mark(arr(16), [2, 6, 10, 14]),
      snare:  mark(arr(16), [4, 12]),
      mel: { type: 'triangle', vol: 0.06, dur: 0.18 },
      bs:  { type: 'sawtooth', vol: 0.07, dur: 0.4 }
    },

    // 3. BUBBLE POP — dreamy chimes
    'bubble-pop': {
      bpm: 88,
      steps: 16,
      melody: [N.C5, 0, N.E5, 0, N.G5, 0, N.E5, 0, N.A5, 0, N.G5, 0, N.E5, 0, N.D5, 0],
      bass:   [N.C3, 0, 0, 0, 0, 0, 0, 0, N.F2, 0, 0, 0, N.G2, 0, 0, 0],
      hat:    mark(arr(16), [4, 12]),
      mel: { type: 'sine', vol: 0.08, dur: 0.45 },
      bs:  { type: 'sine', vol: 0.07, dur: 0.5 }
    },

    // 4. NINJA RUN — driving action
    'ninja-run': {
      bpm: 138,
      steps: 16,
      melody: [N.D5, 0, N.F5, N.D5, N.A4, 0, N.D5, 0, N.E5, 0, N.G5, N.E5, N.C5, 0, N.E5, 0],
      bass:   [N.D2, N.D2, 0, 0, N.A1 || N.A2, 0, 0, 0, N.G2, N.G2, 0, 0, N.A2, 0, 0, 0],
      kick:   mark(arr(16), [0, 6, 8, 14]),
      snare:  mark(arr(16), [4, 12]),
      hat:    mark(arr(16), [0, 2, 4, 6, 8, 10, 12, 14]),
      mel: { type: 'sawtooth', vol: 0.05, dur: 0.18 },
      bs:  { type: 'square', vol: 0.06, dur: 0.22 }
    },

    // 5. COLOR MATCH — slow ambient
    'color-match': {
      bpm: 78,
      steps: 16,
      melody: [N.G4, 0, 0, 0, N.B4, 0, 0, 0, N.D5, 0, 0, 0, N.B4, 0, 0, 0],
      bass:   [N.G2, 0, 0, 0, 0, 0, 0, 0, N.D3, 0, 0, 0, 0, 0, 0, 0],
      hat:    mark(arr(16), [8]),
      mel: { type: 'sine', vol: 0.08, dur: 0.7 },
      bs:  { type: 'sine', vol: 0.10, dur: 1.1 }
    },

    // 6. DODGEBALL — punchy mid-tempo
    'dodgeball': {
      bpm: 124,
      steps: 16,
      melody: [N.E5, 0, N.E5, 0, N.G5, 0, N.E5, 0, N.D5, 0, N.D5, 0, N.E5, 0, N.G5, 0],
      bass:   [N.E2, 0, 0, 0, N.A2, 0, 0, 0, N.G2, 0, 0, 0, N.B2, 0, 0, 0],
      kick:   mark(arr(16), [0, 4, 8, 12]),
      snare:  mark(arr(16), [4, 12]),
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'square', vol: 0.05, dur: 0.18 },
      bs:  { type: 'sawtooth', vol: 0.07, dur: 0.35 }
    },

    // 7. BLOCK DROP — classic block-puzzle
    'block-drop': {
      bpm: 134,
      steps: 16,
      melody: [N.E5, N.B4, N.C5, N.D5, N.C5, N.B4, N.A4, N.A4, N.C5, N.E5, N.D5, N.C5, N.B4, N.C5, N.D5, N.E5],
      bass:   [N.A2, 0, 0, 0, N.E2, 0, 0, 0, N.A2, 0, 0, 0, N.E2, 0, 0, 0],
      kick:   mark(arr(16), [0, 8]),
      snare:  mark(arr(16), [4, 12]),
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'square', vol: 0.05, dur: 0.16 },
      bs:  { type: 'square', vol: 0.06, dur: 0.4 }
    },

    // 8. WORD RUSH — flowing arpeggios
    'word-rush': {
      bpm: 112,
      steps: 16,
      melody: [N.D4, N.F4, N.A4, N.D5, N.A4, N.F4, N.D4, N.F4, N.E4, N.G4, N.B4, N.E5, N.B4, N.G4, N.E4, N.G4],
      bass:   [N.D2, 0, 0, 0, 0, 0, 0, 0, N.E2, 0, 0, 0, 0, 0, 0, 0],
      hat:    mark(arr(16), [0, 4, 8, 12]),
      mel: { type: 'triangle', vol: 0.06, dur: 0.18 },
      bs:  { type: 'sine', vol: 0.10, dur: 1.0 }
    },

    // 9. SUDOKU MINI — meditative
    'sudoku-mini': {
      bpm: 70,
      steps: 16,
      melody: [N.A4, 0, 0, 0, 0, 0, 0, 0, N.C5, 0, 0, 0, 0, 0, 0, 0],
      bass:   [N.A2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      mel: { type: 'sine', vol: 0.07, dur: 1.4 },
      bs:  { type: 'sine', vol: 0.08, dur: 2.0 }
    },

    // 10. KART LOOPS — fast synthwave
    'kart-loops': {
      bpm: 148,
      steps: 16,
      melody: [N.A4, N.CS5, N.E5, N.CS5, N.A4, N.CS5, N.E5, N.A5, N.B4, N.D5, N.FS5, N.D5, N.B4, N.D5, N.FS5, N.B5],
      bass:   [N.A2, N.A2, N.E3, N.A2, N.A2, N.A2, N.E3, N.A2, N.B2, N.B2, N.FS3, N.B2, N.B2, N.B2, N.FS3, N.B2],
      kick:   mark(arr(16), [0, 4, 8, 12]),
      snare:  mark(arr(16), [4, 12]),
      hat:    mark(arr(16), [0, 2, 4, 6, 8, 10, 12, 14]),
      mel: { type: 'sawtooth', vol: 0.05, dur: 0.15 },
      bs:  { type: 'square', vol: 0.06, dur: 0.18 }
    },

    // 11. CHESS LITE — baroque, slow
    'chess-lite': {
      bpm: 72,
      steps: 16,
      melody: [N.D4, N.E4, N.F4, N.G4, N.A4, 0, N.G4, 0, N.F4, N.E4, N.D4, N.E4, N.F4, 0, N.D4, 0],
      bass:   [N.D2, 0, 0, 0, N.A2, 0, 0, 0, N.D2, 0, 0, 0, N.G2, 0, 0, 0],
      mel: { type: 'triangle', vol: 0.07, dur: 0.5 },
      bs:  { type: 'triangle', vol: 0.08, dur: 0.8 }
    },

    // 12. SPACE ZOOM — dark sci-fi synth
    'space-zoom': {
      bpm: 124,
      steps: 16,
      melody: [N.G4, 0, N.G4, 0, N.AS4, 0, N.D5, 0, N.F4, 0, N.F4, 0, N.GS4, 0, N.CS5, 0],
      bass:   [N.G2, N.G2, 0, 0, N.G2, 0, 0, 0, N.F2, N.F2, 0, 0, N.F2, 0, 0, 0],
      kick:   mark(arr(16), [0, 8]),
      snare:  mark(arr(16), [4, 12]),
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'sawtooth', vol: 0.05, dur: 0.22 },
      bs:  { type: 'square', vol: 0.07, dur: 0.3 }
    }
  };

  // -------- Engine --------
  var ctx = null;
  var masterGain = null;
  var running = false;
  var preset = null;
  var stepDur = 0.15;
  var nextNoteTime = 0;
  var step = 0;
  var timer = null;
  var muted = false;

  try { muted = localStorage.getItem('music-muted') === '1'; } catch (_) {}

  function ensureCtx() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.85;
      masterGain.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function note(freq, dur, type, vol, time) {
    if (!ctx || !freq) return;
    var t = time || ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    o.type = type || 'sine';
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(masterGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function kick(vol, time) {
    if (!ctx) return;
    var t = time || ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.13);
    o.type = 'sine';
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(masterGain);
    o.start(t);
    o.stop(t + 0.15);
  }

  function snare(vol, time) {
    if (!ctx) return;
    var t = time || ctx.currentTime;
    var bs = Math.floor(ctx.sampleRate * 0.12);
    var buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < bs; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bs, 1.5);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 900;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(filt).connect(g).connect(masterGain);
    src.start(t);
    src.stop(t + 0.13);
  }

  function hat(vol, time) {
    if (!ctx) return;
    var t = time || ctx.currentTime;
    var bs = Math.floor(ctx.sampleRate * 0.035);
    var buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < bs; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bs, 2);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 6000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(filt).connect(g).connect(masterGain);
    src.start(t);
    src.stop(t + 0.04);
  }

  function scheduleStep(s, time) {
    if (!preset) return;
    var melFreq = preset.melody && preset.melody[s];
    if (melFreq) note(melFreq, preset.mel.dur, preset.mel.type, preset.mel.vol, time);
    var bsFreq = preset.bass && preset.bass[s];
    if (bsFreq) note(bsFreq, preset.bs.dur, preset.bs.type, preset.bs.vol, time);
    if (preset.kick && preset.kick[s]) kick(0.22, time);
    if (preset.snare && preset.snare[s]) snare(0.12, time);
    if (preset.hat && preset.hat[s]) hat(0.05, time);
  }

  function scheduler() {
    if (!running || !ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += stepDur;
      step = (step + 1) % preset.steps;
    }
  }

  function start(name) {
    var p = PRESETS[name];
    if (!p) return;
    ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    preset = p;
    stepDur = (60 / preset.bpm) / 4; // 16th notes
    step = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    running = true;
    if (timer) clearInterval(timer);
    timer = setInterval(scheduler, 25);
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('music-muted', muted ? '1' : '0'); } catch (_) {}
    if (masterGain && ctx) {
      var t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.linearRampToValueAtTime(muted ? 0 : 0.85, t + 0.08);
    }
  }

  function toggle() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  window.Music = {
    start: start,
    stop: stop,
    setMuted: setMuted,
    toggle: toggle,
    isMuted: isMuted
  };
})();
