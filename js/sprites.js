'use strict';

// Drawing of everything that moves, plus the HUD and mission banners.
// All coordinates are world units; the caller has set up the scale transform.

const Sprites = {
  tank(ctx, t) {
    if (t.alpha <= 0.01) return;
    const c = t.colors;
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x, t.y);

    ctx.save();
    ctx.translate(4, 6);
    ctx.rotate(t.angle);
    ctx.fillStyle = 'rgba(50,25,0,0.28)';
    roundRectPath(ctx, -19, -16, 38, 32, 8);
    ctx.fill();
    ctx.restore();

    ctx.rotate(t.angle);
    // tracks
    for (const side of [-1, 1]) {
      const ty = side < 0 ? -16 : 9;
      ctx.fillStyle = c.track;
      roundRectPath(ctx, -18, ty, 36, 7, 3);
      ctx.fill();
      const ph = (((side < 0 ? -t.treadL : -t.treadR) % 4) + 4) % 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = -17 + ph; x < 17; x += 4) { ctx.moveTo(x, ty + 1); ctx.lineTo(x, ty + 6); }
      ctx.stroke();
    }
    // hull
    ctx.fillStyle = c.body;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, -16, -11, 32, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRectPath(ctx, -14, -9, 28, 7, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    roundRectPath(ctx, -14, 3, 28, 6, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, -9);
    ctx.lineTo(12, 9);
    ctx.stroke();

    // turret + barrel
    ctx.rotate(t.turret - t.angle);
    const rec = t.recoil;
    ctx.fillStyle = c.body;
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, 4 - rec, -3, BARREL_LEN - 4, 6, 2);
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, BARREL_LEN - 5 - rec, -3.8, 5, 7.6, 1.5);
    ctx.fill();
    ctx.stroke();
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 12);
    g.addColorStop(0, c.light);
    g.addColorStop(1, c.body);
    ctx.fillStyle = g;
    roundRectPath(ctx, -9, -8, 18, 16, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(c.dark, 0.55);
    ctx.beginPath();
    ctx.arc(-3, 0, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  // Small static tank used in banners and the HUD.
  tankIcon(ctx, x, y, color, s = 1) {
    const fake = {
      x: 0, y: 0, angle: 0, turret: 0, recoil: 0, alpha: 1, treadL: 0, treadR: 0,
      colors: tankColors(color),
    };
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    this.tank(ctx, fake);
    ctx.restore();
  },

  bullet(ctx, b) {
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.fillStyle = 'rgba(50,25,0,0.22)';
    ctx.beginPath();
    ctx.arc(b.x + 3, b.y + 5, 3.5, 0, TAU);
    ctx.fill();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    if (b.rocket) {
      const f = 8 + Math.random() * 6;
      ctx.fillStyle = 'rgba(255,150,50,0.9)';
      ctx.beginPath();
      ctx.moveTo(-4, -2.8); ctx.lineTo(-4 - f, 0); ctx.lineTo(-4, 2.8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,170,0.95)';
      ctx.beginPath();
      ctx.moveTo(-4, -1.4); ctx.lineTo(-4 - f * 0.5, 0); ctx.lineTo(-4, 1.4);
      ctx.fill();
    }
    ctx.fillStyle = '#f6f2e8';
    ctx.strokeStyle = '#5d554c';
    ctx.lineWidth = 1.2;
    roundRectPath(ctx, -5, -3, 10, 6, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b.rocket ? '#d8532b' : '#bdb5a8';
    ctx.beginPath();
    ctx.arc(2.5, 0, 2, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.restore();
  },

  mine(ctx, m, time) {
    const left = MINE_FUSE - m.age;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = 'rgba(50,25,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 3, MINE_R + 1, MINE_R - 1, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, MINE_R);
    g.addColorStop(0, '#fff0a0');
    g.addColorStop(1, '#e0a51c');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#7a5410';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, MINE_R, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,0,0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.stroke();
    const rate = left < 3 ? 7 : left < 6 ? 3.5 : 1.5;
    const on = Math.sin(time * rate * TAU) > 0;
    if (on) {
      ctx.shadowColor = '#ff3b2f';
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = on ? '#ff3b2f' : '#7d1a12';
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  particle(ctx, p) {
    const f = p.life / p.max; // 1 -> 0
    switch (p.kind) {
      case 'smoke': {
        ctx.globalAlpha = f * p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + (1 - f) * p.grow), 0, TAU);
        ctx.fill();
        break;
      }
      case 'fire': {
        ctx.globalAlpha = Math.min(1, f * 1.6);
        ctx.fillStyle = f > 0.65 ? '#fff3b0' : f > 0.35 ? '#ffb347' : '#e8572a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + f * 0.6), 0, TAU);
        ctx.fill();
        break;
      }
      case 'ring': {
        ctx.globalAlpha = f * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1 + 4 * f;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.size * (1 - f * f * f)), 0, TAU);
        ctx.stroke();
        break;
      }
      case 'debris': {
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        break;
      }
      case 'spark': {
        ctx.globalAlpha = f;
        ctx.strokeStyle = '#ffe9a0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
        break;
      }
    }
    ctx.globalAlpha = 1;
  },

  tag(ctx, t, label, color) {
    const x = t.x, y = t.y - 31;
    ctx.fillStyle = color;
    roundRectPath(ctx, x - 13, y - 7, 26, 14, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 6); ctx.lineTo(x + 4, y + 6); ctx.lineTo(x, y + 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
  },

  // Ring that fills while a fire key is held (hold long enough = mine).
  charge(ctx, t, f, color) {
    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 25, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 25, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    ctx.stroke();
    ctx.restore();
  },

  // Dotted preview of a shot's path; the part after a bounce is fainter.
  aimPath(ctx, path, color) {
    const pts = path.pts;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 9]);
    for (const [w, c] of [[5, 'rgba(255,255,255,0.7)'], [3, color]]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.globalAlpha = i === 0 ? 0.75 : 0.4;
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const end = pts[pts.length - 1];
    if (path.tank && path.tank.team === 'enemy') {
      // On target: ring around the enemy.
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(path.tank.x, path.tank.y, TANK_R + 8, 0, TAU);
      ctx.stroke();
    } else {
      ctx.globalAlpha = pts.length > 2 ? 0.4 : 0.75;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  },

  // Mouse crosshair (1-player mode).
  reticle(ctx, x, y, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    for (const [w, c] of [[6, '#fff'], [3, color]]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
        ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
      }
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  floater(ctx, f) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.font = `700 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  },

  // ---- HUD -----------------------------------------------------------------
  pill(ctx, x, y, w, h, fill, stroke) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRectPath(ctx, x, y + 3, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
  },

  scorePills(ctx, side, label, score, color, dim) {
    const L = side === 0;
    const y1 = WORLD_H - 86, y2 = WORLD_H - 55;
    const w1 = 104, w2 = 150;
    ctx.globalAlpha = dim ? 0.6 : 1;
    this.pill(ctx, L ? -30 : WORLD_W - w1 + 30, y1, w1, 28, '#eef2f7', color);
    this.pill(ctx, L ? -30 : WORLD_W - w2 + 30, y2, w2, 44, '#eef2f7', color);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText(label, L ? 37 : WORLD_W - 37, y1 + 15);
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(String(score), L ? 55 : WORLD_W - 55, y2 + 24);
    ctx.globalAlpha = 1;
  },

  ribbon(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRectPath(ctx, x, y + 3, w, h, 8);
    ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#d8413a');
    g.addColorStop(1, '#a8211f');
    ctx.fillStyle = g;
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = '#f2cf7a';
    ctx.lineWidth = 2;
    roundRectPath(ctx, x + 3, y + 3, w - 6, h - 6, 6);
    ctx.stroke();
  },

  hud(ctx, game) {
    for (let i = 0; i < game.numPlayers; i++) {
      const p = game.tanks.find(t => t.playerIndex === i);
      this.scorePills(ctx, i, PLAYER_STYLE[i].label, game.scores[i], PLAYER_STYLE[i].ui, !p || !p.alive);
    }
    const enemies = game.tanks.filter(t => t.team === 'enemy' && t.alive).length;
    const w = 330, h = 34, x = WORLD_W / 2 - w / 2, y = WORLD_H - 38;
    this.ribbon(ctx, x, y, w, h);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`Mission ${game.missionIndex + 1}`, x + 16, y + h / 2 + 1);
    this.tankIcon(ctx, x + 172, y + h / 2, '#f3e3c3', 0.55);
    ctx.fillText(`× ${enemies}`, x + 188, y + h / 2 + 1);
    ctx.fillStyle = '#ffd0d0';
    ctx.fillText(`♥`, x + 248, y + h / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(`× ${game.lives}`, x + 268, y + h / 2 + 1);
  },

  // Cream card across the middle of the screen (mission intro / results).
  card(ctx, h) {
    const y = WORLD_H / 2 - h / 2;
    ctx.fillStyle = 'rgba(30,15,0,0.25)';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y + 6, WORLD_W, h);
    ctx.fillStyle = '#f8f0dc';
    ctx.fillRect(0, y, WORLD_W, h);
    ctx.fillStyle = '#c8302c';
    ctx.fillRect(0, y, WORLD_W, 9);
    ctx.fillRect(0, y + h - 9, WORLD_W, 9);
    ctx.fillStyle = '#f2cf7a';
    ctx.fillRect(0, y + 9, WORLD_W, 2);
    ctx.fillRect(0, y + h - 11, WORLD_W, 2);
    return y;
  },

  intro(ctx, game, t) {
    const enemies = game.tanks.filter(e => e.team === 'enemy');
    const y = this.card(ctx, 210);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#b5262a';
    ctx.font = `700 58px ${FONT}`;
    ctx.fillText(`Mission ${game.missionIndex + 1}`, WORLD_W / 2, y + 58);
    ctx.fillStyle = '#4a3a2a';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(`Enemy tanks: ${enemies.length}`, WORLD_W / 2, y + 108);
    // one icon per enemy
    const n = enemies.length, gap = 44;
    const x0 = WORLD_W / 2 - ((n - 1) * gap) / 2;
    enemies.forEach((e, i) => this.tankIcon(ctx, x0 + i * gap, y + 148, e.stats.body, 0.85));
    ctx.font = `600 20px ${FONT}`;
    ctx.fillStyle = '#4a3a2a';
    let lives = `Lives × ${game.lives}`;
    if (game.bonusLife) lives += '   •   Bonus life!';
    ctx.fillText(lives, WORLD_W / 2, y + 185);
  },

  startFlash(ctx, f) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f * 2);
    ctx.translate(WORLD_W / 2, WORLD_H / 2);
    const s = 1 + (1 - f) * 0.4;
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 76px ${FONT}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#fff';
    ctx.strokeText('Start!', 0, 0);
    ctx.fillStyle = '#c8302c';
    ctx.fillText('Start!', 0, 0);
    ctx.restore();
  },

  result(ctx, game, cleared) {
    const y = this.card(ctx, 170);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cleared ? '#2f7d32' : '#b5262a';
    ctx.font = `700 52px ${FONT}`;
    ctx.fillText(cleared ? 'Mission Cleared!' : 'Mission Failed', WORLD_W / 2, y + 60);
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = '#4a3a2a';
    if (cleared) {
      const parts = [];
      for (let i = 0; i < game.numPlayers; i++) parts.push(`${PLAYER_STYLE[i].label}: ${game.missionKills[i]} destroyed`);
      ctx.fillText(parts.join('      '), WORLD_W / 2, y + 115);
    } else {
      const left = game.lives - 1;
      ctx.fillText(left > 0 ? `Lives left: ${left}` : 'No lives left', WORLD_W / 2, y + 115);
    }
  },
};
