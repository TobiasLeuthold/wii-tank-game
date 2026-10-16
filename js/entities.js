'use strict';

let nextTankId = 1;

function tankColors(body) {
  return { body, dark: shade(body, -0.4), light: shade(body, 0.4), track: '#3a342e' };
}

class Tank {
  constructor(o) {
    this.id = nextTankId++;
    this.team = o.team;                   // 'player' | 'enemy'
    this.playerIndex = o.playerIndex ?? -1;
    this.stats = o.stats;
    this.x = o.x; this.y = o.y;
    this.angle = o.angle || 0;
    this.turret = this.angle;
    this.move = 0; this.rot = 0;          // drive inputs, -1..1
    this.vx = 0; this.vy = 0;             // smoothed velocity (AI uses it to lead shots)
    this.alive = true;
    this.cooldown = 0.4;
    this.recoil = 0;
    this.bulletCount = 0;
    this.mineCount = 0;
    this.maxMines = o.stats.maxMines ?? o.stats.mines ?? 0;
    this.treadL = 0; this.treadR = 0; this.treadAcc = 0;
    this.alpha = 1;
    this.colors = tankColors(o.stats.body || o.body);
    // player input state
    this.fireQueued = false;
    this.mineQueued = false;
    this.fireHeld = 0;
    this.holdMined = false;
    this.ai = null;
  }
}

class Bullet {
  constructor(owner, x, y, angle) {
    const sp = owner.stats.bulletSpeed;
    this.owner = owner;
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * sp;
    this.vy = Math.sin(angle) * sp;
    this.bouncesLeft = owner.stats.bounces;
    this.rocket = sp >= SPEED_ROCKET;
    this.bounced = false;
    this.alive = true;
    this.trail = 0;
  }
}

class Mine {
  constructor(owner, x, y) {
    this.owner = owner;
    this.x = x; this.y = y;
    this.age = 0;
    this.alive = true;
  }
}

// ---- particles ------------------------------------------------------------
function addParticle(game, kind, x, y, o = {}) {
  if (game.particles.length > 900) return;
  const life = o.life || 0.5;
  game.particles.push({
    kind, x, y, life, max: life,
    vx: o.vx || 0, vy: o.vy || 0,
    size: o.size || 4, color: o.color || '#8a837b',
    alpha: o.alpha ?? 0.5, grow: o.grow ?? 1.5,
    rot: o.rot || 0, vr: o.vr || 0, damp: o.damp ?? 3,
  });
}

function updateParticles(game, dt) {
  for (const p of game.particles) {
    p.life -= dt;
    const k = Math.exp(-p.damp * dt);
    p.vx *= k; p.vy *= k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
  game.particles = game.particles.filter(p => p.life > 0);
  for (const f of game.floaters) { f.life -= dt; f.y -= 28 * dt; }
  game.floaters = game.floaters.filter(f => f.life > 0);
}

const FX = {
  puff(game, x, y, n = 4, size = 5, color = '#d9d3c8') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(10, 40);
      addParticle(game, 'smoke', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.8), size: rand(size * 0.6, size), color, alpha: 0.55 });
    }
  },
  muzzle(game, x, y, angle) {
    for (let i = 0; i < 4; i++) {
      const a = angle + rand(-0.5, 0.5), s = rand(30, 90);
      addParticle(game, 'smoke', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), size: rand(3, 5), color: '#e8e2d6', alpha: 0.7 });
    }
    addParticle(game, 'fire', x, y, { life: 0.12, size: 6 });
  },
  sparks(game, x, y, n = 5) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(80, 200);
      addParticle(game, 'spark', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.12, 0.25), damp: 6 });
    }
  },
  explosion(game, x, y, color, big) {
    const scale = big ? 1.8 : 1;
    addParticle(game, 'ring', x, y, { life: 0.4, size: big ? MINE_BLAST : 34, color: '#fff3c8' });
    for (let i = 0; i < 16 * scale; i++) {
      const a = rand(0, TAU), s = rand(30, 170) * scale;
      addParticle(game, 'fire', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.55), size: rand(6, 12) * scale, damp: 4 });
    }
    for (let i = 0; i < 12 * scale; i++) {
      const a = rand(0, TAU), s = rand(15, 70) * scale;
      addParticle(game, 'smoke', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 1.5), size: rand(7, 13) * scale, color: '#5d554e', alpha: 0.45, damp: 2 });
    }
    if (color) {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU), s = rand(80, 230);
        addParticle(game, 'debris', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 0.9), size: rand(3, 6), color, vr: rand(-12, 12), damp: 3.5 });
      }
    }
  },
};

// ---- rules ----------------------------------------------------------------
function canHurt(game, attacker, victim) {
  if (!attacker) return true;
  if (attacker.team === 'player' && victim.team === 'player') return game.options.friendlyFire;
  return true;
}

function killTank(game, t, killer) {
  if (!t.alive) return;
  t.alive = false;
  t.alpha = 1;
  FX.explosion(game, t.x, t.y, t.colors.body, false);
  Art.decalCross(game.dctx, t.x, t.y, t.colors.body);
  Sound.explode(false);
  game.shake = Math.max(game.shake, 5);
  if (killer && killer.team === 'player' && t.team === 'enemy') {
    const i = killer.playerIndex;
    game.scores[i]++;
    game.missionKills[i]++;
    game.floaters.push({ x: t.x, y: t.y - 24, text: '+1', color: PLAYER_STYLE[i].ui, life: 1.2 });
  }
}

function tryFire(game, t) {
  const s = t.stats;
  if (t.cooldown > 0 || t.bulletCount >= s.maxBullets) return false;
  const tx = t.x + Math.cos(t.turret) * (BARREL_LEN + 2);
  const ty = t.y + Math.sin(t.turret) * (BARREL_LEN + 2);
  if (game.world.segmentHitsWall(t.x, t.y, tx, ty, BULLET_R)) {
    // Barrel is pressed against a wall: the shot fizzles.
    FX.puff(game, tx, ty, 3, 4);
    Sound.fizzle();
    t.cooldown = 0.25;
    return false;
  }
  const b = new Bullet(t, tx, ty, t.turret + (s.spread ? rand(-s.spread, s.spread) : 0));
  game.bullets.push(b);
  t.bulletCount++;
  t.cooldown = s.cooldown;
  t.recoil = 4;
  FX.muzzle(game, tx, ty, t.turret);
  Sound.shoot(b.rocket);
  return true;
}

function tryLayMine(game, t) {
  if (t.mineCount >= t.maxMines) return false;
  for (const m of game.mines) if (dist2(m.x, m.y, t.x, t.y) < (MINE_R * 3) ** 2) return false;
  game.mines.push(new Mine(t, t.x, t.y));
  t.mineCount++;
  Sound.mineDrop();
  return true;
}

function destroyBullet(game, b, effect) {
  if (!b.alive) return;
  b.alive = false;
  b.owner.bulletCount--;
  if (effect) FX.puff(game, b.x, b.y, 3, 4);
}

function explodeMine(game, m) {
  if (!m.alive) return;
  m.alive = false;
  m.owner.mineCount--;
  FX.explosion(game, m.x, m.y, null, true);
  Art.decalScorch(game.dctx, m.x, m.y, MINE_BLAST * 0.75);
  Sound.explode(true);
  game.shake = Math.max(game.shake, 9);
  const r2 = (MINE_BLAST + 6) ** 2;
  for (const t of game.tanks) {
    if (t.alive && dist2(t.x, t.y, m.x, m.y) < r2 && canHurt(game, m.owner, t)) killTank(game, t, m.owner);
  }
  for (const b of game.bullets) {
    if (b.alive && dist2(b.x, b.y, m.x, m.y) < r2) destroyBullet(game, b, true);
  }
  for (const o of game.mines) {
    if (o.alive && o !== m && dist2(o.x, o.y, m.x, m.y) < r2) o.age = Math.max(o.age, MINE_FUSE - 0.12);
  }
  // Blast breaks nearby cork blocks.
  let changed = false;
  const gx0 = Math.floor((m.x - MINE_BLAST) / CELL), gx1 = Math.floor((m.x + MINE_BLAST) / CELL);
  const gy0 = Math.floor((m.y - MINE_BLAST) / CELL), gy1 = Math.floor((m.y + MINE_BLAST) / CELL);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      if (game.world.at(gx, gy) !== 'x') continue;
      const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
      if (dist2(cx, cy, m.x, m.y) > (MINE_BLAST + 10) ** 2) continue;
      game.world.set(gx, gy, '.');
      changed = true;
      for (let i = 0; i < 8; i++) {
        const a = rand(0, TAU), s = rand(60, 180);
        addParticle(game, 'debris', cx, cy, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1), size: rand(3, 7), color: CORK_TONE, vr: rand(-10, 10) });
      }
    }
  }
  if (changed) game.rebuildLayers();
}

// ---- per-step updates -----------------------------------------------------
function moveTank(game, t, dt) {
  const s = t.stats;
  const ox = t.x, oy = t.y, oa = t.angle;
  t.angle = normAngle(t.angle + t.rot * s.turn * dt);
  const sp = t.move >= 0 ? s.speed : (s.reverse || s.speed);
  t.x += Math.cos(t.angle) * t.move * sp * dt;
  t.y += Math.sin(t.angle) * t.move * sp * dt;
  game.world.pushCircleOut(t, TANK_R);
  // Tanks don't push each other: the mover backs off.
  for (const o of game.tanks) {
    if (o === t || !o.alive) continue;
    const dx = t.x - o.x, dy = t.y - o.y, d2 = dx * dx + dy * dy, min = TANK_R * 2;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      t.x += (dx / d) * (min - d);
      t.y += (dy / d) * (min - d);
    }
  }
  game.world.pushCircleOut(t, TANK_R);

  const mx = t.x - ox, my = t.y - oy;
  t.vx += (mx / dt - t.vx) * 0.15;
  t.vy += (my / dt - t.vy) * 0.15;
  const fwd = mx * Math.cos(t.angle) + my * Math.sin(t.angle);
  const turn = angleDiff(oa, t.angle) * 12.5;
  t.treadL += fwd - turn;
  t.treadR += fwd + turn;
  t.treadAcc += Math.abs(fwd) + Math.abs(turn) * 0.5;
  if (t.treadAcc > 7) {
    t.treadAcc = 0;
    Art.decalTread(game.dctx, t);
  }
}

function controlPlayer(game, t, input, dt) {
  if (game.options.steering === 'direct') {
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx || dy) {
      const d = angleDiff(t.angle, Math.atan2(dy, dx));
      t.rot = clamp(d / (t.stats.turn * dt), -1, 1);
      const a = Math.abs(d);
      t.move = a < 0.5 ? 1 : a < 1.2 ? 0.35 : 0;
    } else {
      t.rot = 0;
      t.move = 0;
    }
  } else {
    t.rot = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    t.move = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  }
  t.turret = t.angle; // players always shoot where the tank faces

  if (t.fireQueued) { t.fireQueued = false; tryFire(game, t); }
  if (input.fire) {
    t.fireHeld += dt;
    if (!t.holdMined && t.fireHeld >= MINE_HOLD) { t.holdMined = true; tryLayMine(game, t); }
  } else {
    t.fireHeld = 0;
    t.holdMined = false;
  }
  if (t.mineQueued) { t.mineQueued = false; tryLayMine(game, t); }
}

function updateBullets(game, dt) {
  const w = game.world;
  for (const b of game.bullets) {
    if (!b.alive) continue;
    if (w.stepProjectile(b, dt)) {
      if (b.bouncesLeft <= 0) { destroyBullet(game, b, true); continue; }
      b.bouncesLeft--;
      b.bounced = true;
      FX.sparks(game, b.x, b.y, 3);
      Sound.bounce();
    }
    b.trail += dt;
    if (b.trail > (b.rocket ? 0.012 : 0.028)) {
      b.trail = 0;
      addParticle(game, 'smoke', b.x - b.vx * 0.02, b.y - b.vy * 0.02, {
        life: b.rocket ? 0.45 : 0.35, size: b.rocket ? 3 : 2.2, color: b.rocket ? '#9a928a' : '#e2ddd3', alpha: 0.6, grow: 1.2,
      });
    }
    for (const t of game.tanks) {
      if (!t.alive || (t === b.owner && !b.bounced) || !canHurt(game, b.owner, t)) continue;
      if (dist2(t.x, t.y, b.x, b.y) < (TANK_R + BULLET_R) ** 2) {
        destroyBullet(game, b, false);
        killTank(game, t, b.owner);
        break;
      }
    }
    if (!b.alive) continue;
    for (const m of game.mines) {
      if (m.alive && dist2(m.x, m.y, b.x, b.y) < (MINE_R + BULLET_R) ** 2) {
        destroyBullet(game, b, false);
        explodeMine(game, m);
        break;
      }
    }
  }
  // Shots that touch cancel each other out.
  const bs = game.bullets;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (b.alive && dist2(a.x, a.y, b.x, b.y) < (BULLET_R * 2 + 1) ** 2) {
        destroyBullet(game, a, true);
        destroyBullet(game, b, true);
        FX.sparks(game, (a.x + b.x) / 2, (a.y + b.y) / 2, 6);
        Sound.pop();
        break;
      }
    }
  }
  game.bullets = game.bullets.filter(b => b.alive);
}

function updateMines(game, dt) {
  for (const m of game.mines) {
    if (!m.alive) continue;
    m.age += dt;
    const left = MINE_FUSE - m.age;
    if (left <= 0) { explodeMine(game, m); continue; }
    if (left < 3 && Math.sin(game.time * 7 * TAU) > 0.95) Sound.mineBeep();
    if (m.age < MINE_ARM) continue;
    for (const t of game.tanks) {
      if (!t.alive || t === m.owner) continue;
      const opposing = t.team !== m.owner.team || (t.team === 'player' && game.options.friendlyFire);
      if (opposing && dist2(t.x, t.y, m.x, m.y) < MINE_TRIGGER ** 2) { explodeMine(game, m); break; }
    }
  }
  game.mines = game.mines.filter(m => m.alive);
}
