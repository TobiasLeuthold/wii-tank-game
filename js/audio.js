'use strict';

// Tiny WebAudio synth: every sound and the music are generated, no audio files.
const Sound = (() => {
  let ac = null, sfx = null, musicOut = null, noiseBuf = null;
  let enabled = true;
  const lastPlayed = {};

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      sfx = ac.createGain();
      sfx.gain.value = 0.5;
      sfx.connect(ac.destination);
      musicOut = ac.createGain();
      musicOut.gain.value = 0;
      musicOut.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // Skip a sound if the same one played less than `gap` seconds ago.
  function throttle(name, gap) {
    const now = performance.now() / 1000;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return true;
    lastPlayed[name] = now;
    return false;
  }

  const running = () => ac && ac.state === 'running';
  const ready = () => enabled && running();

  // `at` is an absolute AudioContext time (music); `delay` is relative to now (effects).
  function tone({ freq, freq2 = freq, dur = 0.1, type = 'square', vol = 0.2, delay = 0, at = 0, dest = sfx }) {
    const t0 = at || ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.3, vol = 0.3, f1 = 2000, f2 = 200, q = 0.8, ft = 'lowpass', delay = 0, at = 0, dest = sfx }) {
    const t0 = at || ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filt = ac.createBiquadFilter();
    filt.type = ft;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f1, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  function notes(seq, type = 'square', vol = 0.12) {
    let t = 0;
    for (const [f, d] of seq) {
      if (f) tone({ freq: f, freq2: f, dur: d * 0.95, type, vol, delay: t });
      t += d;
    }
  }

  // ---- background music: a little march, 8 bars of eighth notes -----------
  const BPM = 126, EIGHTH = 60 / BPM / 2;
  const MELODY = [ // MIDI notes, 0 = rest
    76, 76, 79, 76, 84, 0, 79, 0,
    74, 74, 79, 74, 83, 0, 79, 0,
    72, 72, 76, 72, 81, 0, 79, 77,
    77, 0, 76, 0, 74, 0, 72, 74,
    76, 76, 79, 76, 84, 0, 86, 0,
    83, 0, 81, 0, 79, 0, 74, 0,
    77, 77, 81, 77, 76, 0, 74, 0,
    74, 76, 77, 79, 79, 0, 0, 0,
  ];
  const ROOTS = [48, 43, 45, 41, 48, 43, 41, 43]; // C G Am F C G F G
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  let musicMode = null, timer = null, stopTimer = null, step = 0, nextAt = 0;

  function scheduleStep(s, t) {
    const bar = (s / 8) | 0, beat = s % 8, root = ROOTS[bar];
    const battle = musicMode === 'battle';
    if (beat % 2 === 0) {
      tone({ freq: midi(beat % 4 === 0 ? root : root + 7), dur: EIGHTH * 0.9, type: 'triangle', vol: 0.35, at: t, dest: musicOut });
    }
    const m = MELODY[s];
    if (m) tone({ freq: midi(m), dur: EIGHTH * 0.8, type: battle ? 'square' : 'triangle', vol: battle ? 0.06 : 0.13, at: t, dest: musicOut });
    if (!battle) return;
    if (beat === 0 || beat === 4) tone({ freq: 140, freq2: 45, dur: 0.16, type: 'sine', vol: 0.5, at: t, dest: musicOut });
    if (beat === 2 || beat === 6) noise({ dur: 0.12, vol: 0.22, ft: 'highpass', f1: 1500, f2: 1500, at: t, dest: musicOut });
    if (beat === 7 && bar % 2 === 1) {
      noise({ dur: 0.06, vol: 0.1, ft: 'highpass', f1: 1500, f2: 1500, at: t, dest: musicOut });
      noise({ dur: 0.06, vol: 0.13, ft: 'highpass', f1: 1500, f2: 1500, at: t + EIGHTH / 2, dest: musicOut });
    }
    noise({ dur: 0.035, vol: 0.05, ft: 'highpass', f1: 7000, f2: 7000, at: t + (beat % 2 ? 0 : EIGHTH / 2), dest: musicOut });
  }

  function tick() {
    if (!running() || !musicMode) return;
    // After the tab was in the background, skip ahead instead of playing a burst of notes.
    if (nextAt < ac.currentTime - 0.05) nextAt = ac.currentTime + 0.05;
    while (nextAt < ac.currentTime + 0.15) {
      scheduleStep(step, nextAt);
      step = (step + 1) % MELODY.length;
      nextAt += EIGHTH;
    }
  }

  function setMusic(mode) {
    if (mode === musicMode) return;
    if (!mode) {
      musicMode = null;
      if (running()) musicOut.gain.setTargetAtTime(0, ac.currentTime, 0.08);
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (!musicMode) { clearInterval(timer); timer = null; } }, 400);
      return;
    }
    if (!running()) return; // starts once the first click/keypress unlocks audio
    const fresh = !musicMode;
    musicMode = mode;
    musicOut.gain.cancelScheduledValues(ac.currentTime);
    musicOut.gain.setTargetAtTime(0.3, ac.currentTime, 0.1);
    if (fresh) {
      step = 0;
      nextAt = ac.currentTime + 0.08;
    }
    if (!timer) timer = setInterval(tick, 25);
    tick();
  }

  const sfxCall = fn => (...args) => { if (ready()) fn(...args); };

  return {
    unlock: ensure,
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; },
    // 'menu' | 'battle' | null
    music: setMusic,
    get musicMode() { return musicMode; },

    shoot: sfxCall(rocket => {
      if (throttle('shoot', 0.03)) return;
      noise({ dur: rocket ? 0.22 : 0.14, vol: 0.25, f1: rocket ? 3500 : 2200, f2: 300 });
      tone({ freq: rocket ? 520 : 360, freq2: 120, dur: 0.1, type: 'square', vol: 0.06 });
    }),
    bounce: sfxCall(() => {
      if (throttle('bounce', 0.04)) return;
      tone({ freq: 1100, freq2: 700, dur: 0.06, type: 'triangle', vol: 0.12 });
    }),
    pop: sfxCall(() => {
      if (throttle('pop', 0.04)) return;
      noise({ dur: 0.1, vol: 0.2, f1: 4000, f2: 800 });
    }),
    fizzle: sfxCall(() => noise({ dur: 0.12, vol: 0.12, f1: 900, f2: 200 })),
    explode: sfxCall(big => {
      noise({ dur: big ? 1.0 : 0.6, vol: big ? 0.7 : 0.5, f1: big ? 2400 : 1800, f2: 60, q: 1.2 });
      tone({ freq: big ? 110 : 150, freq2: 35, dur: big ? 0.6 : 0.4, type: 'sine', vol: 0.5 });
    }),
    mineDrop: sfxCall(() => tone({ freq: 420, freq2: 260, dur: 0.12, type: 'triangle', vol: 0.18 })),
    mineBeep: sfxCall(() => {
      if (throttle('beep', 0.08)) return;
      tone({ freq: 1500, dur: 0.05, type: 'square', vol: 0.05 });
    }),
    click: sfxCall(() => tone({ freq: 900, freq2: 1200, dur: 0.05, type: 'triangle', vol: 0.08 })),
    jingle: sfxCall(kind => {
      const C5 = 523, D5 = 587, E5 = 659, F5 = 698, G5 = 784, A5 = 880, C6 = 1047, G4 = 392, E4 = 330, C4 = 262;
      if (kind === 'start') notes([[G4, 0.12], [C5, 0.12], [E5, 0.12], [G5, 0.24], [E5, 0.12], [G5, 0.4]]);
      else if (kind === 'clear') notes([[C5, 0.1], [E5, 0.1], [G5, 0.1], [C6, 0.2], [0, 0.06], [A5, 0.1], [C6, 0.45]], 'triangle', 0.2);
      else if (kind === 'fail') notes([[G4, 0.22], [F5 / 2, 0.22], [E4, 0.22], [C4, 0.6]], 'triangle', 0.2);
      else if (kind === 'win') notes([[C5, 0.12], [D5, 0.12], [E5, 0.12], [G5, 0.12], [C6, 0.3], [G5, 0.12], [C6, 0.6]], 'triangle', 0.2);
    }),
  };
})();
