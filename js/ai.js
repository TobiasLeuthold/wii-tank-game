'use strict';

// Enemy brains. Each enemy picks a target player, wanders or hunts using a
// tile path, swerves away from incoming shots, keeps clear of mines, swings
// its turret toward a firing solution (smart tanks also search for ricochet
// shots) and fires once a simulated shot would actually hit a player.

function createAI(t) {
  return {
    path: [], repath: rand(0.2, 1.2), fleeing: false,
    aimTimer: 0, aimAngle: t.turret, noise: 0,
    checkTimer: 0, fireWait: -1,
    burstLeft: 0, burstTimer: 0,
    dodgeTimer: 0, dodgeAngle: 0, threatTimer: 0,
    mineTimer: rand(2, 6),
    stuckTimer: 0, lastX: t.x, lastY: t.y,
  };
}

function updateAI(game, t, dt) {
  const ai = t.ai;
  let target = null, best = Infinity;
  for (const p of game.tanks) {
    if (!p.alive || p.team !== 'player') continue;
    const d = dist2(p.x, p.y, t.x, t.y);
    if (d < best) { best = d; target = p; }
  }
  if (!target) { t.move = 0; t.rot = 0; return; }

  if (t.stats.speed > 0) aiMove(game, t, ai, dt, target);
  else { t.move = 0; t.rot = 0; }
  aiAim(game, t, ai, dt, target);
  aiFire(game, t, ai, dt);
  if (t.maxMines > 0) aiMines(game, t, ai, dt, target);
}

// Steer toward a heading; optionally drive in reverse if that is quicker.
function driveToward(t, angle, allowReverse) {
  let d = angleDiff(t.angle, angle), dir = 1;
  if (allowReverse && Math.abs(d) > Math.PI / 2) { d = angleDiff(t.angle, angle + Math.PI); dir = -1; }
  t.rot = clamp(d * 4, -1, 1);
  const a = Math.abs(d);
  t.move = dir * (a < 0.3 ? 1 : a < 0.9 ? 0.4 : 0);
}

function mineDanger(game, x, y) {
  for (const m of game.mines) if (dist2(m.x, m.y, x, y) < (MINE_BLAST + TANK_R) ** 2) return true;
  return false;
}

function dangerMap(game) {
  const map = new Uint8Array(GW * GH);
  for (const m of game.mines) {
    const r = MINE_BLAST + TANK_R;
    const gx0 = Math.floor((m.x - r) / CELL), gx1 = Math.floor((m.x + r) / CELL);
    const gy0 = Math.floor((m.y - r) / CELL), gy1 = Math.floor((m.y + r) / CELL);
    for (let gy = Math.max(0, gy0); gy <= Math.min(GH - 1, gy1); gy++) {
      for (let gx = Math.max(0, gx0); gx <= Math.min(GW - 1, gx1); gx++) {
        if (dist2((gx + 0.5) * CELL, (gy + 0.5) * CELL, m.x, m.y) < r * r) map[gy * GW + gx] = 1;
      }
    }
  }
  return map;
}

// Closest bullet that will pass near this tank within the next ~0.9 s.
function findThreat(game, t) {
  let best = null, bestT = 0.9;
  for (const b of game.bullets) {
    if (!b.alive || (b.owner === t && !b.bounced)) continue;
    const rx = t.x - b.x, ry = t.y - b.y, v2 = b.vx * b.vx + b.vy * b.vy;
    const tc = (rx * b.vx + ry * b.vy) / v2;
    if (tc < 0 || tc > bestT) continue;
    const cx = b.x + b.vx * tc - t.x, cy = b.y + b.vy * tc - t.y;
    if (cx * cx + cy * cy < (TANK_R + 14) ** 2) { bestT = tc; best = b; }
  }
  return best;
}

function aiMove(game, t, ai, dt, target) {
  const s = t.stats, w = game.world;

  if (s.dodge > 0) {
    ai.threatTimer -= dt;
    if (ai.threatTimer <= 0) {
      ai.threatTimer = 0.08;
      const b = ai.dodgeTimer <= 0 ? findThreat(game, t) : null;
      if (b && Math.random() < s.dodge) {
        const bl = Math.hypot(b.vx, b.vy);
        let px = -b.vy / bl, py = b.vx / bl;
        if ((t.x - b.x) * px + (t.y - b.y) * py < 0) { px = -px; py = -py; }
        if (w.blocksTankAt(t.x + px * 30, t.y + py * 30)) { px = -px; py = -py; }
        ai.dodgeAngle = Math.atan2(py, px);
        ai.dodgeTimer = 0.45;
      }
    }
  }
  if (ai.dodgeTimer > 0) {
    ai.dodgeTimer -= dt;
    driveToward(t, ai.dodgeAngle, true);
    if (ai.dodgeTimer <= 0) ai.repath = 0;
    return;
  }

  ai.repath -= dt;
  const inDanger = mineDanger(game, t.x, t.y);
  if (ai.repath <= 0 || ai.path.length === 0 || (inDanger && !ai.fleeing)) planPath(game, t, ai, target, inDanger);

  if (ai.path.length) {
    const [gx, gy] = ai.path[0];
    const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
    if (dist2(cx, cy, t.x, t.y) < 64) ai.path.shift();
    if (ai.path.length) {
      const [nx, ny] = ai.path[0];
      driveToward(t, Math.atan2((ny + 0.5) * CELL - t.y, (nx + 0.5) * CELL - t.x), false);
    } else { t.move = 0; t.rot = 0; }
  } else { t.move = 0; t.rot = 0; }

  // Stuck against another tank or a corner: pick somewhere else.
  ai.stuckTimer += dt;
  if (ai.stuckTimer > 0.8) {
    if (ai.path.length && dist2(t.x, t.y, ai.lastX, ai.lastY) < 36) { ai.path = []; ai.repath = 0; }
    ai.stuckTimer = 0;
    ai.lastX = t.x;
    ai.lastY = t.y;
  }
}

function planPath(game, t, ai, target, inDanger) {
  const s = t.stats, w = game.world;
  const sx = Math.floor(t.x / CELL), sy = Math.floor(t.y / CELL);
  const danger = dangerMap(game);
  // When already inside a blast zone, walk through danger to the nearest safe tile.
  const res = w.bfs(sx, sy, (gx, gy) => w.blocksTank(gx, gy) || (!inDanger && danger[gy * GW + gx] === 1));
  let goal = null;
  if (inDanger) {
    let bestD = Infinity;
    for (let i = 0; i < res.dist.length; i++) {
      if (res.dist[i] > 0 && !danger[i] && res.dist[i] < bestD) { bestD = res.dist[i]; goal = i; }
    }
  } else {
    const cand = [];
    for (let i = 0; i < res.dist.length; i++) if (res.dist[i] >= 2 && res.dist[i] <= 8) cand.push(i);
    if (cand.length) {
      if (Math.random() < s.aggro) {
        // Hunt: head for a tile near the player, but not right on top of them.
        cand.sort((a, b) => scoreHunt(a, target) - scoreHunt(b, target));
        goal = cand[(Math.random() * Math.min(4, cand.length)) | 0];
      } else {
        goal = cand[(Math.random() * cand.length) | 0];
      }
    }
  }
  ai.fleeing = inDanger;
  ai.path = goal === null ? [] : w.pathTo(res, goal % GW, (goal / GW) | 0);
  ai.repath = inDanger ? 0.6 : rand(1.5, 4);
}

function scoreHunt(i, target) {
  const d = Math.sqrt(dist2(((i % GW) + 0.5) * CELL, (((i / GW) | 0) + 0.5) * CELL, target.x, target.y));
  return Math.abs(d - 150);
}

function leadAngle(t, target, speed, factor) {
  const dx = target.x - t.x, dy = target.y - t.y;
  const time = (Math.hypot(dx, dy) / speed) * factor;
  return Math.atan2(dy + target.vy * time, dx + target.vx * time);
}

// Sweep angles for a bank shot that reaches a player.
function findRicochet(game, t, samples) {
  const s = t.stats;
  let best = null, bestScore = Infinity;
  const off = Math.random() * (TAU / samples);
  for (let i = 0; i < samples; i++) {
    const a = off + (i * TAU) / samples;
    const r = game.world.trace(t.x, t.y, a, s.bounces, game.tanks, { owner: t, maxLen: 1300 });
    if (r.tank && r.tank.team === 'player') {
      const score = Math.abs(angleDiff(t.turret, a)) + r.len * 0.0015;
      if (score < bestScore) { bestScore = score; best = a; }
    }
  }
  return best;
}

function aiAim(game, t, ai, dt, target) {
  const s = t.stats;
  ai.aimTimer -= dt;
  if (ai.aimTimer <= 0) {
    ai.aimTimer = rand(0.18, 0.32);
    const toTarget = Math.atan2(target.y - t.y, target.x - t.x);
    if (s.aim === 'lazy') {
      if (Math.random() < 0.15) ai.noise = rand(-1.1, 1.1);
      ai.aimAngle = toTarget + ai.noise;
    } else {
      const smart = s.aim === 'smart';
      const lead = leadAngle(t, target, s.bulletSpeed, smart ? 1 : 0.5);
      const direct = game.world.trace(t.x, t.y, lead, 0, game.tanks, { owner: t });
      if (direct.tank === target) {
        ai.aimAngle = lead;
      } else {
        let found = null;
        if (s.bounces > 0 && (smart || Math.random() < 0.35)) found = findRicochet(game, t, smart ? 120 : 40);
        ai.aimAngle = found ?? toTarget + rand(-0.3, 0.3);
      }
    }
  }
  const d = angleDiff(t.turret, ai.aimAngle), step = s.turretTurn * dt;
  t.turret = normAngle(t.turret + clamp(d, -step, step));
}

function aiFire(game, t, ai, dt) {
  const s = t.stats;
  if (ai.burstLeft > 0) {
    ai.burstTimer -= dt;
    if (ai.burstTimer <= 0) {
      ai.burstLeft--;
      ai.burstTimer = s.burstGap || 0.16;
      t.cooldown = 0;
      tryFire(game, t);
      if (ai.burstLeft === 0) t.cooldown = s.cooldown * rand(0.8, 1.3);
    }
    return;
  }
  if (t.cooldown > 0 || t.bulletCount >= s.maxBullets) { ai.fireWait = -1; return; }
  ai.checkTimer -= dt;
  if (ai.checkTimer > 0) return;
  ai.checkTimer = 0.05;
  // Only shoot if the simulated shot reaches a player before anything friendly.
  const r = game.world.trace(t.x, t.y, t.turret, s.bounces, game.tanks, { owner: t, margin: 2 });
  if (r.tank && r.tank.team === 'player') {
    if (ai.fireWait < 0) ai.fireWait = s.reaction * rand(0.6, 1.4);
    ai.fireWait -= 0.05;
    if (ai.fireWait <= 0 && tryFire(game, t)) {
      t.cooldown = s.cooldown * rand(0.8, 1.3);
      ai.fireWait = -1;
      if (s.burst > 1) { ai.burstLeft = s.burst - 1; ai.burstTimer = s.burstGap || 0.16; }
    }
  } else {
    ai.fireWait = -1;
  }
}

function aiMines(game, t, ai, dt, target) {
  ai.mineTimer -= dt;
  if (ai.mineTimer > 0 || t.mineCount >= t.maxMines) return;
  const near = dist2(t.x, t.y, target.x, target.y) < 200 * 200;
  ai.mineTimer = rand(3, 7) * (0.35 / t.stats.mineRate) * (near ? 0.5 : 1);
  for (const o of game.tanks) {
    if (o !== t && o.alive && o.team === t.team && dist2(o.x, o.y, t.x, t.y) < (MINE_BLAST + 25) ** 2) return;
  }
  if (tryLayMine(game, t)) { ai.path = []; ai.repath = 0; ai.fleeing = false; }
}
