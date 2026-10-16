'use strict';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// The tile grid of one mission, including the border ring.
class World {
  constructor(level, seed) {
    this.grid = new Array(GW * GH).fill('.');
    this.variant = new Float32Array(GW * GH);
    this.players = [];
    this.enemies = [];
    const R = makeRng(seed * 7717 + 3);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        this.variant[i] = R();
        if (gx === 0 || gy === 0 || gx === GW - 1 || gy === GH - 1) { this.grid[i] = '#'; continue; }
        const ch = level.map[gy - 1][gx - 1];
        if (ch === '#' || ch === 'x' || ch === 'o') this.grid[i] = ch;
        else if (ch === '1' || ch === '2') this.players[+ch - 1] = { gx, gy };
        else if (ENEMY_TYPES[ch]) this.enemies.push({ gx, gy, type: ch });
      }
    }
  }

  at(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return '#';
    return this.grid[gy * GW + gx];
  }
  set(gx, gy, c) { this.grid[gy * GW + gx] = c; }

  // Walls stop bullets and tanks; holes stop only tanks.
  isWall(gx, gy) { const c = this.at(gx, gy); return c === '#' || c === 'x'; }
  blocksTank(gx, gy) { return this.at(gx, gy) !== '.'; }
  blocksTankAt(x, y) { return this.blocksTank(Math.floor(x / CELL), Math.floor(y / CELL)); }

  circleHitsWall(x, y, r) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (!this.isWall(gx, gy)) continue;
        const nx = clamp(x, gx * CELL, gx * CELL + CELL), ny = clamp(y, gy * CELL, gy * CELL + CELL);
        if (dist2(x, y, nx, ny) < r * r) return true;
      }
    }
    return false;
  }

  segmentHitsWall(x0, y0, x1, y1, r) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / 3));
    for (let i = 0; i <= n; i++) {
      if (this.circleHitsWall(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r)) return true;
    }
    return false;
  }

  // Push a circle (object with x,y) out of every tile that blocks tanks.
  pushCircleOut(o, r) {
    for (let iter = 0; iter < 2; iter++) {
      const x0 = Math.floor((o.x - r) / CELL), x1 = Math.floor((o.x + r) / CELL);
      const y0 = Math.floor((o.y - r) / CELL), y1 = Math.floor((o.y + r) / CELL);
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (!this.blocksTank(gx, gy)) continue;
          const rx = gx * CELL, ry = gy * CELL;
          const nx = clamp(o.x, rx, rx + CELL), ny = clamp(o.y, ry, ry + CELL);
          const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            o.x += (dx / d) * (r - d);
            o.y += (dy / d) * (r - d);
          } else {
            const left = o.x - rx, right = rx + CELL - o.x, top = o.y - ry, bottom = ry + CELL - o.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) o.x = rx - r;
            else if (m === right) o.x = rx + CELL + r;
            else if (m === top) o.y = ry - r;
            else o.y = ry + CELL + r;
          }
        }
      }
    }
  }

  // Move a projectile by (vx,vy)*dt, mirroring velocity off walls.
  // Returns true if it bounced during this step.
  stepProjectile(p, dt) {
    let bounced = false;
    const nx = p.x + p.vx * dt;
    if (this.circleHitsWall(nx, p.y, BULLET_R)) { p.vx = -p.vx; bounced = true; } else p.x = nx;
    const ny = p.y + p.vy * dt;
    if (this.circleHitsWall(p.x, ny, BULLET_R)) { p.vy = -p.vy; bounced = true; } else p.y = ny;
    return bounced;
  }

  // Simulate a shot fired from (x,y) at `angle`; return the first tank it would hit.
  // The owner is ignored until the shot has bounced (same rule as real bullets).
  trace(x, y, angle, bounces, tanks, opts = {}) {
    const p = { x, y, vx: Math.cos(angle), vy: Math.sin(angle) };
    const stepLen = 5, maxLen = opts.maxLen || 1500, margin = opts.margin || 0;
    const rr = (TANK_R + BULLET_R + margin) ** 2;
    let left = bounces, bounced = false;
    for (let len = 0; len < maxLen; len += stepLen) {
      if (this.stepProjectile(p, stepLen)) {
        if (left-- <= 0) return { tank: null, len };
        bounced = true;
      }
      for (const t of tanks) {
        if (!t.alive || (t === opts.owner && !bounced)) continue;
        if (dist2(t.x, t.y, p.x, p.y) < rr) return { tank: t, len };
      }
    }
    return { tank: null, len: maxLen };
  }

  // Path of a shot for the aim line: start, each bounce, end point, and the
  // first visible tank it reaches. Invisible tanks are not revealed.
  shotPath(x, y, angle, bounces, tanks, owner, maxLen = 1400) {
    const p = { x, y, vx: Math.cos(angle), vy: Math.sin(angle) };
    const pts = [{ x, y }];
    const rr = (TANK_R + BULLET_R) ** 2;
    let left = bounces, bounced = false;
    if (this.circleHitsWall(x, y, BULLET_R)) return { pts: [], tank: null };
    for (let len = 0; len < maxLen; len += 4) {
      if (this.stepProjectile(p, 4)) {
        pts.push({ x: p.x, y: p.y });
        if (left-- <= 0) return { pts, tank: null };
        bounced = true;
      }
      for (const t of tanks) {
        if (!t.alive || t.alpha < 0.3 || (t === owner && !bounced)) continue;
        if (dist2(t.x, t.y, p.x, p.y) < rr) {
          pts.push({ x: p.x, y: p.y });
          return { pts, tank: t };
        }
      }
    }
    pts.push({ x: p.x, y: p.y });
    return { pts, tank: null };
  }

  // Breadth-first search over tiles (8 directions, no corner cutting).
  bfs(sx, sy, blocked) {
    const N = GW * GH;
    const dist = new Int16Array(N).fill(-1);
    const prev = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    const s = sy * GW + sx;
    dist[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const c = q[head++], cx = c % GW, cy = (c / GW) | 0;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ny * GW + nx;
        if (dist[n] >= 0 || blocked(nx, ny)) continue;
        if (dx && dy && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
        dist[n] = dist[c] + 1;
        prev[n] = c;
        q[tail++] = n;
      }
    }
    return { dist, prev, start: s };
  }

  // Tiles from the BFS start (exclusive) to (gx,gy) (inclusive).
  pathTo(res, gx, gy) {
    const path = [];
    let c = gy * GW + gx;
    if (res.dist[c] < 0) return path;
    while (c !== res.start && c >= 0) {
      path.push([c % GW, (c / GW) | 0]);
      c = res.prev[c];
    }
    return path.reverse();
  }
}
