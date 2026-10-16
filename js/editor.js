'use strict';

// In-browser level editor: paint the 22x15 grid, place tanks, save levels
// locally, share them as text codes and test-play them.

const EDITOR_TOOLS = [
  { ch: '.', label: 'Floor (eraser, also right mouse button)' },
  { ch: '#', label: 'Wood block' },
  { ch: 'x', label: 'Cork block (mine blasts break it)' },
  { ch: 'o', label: 'Hole (stops tanks, bullets fly over)' },
  { ch: '1', label: 'Player 1 start' },
  { ch: '2', label: 'Player 2 start' },
  ...Object.entries(ENEMY_TYPES).map(([k, t]) => ({ ch: k, label: `${t.name} tank` })),
];
const EDITOR_CHARS = new Set(EDITOR_TOOLS.map(t => t.ch));
const MAX_ENEMIES = 14;
const MAX_CUSTOM = 40;
const CODE_PREFIX = 'TANKS1:';

function blankMap() { return Array.from({ length: ROWS }, () => Array(COLS).fill('.')); }
function mapToRows(map) { return map.map(r => r.join('')); }
function rowsToMap(rows) { return rows.map(r => r.split('')); }

const Editor = {
  game: null,
  level: null,     // { id, name, map: ROWS arrays of COLS chars }
  tool: '#',
  painting: 0,     // 0 = not painting, 1 = paint with tool, 2 = erase
  hover: null,
  players: 2,
  toastTimer: 0,

  init(game) {
    this.game = game;
    this.root = document.getElementById('editor-ui');
    this.nameInput = document.getElementById('ed-name');
    this.loadSelect = document.getElementById('ed-load');
    this.codePanel = document.getElementById('ed-code');
    this.codeInput = document.getElementById('ed-code-input');
    this.buildPalette();
    this.root.addEventListener('click', e => {
      const b = e.target.closest('[data-ed]');
      if (b) { Sound.click(); this.action(b.dataset.ed, b); }
    });
    this.nameInput.addEventListener('input', () => { this.level.name = this.nameInput.value; this.saveDraft(); });
    this.loadSelect.addEventListener('change', () => { this.loadFrom(this.loadSelect.value); this.loadSelect.value = ''; });
    this.codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.action('import-go'); });

    const c = game.canvas;
    c.addEventListener('mousedown', e => {
      if (game.state !== 'editor') return;
      e.preventDefault();
      this.painting = e.button === 2 ? 2 : 1;
      this.paintEvent(e);
    });
    c.addEventListener('mousemove', e => {
      if (game.state !== 'editor') return;
      const p = game.toWorld(e);
      this.hover = { gx: Math.floor(p.x / CELL), gy: Math.floor(p.y / CELL) };
      if (this.painting) this.paintEvent(e);
    });
    c.addEventListener('mouseleave', () => { this.hover = null; });
    c.addEventListener('contextmenu', e => { if (game.state === 'editor') e.preventDefault(); });
    window.addEventListener('mouseup', () => { this.painting = 0; });
  },

  buildPalette() {
    const pal = document.getElementById('ed-palette');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const t of EDITOR_TOOLS) {
      const b = document.createElement('button');
      b.className = 'ed-tool';
      b.dataset.ed = 'tool';
      b.dataset.ch = t.ch;
      b.title = t.label;
      const cv = document.createElement('canvas');
      cv.width = 30 * dpr;
      cv.height = 30 * dpr;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      this.drawToolIcon(ctx, t.ch);
      b.appendChild(cv);
      pal.appendChild(b);
    }
  },

  drawToolIcon(ctx, ch) {
    if (ch === '.') {
      ctx.fillStyle = '#e5c28c';
      roundRectPath(ctx, 3, 3, 24, 24, 4);
      ctx.fill();
      ctx.strokeStyle = '#a0703a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(9, 9); ctx.lineTo(21, 21); ctx.moveTo(21, 9); ctx.lineTo(9, 21);
      ctx.stroke();
    } else if (ch === '#' || ch === 'x') {
      ctx.fillStyle = ch === '#' ? WOOD_TONES[2] : CORK_TONE;
      ctx.fillRect(4, 3, 22, 22);
      ctx.fillStyle = shade(ch === '#' ? WOOD_TONES[2] : CORK_TONE, -0.32);
      ctx.fillRect(4, 25, 22, 4);
      ctx.strokeStyle = 'rgba(80,50,25,0.6)';
      ctx.strokeRect(4.5, 3.5, 21, 25);
      if (ch === 'x') {
        ctx.fillStyle = '#9a5a1e';
        for (let i = 0; i < 14; i++) ctx.fillRect(6 + ((i * 7) % 18), 5 + ((i * 11) % 18), 1.6, 1.6);
      }
    } else if (ch === 'o') {
      ctx.fillStyle = '#3d2614';
      ctx.beginPath();
      ctx.arc(15, 15, 11, 0, TAU);
      ctx.fill();
    } else {
      const color = ch === '1' ? PLAYER_STYLE[0].body : ch === '2' ? PLAYER_STYLE[1].body : ENEMY_TYPES[ch].body;
      Sprites.tankIcon(ctx, 14, 14, color, 0.62, ENEMY_TYPES[ch]?.invisible ? 0.55 : 1);
      if (ch === '1' || ch === '2') {
        ctx.font = `700 9px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(`P${ch}`, 13, 17);
      }
    }
  },

  // ---- open / close -------------------------------------------------------
  open() {
    if (!this.level) {
      const d = Save.data.editorDraft;
      this.level = d ? { id: d.id || null, name: d.name || '', map: rowsToMap(d.rows) } : { id: null, name: '', map: blankMap() };
    }
    UI.hide();
    this.game.mode = 'editor';
    this.root.hidden = false;
    this.closeCode();
    this.nameInput.value = this.level.name;
    this.refreshLoadList();
    this.selectTool(this.tool);
    this.setPlayers(this.players);
    this.refresh();
  },

  hideUI() { this.root.hidden = true; this.painting = 0; },

  close() {
    this.hideUI();
    this.game.quitToMenu();
  },

  // Rebuild the preview world from the map.
  refresh() {
    const g = this.game;
    g.setupLevel(this.asLevel(), 4242, 0);
    g.par = null;
    g.state = 'editor';
  },

  asLevel() { return { name: this.level.name, map: mapToRows(this.level.map) }; },

  saveDraft() {
    Save.data.editorDraft = { id: this.level.id, name: this.level.name, rows: mapToRows(this.level.map) };
    Save.write();
  },

  // ---- painting -----------------------------------------------------------
  paintEvent(e) {
    const p = this.game.toWorld(e);
    this.paintAt(Math.floor(p.x / CELL), Math.floor(p.y / CELL), this.painting === 2 ? '.' : this.tool);
  },

  enemyCount() {
    let n = 0;
    for (const row of this.level.map) for (const ch of row) if (ENEMY_TYPES[ch]) n++;
    return n;
  },

  paintAt(gx, gy, ch) {
    if (gx < 1 || gy < 1 || gx > COLS || gy > ROWS) return;
    const row = this.level.map[gy - 1], cur = row[gx - 1];
    if (cur === ch) return;
    if (ENEMY_TYPES[ch] && !ENEMY_TYPES[cur] && this.enemyCount() >= MAX_ENEMIES) {
      this.toast(`At most ${MAX_ENEMIES} enemy tanks per level`);
      return;
    }
    if (ch === '1' || ch === '2') {
      // Only one start position per player.
      for (const r of this.level.map) for (let i = 0; i < r.length; i++) if (r[i] === ch) r[i] = '.';
    }
    row[gx - 1] = ch;
    this.saveDraft();
    this.refresh();
  },

  selectTool(ch) {
    this.tool = ch;
    for (const b of this.root.querySelectorAll('.ed-tool')) b.classList.toggle('on', b.dataset.ch === ch);
  },

  setPlayers(n) {
    this.players = n;
    for (const b of this.root.querySelectorAll('[data-ed="p1"], [data-ed="p2"]')) {
      b.classList.toggle('on', b.dataset.ed === `p${n}`);
    }
  },

  // ---- toolbar ------------------------------------------------------------
  action(a, b) {
    switch (a) {
      case 'tool': this.selectTool(b.dataset.ch); break;
      case 'menu': this.close(); break;
      case 'p1': this.setPlayers(1); break;
      case 'p2': this.setPlayers(2); break;
      case 'clear':
        this.level.map = blankMap();
        this.saveDraft();
        this.refresh();
        this.toast('Cleared');
        break;
      case 'save': this.save(); break;
      case 'delete': this.remove(); break;
      case 'test': this.test(); break;
      case 'share': this.share(); break;
      case 'import':
        this.codePanel.hidden = false;
        this.codePanel.dataset.mode = 'import';
        this.codeInput.value = '';
        this.codeInput.readOnly = false;
        this.codeInput.focus();
        break;
      case 'import-go': this.importCode(this.codeInput.value); break;
      case 'code-close': this.closeCode(); break;
    }
  },

  closeCode() { this.codePanel.hidden = true; },

  problems() {
    const flat = this.level.map.flat();
    if (!flat.includes('1')) return 'Place a Player 1 start first';
    if (this.players === 2 && !flat.includes('2')) return 'Place a Player 2 start, or switch to 1P';
    if (!flat.some(ch => ENEMY_TYPES[ch])) return 'Place at least one enemy tank';
    return null;
  },

  test() {
    const p = this.problems();
    if (p) { this.toast(p); return; }
    this.hideUI();
    this.game.startCustom(this.asLevel(), this.players, 'editor');
  },

  save() {
    const list = Save.data.custom;
    const name = this.level.name.trim() || `My level ${list.length + 1}`;
    this.level.name = name;
    this.nameInput.value = name;
    const entry = { id: this.level.id || `L${Date.now()}`, name, rows: mapToRows(this.level.map) };
    const i = list.findIndex(l => l.id === entry.id);
    if (i >= 0) list[i] = entry;
    else {
      if (list.length >= MAX_CUSTOM) { this.toast(`You can keep up to ${MAX_CUSTOM} levels; delete one first`); return; }
      list.push(entry);
    }
    this.level.id = entry.id;
    this.saveDraft();
    this.refreshLoadList();
    this.toast(`Saved "${name}"`);
  },

  remove() {
    const list = Save.data.custom, i = list.findIndex(l => l.id === this.level.id);
    if (i < 0) { this.toast('This level is not saved yet'); return; }
    const [gone] = list.splice(i, 1);
    this.level.id = null;
    this.saveDraft();
    this.refreshLoadList();
    this.toast(`Deleted "${gone.name}" (still open here, save again to keep it)`);
  },

  refreshLoadList() {
    const opts = ['<option value="" selected disabled>Load…</option>', '<option value="blank">New blank level</option>'];
    if (Save.data.custom.length) {
      opts.push('<optgroup label="My levels">');
      for (const l of Save.data.custom) opts.push(`<option value="c:${l.id}">${escapeHtml(l.name)}</option>`);
      opts.push('</optgroup>');
    }
    opts.push('<optgroup label="Start from a mission">');
    LEVELS.forEach((_, i) => opts.push(`<option value="m:${i}">Mission ${i + 1}</option>`));
    opts.push('</optgroup><optgroup label="Start from a versus arena">');
    VERSUS_ARENAS.forEach((a, i) => opts.push(`<option value="a:${i}">${a.name}</option>`));
    opts.push('</optgroup>');
    this.loadSelect.innerHTML = opts.join('');
  },

  loadFrom(v) {
    if (!v) return;
    if (v === 'blank') this.level = { id: null, name: '', map: blankMap() };
    else if (v.startsWith('c:')) {
      const l = Save.data.custom.find(x => x.id === v.slice(2));
      if (!l) return;
      this.level = { id: l.id, name: l.name, map: rowsToMap(l.rows) };
    } else if (v.startsWith('m:')) {
      const i = +v.slice(2);
      this.level = { id: null, name: `Mission ${i + 1} remix`, map: rowsToMap(LEVELS[i].map) };
    } else if (v.startsWith('a:')) {
      const a = VERSUS_ARENAS[+v.slice(2)];
      this.level = { id: null, name: `${a.name} remix`, map: rowsToMap(a.map) };
    }
    this.nameInput.value = this.level.name;
    this.saveDraft();
    this.refresh();
    this.toast(`Loaded "${this.level.name || 'blank level'}"`);
  },

  // ---- share codes ----------------------------------------------------------
  encode() {
    const json = JSON.stringify({ n: this.level.name, m: mapToRows(this.level.map).join('') });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    return CODE_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  decode(code) {
    code = code.trim();
    if (!code.startsWith(CODE_PREFIX)) throw new Error('That is not a level code');
    const b64 = code.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const m = String(data.m || '');
    if (m.length !== ROWS * COLS || [...m].some(ch => !EDITOR_CHARS.has(ch))) throw new Error('The level code is damaged');
    const rows = [];
    for (let r = 0; r < ROWS; r++) rows.push(m.slice(r * COLS, (r + 1) * COLS));
    return { name: String(data.n || '').slice(0, 24), rows };
  },

  share() {
    const code = this.encode();
    this.codePanel.hidden = false;
    this.codePanel.dataset.mode = 'share';
    this.codeInput.value = code;
    this.codeInput.readOnly = true;
    this.codeInput.select();
    const done = () => this.toast('Level code copied, paste it to a friend');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, () => this.toast('Copy the code from the box above'));
    else this.toast('Copy the code from the box above');
  },

  importCode(code) {
    try {
      const l = this.decode(code);
      this.level = { id: null, name: l.name, map: rowsToMap(l.rows) };
      this.nameInput.value = l.name;
      this.closeCode();
      this.saveDraft();
      this.refresh();
      this.toast(`Imported "${l.name || 'level'}", press Save to keep it`);
    } catch (err) {
      this.toast(err.message.startsWith('That') || err.message.startsWith('The') ? err.message : 'The level code is damaged');
    }
  },

  toast(msg) {
    const el = document.getElementById('ed-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  },

  // ---- drawing (called from game.render in the 'editor' state) --------------
  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80,50,20,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx <= COLS + 1; gx++) { ctx.moveTo(gx * CELL, CELL); ctx.lineTo(gx * CELL, (ROWS + 1) * CELL); }
    for (let gy = 1; gy <= ROWS + 1; gy++) { ctx.moveTo(CELL, gy * CELL); ctx.lineTo((COLS + 1) * CELL, gy * CELL); }
    ctx.stroke();
    // player starts
    this.level.map.forEach((row, r) => row.forEach((ch, c) => {
      if (ch !== '1' && ch !== '2') return;
      const i = +ch - 1, x = (c + 1.5) * CELL, y = (r + 1.5) * CELL;
      Sprites.tankIcon(ctx, x, y, PLAYER_STYLE[i].body, 1, 1);
      Sprites.tag(ctx, { x, y }, PLAYER_STYLE[i].label, PLAYER_STYLE[i].ui);
    }));
    const h = this.hover;
    if (h && h.gx >= 1 && h.gy >= 1 && h.gx <= COLS && h.gy <= ROWS) {
      ctx.strokeStyle = this.painting === 2 ? '#c8302c' : '#3d8fe0';
      ctx.lineWidth = 3;
      ctx.strokeRect(h.gx * CELL + 1.5, h.gy * CELL + 1.5, CELL - 3, CELL - 3);
    }
    ctx.restore();
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
