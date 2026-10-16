'use strict';

// States: menu (title, demo map behind) -> intro -> play -> cleared | failed
//         paused, gameover, victory
class TankGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stage = document.getElementById('stage');
    Save.load();
    this.options = { ...Save.data.options };
    Sound.setEnabled(this.options.sound);

    this.keys = new Set();
    this.mouse = { x: WORLD_W / 2, y: WORLD_H / 2, seen: false };
    this.cursorHidden = false;
    this.k = 0;
    this.floor = null;
    this.layers = null;
    this.decals = null;
    this.dctx = null;
    this.world = null;
    this.tanks = []; this.bullets = []; this.mines = []; this.particles = []; this.floaters = [];

    this.state = 'menu';
    this.prevState = null;
    this.stateTimer = 0;
    this.time = 0;
    this.shake = 0;
    this.startFlash = 0;

    this.mode = 'campaign'; // 'campaign' | 'versus'
    this.vs = null;
    this.missionIndex = 0;
    this.numPlayers = 2;
    this.lives = START_LIVES;
    this.scores = [0, 0];
    this.missionKills = [0, 0];
    this.bonusLife = false;

    this.resize();
    this.loadMission(Save.data.progress?.mission ?? 0, true);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(t => this.frame(t));
  }

  // ---- canvas / layers -------------------------------------------------------
  resize() {
    const s = Math.min(window.innerWidth / WORLD_W, window.innerHeight / WORLD_H) * 0.98;
    this.stage.style.width = Math.floor(WORLD_W * s) + 'px';
    this.stage.style.height = Math.floor(WORLD_H * s) + 'px';
    const k = clamp(Math.round(s * (window.devicePixelRatio || 1) * 4) / 4, 0.75, 2.5);
    if (k === this.k) return;
    this.k = k;
    this.canvas.width = Math.round(WORLD_W * k);
    this.canvas.height = Math.round(WORLD_H * k);
    this.floor = null;
    if (this.world) this.rebuildLayers();
    if (this.decals) {
      const old = this.decals;
      this.newDecals();
      this.dctx.drawImage(old, 0, 0, WORLD_W, WORLD_H);
    }
  }

  newDecals() {
    this.decals = makeCanvas(WORLD_W * this.k, WORLD_H * this.k);
    this.dctx = this.decals.getContext('2d');
    this.dctx.scale(this.k, this.k);
  }

  rebuildLayers() {
    if (!this.floor) this.floor = Art.buildFloor(this.k);
    this.layers = Art.buildLayers(this.world, this.k, this.floor);
  }

  setOptions(o) {
    this.options = o;
    Save.setOptions(o);
    Sound.setEnabled(o.sound);
  }

  // ---- mission flow -------------------------------------------------------------
  // Build the world and its tanks from a level map.
  setupLevel(level, seed, nPlayers) {
    this.world = new World(level, seed);
    this.tanks = []; this.bullets = []; this.mines = []; this.particles = []; this.floaters = [];
    this.missionKills = [0, 0];
    this.newDecals();
    this.rebuildLayers();
    const w = this.world, center = c => (c + 0.5) * CELL;
    for (let i = 0; i < nPlayers; i++) {
      const sp = w.players[i] || w.players[0] || { gx: 2, gy: 2 + i * 2 };
      this.tanks.push(new Tank({
        team: 'player', playerIndex: i, stats: PLAYER_STATS, body: PLAYER_STYLE[i].body,
        x: center(sp.gx), y: center(sp.gy), angle: sp.gx > GW / 2 ? Math.PI : 0,
      }));
    }
    for (const e of w.enemies) {
      const t = new Tank({ team: 'enemy', stats: ENEMY_TYPES[e.type], x: center(e.gx), y: center(e.gy), angle: Math.PI });
      t.ai = createAI(t);
      t.cooldown = rand(1.0, 2.0); // grace period after "Start!"
      this.tanks.push(t);
    }
  }

  loadMission(index, demo = false) {
    this.missionIndex = index;
    this.setupLevel(LEVELS[index], index + 1, demo ? 0 : this.numPlayers);
    if (!demo) {
      this.state = 'intro';
      this.stateTimer = 2.6;
      Sound.jingle('start');
      Save.setProgress({ mission: index, lives: this.lives, players: this.numPlayers, scores: [...this.scores] });
    }
  }

  // ---- versus: P1 vs P2, first to VS_WINS rounds ----------------------------
  startVersus() {
    this.mode = 'versus';
    this.numPlayers = 2;
    const order = VERSUS_ARENAS.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.vs = { round: 0, wins: [0, 0], order, winner: -1, settle: null };
    UI.hide();
    this.nextRound();
  }

  nextRound() {
    const vs = this.vs;
    const arena = vs.order[vs.round % vs.order.length];
    vs.round++;
    vs.winner = -1;
    vs.settle = null;
    vs.arena = VERSUS_ARENAS[arena].name;
    this.setupLevel(VERSUS_ARENAS[arena], 100 + arena, 2);
    this.state = 'intro';
    this.stateTimer = 2.2;
    Sound.jingle('start');
  }

  roundOver(winner) {
    this.state = 'roundover';
    this.stateTimer = 2.6;
    for (const b of this.bullets) destroyBullet(this, b, true);
    this.bullets = [];
    this.vs.winner = winner ? winner.playerIndex : -1;
    if (winner) this.vs.wins[winner.playerIndex]++;
    Sound.jingle(winner ? 'clear' : 'fail');
  }

  afterRound() {
    const vs = this.vs;
    if (Math.max(...vs.wins) >= VS_WINS) {
      this.state = 'matchover';
      Sound.jingle('win');
      UI.showMatchOver(vs);
    } else {
      this.nextRound();
    }
  }

  newGame(players, mission) {
    this.mode = 'campaign';
    this.numPlayers = players;
    this.lives = START_LIVES;
    this.scores = [0, 0];
    this.bonusLife = false;
    UI.hide();
    this.loadMission(mission);
  }

  continueSaved() {
    const p = Save.data.progress;
    if (!p) return;
    this.mode = 'campaign';
    this.numPlayers = p.players === 1 ? 1 : 2;
    this.lives = Math.max(1, p.lives | 0);
    this.scores = [(p.scores && p.scores[0]) | 0, (p.scores && p.scores[1]) | 0];
    this.bonusLife = false;
    UI.hide();
    this.loadMission(p.mission);
  }

  pause() {
    if (!['intro', 'play', 'cleared', 'failed', 'roundover'].includes(this.state)) return;
    this.prevState = this.state;
    this.state = 'paused';
    this.keys.clear();
    UI.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    this.last = performance.now();
    UI.hide();
  }

  restartMission() {
    if (this.mode === 'versus') { this.startVersus(); return; }
    for (let i = 0; i < 2; i++) this.scores[i] -= this.missionKills[i];
    this.bonusLife = false;
    UI.hide();
    this.loadMission(this.missionIndex);
  }

  quitToMenu() {
    this.loadMission(this.missionIndex, true);
    this.state = 'menu';
    UI.show('title');
  }

  retryAfterGameOver() {
    this.lives = START_LIVES;
    this.bonusLife = false;
    UI.hide();
    this.loadMission(this.missionIndex);
  }

  missionCleared() {
    this.state = 'cleared';
    this.stateTimer = 3.2;
    for (const b of this.bullets) destroyBullet(this, b, true);
    this.bullets = [];
    Sound.jingle('clear');
    Save.markCleared(this.missionIndex);
  }

  missionFailed() {
    this.state = 'failed';
    this.stateTimer = 3.0;
    Sound.jingle('fail');
  }

  afterCleared() {
    if (this.missionIndex >= LEVELS.length - 1) {
      this.state = 'victory';
      Save.clearProgress();
      Sound.jingle('win');
      UI.showVictory(this.scores, this.numPlayers);
      return;
    }
    this.bonusLife = (this.missionIndex + 1) % 5 === 0;
    if (this.bonusLife) this.lives++;
    this.loadMission(this.missionIndex + 1);
  }

  afterFailed() {
    this.lives--;
    this.bonusLife = false;
    if (this.lives <= 0) {
      this.state = 'gameover';
      Save.setProgress({ mission: this.missionIndex, lives: START_LIVES, players: this.numPlayers, scores: [...this.scores] });
      UI.showGameOver(this.missionIndex);
    } else {
      this.loadMission(this.missionIndex);
    }
  }

  // ---- input --------------------------------------------------------------
  // 1-player games aim with the mouse; 2-player games use the keyboard only.
  get mouseAim() { return this.numPlayers === 1; }

  keymap(i) { return this.mouseAim ? KEYMAP_MOUSE : KEYMAP[i]; }

  inputFor(i) {
    const map = this.keymap(i), keys = this.keys;
    const any = codes => codes.some(c => keys.has(c));
    const input = {
      up: any(map.up), down: any(map.down), left: any(map.left), right: any(map.right), fire: any(map.fire),
      mouseAim: this.mouseAim, aim: null,
    };
    if (this.mouseAim && this.mouse.seen) {
      const t = this.tanks.find(p => p.playerIndex === i);
      if (t) input.aim = Math.atan2(this.mouse.y - t.y, this.mouse.x - t.x);
    }
    return input;
  }

  bindInput() {
    window.addEventListener('keydown', e => {
      Sound.unlock();
      const code = e.code, inMenu = UI.current !== null;
      if (!inMenu && GAME_KEYS.has(code)) e.preventDefault();
      if (code === 'Escape' || (code === 'KeyP' && (!inMenu || UI.current === 'pause'))) {
        e.preventDefault();
        if (inMenu) UI.back(); else this.pause();
        return;
      }
      if (code === 'KeyM' && !e.repeat) {
        this.setOptions({ ...this.options, music: !this.options.music });
        if (UI.current === 'options') UI.refreshOptions();
      }
      if (inMenu) return;
      this.keys.add(code);
      if (e.repeat || this.state !== 'play') return;
      const nudge = !this.mouseAim && this.options.steering === 'tank';
      for (const t of this.tanks) {
        if (t.team !== 'player' || !t.alive) continue;
        const map = this.keymap(t.playerIndex);
        if (map.fire.includes(code)) t.fireQueued = true;
        if (map.mine.includes(code)) t.mineQueued = true;
        if (nudge && map.left.includes(code)) t.nudge = -1;
        if (nudge && map.right.includes(code)) t.nudge = 1;
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('mousemove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * WORLD_W;
      this.mouse.y = ((e.clientY - r.top) / r.height) * WORLD_H;
      this.mouse.seen = true;
    });
    this.canvas.addEventListener('mousedown', e => {
      Sound.unlock();
      if (e.button !== 0 || !this.mouseAim || this.state !== 'play') return;
      e.preventDefault();
      const p = this.tanks.find(t => t.playerIndex === 0 && t.alive);
      if (p) p.fireQueued = true;
    });
    window.addEventListener('mousedown', () => Sound.unlock());
    window.addEventListener('blur', () => { this.keys.clear(); this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
  }

  // ---- simulation -----------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    if (this.startFlash > 0) this.startFlash -= dt;
    switch (this.state) {
      case 'intro':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = 'play';
          this.startFlash = 0.9;
          for (const t of this.tanks) { t.fireQueued = false; t.mineQueued = false; }
        }
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      case 'cleared':
      case 'failed':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          if (this.state === 'cleared') this.afterCleared(); else this.afterFailed();
        }
        break;
      case 'roundover':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.afterRound();
        break;
    }
    updateParticles(this, dt);
  }

  updatePlay(dt) {
    for (const t of this.tanks) {
      if (!t.alive) continue;
      t.cooldown -= dt;
      t.recoil = Math.max(0, t.recoil - dt * 30);
      if (t.team === 'player') controlPlayer(this, t, this.inputFor(t.playerIndex), dt);
      else updateAI(this, t, dt);
      moveTank(this, t, dt);
      if (t.stats.invisible) t.alpha = Math.max(0, t.alpha - dt * 0.8);
    }
    updateBullets(this, dt);
    updateMines(this, dt);
    if (this.mode === 'versus') {
      // Short settle time so two shots that cross count as a draw.
      const alive = this.tanks.filter(t => t.alive);
      if (alive.length <= 1) {
        this.vs.settle = (this.vs.settle ?? 0.6) - dt;
        if (this.vs.settle <= 0) this.roundOver(alive[0] || null);
      }
      return;
    }
    const enemiesLeft = this.tanks.some(t => t.alive && t.team === 'enemy');
    const playersLeft = this.tanks.some(t => t.alive && t.team === 'player');
    if (!enemiesLeft) this.missionCleared();
    else if (!playersLeft) this.missionFailed();
  }

  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.state !== 'paused') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 14) { this.update(STEP); this.acc -= STEP; n++; }
      if (n === 14) this.acc = 0;
    }
    this.updateMusic();
    this.updateCursor();
    this.render();
  }

  // Title screen gets the calm version, battles the full march; jingles play in between.
  updateMusic() {
    let want = null;
    if (this.options.music) {
      if (this.state === 'play') want = 'battle';
      else if (this.state === 'menu') want = 'menu';
    }
    Sound.music(want);
  }

  // Hide the system cursor while the crosshair is drawn.
  updateCursor() {
    const hide = this.showReticle();
    if (hide !== this.cursorHidden) {
      this.cursorHidden = hide;
      this.canvas.style.cursor = hide ? 'none' : '';
    }
  }

  showReticle() {
    return this.mouseAim && this.mouse.seen && UI.current === null &&
      ['intro', 'play', 'cleared', 'failed'].includes(this.state);
  }

  // ---- drawing --------------------------------------------------------------
  render() {
    const ctx = this.ctx, k = this.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a1d12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.layers) return;

    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = rand(-0.5, 0.5) * this.shake; sy = rand(-0.5, 0.5) * this.shake; }
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    ctx.drawImage(this.layers.ground, 0, 0, WORLD_W, WORLD_H);
    ctx.drawImage(this.decals, 0, 0, WORLD_W, WORLD_H);
    for (const m of this.mines) Sprites.mine(ctx, m, this.time);
    const alive = this.tanks.filter(t => t.alive).sort((a, b) => a.y - b.y);
    for (const t of alive) Sprites.tank(ctx, t);
    ctx.drawImage(this.layers.blocks, 0, 0, WORLD_W, WORLD_H);
    if (this.options.aimLine && (this.state === 'play' || this.state === 'intro')) {
      for (const t of alive) {
        if (t.team !== 'player') continue;
        const tip = BARREL_LEN + 2;
        const path = this.world.shotPath(t.x + Math.cos(t.turret) * tip, t.y + Math.sin(t.turret) * tip,
          t.turret, t.stats.bounces, this.tanks, t);
        const hostile = path.tank && (path.tank.team === 'enemy' || this.mode === 'versus');
        Sprites.aimPath(ctx, path, PLAYER_STYLE[t.playerIndex].ui, hostile);
      }
    }
    for (const b of this.bullets) Sprites.bullet(ctx, b);
    for (const p of this.particles) Sprites.particle(ctx, p);
    for (const t of alive) {
      if (t.team !== 'player') continue;
      const st = PLAYER_STYLE[t.playerIndex];
      if (this.numPlayers > 1) Sprites.tag(ctx, t, st.label, st.ui);
      if (t.fireHeld > 0.12 && !t.holdMined && t.mineCount < t.maxMines) {
        Sprites.charge(ctx, t, Math.min(1, t.fireHeld / MINE_HOLD), st.ui);
      }
    }
    for (const f of this.floaters) Sprites.floater(ctx, f);

    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (this.showReticle()) Sprites.reticle(ctx, this.mouse.x, this.mouse.y, PLAYER_STYLE[0].ui);
    if (this.state === 'menu') return;
    const st = this.state === 'paused' ? this.prevState : this.state;
    Sprites.hud(ctx, this);
    const versus = this.mode === 'versus';
    if (st === 'intro') { if (versus) Sprites.versusIntro(ctx, this.vs); else Sprites.intro(ctx, this); }
    if (this.startFlash > 0) Sprites.startFlash(ctx, this.startFlash / 0.9);
    if (st === 'cleared' && this.stateTimer < 2.8) Sprites.result(ctx, this, true);
    if (st === 'failed' && this.stateTimer < 2.4) Sprites.result(ctx, this, false);
    if (st === 'roundover' && this.stateTimer < 2.2) Sprites.roundResult(ctx, this.vs);
  }
}

const game = new TankGame(document.getElementById('game'));
UI.init(game);
UI.show('title');
