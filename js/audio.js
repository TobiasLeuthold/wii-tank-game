'use strict';

// Tiny WebAudio synth: every sound is generated, no audio files needed.
const Sound = (() => {
  let ac = null, master = null, noiseBuf = null;
  let enabled = true;
  const lastPlayed = {};

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
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

  function ready() { return enabled && ac && ac.state === 'running'; }

  function tone({ freq, freq2 = freq, dur = 0.1, type = 'square', vol = 0.2, delay = 0 }) {
    if (!ready()) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.3, vol = 0.3, f1 = 2000, f2 = 200, q = 0.8, delay = 0 }) {
    if (!ready()) return;
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f1, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function notes(seq, type = 'square', vol = 0.12) {
    let t = 0;
    for (const [f, d] of seq) {
      if (f) tone({ freq: f, freq2: f, dur: d * 0.95, type, vol, delay: t });
      t += d;
    }
  }

  return {
    unlock: ensure,
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; },

    shoot(rocket) {
      if (throttle('shoot', 0.03)) return;
      noise({ dur: rocket ? 0.22 : 0.14, vol: 0.25, f1: rocket ? 3500 : 2200, f2: 300 });
      tone({ freq: rocket ? 520 : 360, freq2: 120, dur: 0.1, type: 'square', vol: 0.06 });
    },
    bounce() {
      if (throttle('bounce', 0.04)) return;
      tone({ freq: 1100, freq2: 700, dur: 0.06, type: 'triangle', vol: 0.12 });
    },
    pop() {
      if (throttle('pop', 0.04)) return;
      noise({ dur: 0.1, vol: 0.2, f1: 4000, f2: 800 });
    },
    fizzle() { noise({ dur: 0.12, vol: 0.12, f1: 900, f2: 200 }); },
    explode(big) {
      noise({ dur: big ? 1.0 : 0.6, vol: big ? 0.7 : 0.5, f1: big ? 2400 : 1800, f2: 60, q: 1.2 });
      tone({ freq: big ? 110 : 150, freq2: 35, dur: big ? 0.6 : 0.4, type: 'sine', vol: 0.5 });
    },
    mineDrop() { tone({ freq: 420, freq2: 260, dur: 0.12, type: 'triangle', vol: 0.18 }); },
    mineBeep() {
      if (throttle('beep', 0.08)) return;
      tone({ freq: 1500, dur: 0.05, type: 'square', vol: 0.05 });
    },
    click() { tone({ freq: 900, freq2: 1200, dur: 0.05, type: 'triangle', vol: 0.08 }); },
    jingle(kind) {
      const C5 = 523, D5 = 587, E5 = 659, F5 = 698, G5 = 784, A5 = 880, C6 = 1047, G4 = 392, E4 = 330, C4 = 262;
      if (kind === 'start') notes([[G4, 0.12], [C5, 0.12], [E5, 0.12], [G5, 0.24], [E5, 0.12], [G5, 0.4]]);
      else if (kind === 'clear') notes([[C5, 0.1], [E5, 0.1], [G5, 0.1], [C6, 0.2], [0, 0.06], [A5, 0.1], [C6, 0.45]], 'triangle', 0.2);
      else if (kind === 'fail') notes([[G4, 0.22], [F5 / 2, 0.22], [E4, 0.22], [C4, 0.6]], 'triangle', 0.2);
      else if (kind === 'win') notes([[C5, 0.12], [D5, 0.12], [E5, 0.12], [G5, 0.12], [C6, 0.3], [G5, 0.12], [C6, 0.6]], 'triangle', 0.2);
      else if (kind === 'life') notes([[E5, 0.08], [G5, 0.08], [E5 * 2, 0.08], [C6, 0.08], [D5 * 2, 0.08], [G5 * 2, 0.2]], 'square', 0.08);
    },
  };
})();
