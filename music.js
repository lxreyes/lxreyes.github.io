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
    },

    // 13. PASSWORD GAME — typewriter-ish bounce
    'password-game': {
      bpm: 96,
      steps: 16,
      melody: [N.C5, 0, N.E5, 0, N.G5, 0, N.E5, 0, N.A4, 0, N.C5, 0, N.E5, 0, N.D5, 0],
      bass:   [N.C3, 0, 0, 0, 0, 0, 0, 0, N.A2, 0, 0, 0, N.G2, 0, 0, 0],
      hat:    mark(arr(16), [0, 2, 4, 6, 8, 10, 12, 14]),
      mel: { type: 'triangle', vol: 0.05, dur: 0.18 },
      bs:  { type: 'sine', vol: 0.08, dur: 0.55 }
    },

    // 14. TROLLEY — somber organ
    'trolley': {
      bpm: 64,
      steps: 16,
      melody: [N.D4, 0, 0, 0, N.F4, 0, 0, 0, N.A4, 0, 0, 0, N.F4, 0, N.E4, 0],
      bass:   [N.D2, 0, 0, 0, 0, 0, 0, 0, N.A2, 0, 0, 0, 0, 0, 0, 0],
      mel: { type: 'triangle', vol: 0.07, dur: 0.75 },
      bs:  { type: 'sine', vol: 0.10, dur: 1.5 }
    },

    // 15. GAME OF LIFE — generative ambient
    'game-of-life': {
      bpm: 84,
      steps: 16,
      melody: [N.E4, 0, N.B4, 0, N.G4, 0, N.D5, 0, N.A4, 0, N.E5, 0, N.B4, 0, N.FS5, 0],
      bass:   [N.E2, 0, 0, 0, 0, 0, 0, 0, N.A2, 0, 0, 0, 0, 0, 0, 0],
      hat:    mark(arr(16), [3, 11]),
      mel: { type: 'sine', vol: 0.06, dur: 0.5 },
      bs:  { type: 'sine', vol: 0.09, dur: 1.1 }
    },

    // 16. SNAKE — bouncy 8-bit pentatonic
    'snake': {
      bpm: 122,
      steps: 16,
      melody: [N.E5, N.B4, N.C5, N.D5, N.E5, 0, N.D5, N.C5, N.B4, 0, N.A4, N.B4, N.C5, 0, N.D5, 0],
      bass:   [N.A2, 0, 0, 0, N.E2, 0, 0, 0, N.A2, 0, 0, 0, N.E2, 0, 0, 0],
      kick:   mark(arr(16), [0, 4, 8, 12]),
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'square', vol: 0.05, dur: 0.15 },
      bs:  { type: 'square', vol: 0.06, dur: 0.4 }
    },

    // 17. PONG — minimal beat with off-court reverbless tones
    'pong': {
      bpm: 100,
      steps: 16,
      melody: [N.C5, 0, 0, 0, N.E5, 0, 0, 0, N.G5, 0, 0, 0, N.E5, 0, 0, 0],
      bass:   [N.C3, 0, 0, 0, 0, 0, 0, 0, N.G2, 0, 0, 0, 0, 0, 0, 0],
      kick:   mark(arr(16), [0, 8]),
      hat:    mark(arr(16), [4, 12]),
      mel: { type: 'sine', vol: 0.06, dur: 0.25 },
      bs:  { type: 'sine', vol: 0.08, dur: 0.6 }
    },

    // 18. MEMORY — soft glockenspiel
    'memory': {
      bpm: 76,
      steps: 16,
      melody: [N.A5, 0, N.E5, 0, N.C5, 0, N.E5, 0, N.G5, 0, N.D5, 0, N.B4, 0, N.D5, 0],
      bass:   [N.A2, 0, 0, 0, 0, 0, 0, 0, N.G2, 0, 0, 0, 0, 0, 0, 0],
      mel: { type: 'sine', vol: 0.07, dur: 0.5 },
      bs:  { type: 'sine', vol: 0.08, dur: 1.0 }
    },

    // 19. 2048 — focused arpeggios
    'twenty-48': {
      bpm: 108,
      steps: 16,
      melody: [N.D4, N.A4, N.F5, N.A4, N.D4, N.A4, N.F5, N.A4, N.E4, N.B4, N.G5, N.B4, N.E4, N.B4, N.G5, N.B4],
      bass:   [N.D2, 0, 0, 0, 0, 0, 0, 0, N.E2, 0, 0, 0, 0, 0, 0, 0],
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'triangle', vol: 0.05, dur: 0.16 },
      bs:  { type: 'sine', vol: 0.09, dur: 1.0 }
    },

    // 20. CONNECT FOUR — strategy march
    'connect-four': {
      bpm: 92,
      steps: 16,
      melody: [N.C4, 0, N.E4, 0, N.G4, 0, N.C5, 0, N.B4, 0, N.G4, 0, N.E4, 0, N.D4, 0],
      bass:   [N.C2, 0, 0, 0, N.G2, 0, 0, 0, N.A2, 0, 0, 0, N.G2, 0, 0, 0],
      kick:   mark(arr(16), [0, 8]),
      snare:  mark(arr(16), [4, 12]),
      mel: { type: 'triangle', vol: 0.06, dur: 0.32 },
      bs:  { type: 'triangle', vol: 0.07, dur: 0.7 }
    },

    // 23. COZY CABIN — warm, slow lullaby with sparse notes
    'cozy-cabin': {
      bpm: 62,
      steps: 16,
      melody: [N.C5, 0, 0, 0, N.E5, 0, 0, 0, N.G4, 0, 0, 0, N.A4, 0, 0, 0],
      bass:   [N.C3, 0, 0, 0, 0, 0, 0, 0, N.G2, 0, 0, 0, 0, 0, 0, 0],
      mel: { type: 'sine', vol: 0.04, dur: 1.1 },
      bs:  { type: 'sine', vol: 0.06, dur: 2.0 }
    },

    // 22. PORTFOLIO — chill ambient lobby, slow and airy
    'portfolio': {
      bpm: 80,
      steps: 16,
      melody: [N.E5, 0, 0, 0, N.G5, 0, 0, N.A5, 0, 0, N.E5, 0, N.D5, 0, 0, 0],
      bass:   [N.A2, 0, 0, 0, 0, 0, 0, 0, N.E2, 0, 0, 0, 0, 0, 0, 0],
      hat:    mark(arr(16), [4, 12]),
      mel: { type: 'sine', vol: 0.045, dur: 0.7 },
      bs:  { type: 'sine', vol: 0.07, dur: 1.4 }
    },

    // 21. BLACKJACK — smoky jazz lounge
    'blackjack': {
      bpm: 80,
      steps: 16,
      melody: [N.A4, 0, N.C5, N.E5, N.D5, 0, N.C5, N.B4, N.A4, 0, N.G4, N.A4, N.B4, 0, N.A4, 0],
      bass:   [N.A2, 0, N.E3, 0, N.A2, 0, N.E3, 0, N.D2, 0, N.A2, 0, N.E2, 0, N.G2, 0],
      hat:    mark(arr(16), [2, 6, 10, 14]),
      mel: { type: 'triangle', vol: 0.06, dur: 0.3 },
      bs:  { type: 'triangle', vol: 0.07, dur: 0.5 }
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

  // Intense mode — Plus-mode games pass {intense:true} to Music.start() and
  // the scheduler leans on the preset harder: louder + brighter melody, thicker
  // bass, kick on every quarter regardless of the pattern, snare on the back
  // beats, and hi-hat on every off-16th. The BPM bump happens in start().
  var intense = false;

  function scheduleStep(s, time) {
    if (!preset) return;
    var melVol = preset.mel.vol * (intense ? 1.5 : 1);
    var bsVol = preset.bs.vol * (intense ? 1.5 : 1);
    var melFreq = preset.melody && preset.melody[s];
    if (melFreq) note(melFreq, preset.mel.dur, preset.mel.type, melVol, time);
    var bsFreq = preset.bass && preset.bass[s];
    if (bsFreq) note(bsFreq, preset.bs.dur, preset.bs.type, bsVol, time);
    // Kicks: preset pattern OR (in intense mode) every quarter note.
    var stepsPerBeat = Math.max(1, Math.round(preset.steps / 4));
    var kickHit = preset.kick && preset.kick[s];
    if (intense && s % stepsPerBeat === 0) kickHit = 1;
    if (kickHit) kick(intense ? 0.32 : 0.22, time);
    // Snare: preset pattern OR (in intense mode) beats 2 & 4.
    var snareHit = preset.snare && preset.snare[s];
    if (intense && s % (stepsPerBeat * 2) === stepsPerBeat) snareHit = 1;
    if (snareHit) snare(intense ? 0.18 : 0.12, time);
    // Hi-hat: preset pattern OR (in intense mode) every off-8th.
    var hatHit = preset.hat && preset.hat[s];
    if (intense && s % Math.max(1, Math.round(stepsPerBeat / 2)) === Math.max(1, Math.round(stepsPerBeat / 2)) / 2) {
      // Half-step within each beat
    }
    if (intense && s % Math.max(1, stepsPerBeat / 2) === 0 && s % stepsPerBeat !== 0) hatHit = 1;
    if (hatHit) hat(intense ? 0.09 : 0.05, time);
  }

  function scheduler() {
    if (!running || !ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += stepDur;
      step = (step + 1) % preset.steps;
    }
  }

  var musicStartTime = 0;

  function start(name, opts) {
    var p = PRESETS[name];
    if (!p) return;
    ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    preset = p;
    // Intense mode: pump the tempo 20% and let scheduleStep() layer in extra
    // percussion so Plus-mode gameplay has a soundtrack that matches its
    // energy.
    intense = !!(opts && opts.intense);
    var effectiveBpm = preset.bpm * (intense ? 1.2 : 1);
    stepDur = (60 / effectiveBpm) / 4; // 16th notes
    step = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    musicStartTime = nextNoteTime;
    running = true;
    if (timer) clearInterval(timer);
    timer = setInterval(scheduler, 25);
  }

  // Toggle intensity without restarting the track — useful for games that flip
  // Plus mode mid-play.
  function setIntense(on) {
    if (!preset) { intense = !!on; return; }
    intense = !!on;
    var effectiveBpm = preset.bpm * (intense ? 1.2 : 1);
    stepDur = (60 / effectiveBpm) / 4;
  }

  function effectiveBpm() {
    return preset ? preset.bpm * (intense ? 1.2 : 1) : 0;
  }

  // Returns position within the current beat (0..1). -1 if music hasn't started.
  function beatPhase() {
    if (!preset || !ctx) return -1;
    var beatDur = 60 / effectiveBpm();
    var t = ((ctx.currentTime - musicStartTime) % beatDur + beatDur) % beatDur;
    return t / beatDur;
  }

  // Position within the current MEASURE (one bar = preset.steps sixteenth notes).
  // Returns 0..1 across the whole bar; the start of the bar (downbeat) is at 0.
  function measurePhase() {
    if (!preset || !ctx) return -1;
    var barDur = (60 / effectiveBpm()) * (preset.steps / 4);
    var t = ((ctx.currentTime - musicStartTime) % barDur + barDur) % barDur;
    return t / barDur;
  }

  // True if we're near the BIG beats — the downbeat (step 0) and the halfway
  // point of the bar (step 8 in a 16-step bar). The kick lives on every beat
  // in most presets, but only these two count as "big".
  function isOnDownbeat(toleranceMs) {
    var p = measurePhase();
    if (p < 0 || !preset) return false;
    var barDur = (60 / effectiveBpm()) * (preset.steps / 4);
    var tol = ((toleranceMs || 120) / 1000) / barDur;
    // Near 0 (downbeat) or near 0.5 (halfway through the bar)
    return p < tol || p > 1 - tol || Math.abs(p - 0.5) < tol;
  }

  // True if we're within `toleranceMs` of a beat (default 120ms).
  function isOnBeat(toleranceMs) {
    var p = beatPhase();
    if (p < 0 || !preset) return false;
    var beatDur = 60 / effectiveBpm();
    var tol = ((toleranceMs || 120) / 1000) / beatDur;
    return p < tol || p > 1 - tol;
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

  // ---------------------------------------------------- Sound effects
  // Quick one-shot SFX so individual games don't each ship their own oscillator
  // boilerplate. Routed through the shared master gain so the mute toggle
  // silences SFX along with the music.
  function sfx(name) {
    ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    var t = ctx.currentTime;
    switch (name) {
      case 'move':
        sfxTone(180, 0.05, 'sine', 0.08, t);
        break;
      case 'merge':
        sfxTone(440, 0.10, 'triangle', 0.14, t);
        sfxTone(660, 0.08, 'triangle', 0.10, t + 0.02);
        break;
      case 'wild':
        sfxTone(880, 0.10, 'sine', 0.14, t);
        sfxTone(1175, 0.10, 'sine', 0.12, t + 0.05);
        sfxTone(1568, 0.12, 'sine', 0.10, t + 0.10);
        break;
      case 'doubler':
        sfxTone(220, 0.04, 'sawtooth', 0.16, t);
        sfxTone(440, 0.06, 'square', 0.14, t + 0.03);
        sfxTone(880, 0.10, 'triangle', 0.12, t + 0.07);
        break;
      case 'mystery':
        // Random sparkle, three quick notes from a pentatonic pool
        var pool = [523, 587, 659, 784, 880, 1047];
        for (var i = 0; i < 3; i++) {
          var f = pool[Math.floor(Math.random() * pool.length)];
          sfxTone(f, 0.12, 'sine', 0.10, t + i * 0.05);
        }
        break;
      case 'hot':
        // Whoosh + crackle: descending tone over noise
        sfxSweep(1200, 300, 0.25, 'triangle', 0.14, t);
        sfxNoise(0.20, 0.08, 1800, t);
        break;
      case 'bomb':
        // Boom: low descending tone + noise burst
        sfxSweep(420, 40, 0.32, 'sawtooth', 0.22, t);
        sfxNoise(0.30, 0.18, 600, t);
        break;
      case 'combo':
        // Ascending chord
        sfxTone(523, 0.14, 'triangle', 0.14, t);
        sfxTone(659, 0.14, 'triangle', 0.14, t + 0.06);
        sfxTone(784, 0.18, 'triangle', 0.14, t + 0.12);
        break;
      case 'milestone':
        // Triumphant
        sfxTone(523, 0.18, 'triangle', 0.16, t);
        sfxTone(659, 0.18, 'triangle', 0.16, t + 0.04);
        sfxTone(784, 0.18, 'triangle', 0.16, t + 0.08);
        sfxTone(1047, 0.32, 'triangle', 0.16, t + 0.16);
        break;
      case 'undo':
        sfxTone(420, 0.06, 'sine', 0.12, t);
        sfxTone(320, 0.08, 'sine', 0.10, t + 0.04);
        break;
      case 'gameover':
        sfxSweep(280, 70, 0.45, 'sawtooth', 0.20, t);
        sfxSweep(180, 45, 0.55, 'sawtooth', 0.16, t + 0.1);
        break;
      case 'win':
        sfxTone(523, 0.14, 'triangle', 0.16, t);
        sfxTone(659, 0.14, 'triangle', 0.16, t + 0.08);
        sfxTone(784, 0.14, 'triangle', 0.16, t + 0.16);
        sfxTone(1047, 0.28, 'triangle', 0.16, t + 0.24);
        break;
      case 'select':
        sfxTone(620, 0.04, 'sine', 0.08, t);
        break;
      default:
        break;
    }
  }

  function sfxTone(freq, dur, type, vol, when) {
    if (!ctx || !masterGain) return;
    var t = when || ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    o.type = type || 'sine';
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(masterGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sfxSweep(fromFreq, toFreq, dur, type, vol, when) {
    if (!ctx || !masterGain) return;
    var t = when || ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.setValueAtTime(fromFreq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t + dur);
    o.type = type || 'sawtooth';
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(masterGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sfxNoise(dur, vol, cutoff, when) {
    if (!ctx || !masterGain) return;
    var t = when || ctx.currentTime;
    var bufSize = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.6);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff || 1200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(masterGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Resume the audio context on any user gesture. Browsers create the context
  // suspended until they see a click / key / touch — without this hook the
  // music engine fires up but produces no audible output.
  function wakeOnUserGesture() {
    var awake = false;
    function wake() {
      if (awake) return;
      awake = true;
      ensureCtx();
      if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
      window.removeEventListener('touchstart', wake, true);
    }
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    window.addEventListener('touchstart', wake, true);
  }
  wakeOnUserGesture();

  window.Music = {
    start: start,
    stop: stop,
    setMuted: setMuted,
    toggle: toggle,
    isMuted: isMuted,
    sfx: sfx,
    beatPhase: beatPhase,
    isOnBeat: isOnBeat,
    measurePhase: measurePhase,
    isOnDownbeat: isOnDownbeat
  };
})();
