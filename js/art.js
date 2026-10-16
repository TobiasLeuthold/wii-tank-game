'use strict';

// Procedural textures for the static parts of the scene: wood floor, blocks,
// holes, plus persistent floor decals (tread marks, wreck crosses, scorches).

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Wavy grain lines clipped to a rectangle.
function drawGrain(ctx, x, y, w, h, color, R, horizontal, spacing, alpha = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  const across = horizontal ? h : w, along = horizontal ? w : h;
  const n = Math.ceil(across / spacing) + 1;
  for (let i = 0; i < n; i++) {
    const off = (i + R() * 0.7) * spacing;
    const amp = 0.6 + R() * 2.2, freq = 0.012 + R() * 0.03, ph = R() * TAU;
    ctx.globalAlpha = (0.08 + R() * 0.2) * alpha;
    ctx.lineWidth = 0.5 + R() * 1.3;
    ctx.beginPath();
    for (let s = -6; s <= along + 6; s += 6) {
      const wv = Math.sin(s * freq + ph) * amp;
      if (horizontal) ctx.lineTo(x + s, y + off + wv);
      else ctx.lineTo(x + off + wv, y + s);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Nested arcs, the "cathedral" figure seen on flat-sawn boards.
function drawCathedral(ctx, x, y, w, h, color, R) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  const cx = x + w * (0.3 + R() * 0.5), cy = y + h * (0.35 + R() * 0.3);
  const rings = 4 + ((R() * 5) | 0);
  for (let i = 0; i < rings; i++) {
    ctx.globalAlpha = 0.1 + R() * 0.08;
    ctx.lineWidth = 0.8 + R();
    ctx.beginPath();
    ctx.ellipse(cx - i * 12, cy, 18 + i * 20, 2.5 + i * 2.8, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  ctx.restore();
}

const WOOD_TONES = ['#ecc29b', '#e3b086', '#cf9b6b', '#b07f55', '#946a49'];
const CORK_TONE = '#e39a4c';

const Art = {
  // Plank floor covering the whole world. Built once per render scale k.
  buildFloor(k) {
    const c = makeCanvas(WORLD_W * k, WORLD_H * k);
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    const R = makeRng(7);
    const PH = 52;
    const tones = ['#e8c792', '#e2bd86', '#ecd0a2', '#dcb47c', '#e5c28c', '#efd6ab'];
    for (let y = 0; y < WORLD_H; y += PH) {
      let x = -R() * 240;
      while (x < WORLD_W) {
        const len = 200 + R() * 300;
        ctx.fillStyle = tones[(R() * tones.length) | 0];
        ctx.fillRect(x, y, len, PH);
        drawGrain(ctx, x, y, len, PH, '#a0703a', R, true, 3.4);
        if (R() < 0.45) drawCathedral(ctx, x, y, len, PH, '#9a6a35', R);
        const g = ctx.createLinearGradient(0, y, 0, y + PH);
        g.addColorStop(0, 'rgba(255,255,255,0.10)');
        g.addColorStop(1, 'rgba(120,70,20,0.07)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, len, PH);
        ctx.fillStyle = 'rgba(105,65,25,0.35)';
        ctx.fillRect(x, y, 1.3, PH);
        x += len;
      }
      ctx.fillStyle = 'rgba(105,65,25,0.30)';
      ctx.fillRect(0, y, WORLD_W, 1.3);
    }
    const v = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.35, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(70,35,0,0.18)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    c.k = k;
    return c;
  },

  // ground = floor + holes + block shadows; blocks = raised blocks drawn over tanks.
  buildLayers(world, k, floor) {
    const ground = makeCanvas(WORLD_W * k, WORLD_H * k);
    const g = ground.getContext('2d');
    g.drawImage(floor, 0, 0);
    g.scale(k, k);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) if (world.at(gx, gy) === 'o') this.drawHole(g, gx, gy);
    }
    g.save();
    g.shadowColor = 'rgba(60,30,5,0.45)';
    g.shadowBlur = 10 * k;
    g.shadowOffsetX = 7 * k;
    g.shadowOffsetY = 7 * k;
    g.fillStyle = '#6a4a2a';
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        if (world.isWall(gx, gy)) g.fillRect(gx * CELL, gy * CELL - BLOCK_H, CELL, CELL + BLOCK_H);
      }
    }
    g.restore();

    const blocks = makeCanvas(WORLD_W * k, WORLD_H * k);
    const b = blocks.getContext('2d');
    b.scale(k, k);
    // Top to bottom, so a block's top face covers the front face of the one above it.
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const c = world.at(gx, gy);
        if (c === '#' || c === 'x') this.drawBlock(b, gx, gy, c, world.variant[gy * GW + gx]);
      }
    }
    return { ground, blocks };
  },

  drawBlock(ctx, gx, gy, kind, v) {
    const x = gx * CELL, y = gy * CELL - BLOCK_H;
    const R = makeRng(gx * 7919 + gy * 104729 + 13);
    const base = kind === 'x' ? CORK_TONE : WOOD_TONES[Math.floor(v * WOOD_TONES.length)];
    // front face
    const fy = y + CELL;
    ctx.fillStyle = shade(base, -0.32);
    ctx.fillRect(x, fy, CELL, BLOCK_H);
    drawGrain(ctx, x, fy, CELL, BLOCK_H, shade(base, -0.6), R, false, 3, 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x, fy + BLOCK_H - 2, CELL, 2);
    // top face
    ctx.fillStyle = base;
    ctx.fillRect(x, y, CELL, CELL);
    if (kind === 'x') {
      for (let i = 0; i < 80; i++) {
        ctx.globalAlpha = 0.25 + R() * 0.4;
        ctx.fillStyle = R() < 0.6 ? '#9a5a1e' : '#ffd29a';
        const s = 1 + R() * 1.8;
        ctx.fillRect(x + R() * (CELL - s), y + R() * (CELL - s), s, s);
      }
      ctx.globalAlpha = 1;
    } else {
      drawGrain(ctx, x, y, CELL, CELL, shade(base, -0.45), R, R() < 0.5, 3.2);
    }
    // bevel + outline
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, CELL, 2.5);
    ctx.fillRect(x, y, 2.5, CELL);
    ctx.fillStyle = 'rgba(70,35,10,0.22)';
    ctx.fillRect(x, y + CELL - 2.5, CELL, 2.5);
    ctx.fillRect(x + CELL - 2.5, y, 2.5, CELL);
    ctx.strokeStyle = 'rgba(80,50,25,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL + BLOCK_H - 1);
    ctx.beginPath();
    ctx.moveTo(x, fy + 0.5);
    ctx.lineTo(x + CELL, fy + 0.5);
    ctx.stroke();
  },

  drawHole(ctx, gx, gy) {
    const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
    ctx.fillStyle = 'rgba(120,80,40,0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 19, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(cx, cy + 5, 2, cx, cy, 17);
    g.addColorStop(0, '#24160b');
    g.addColorStop(0.7, '#3d2614');
    g.addColorStop(1, '#6b4524');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 16.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,200,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 16.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  },

  // ---- persistent floor decals (drawn into a ctx already scaled to world units)
  decalTread(ctx, t) {
    const c = Math.cos(t.angle), s = Math.sin(t.angle);
    ctx.fillStyle = 'rgba(95,60,25,0.15)';
    for (const side of [-12.5, 12.5]) {
      ctx.save();
      ctx.translate(t.x - s * side, t.y + c * side);
      ctx.rotate(t.angle);
      ctx.fillRect(-1.6, -3.2, 3.2, 6.4);
      ctx.restore();
    }
  },

  decalCross(ctx, x, y, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand(-0.3, 0.3));
    ctx.strokeStyle = rgba(shade(color, -0.35), 0.55);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-13, -13); ctx.lineTo(13, 13);
    ctx.moveTo(13, -13); ctx.lineTo(-13, 13);
    ctx.stroke();
    ctx.restore();
  },

  decalScorch(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(40,20,5,0.45)');
    g.addColorStop(0.6, 'rgba(60,30,8,0.22)');
    g.addColorStop(1, 'rgba(60,30,8,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  },
};
