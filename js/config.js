'use strict';

// ---- World geometry -------------------------------------------------------
const CELL = 40;
const COLS = 22, ROWS = 15;            // playable area; every level map is 22 x 15
const GW = COLS + 2, GH = ROWS + 2;    // plus one ring of border blocks
const WORLD_W = GW * CELL;             // 960
const WORLD_H = GH * CELL;             // 680
const BLOCK_H = 10;                    // fake 3D height of blocks, in px
const STEP = 1 / 120;                  // fixed simulation step (s)

// ---- Sizes ----------------------------------------------------------------
const TANK_R = 15;
const BULLET_R = 4;
const BARREL_LEN = 23;

// ---- Mines ----------------------------------------------------------------
const MINE_R = 9;
const MINE_BLAST = 74;     // blast radius
const MINE_FUSE = 10;      // goes off by itself after this many seconds
const MINE_ARM = 1.0;      // proximity trigger is inactive this long after placing
const MINE_TRIGGER = 46;   // an opposing tank this close sets it off
const MINE_HOLD = 0.45;    // hold the fire key this long to drop a mine

// ---- Projectiles ----------------------------------------------------------
const SPEED_NORMAL = 225;
const SPEED_ROCKET = 420;

const START_LIVES = 3;

const PLAYER_STATS = {
  speed: 105, reverse: 80, turn: 2.7,
  bulletSpeed: SPEED_NORMAL, bounces: 1, maxBullets: 5, cooldown: 0.12, maxMines: 2,
};

// Tank-style steering accelerates: a tap turns a little, holding speeds up.
const TURN_NUDGE = 0.012;   // rad turned instantly on each key press
const TURN_MIN_RATE = 0.25; // rad/s right after pressing
const TURN_RAMP = 0.4;      // s until full turn speed (PLAYER_STATS.turn)

const PLAYER_STYLE = [
  { label: 'P1', body: '#2f6ed8', ui: '#3d8fe0' },
  { label: 'P2', body: '#d9443b', ui: '#d9443b' },
];

// Enemy tanks, modelled on the Wii Play "Tanks!" roster.
//   speed       drive speed (0 = stationary)
//   aim         lazy: wobbly turret | direct: aims at you | smart: also finds ricochet shots
//   bounces     wall bounces per shot (rockets usually 0)
//   burst       shots fired in a quick volley
//   mines       max mines on the field; mineRate scales how often they lay them
//   dodge       chance (0..1) to swerve away from an incoming shot
//   aggro       chance (0..1) to drive toward a player instead of wandering
//   reaction    delay (s) between lining up a shot and firing
//   spread      random aim error per shot (radians)
const ENEMY_TYPES = {
  B: { name: 'Brown',  body: '#a5703c', speed: 0,   turn: 3.0, turretTurn: 1.1, bulletSpeed: SPEED_NORMAL,      bounces: 1, maxBullets: 1, cooldown: 2.4,  burst: 1, aim: 'lazy',   mines: 0, mineRate: 0,    dodge: 0,    aggro: 0,    reaction: 0.55, spread: 0.08 },
  A: { name: 'Grey',   body: '#8e918c', speed: 42,  turn: 3.0, turretTurn: 1.8, bulletSpeed: SPEED_NORMAL,      bounces: 1, maxBullets: 1, cooldown: 1.8,  burst: 1, aim: 'direct', mines: 0, mineRate: 0,    dodge: 0.15, aggro: 0.35, reaction: 0.4, spread: 0.06 },
  T: { name: 'Teal',   body: '#2e9a8c', speed: 42,  turn: 3.0, turretTurn: 2.4, bulletSpeed: SPEED_ROCKET,      bounces: 0, maxBullets: 1, cooldown: 2.0,  burst: 1, aim: 'direct', mines: 0, mineRate: 0,    dodge: 0.3,  aggro: 0.3,  reaction: 0.3, spread: 0.04 },
  Y: { name: 'Yellow', body: '#e6bd2f', speed: 78,  turn: 3.4, turretTurn: 2.0, bulletSpeed: SPEED_NORMAL,      bounces: 1, maxBullets: 1, cooldown: 1.8,  burst: 1, aim: 'direct', mines: 4, mineRate: 0.35, dodge: 0.5,  aggro: 0.25, reaction: 0.35, spread: 0.06 },
  R: { name: 'Pink',   body: '#e0659b', speed: 48,  turn: 3.0, turretTurn: 2.4, bulletSpeed: SPEED_NORMAL,      bounces: 1, maxBullets: 3, cooldown: 1.5,  burst: 3, aim: 'direct', mines: 0, mineRate: 0,    dodge: 0.3,  aggro: 0.5,  reaction: 0.3, spread: 0.09, burstGap: 0.16 },
  G: { name: 'Green',  body: '#55b03a', speed: 0,   turn: 3.0, turretTurn: 2.2, bulletSpeed: SPEED_ROCKET,      bounces: 2, maxBullets: 2, cooldown: 2.0,  burst: 1, aim: 'smart',  mines: 0, mineRate: 0,    dodge: 0,    aggro: 0,    reaction: 0.45, spread: 0.03 },
  P: { name: 'Purple', body: '#8b4fc6', speed: 92,  turn: 3.8, turretTurn: 2.8, bulletSpeed: SPEED_NORMAL + 15, bounces: 1, maxBullets: 5, cooldown: 0.55, burst: 1, aim: 'smart',  mines: 2, mineRate: 0.2,  dodge: 0.7,  aggro: 0.6,  reaction: 0.2, spread: 0.045 },
  W: { name: 'White',  body: '#ecebe6', speed: 78,  turn: 3.6, turretTurn: 2.6, bulletSpeed: SPEED_NORMAL,      bounces: 1, maxBullets: 5, cooldown: 0.7,  burst: 1, aim: 'smart',  mines: 2, mineRate: 0.2,  dodge: 0.6,  aggro: 0.45, reaction: 0.25, spread: 0.045, invisible: true },
  K: { name: 'Black',  body: '#2c2c31', speed: 120, turn: 4.4, turretTurn: 3.4, bulletSpeed: SPEED_ROCKET + 30, bounces: 0, maxBullets: 2, cooldown: 0.7,  burst: 1, aim: 'smart',  mines: 2, mineRate: 0.25, dodge: 0.9,  aggro: 0.7,  reaction: 0.15, spread: 0.035 },
};

// ---- Controls -------------------------------------------------------------
const KEYMAP = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    fire: ['Space'], mine: ['KeyE', 'KeyQ'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    fire: ['Digit0', 'Numpad0'], mine: ['NumpadDecimal', 'NumpadEnter', 'Enter', 'ControlRight', 'Period'] },
];
// 1-player mode: drive with WASD (or arrows), aim with the mouse, left click shoots.
const KEYMAP_MOUSE = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  fire: [], mine: ['Space', 'KeyE', 'KeyQ'],
};
// Keys whose browser default (scrolling, button activation) must be suppressed.
const GAME_KEYS = new Set([].concat(...KEYMAP.map(m => [].concat(...Object.values(m)))));

const DEFAULT_OPTIONS = { friendlyFire: true, aimLine: true, steering: 'tank', music: true, sound: true };

const FONT = '"Fredoka", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

// ---- Small helpers --------------------------------------------------------
const TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rand(a, b) { return a + Math.random() * (b - a); }
function normAngle(a) { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; }
// Signed shortest rotation from a to b.
function angleDiff(a, b) { return normAngle(b - a); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
