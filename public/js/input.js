// Keyboard, gamepad and touch input.  Produces per-player held states each tick
// and turns them into key-down / key-up messages for the ship, with a
// keyboard-like typematic repeat for the fire button.
import { ABIL, ABIL_NAMES } from './sim.js';

const CTLS = ['left', 'right', 'thrust', 'fire', 'special'];
const FIRE_DELAY = 12;   // ticks before a held fire button starts repeating
const CHEATS = ['PHASEOUT', 'JUGGER', 'NUKE', 'AUTOFIRE'];

// default keys follow the original's defaults (P1 arrows/Space/RCtrl,
// P2 A/D/S/LShift/LCtrl, P3 numpad 4/6/8/0/2); P4 gets J/L/I/K/U
const KEYMAP = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], thrust: ['ArrowUp'], fire: ['Space'], special: ['ControlRight'] },
  { left: ['KeyA'], right: ['KeyD'], thrust: ['KeyS', 'KeyW'], fire: ['ShiftLeft'], special: ['ControlLeft'] },
  { left: ['Numpad4'], right: ['Numpad6'], thrust: ['Numpad8'], fire: ['Numpad0'], special: ['Numpad2', 'Numpad5'] },
  { left: ['KeyJ'], right: ['KeyL'], thrust: ['KeyI'], fire: ['KeyK'], special: ['KeyU'] },
];
// extra comfort keys for player 1 in a one-player game
const KEYMAP_SOLO = { left: ['KeyA'], right: ['KeyD'], thrust: ['KeyW'], special: ['ArrowDown', 'ControlLeft', 'ShiftLeft', 'ShiftRight', 'KeyS', 'Enter'] };
const SPECIAL_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'];   // player 1: the four specials when "all specials" is on

const blank = () => ({ left: false, right: false, thrust: false, fire: false, special: false, sp: [false, false, false, false] });

export class Input {
  constructor() {
    this.keys = new Set();
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touch = { stick: null, fire: false, sp: [false, false, false, false] };
    this.stickMode = 'aim';
    this.prev = [0, 1, 2, 3].map(blank);
    this.fireHeld = [0, 0, 0, 0];
    this.cheatBuf = '';
    this.numPlayers = 1;
    this.allSpecials = false;
    this.onCheat = null;
    this.pendingSpecial = [null, null, null, null];
    this.gpPrev = [];
    this.onGamepadButton = null;
  }

  keyDown(code, key) {
    this.keys.add(code);
    if (key && key.length === 1 && /[a-z]/i.test(key)) {
      this.cheatBuf = (this.cheatBuf + key.toUpperCase()).slice(-8);
      for (const c of CHEATS) if (this.cheatBuf.endsWith(c)) { this.cheatBuf = ''; this.onCheat && this.onCheat(c); }
    }
  }
  keyUp(code) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); this.touch.fire = false; this.touch.sp = [false, false, false, false]; this.touch.stick = null; }
  isGameKey(code) {
    for (const m of KEYMAP) for (const k in m) if (m[k].includes(code)) return true;
    for (const k in KEYMAP_SOLO) if (KEYMAP_SOLO[k].includes(code)) return true;
    return SPECIAL_KEYS.includes(code);
  }

  gamepads() {
    try { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); } catch (e) { return []; }
  }

  // raw held state for player num, independent of the ship
  raw(num, ship) {
    const s = blank();
    const any = list => list.some(k => this.keys.has(k));
    const m = KEYMAP[num];
    for (const c of CTLS) s[c] = any(m[c]);
    if (num === 0 && this.numPlayers === 1) for (const c in KEYMAP_SOLO) s[c] = s[c] || any(KEYMAP_SOLO[c]);
    if (num === 0) SPECIAL_KEYS.forEach((k, i) => { s.sp[i] = this.keys.has(k); });
    // gamepad with the same index as the player
    const gp = this.gamepads().find(p => p.index === num) || (num === 0 && this.numPlayers === 1 ? this.gamepads()[0] : null);
    if (gp) {
      const b = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      s.left = s.left || b(14) || ax < -0.5;
      s.right = s.right || b(15) || ax > 0.5;
      s.thrust = s.thrust || b(12) || b(7) || ay < -0.6;
      s.fire = s.fire || b(0);
      s.special = s.special || b(1) || b(13);
      [2, 3, 4, 5].forEach((bi, i) => { if (b(bi)) s.sp[i] = true; });
    }
    // touch controls drive player 1
    if (num === 0) {
      const t = this.touch;
      s.fire = s.fire || t.fire;
      t.sp.forEach((v, i) => { if (v) s.sp[i] = true; });
      const st = t.stick;
      if (st && st.d > 0.25) {
        if (this.stickMode === 'aim') {
          if (ship && !ship.dead) {
            const target = Math.round(st.a * 1024 / (2 * Math.PI)) & 1023;
            const diff = ((target - ship.rot + 512) & 1023) - 512;
            const dead = (ship.rotSpeed >> 1) + 1;
            if (diff < -dead) s.left = true; else if (diff > dead) s.right = true;
          }
          if (st.d > 0.7) s.thrust = true;
        } else {
          if (st.x < -0.35) s.left = true;
          if (st.x > 0.35) s.right = true;
          if (st.y < -0.5) s.thrust = true;
        }
      }
    }
    // in normal mode any special button triggers the player's one special
    if (!this.allSpecials) {
      if (s.sp.some(Boolean)) s.special = true;
      s.sp = [false, false, false, false];
    }
    return s;
  }

  held(num) {
    return this.raw(num, null);
  }

  resetPlayer(num) {
    this.prev[num] = blank();
    this.fireHeld[num] = 0;
  }

  // called once per tick by the game, before objects act
  feed(game) {
    this.numPlayers = game.numPlayers;
    this.allSpecials = !!game.params.allSpecials;
    this.pollGamepadButtons();
    for (const st of game.stats) {
      const n = st.num;
      if (this.pendingSpecial[n] !== null && !st.curShip) { st.special = this.pendingSpecial[n]; this.pendingSpecial[n] = null; }
      const ship = st.curShip;
      const cur = this.raw(n, ship);
      const p = this.prev[n];
      if (ship && !ship.dead && game.isPlaying()) {
        // left/right/thrust: down every tick while held (like key repeat), up on release
        for (const c of ['left', 'right', 'thrust']) if (!cur[c] && p[c]) ship.message(false, c);
        for (const c of ['left', 'right', 'thrust']) if (cur[c]) ship.message(true, c);
        if (cur.fire) {
          if (!p.fire || this.fireHeld[n] >= FIRE_DELAY) ship.message(true, 'fire');
          this.fireHeld[n]++;
        } else { if (p.fire) ship.message(false, 'fire'); this.fireHeld[n] = 0; }
        if (cur.special && !p.special) ship.message(true, 'special', st.special);
        else if (!cur.special && p.special) ship.message(false, 'special', st.special);
        for (let i = 0; i < 4; i++) {
          if (cur.sp[i] && !p.sp[i]) ship.message(true, 'special', i);
          else if (!cur.sp[i] && p.sp[i]) ship.message(false, 'special', i);
        }
      }
      this.prev[n] = cur;
    }
  }

  pollGamepadButtons() {
    for (const gp of this.gamepads()) {
      const prev = this.gpPrev[gp.index] || [];
      const now = gp.buttons.map(b => !!(b && b.pressed));
      now.forEach((v, i) => { if (v && !prev[i] && this.onGamepadButton) this.onGamepadButton(gp.index, i); });
      this.gpPrev[gp.index] = now;
    }
  }

  // ------------------------------------------------------------ touch UI ---
  buildTouch(root, opts) {
    this.opts = opts;
    const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; root.appendChild(d); return d; };
    this.tStickZone = el('t-zone');
    this.tStickBase = el('t-stick-base'); this.tStickKnob = el('t-stick-knob');
    this.tFire = el('t-btn t-fire', '<span>FIRE</span>');
    const short = ['HYPER', 'SHIELD', 'DISRUPT', 'CLOAK'];
    this.tSp = short.map((s, i) => { const b = el('t-btn t-sp', `<span>${s}</span>`); b.dataset.sp = i; b.title = ABIL_NAMES[i]; return b; });
    const zone = this.tStickZone;
    let stickId = null;
    const setStick = (e) => {
      const r = this.stickCenter;
      const dx = e.clientX - r.x, dy = e.clientY - r.y, R = r.r;
      let d = Math.hypot(dx, dy) / R; const a = Math.atan2(dx, -dy);
      const dc = Math.min(1, d);
      this.touch.stick = { d: dc, a: (a + 2 * Math.PI) % (2 * Math.PI), x: dc * Math.sin(a), y: -dc * Math.cos(a) };
      this.tStickKnob.style.transform = `translate(${dc * Math.sin(a) * R}px, ${-dc * Math.cos(a) * R}px)`;
    };
    zone.addEventListener('pointerdown', e => {
      e.preventDefault();
      opts.onGesture && opts.onGesture(e);
      if (stickId !== null) return;
      if (opts.canStick && !opts.canStick()) { opts.onTap && opts.onTap(e); return; }
      stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      const R = this.stickRadius || 60;
      this.stickCenter = { x: e.clientX, y: e.clientY, r: R };
      this.tStickBase.style.left = `${e.clientX - R}px`; this.tStickBase.style.top = `${e.clientY - R}px`;
      this.tStickKnob.style.left = `${e.clientX - R * 0.45}px`; this.tStickKnob.style.top = `${e.clientY - R * 0.45}px`;
      this.tStickKnob.style.transform = '';
      this.tStickBase.classList.add('on'); this.tStickKnob.classList.add('on');
      this.touch.stick = { d: 0, a: 0, x: 0, y: 0 };
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === stickId) { e.preventDefault(); setStick(e); } });
    const end = e => {
      if (e.pointerId !== stickId) return;
      stickId = null; this.touch.stick = null;
      this.tStickBase.classList.remove('on'); this.tStickKnob.classList.remove('on');
      this.placeStickHome();
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end); zone.addEventListener('lostpointercapture', end);
    const hold = (b, on, off) => {
      const ids = new Set();
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); opts.onGesture && opts.onGesture(e);
        ids.add(e.pointerId); try { b.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        b.classList.add('down'); on();
      });
      const up = e => { if (!ids.delete(e.pointerId)) return; if (!ids.size) { b.classList.remove('down'); off(); } };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    };
    hold(this.tFire, () => { this.touch.fire = true; }, () => { this.touch.fire = false; });
    this.tSp.forEach((b, i) => hold(b, () => {
      if (!this.allSpecials && opts.getSpecial && opts.getSpecial() !== i) { opts.selectSpecial && opts.selectSpecial(i); return; }
      this.touch.sp[i] = true;
    }, () => { this.touch.sp[i] = false; }));
  }

  // position touch controls; area = {x,y,w,h} of the whole viewport (CSS px), safe = insets
  layoutTouch(vw, vh, safe, game, zoneTop = 0) {
    if (!this.tFire) return;
    const unit = Math.min(vw, vh);
    const fireR = Math.max(34, Math.min(62, unit * 0.11));
    const spR = fireR * 0.62;
    const R = Math.max(44, Math.min(80, unit * 0.14));
    this.stickRadius = R;
    const fx = vw - safe.r - fireR - 18 - spR * 0.6, fy = vh - safe.b - fireR - 18;
    const place = (b, cx, cy, r) => { Object.assign(b.style, { left: `${cx - r}px`, top: `${cy - r}px`, width: `${2 * r}px`, height: `${2 * r}px` }); };
    place(this.tFire, fx, fy, fireR);
    // specials on an arc up and left of the fire button
    const arc = [[-2.1, -0.35], [-1.55, -1.45], [-0.35, -2.15], [0.75, -1.65]];
    this.tSp.forEach((b, i) => place(b, fx + arc[i][0] * fireR * 1.05, fy + arc[i][1] * fireR * 1.05, spR));
    Object.assign(this.tStickZone.style, { left: '0px', top: `${zoneTop}px`, width: `${vw * 0.5}px`, height: `${Math.max(0, vh - zoneTop)}px` });
    this.home = { x: safe.l + R + 26, y: vh - safe.b - R - 26 };
    this.placeStickHome();
    for (const e of [this.tStickBase, this.tStickKnob]) { e.style.width = e.style.height = `${(e === this.tStickBase ? 2 : 0.9) * R}px`; }
  }
  placeStickHome() {
    if (!this.home || this.touch.stick) return;
    const R = this.stickRadius;
    this.tStickBase.style.left = `${this.home.x - R}px`; this.tStickBase.style.top = `${this.home.y - R}px`;
    this.tStickKnob.style.left = `${this.home.x - R * 0.45}px`; this.tStickKnob.style.top = `${this.home.y - R * 0.45}px`;
    this.tStickKnob.style.transform = '';
  }
  updateTouchUI(special, allSpecials) {
    if (!this.tSp) return;
    this.tSp.forEach((b, i) => b.classList.toggle('dim', !allSpecials && i !== special));
  }
}

export { ABIL };
