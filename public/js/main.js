// Boot, main loop, layout, toolbar, dialogs, persistence and the test hook.
import { Game, M, TICK_MS, RES, RESY, ABIL_NAMES } from './sim.js';
import { loadAssets } from './assets.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import { Input } from './input.js';

const LS_OPT = 'cc94.options', LS_HI = 'cc94.hiscores';
const SPEC_LIMIT = 2048, SPEC_SUM = SPEC_LIMIT * 5 / 2;
const SPEC_KEYS = [['bullet', 'Bullet speed'], ['thrust', 'Thrust'], ['speed', 'Maximum speed'], ['rot', 'Rotation speed'], ['ability', 'Special ability']];

const $ = s => document.querySelector(s);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

// ---------------------------------------------------------------- options ---
function defaults() {
  return {
    difficulty: 1, fragmentExplosions: true, pauseInactive: true, bulletsKillPlayers: false,
    tournament: false, tournamentRocks: 1, tournamentLives: 5, tournamentRounds: 7,
    startingLevel: 0, allSpecials: false, numPlayers: 1, sound: true, music: false, stickMode: 'aim',
    players: [0, 1, 2, 3].map(() => ({ special: 0, specs: { rot: 1024, thrust: 1024, speed: 1024, ability: 1024, bullet: 1024 } })),
  };
}
function loadOptions() {
  const d = defaults(), o = load(LS_OPT, {});
  const p = Object.assign(d, o);
  p.players = d.players.map((dp, i) => {
    const op = (o.players || [])[i] || {};
    return { special: Number.isInteger(op.special) && op.special >= -1 && op.special <= 3 ? op.special : dp.special,
      specs: Object.assign({}, dp.specs, op.specs || {}) };
  });
  p.difficulty = Math.min(3, Math.max(1, p.difficulty | 0));
  return p;
}
const params = loadOptions();
const saveOptions = () => save(LS_OPT, params);

// ------------------------------------------------------------- hi scores ---
const hiscores = {
  data: load(LS_HI, []).filter(e => e && typeof e.score === 'number').slice(0, 10),
  list() { return this.data.slice(); },
  rank(score) {
    if (score <= 0) return 0;
    let r = this.data.findIndex(e => score > e.score);
    if (r < 0) r = this.data.length < 10 ? this.data.length : -1;
    return r + 1;
  },
  insert(initials, score) {
    const r = this.rank(score); if (!r) return;
    this.data.splice(r - 1, 0, { initials, score });
    this.data.length = Math.min(10, this.data.length);
    save(LS_HI, this.data);
  },
};

// --------------------------------------------------------------- globals ---
const canvas = $('#cv'), ctx = canvas.getContext('2d', { alpha: false });
const input = new Input();
input.stickMode = params.stickMode;
const audio = new Audio();
audio.sfxOn = params.sound; audio.musicOn = params.music;
let A, game, renderer;
let pauseReason = null;             // 'user' | 'inactive'
let dialogOpen = false;
const perf = { frames: 0, ticks: 0, dts: [], maxTickMs: 0, errors: [] };
window.addEventListener('error', e => perf.errors.push(String(e.message)));

function setTouch(on) {
  if (on && !input.touchMode) { input.touchMode = true; }
  document.body.classList.toggle('touch', input.touchMode);
  layout();
}

// ---------------------------------------------------------------- layout ---
function safeInsets() {
  const r = $('#safe-probe').getBoundingClientRect();
  return { t: r.top, l: r.left, r: innerWidth - r.right, b: innerHeight - r.bottom };
}
function layout() {
  const vw = innerWidth, vh = innerHeight, safe = safeInsets();
  const aw = vw - safe.l - safe.r, ah = vh - safe.t - safe.b;
  const portrait = vh > vw;
  const touch = input.touchMode;
  // reserve room under the game for the touch controls on portrait phones
  const ctlH = touch && portrait ? Math.min(ah * 0.42, Math.max(230, Math.min(vw, vh) * 0.62)) : 0;
  let s = Math.min(aw / 640, (ah - ctlH) / 520);
  const barH = Math.round(Math.max(touch ? 30 : 24, Math.min(40, 24 * s)));
  const showTitle = !touch && ah > 560;
  const titleH = showTitle ? Math.round(Math.max(18, Math.min(26, 20 * s))) : 0;
  s = Math.min(aw / 640, (ah - ctlH - barH - titleH - 2) / 480);
  const cw = Math.floor(640 * s), ch = Math.floor(480 * s);
  const fw = cw + 2, fh = ch + barH + titleH + 2;
  const fr = $('#frame');
  const left = Math.round(safe.l + (aw - fw) / 2);
  const top = Math.round(touch && portrait ? safe.t + Math.max(0, (ah - ctlH - fh) / 2) : safe.t + (ah - fh) / 2);
  Object.assign(fr.style, { left: left + 'px', top: top + 'px', width: fw + 'px', height: fh + 'px', visibility: 'visible' });
  const tb = $('#titlebar'); tb.style.display = showTitle ? 'flex' : 'none'; tb.style.height = titleH + 'px'; tb.style.fontSize = Math.round(titleH * 0.6) + 'px';
  const bar = $('#toolbar'); bar.style.height = barH + 'px'; bar.style.fontSize = Math.max(9, Math.min(14, fw / 40, barH * 0.5)).toFixed(1) + 'px';
  const sc = $('#screen'); sc.style.width = cw + 'px'; sc.style.height = ch + 'px';
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.round(cw * dpr)), bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  input.layoutTouch(vw, vh, safe, game, top + titleH + barH + 1);
  draw(0);
}

// --------------------------------------------------------------- toolbar ---
function syncToolbar() {
  if (!game) return;
  const playing = game.isPlaying();
  $('#btn-start').textContent = playing ? 'Stop' : 'Start';
  $('#btn-pause').textContent = game.paused ? 'Continue' : 'Pause';
  $('#btn-sound').classList.toggle('off', !params.sound);
  $('#btn-music').classList.toggle('off', !params.music);
  for (let i = 1; i <= 4; i++) $(`[data-cmd=p${i}]`).classList.toggle('on', params.numPlayers === i);
  document.body.classList.toggle('playing', playing && !game.paused);
  const st = game.stats[0];
  input.updateTouchUI(st && playing ? st.special : params.players[0].special, params.allSpecials);
}
function startGame(n) {
  if (n) { params.numPlayers = n; saveOptions(); }
  hideInitials();
  setPause(null);
  input.clearKeys();
  game.newGame(params.numPlayers);
  syncToolbar();
}
function stopGame() { hideInitials(); setPause(null); game.stopGame(); syncToolbar(); }
function setPause(reason) {
  if (!game) return;
  if (reason) {
    if (!game.isPlaying() && reason === 'user') return;
    game.paused = 1; pauseReason = reason; audio.suspend(); input.clearKeys();
  } else {
    game.paused = 0; pauseReason = null;
    if (document.visibilityState === 'visible') audio.resume();
    resetClock();
  }
  syncToolbar();
}
function togglePause() { if (game.paused) setPause(null); else setPause('user'); }

const commands = {
  p1: () => startGame(1), p2: () => startGame(2), p3: () => startGame(3), p4: () => startGame(4),
  start: () => { if (game.isPlaying()) stopGame(); else startGame(); },
  pause: togglePause,
  sound: () => { params.sound = !params.sound; audio.setSfx(params.sound); if (!params.sound) game.loops.clear(); saveOptions(); syncToolbar(); },
  music: () => { params.music = !params.music; audio.setMusic(params.music); saveOptions(); syncToolbar(); },
  players: () => playersDialog(), game: () => gameDialog(), help: () => helpDialog(), about: () => aboutDialog(),
};
$('#toolbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  gesture();
  commands[b.dataset.cmd] && commands[b.dataset.cmd]();
  b.blur();
});

// --------------------------------------------------------------- dialogs ---
function openDialog(title, bodyHtml, buttons, onMount) {
  dialogOpen = true;
  const wasPaused = game.paused;
  if (game.isPlaying() && !wasPaused) setPause('user');
  input.clearKeys();
  const d = $('#dlg');
  d.innerHTML = `<div class="cap">${title}</div><div class="body">${bodyHtml}</div><div class="btns"></div>`;
  const close = () => {
    $('#modal').classList.add('hidden'); dialogOpen = false;
    if (!wasPaused && pauseReason === 'user') setPause(null);
    syncToolbar();
  };
  for (const [label, fn] of buttons) {
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('click', () => { if (fn() !== false) close(); });
    d.querySelector('.btns').appendChild(b);
  }
  $('#modal').classList.remove('hidden');
  onMount && onMount(d, close);
  d.closeDialog = close;
}
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') $('#dlg').closeDialog(); });

function playersDialog() {
  const work = JSON.parse(JSON.stringify(params.players));
  let cur = 0;
  const radios = [-1, 0, 1, 2, 3].map(v => `<label><input type="radio" name="sp" value="${v}"> ${v < 0 ? 'None' : ABIL_NAMES[v]}</label>`).join('');
  const sliders = SPEC_KEYS.map(([k, l]) => `<span>${l}:</span><input type="range" min="0" max="${SPEC_LIMIT - 1}" step="1" data-spec="${k}">`).join('');
  openDialog('Players', `
    <div class="tabs">${[1, 2, 3, 4].map(i => `<button data-pl="${i - 1}">Player ${i}</button>`).join('')}</div>
    <div class="spec">${sliders}</div>
    <div class="row">
      <fieldset><legend>Special ability</legend>${radios}</fieldset>
      <fieldset><legend>Options</legend>
        <label><input type="checkbox" id="o-all"> All specials (Z X C V / 4 touch buttons)</label>
        <label>Touch stick: <select id="o-stick"><option value="aim">point to steer</option><option value="tank">classic rotate/thrust</option></select></label>
        <p style="font-size:11px;max-width:230px">Keys: P1 &larr; &rarr; &uarr; Space RCtrl &middot; P2 A D S LShift LCtrl &middot; P3 Numpad 4 6 8 0 2 &middot; P4 J L I K U &middot; Gamepads map to players by index.</p>
        <button id="o-reset">Reset</button>
      </fieldset>
    </div>`,
  [['OK', () => {
    params.players = work; params.allSpecials = $('#o-all').checked; params.stickMode = $('#o-stick').value;
    input.stickMode = params.stickMode;
    // like the original, a new special takes effect at once for a live player's next ship
    game.stats.forEach(st => { input.pendingSpecial[st.num] = work[st.num].special; st.specs = work[st.num].specs; });
    saveOptions();
  }], ['Cancel', () => {}], ['Help', () => { helpDialog(); return false; }]],
  d => {
    $('#o-all').checked = params.allSpecials; $('#o-stick').value = params.stickMode;
    const show = () => {
      d.querySelectorAll('[data-pl]').forEach(b => b.classList.toggle('on', +b.dataset.pl === cur));
      d.querySelectorAll('input[name=sp]').forEach(r => { r.checked = +r.value === work[cur].special; });
      d.querySelectorAll('[data-spec]').forEach(r => { r.value = work[cur].specs[r.dataset.spec]; });
    };
    d.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => { cur = +b.dataset.pl; show(); }));
    d.querySelectorAll('input[name=sp]').forEach(r => r.addEventListener('change', () => { work[cur].special = +r.value; }));
    d.querySelectorAll('[data-spec]').forEach(r => r.addEventListener('input', () => {
      // the five specs always sum to SpecLimit*5/2: moving one rescales the others
      const sp = work[cur].specs, k = r.dataset.spec, v = Math.max(0, Math.min(SPEC_LIMIT - 1, +r.value));
      const others = SPEC_KEYS.map(e => e[0]).filter(x => x !== k);
      const sum = others.reduce((a, x) => a + sp[x], 0);
      sp[k] = v;
      for (const x of others) sp[x] = Math.max(0, Math.min(SPEC_LIMIT - 1, sum > 0 ? Math.round((SPEC_SUM - v) * sp[x] / sum) : Math.round((SPEC_SUM - v) / 4)));
      show();
    }));
    $('#o-reset').addEventListener('click', () => { for (const [k] of SPEC_KEYS) work[cur].specs[k] = SPEC_LIMIT / 2; show(); });
    show();
  });
}

function gameDialog() {
  const lv = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24].map(l => `<option value="${l}">${l + 1}</option>`).join('');
  openDialog('Game', `
    <div class="row">
      <fieldset><legend>Difficulty</legend>
        ${['Simple', 'Challenging', 'Impossible'].map((n, i) => `<label><input type="radio" name="df" value="${i + 1}"> ${n}</label>`).join('')}
      </fieldset>
      <div>
        <label><input type="checkbox" id="g-frag"> Fragmented explosions</label>
        <label><input type="checkbox" id="g-pause"> Pause when inactive</label>
        <label><input type="checkbox" id="g-deadly"> Deadly bullets</label>
        <label>Starting level: <select id="g-level">${lv}</select></label>
      </div>
    </div>
    <fieldset><legend><label><input type="checkbox" id="g-tour"> Tournament mode (2-4 players)</label></legend>
      ${['No rocks', 'Bounce', 'Destroy'].map((n, i) => `<label style="display:inline-flex;margin-right:10px"><input type="radio" name="tr" value="${i}"> ${n}</label>`).join('')}
    </fieldset>`,
  [['OK', () => {
    params.difficulty = +document.querySelector('input[name=df]:checked').value;
    params.fragmentExplosions = $('#g-frag').checked; params.pauseInactive = $('#g-pause').checked;
    params.bulletsKillPlayers = $('#g-deadly').checked; params.tournament = $('#g-tour').checked;
    params.tournamentRocks = +document.querySelector('input[name=tr]:checked').value;
    params.startingLevel = +$('#g-level').value;
    saveOptions();
  }], ['Cancel', () => {}]],
  () => {
    document.querySelector(`input[name=df][value="${params.difficulty}"]`).checked = true;
    document.querySelector(`input[name=tr][value="${params.tournamentRocks}"]`).checked = true;
    $('#g-frag').checked = params.fragmentExplosions; $('#g-pause').checked = params.pauseInactive;
    $('#g-deadly').checked = params.bulletsKillPlayers; $('#g-tour').checked = params.tournament;
    $('#g-level').value = String(params.startingLevel);
  });
}

function helpDialog() {
  if (dialogOpen) $('#dlg').closeDialog();
  openDialog('Help', `
    <h3>Goal</h3>
    <p>Blast every comet. Big comets split into two medium ones, mediums into two small ones. Some comets hatch little pests that home in on you. A flying saucer drops by now and then. Clear the screen to reach the next level. You get an extra ship every 10,000 points.</p>
    <h3>Desktop</h3>
    <ul><li>Player 1: <kbd>&larr;</kbd> <kbd>&rarr;</kbd> rotate, <kbd>&uarr;</kbd> thrust, <kbd>Space</kbd> fire, <kbd>Right Ctrl</kbd> special. One player also gets <kbd>A</kbd><kbd>D</kbd><kbd>W</kbd> and <kbd>&darr;</kbd>/<kbd>Shift</kbd> for the special.</li>
    <li>Player 2: <kbd>A</kbd> <kbd>D</kbd> <kbd>S</kbd>, <kbd>Left Shift</kbd> fire, <kbd>Left Ctrl</kbd> special. Player 3: numpad <kbd>4</kbd> <kbd>6</kbd> <kbd>8</kbd>, <kbd>0</kbd>, <kbd>2</kbd>. Player 4: <kbd>J</kbd> <kbd>L</kbd> <kbd>I</kbd>, <kbd>K</kbd>, <kbd>U</kbd>.</li>
    <li><kbd>Enter</kbd> starts a game, <kbd>1</kbd>-<kbd>4</kbd> start with that many players, <kbd>P</kbd>/<kbd>Esc</kbd> pauses.</li>
    <li>Gamepad: stick or d-pad rotates, up / RT thrusts, A fires, B special, X Y LB RB are the four specials when "All specials" is on, Start pauses.</li></ul>
    <h3>Touch</h3>
    <p>Drag anywhere on the left half to steer: the ship turns toward the stick and thrusts when you push it to the edge (switch to classic rotate/thrust under Players). Hold FIRE on the right. The cyan buttons are the specials. Tapping a dimmed one makes it your special for your next ship.</p>
    <h3>Specials</h3>
    <ul><li><b>Hyperspace</b>: hold to charge, release to jump. A longer charge means a longer jump.</li>
    <li><b>Shields</b>: an armoured bubble that drains while it is on and recharges while it is off.</li>
    <li><b>Disruptor</b>: a field that knocks nearby objects (and enemy ships) away.</li>
    <li><b>Cloak</b>: hidden from the saucer and from other players for a while.</li></ul>
    <p>Hold FIRE and SPECIAL together to bring your next ship in early.</p>`,
  [['OK', () => {}]]);
}

function aboutDialog() {
  openDialog('About Comet Clobber \u201994', `
    <p style="font-size:16px"><b>COMET CLOBBER! &rsquo;94</b>, a browser remake.</p>
    <p>A tribute to a 1994 classic. Not affiliated.</p>
    <p>The rules, constants and level progression follow the 1994 game. All graphics and sounds here are newly made: the graphics are raytraced or procedural, and the sounds are synthesized live with WebAudio. No original assets are used.</p>
    <p>Works offline once loaded. Install it with &ldquo;Add to Home Screen&rdquo;.</p>`,
  [['OK', () => {}]]);
}

// -------------------------------------------------------------- initials ---
function showInitials() {
  const box = $('#initials'), inp = $('#init-input');
  inp.value = ''; box.classList.remove('hidden');
  setTimeout(() => { try { inp.focus(); } catch (e) { /* */ } }, 50);
}
function hideInitials() { $('#initials').classList.add('hidden'); try { $('#init-input').blur(); } catch (e) { /* */ } }
$('#init-input').addEventListener('input', e => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z ]/g, '').slice(0, 3);
  e.target.value = v;
  game.initials = v;
  if (game.initialsText) game.initialsText.t = (v + '___').slice(0, 3).split('').join(' ');
});
const submitTouchInitials = () => { game.submitInitials($('#init-input').value.toUpperCase() || '???'); hideInitials(); };
$('#init-ok').addEventListener('click', submitTouchInitials);
$('#init-input').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submitTouchInitials(); } });

// ----------------------------------------------------------------- input ---
let unlocked = false;
function gesture() {
  audio.unlock(); unlocked = true;
  if (params.music) audio.startMusic();
}
const NON_GAME = new Set(['Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);
window.addEventListener('keydown', e => {
  if (!game) return;
  if (dialogOpen) { if (e.code === 'Escape') $('#dlg').closeDialog(); return; }
  if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) return;   // keep browser reload
  gesture();
  if (game.mode === M.LogHi && $('#initials').classList.contains('hidden')) {
    if (/^[a-z ]$/i.test(e.key)) game.typeInitial(e.key.toUpperCase());
    else if (e.key === 'Backspace') game.typeInitial('\b');
    else if (e.key === 'Enter') game.submitInitials(game.initials || '???');
    e.preventDefault(); return;
  }
  if (e.repeat && input.keys.has(e.code)) { if (input.isGameKey(e.code)) e.preventDefault(); return; }
  if (game.paused && pauseReason === 'inactive') { setPause(null); }
  if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Pause') {
    if (game.isPlaying()) togglePause();
    input.keyDown(e.code, e.key); input.keyUp(e.code);
    e.preventDefault(); return;
  }
  if (game.paused) { e.preventDefault(); return; }
  if (!game.isPlaying()) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { startGame(); e.preventDefault(); return; }
    const m = /^Digit([1-4])$/.exec(e.code); if (m) { startGame(+m[1]); e.preventDefault(); return; }
  }
  input.keyDown(e.code, e.key);
  if (input.isGameKey(e.code) || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  else if (!NON_GAME.has(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { input.keyUp(e.code); });
window.addEventListener('blur', () => input.clearKeys());

input.onCheat = name => game.cheat(name);
input.onGamepadButton = (idx, b) => {
  if (dialogOpen || !game) return;
  if (game.mode === M.LogHi) { if (b === 0 || b === 9) game.submitInitials(game.initials || 'PAD'); return; }
  if (b === 9) { if (game.isPlaying()) togglePause(); else startGame(); return; }
  if (game.paused) { if (b === 0) setPause(null); return; }
  if (!game.isPlaying() && b === 0) startGame();
};

// taps on the game screen: resume, or start from the attract loop
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') setTouch(true);
  gesture();
  if (!game) return;
  if (game.paused) { setPause(null); return; }
  if (game.mode === M.LogHi) { showInitials(); return; }
  if (!game.isPlaying()) startGame();
});
canvas.addEventListener('dblclick', e => { if (game && !game.isPlaying()) startGame(); });
window.addEventListener('touchstart', () => setTouch(true), { passive: true, once: true });
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!e.target.closest('.dlg .body')) e.preventDefault(); }, { passive: false });
document.addEventListener('selectstart', e => { if (!e.target.closest('input')) e.preventDefault(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    input.clearKeys();
    if (game && game.isPlaying() && params.pauseInactive && !game.paused) setPause('inactive');
    audio.suspend();
  } else if (!game || !game.paused) { audio.resume(); resetClock(); }
});
window.addEventListener('pagehide', () => { if (game && game.isPlaying() && !game.paused) setPause('inactive'); });
window.addEventListener('resize', () => layout());
window.addEventListener('orientationchange', () => setTimeout(layout, 120));
if (window.visualViewport) visualViewport.addEventListener('resize', () => layout());

// ------------------------------------------------------------------ loop ---
let last = performance.now(), acc = 0;
function resetClock() { last = performance.now(); acc = 0; }
function draw(alpha) {
  if (!game) return;
  ctx.setTransform(canvas.width / RES, 0, 0, canvas.height / RESY, 0, 0);
  renderer.draw(ctx, game, alpha, { touch: input.touchMode });
}
function handleEvents() {
  if (!game.events.length) return;
  for (const ev of game.events) {
    if (ev.type === 'initials' && input.touchMode) showInitials();
    else if (ev.type === 'initialsDone') hideInitials();
  }
  game.events.length = 0;
}
let lastMode = -1, lastPlaying = null;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - last; last = now;
  if (dt > 250) dt = 250;
  if (dt > 0) { perf.dts.push(dt); if (perf.dts.length > 600) perf.dts.shift(); }
  perf.frames++;
  input.pollGamepadButtons();
  if (!game.paused && !dialogOpen) {
    acc += dt;
    let n = 0;
    while (acc >= TICK_MS && n < 5) {
      const t0 = performance.now();
      game.tick(); perf.ticks++;
      perf.maxTickMs = Math.max(perf.maxTickMs, performance.now() - t0);
      acc -= TICK_MS; n++;
      handleEvents();
    }
    if (n === 5 && acc > TICK_MS) acc = 0;
  }
  const playing = game.isPlaying();
  if (game.mode !== lastMode || playing !== lastPlaying) { lastMode = game.mode; lastPlaying = playing; syncToolbar(); }
  draw(game.paused ? 1 : Math.min(1, acc / TICK_MS));
}

// ------------------------------------------------------------------ boot ---
async function boot() {
  document.body.classList.toggle('touch', input.touchMode);
  A = await loadAssets();
  renderer = new Renderer(A);
  game = new Game(A, audio, input, hiscores, params);
  input.buildTouch($('#touch'), {
    onGesture: () => gesture(),
    canStick: () => game.isPlaying() && !game.paused,
    onTap: () => { if (game.paused) setPause(null); },
    getSpecial: () => { const st = game.stats[0]; return st ? st.special : params.players[0].special; },
    selectSpecial: i => {
      params.players[0].special = i; saveOptions();
      input.pendingSpecial[0] = i;
      input.updateTouchUI(i, params.allSpecials);
      audio.play('Pop');
    },
  });
  game.setMode(M.Attract);
  layout();
  syncToolbar();
  $('#loading').classList.add('gone');
  resetClock();
  requestAnimationFrame(frame);
}

// test / debug hook
window.__game = {
  get game() { return game; }, params, perf, hiscores,
  start: n => startGame(n), stop: () => stopGame(), pause: () => setPause('user'), resume: () => setPause(null),
  nuke: () => game.cheat('NUKE'),
  skipLevel() {
    for (const o of game.objs) if (o.kind === 'rock' || o.kind === 'pest') o.dead = true;
    game.numRocksLeft = 0;
  },
  gameOver() { for (const st of game.stats) { st.lives = 0; if (st.curShip && !st.curShip.dead) st.curShip.kill(); } },
  counts() { const c = {}; for (const o of game.objs) c[o.kind] = (c[o.kind] || 0) + 1; return c; },
  state() {
    return { mode: game.mode, level: game.level, paused: !!game.paused, playing: game.isPlaying(), ticks: game.ticks, objs: game.objs.length,
      rocksLeft: game.numRocksLeft, stats: game.stats.map(s => ({ score: s.score, lives: s.lives, ship: !!s.curShip, rot: s.curShip ? s.curShip.rot : null, thrust: s.curShip ? !!s.curShip.thrust : null })),
      touch: input.touchMode, stick: input.touch.stick, fire: input.touch.fire, audio: audio.ctx ? audio.ctx.state : 'none' };
  },
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
boot().catch(err => { $('#loading').textContent = 'Failed to load: ' + err.message; console.error(err); });
