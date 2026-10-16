'use strict';

// ---- Save data (localStorage) ---------------------------------------------
// { progress: {mission, lives, players, scores} | undefined,
//   cleared: { [missionIndex]: true }, options: {...} }
const Save = {
  KEY: 'couch-tanks.save.v1',
  data: { cleared: {}, options: { ...DEFAULT_OPTIONS } },

  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = {};
    d.cleared = d.cleared && typeof d.cleared === 'object' ? d.cleared : {};
    d.options = { ...DEFAULT_OPTIONS, ...(d.options || {}) };
    if (d.progress && !(d.progress.mission >= 0 && d.progress.mission < LEVELS.length)) delete d.progress;
    this.data = d;
    return d;
  },
  write() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked: play on without saving */ }
  },
  setProgress(p) { this.data.progress = p; this.write(); },
  clearProgress() { delete this.data.progress; this.write(); },
  markCleared(i) { this.data.cleared[i] = true; this.write(); },
  setOptions(o) { this.data.options = { ...o }; this.write(); },
  reset() { this.data = { cleared: {}, options: this.data.options }; this.write(); },
};

// ---- Menus (HTML overlay) -------------------------------------------------
const UI = {
  game: null,
  current: null,
  backTo: 'title',
  selPlayers: 2,

  init(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.screens = {};
    for (const el of this.root.querySelectorAll('.screen')) this.screens[el.id.replace('screen-', '')] = el;
    this.root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      Sound.unlock();
      Sound.click();
      if (b.dataset.goto) this.show(b.dataset.goto);
      if (b.dataset.action) this.action(b.dataset.action, b);
    });
    this.buildMissionGrid();
    this.selPlayers = Save.data.progress?.players || 2;
  },

  show(name) {
    if (name === 'missions') this.backTo = this.current === 'pause' ? 'pause' : 'title';
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('active', k === name);
    this.root.classList.toggle('open', !!name);
    this.current = name;
    if (name === 'title') this.refreshTitle();
    if (name === 'missions') this.refreshMissions();
    if (name === 'options') this.refreshOptions();
    if (name) {
      const first = this.screens[name].querySelector('.btn.primary:not([hidden]), .btn:not([hidden])');
      if (first) first.focus({ preventScroll: true });
    }
  },

  hide() {
    this.show(null);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  },

  // Esc inside menus: go back one level.
  back() {
    if (this.current === 'missions') this.show(this.backTo);
    else if (this.current === 'options' || this.current === 'help') this.show('title');
    else if (this.current === 'pause') this.game.resume();
  },

  action(a, btn) {
    const g = this.game;
    switch (a) {
      case 'continue': g.continueSaved(); break;
      case 'new1': g.newGame(1, 0); break;
      case 'new2': g.newGame(2, 0); break;
      case 'resume': g.resume(); break;
      case 'restart': g.restartMission(); break;
      case 'quit': g.quitToMenu(); break;
      case 'retry': g.retryAfterGameOver(); break;
      case 'mission': g.newGame(this.selPlayers, +btn.dataset.index); break;
      case 'sel-players':
        this.selPlayers = +btn.dataset.players;
        this.refreshMissions();
        break;
      case 'opt': {
        const o = { ...g.options }, key = btn.dataset.key;
        if (key === 'steering') o.steering = o.steering === 'tank' ? 'direct' : 'tank';
        else o[key] = !o[key];
        g.setOptions(o);
        this.refreshOptions();
        break;
      }
      case 'reset-save':
        if (btn.classList.contains('armed')) {
          Save.reset();
          btn.classList.remove('armed');
          btn.textContent = 'Done';
          setTimeout(() => { btn.textContent = 'Reset'; }, 1200);
        } else {
          btn.classList.add('armed');
          btn.textContent = 'Sure?';
          setTimeout(() => { btn.classList.remove('armed'); if (btn.textContent === 'Sure?') btn.textContent = 'Reset'; }, 2500);
        }
        break;
    }
  },

  refreshTitle() {
    const p = Save.data.progress;
    const btn = document.getElementById('btn-continue');
    btn.hidden = !p;
    if (p) {
      document.getElementById('continue-info').textContent =
        `Mission ${p.mission + 1} · ${p.players}P · ${p.lives} ${p.lives === 1 ? 'life' : 'lives'}`;
    }
  },

  buildMissionGrid() {
    const grid = document.getElementById('mission-grid');
    grid.innerHTML = '';
    LEVELS.forEach((lvl, i) => {
      const b = document.createElement('button');
      b.className = 'mission';
      b.dataset.action = 'mission';
      b.dataset.index = i;
      const dots = levelEnemies(lvl)
        .map(ch => `<span class="dot" style="background:${ENEMY_TYPES[ch].body}" title="${ENEMY_TYPES[ch].name}"></span>`)
        .join('');
      b.innerHTML = `<div class="num"><small>MISSION</small>${i + 1}</div><div class="dots">${dots}</div>`;
      grid.appendChild(b);
    });
  },

  refreshMissions() {
    for (const b of document.querySelectorAll('#player-toggle button')) {
      b.classList.toggle('on', +b.dataset.players === this.selPlayers);
    }
    const prog = Save.data.progress;
    for (const b of document.querySelectorAll('#mission-grid .mission')) {
      const i = +b.dataset.index;
      b.classList.toggle('cleared', !!Save.data.cleared[i]);
      b.classList.toggle('resume', !!prog && prog.mission === i);
      let chk = b.querySelector('.check');
      if (Save.data.cleared[i] && !chk) {
        chk = document.createElement('span');
        chk.className = 'check';
        chk.textContent = '✓';
        b.appendChild(chk);
      } else if (!Save.data.cleared[i] && chk) chk.remove();
    }
  },

  refreshOptions() {
    const o = this.game.options;
    for (const b of document.querySelectorAll('[data-action="opt"]')) {
      const k = b.dataset.key;
      if (k === 'steering') {
        b.textContent = o.steering === 'tank' ? 'Tank' : 'Direction';
        b.classList.remove('off');
      } else {
        b.textContent = o[k] ? 'On' : 'Off';
        b.classList.toggle('off', !o[k]);
      }
    }
  },

  showGameOver(mission) {
    document.getElementById('gameover-info').textContent =
      `You made it to Mission ${mission + 1}. Try again from there with ${START_LIVES} lives.`;
    this.show('gameover');
  },

  showVictory(scores, players) {
    const parts = [];
    for (let i = 0; i < players; i++) parts.push(`${PLAYER_STYLE[i].label}: ${scores[i]} tanks`);
    document.getElementById('victory-info').textContent = `Great teamwork! ${parts.join(' · ')}`;
    this.show('victory');
  },
};
