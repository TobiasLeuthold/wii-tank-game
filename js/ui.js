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
    d.seen = d.seen && typeof d.seen === 'object' ? d.seen : {};
    d.medals = d.medals && typeof d.medals === 'object' ? d.medals : {};
    d.stats = { ...Stats.empty(), ...(d.stats && typeof d.stats === 'object' ? d.stats : {}) };
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
  // Enemy types already introduced with a "New enemy!" card.
  markSeen(types) { for (const k of types) this.data.seen[k] = true; this.write(); },
  setOptions(o) { this.data.options = { ...o }; this.write(); },
  // Keep the best medal and the best time separately; returns what improved.
  recordMedal(i, medal, time) {
    const old = this.data.medals[i] || { medal: 0, time: Infinity };
    const better = { medal: medal > old.medal, time: time < old.time };
    this.data.medals[i] = { medal: Math.max(medal, old.medal), time: Math.round(Math.min(time, old.time) * 10) / 10 };
    this.write();
    return better;
  },
  reset() { this.data = { cleared: {}, seen: {}, medals: {}, stats: Stats.empty(), options: this.data.options }; this.write(); },
};

// ---- Lifetime stats (kept in Save.data.stats, written with the save) --------
const Stats = {
  empty() {
    return {
      playTime: 0,
      shots: [0, 0], hits: [0, 0], kills: [0, 0], deaths: [0, 0], mines: [0, 0], revives: [0, 0],
      byType: {},
      missionsCleared: 0, missionsFailed: 0,
      vsMatches: 0, vsWins: [0, 0], vsRounds: 0,
    };
  },
  get d() { return Save.data.stats; },
  // Per-player counter, e.g. Stats.add('shots', 0).
  add(key, player, n = 1) { if (player >= 0 && player < 2) this.d[key][player] += n; },
  count(key, n = 1) { this.d[key] += n; },
  killedType(type) { this.d.byType[type] = (this.d.byType[type] || 0) + 1; },
};

function fmtNum(n) {
  return n < 10000 ? Math.round(n).toLocaleString('en-US') : (n / 1000).toFixed(n < 100000 ? 1 : 0) + 'K';
}
function fmtDuration(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
function fmtPct(part, whole) { return whole ? `${Math.round((100 * part) / whole)}%` : '–'; }

// What makes each enemy special, for the "Enemy tanks" screen.
const ENEMY_INFO = {
  B: 'Never moves. Its turret wobbles around, so many of its shots miss. A good first target.',
  A: 'Drives around slowly and fires a single bouncing shot as soon as it has a line on you.',
  T: 'Slow, but fires fast rockets. Rockets don’t bounce; they pop on the first wall.',
  Y: 'Lays up to 4 mines and drives away from them. Watch the places it has been.',
  R: 'Fires 3 shots in a quick burst. Keep a wall between you and it.',
  G: 'Stationary sniper. Its fast rockets bounce twice, and it finds bank shots around walls.',
  P: 'Fast and aggressive. Keeps up to 5 shots out, lays mines, dodges and finds bank shots.',
  W: 'Turns invisible once the mission starts. Its tread marks and gun smoke give it away.',
  K: 'The fastest tank. Fires fast rockets, dodges almost every shot and lays mines.',
};

// Short tags derived from the tank stats, so they stay true when stats change.
function enemyTraits(s) {
  const out = [];
  const move = s.speed === 0 ? 'Stationary' : s.speed < 60 ? 'Slow' : s.speed < 90 ? 'Medium speed'
    : s.speed <= PLAYER_STATS.speed ? 'Fast' : 'Faster than you';
  out.push([move, s.speed > PLAYER_STATS.speed]);
  const rocket = s.bulletSpeed >= SPEED_ROCKET;
  out.push([`${s.maxBullets} ${rocket ? 'rocket' : 'shot'}${s.maxBullets > 1 ? 's' : ''} at once`, rocket]);
  out.push([s.bounces === 0 ? 'No bounce' : s.bounces === 1 ? '1 bounce' : `${s.bounces} bounces`, s.bounces > 1]);
  if (s.burst > 1) out.push([`${s.burst}-shot burst`, true]);
  if (s.aim === 'smart') out.push(['Bank shots', true]);
  else if (s.aim === 'lazy') out.push(['Wobbly aim', false]);
  if (s.mines > 0) out.push([`Mines ×${s.mines}`, true]);
  if (s.dodge >= 0.5) out.push(['Dodges', true]);
  if (s.invisible) out.push(['Invisible', true]);
  return out;
}

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
    this.buildEnemyGrid();
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
    if (name === 'stats') this.buildStats();
    if (name === 'pause') {
      document.getElementById('btn-restart').textContent = this.game.mode === 'versus' ? 'Restart match' : 'Restart mission';
    }
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
    else if (['options', 'help', 'enemies', 'stats'].includes(this.current)) this.show('title');
    else if (this.current === 'pause') this.game.resume();
  },

  action(a, btn) {
    const g = this.game;
    switch (a) {
      case 'continue': g.continueSaved(); break;
      case 'new1': g.newGame(1, 0); break;
      case 'new2': g.newGame(2, 0); break;
      case 'versus': g.startVersus(); break;
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

  buildEnemyGrid() {
    const grid = document.getElementById('enemy-grid');
    grid.innerHTML = '';
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const [key, s] of Object.entries(ENEMY_TYPES)) {
      const first = LEVELS.findIndex(l => l.map.some(row => row.includes(key)));
      const card = document.createElement('div');
      card.className = 'enemy-card';
      card.style.borderLeftColor = shade(s.body, -0.15);
      card.innerHTML = `
        <div class="enemy-head">
          <canvas width="${64 * dpr}" height="${50 * dpr}"></canvas>
          <div><h3>${s.name}</h3><small>${first >= 0 ? `First seen in mission ${first + 1}` : ''}</small></div>
        </div>
        <div class="traits">${enemyTraits(s).map(([txt, hot]) => `<span class="trait${hot ? ' hot' : ''}">${txt}</span>`).join('')}</div>
        <p>${ENEMY_INFO[key] || ''}</p>`;
      const ctx = card.querySelector('canvas').getContext('2d');
      ctx.scale(dpr, dpr);
      Sprites.tankIcon(ctx, 30, 23, s.body, 1.25, s.invisible ? 0.45 : 1);
      grid.appendChild(card);
    }
  },

  buildStats() {
    const s = Stats.d, sum = a => a[0] + a[1];
    const medals = [0, 0, 0, 0];
    for (const m of Object.values(Save.data.medals)) medals[m.medal]++;
    const tile = (label, value, extra = '') =>
      `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${extra}</div>`;
    const medalTile = [3, 2, 1].map(t =>
      `<span class="medal-count"><span class="check medal medal-${t}">★</span>${medals[t]}</span>`).join('');
    const rows = [
      ['Shots fired', s.shots, fmtNum],
      ['Hits', s.hits, fmtNum],
      ['Accuracy', null, i => fmtPct(s.hits[i], s.shots[i])],
      ['Enemy tanks destroyed', s.kills, fmtNum],
      ['Times destroyed', s.deaths, fmtNum],
      ['Mines laid', s.mines, fmtNum],
      ['Teammates revived', s.revives, fmtNum],
    ];
    const head = [0, 1].map(i =>
      `<th><span class="pdot" style="background:${PLAYER_STYLE[i].ui}"></span>${PLAYER_STYLE[i].label}</th>`).join('');
    const body = rows.map(([label, arr, f]) =>
      `<tr><td>${label}</td>${[0, 1].map(i => `<td>${arr ? f(arr[i]) : f(i)}</td>`).join('')}</tr>`).join('');
    const types = Object.entries(ENEMY_TYPES).map(([k, t]) =>
      `<div class="type-cell" title="${t.name}"><canvas data-type="${k}"></canvas>` +
      `<div class="type-name">${t.name}</div><div class="type-count">${fmtNum(s.byType[k] || 0)}</div></div>`).join('');

    document.getElementById('stats-body').innerHTML = `
      ${sum(s.shots) === 0 && s.vsRounds === 0 ? '<p class="stats-empty">Play a mission to start collecting stats.</p>' : ''}
      <div class="stats-hero">
        <div class="hero-value">${fmtNum(sum(s.kills))}</div>
        <div class="hero-label">Enemy tanks destroyed</div>
      </div>
      <div class="stat-tiles">
        ${tile('Shots fired', fmtNum(sum(s.shots)))}
        ${tile('Accuracy', fmtPct(sum(s.hits), sum(s.shots)))}
        ${tile('Times destroyed', fmtNum(sum(s.deaths)))}
        ${tile('Mines laid', fmtNum(sum(s.mines)))}
        ${tile('Teammates revived', fmtNum(sum(s.revives)))}
        ${tile('Missions cleared', fmtNum(s.missionsCleared))}
        ${tile('Play time', fmtDuration(s.playTime))}
        ${tile('Medals', '', `<div class="medal-row">${medalTile}</div>`)}
      </div>
      <h3>By player</h3>
      <table class="stats-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
      <h3>Enemy tanks destroyed by type</h3>
      <div class="type-grid">${types}</div>
      <h3>Versus</h3>
      <div class="stat-tiles four">
        ${tile('Matches played', fmtNum(s.vsMatches))}
        ${tile('Rounds played', fmtNum(s.vsRounds))}
        ${tile('<span class="pdot" style="background:' + PLAYER_STYLE[0].ui + '"></span>P1 match wins', fmtNum(s.vsWins[0]))}
        ${tile('<span class="pdot" style="background:' + PLAYER_STYLE[1].ui + '"></span>P2 match wins', fmtNum(s.vsWins[1]))}
      </div>
      <p class="stats-note">Accuracy counts shots that destroyed a tank. Reset stats under Options.</p>`;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const c of document.querySelectorAll('#stats-body canvas[data-type]')) {
      c.width = 48 * dpr;
      c.height = 38 * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      const t = ENEMY_TYPES[c.dataset.type];
      Sprites.tankIcon(ctx, 22, 17, t.body, 0.95, t.invisible ? 0.5 : 1);
    }
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
      // Badge: best medal (or a tick for clears from before medals existed) + best time.
      const m = Save.data.medals[i];
      b.querySelector('.check')?.remove();
      b.querySelector('.best')?.remove();
      if (Save.data.cleared[i] || m) {
        const chk = document.createElement('span');
        chk.className = 'check' + (m ? ` medal medal-${m.medal}` : '');
        chk.textContent = m ? '★' : '✓';
        chk.title = m ? `${MEDALS[m.medal].name} medal` : 'Cleared';
        b.appendChild(chk);
      }
      if (m) {
        const best = document.createElement('div');
        best.className = 'best';
        best.textContent = `best ${fmtTime(m.time)} · par ${fmtTime(parTime(LEVELS[i]))}`;
        b.appendChild(best);
      }
    }
    const count = [0, 0, 0, 0];
    for (const m of Object.values(Save.data.medals)) count[m.medal]++;
    document.getElementById('medal-summary').innerHTML = [3, 2, 1]
      .map(t => `<span><span class="check medal medal-${t}">★</span>${count[t]} ${MEDALS[t].name}</span>`).join('');
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

  showMatchOver(vs) {
    const w = vs.wins[0] > vs.wins[1] ? 0 : 1;
    const title = document.getElementById('match-title');
    title.textContent = `${PLAYER_STYLE[w].label} wins!`;
    title.style.color = PLAYER_STYLE[w].ui;
    document.getElementById('match-info').textContent =
      `${vs.wins[0]} – ${vs.wins[1]} after ${vs.round} rounds.`;
    this.show('matchover');
  },

  showVictory(scores, players) {
    const parts = [];
    for (let i = 0; i < players; i++) parts.push(`${PLAYER_STYLE[i].label}: ${scores[i]} tanks`);
    document.getElementById('victory-info').textContent = `Great teamwork! ${parts.join(' · ')}`;
    this.show('victory');
  },
};
