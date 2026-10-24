// Synthesised sound effects (no sample files).  All sounds are rendered once
// into AudioBuffers from simple maths, then played through WebAudio.
const SR = 22050;

function noiseGen(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; }; }

function render(dur, fn) {
  const n = Math.floor(dur * SR), d = new Float32Array(n);
  fn(d, n);
  // soft clip + tiny fade to avoid clicks
  for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i]);
  for (let i = 0; i < Math.min(64, n); i++) { d[i] *= i / 64; d[n - 1 - i] *= i / 64; }
  return d;
}
const env = (t, dur, a = 0.005) => (t < a ? t / a : Math.max(0, 1 - (t - a) / (dur - a)));
const expEnv = (t, k) => Math.exp(-t * k);
const sq = p => (p % 1 < 0.5 ? 1 : -1);
const saw = p => 2 * (p % 1) - 1;
const tri = p => 1 - 4 * Math.abs((p % 1) - 0.5);

function lowpass(d, cutoffFn) {
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    const fc = cutoffFn(i / SR);
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    y += a * (d[i] - y); d[i] = y;
  }
}

function tone(dur, f0, f1, wave, vol, decay = null) {
  return render(dur, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, f = f0 * Math.pow(f1 / f0, t / dur);
      ph += f / SR;
      d[i] = wave(ph) * vol * (decay ? expEnv(t, decay) : env(t, dur));
    }
  });
}
function boom(dur, cut0, cut1, vol, seed, k = 4) {
  return render(dur, (d, n) => {
    const r = noiseGen(seed);
    for (let i = 0; i < n; i++) d[i] = r();
    lowpass(d, t => cut0 * Math.pow(cut1 / cut0, t / dur));
    lowpass(d, t => cut0 * 1.5 * Math.pow(cut1 / cut0, t / dur));
    for (let i = 0; i < n; i++) { const t = i / SR; d[i] *= vol * 6 * expEnv(t, k) * Math.min(1, t * 200); }
  });
}
function notes(seq, step, wave, vol, len = 1) {
  const dur = seq.length * step + step * len;
  return render(dur, (d, n) => {
    seq.forEach((f, k) => {
      if (!f) return;
      let ph = 0;
      const s0 = Math.floor(k * step * SR), m = Math.floor(step * len * SR);
      for (let i = 0; i < m && s0 + i < n; i++) {
        const t = i / SR; ph += f / SR;
        d[s0 + i] += (wave(ph) * 0.7 + wave(ph * 2) * 0.3) * vol * expEnv(t, 6 / (step * len));
      }
    });
  });
}

function buildSounds() {
  const S = {};
  S.Shoot = render(0.16, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (1500 * Math.exp(-t * 14) + 180) / SR; d[i] = (sq(ph) * 0.5 + saw(ph * 1.01) * 0.3) * 0.35 * env(t, 0.16); }
  });
  S.AlienShoot = render(0.22, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (900 + 500 * Math.sin(t * 90) * Math.exp(-t * 6)) / SR; d[i] = tri(ph) * 0.45 * env(t, 0.22); }
  });
  S.Explode = boom(0.8, 2400, 250, 0.9, 11, 4.5);
  S.ExplodeLo = boom(1.3, 1100, 90, 1.0, 23, 2.8);
  S.ExplodeHi = boom(0.45, 5000, 600, 0.8, 37, 8);
  S.PlayerBlowUp = render(1.6, (d, n) => {
    const b = boom(1.6, 1800, 70, 1.0, 51, 2.2);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (420 * Math.exp(-t * 2) + 40) / SR; d[i] = b[i] * 0.9 + saw(ph) * 0.25 * expEnv(t, 2.5); }
  });
  S.Pop = render(0.09, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (900 * Math.exp(-t * 30) + 200) / SR; d[i] = sq(ph) * 0.4 * env(t, 0.09); }
  });
  S.Bounce = render(0.12, (d, n) => {
    let ph = 0; const r = noiseGen(5);
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (220 * Math.exp(-t * 10)) / SR; d[i] = (Math.sin(ph * 6.283) * 0.8 + r() * 0.3 * expEnv(t, 60)) * expEnv(t, 25); }
  });
  S.RockBounce = render(0.16, (d, n) => {
    let ph = 0; const r = noiseGen(9);
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (140 * Math.exp(-t * 6)) / SR; d[i] = (Math.sin(ph * 6.283) + r() * 0.5 * expEnv(t, 40)) * 0.8 * expEnv(t, 18); }
  });
  S.ShieldBounce = render(0.35, (d, n) => {
    for (let i = 0; i < n; i++) { const t = i / SR; d[i] = (Math.sin(t * 6.283 * 880) * 0.5 + Math.sin(t * 6.283 * 1318) * 0.35 + Math.sin(t * 6.283 * 2093) * 0.2) * 0.6 * expEnv(t, 11); }
  });
  S.HyperSpace = render(0.6, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (150 * Math.pow(16, t / 0.6) * (1 + 0.08 * Math.sin(t * 160))) / SR; d[i] = (tri(ph) * 0.6 + sq(ph * 0.5) * 0.15) * 0.6 * env(t, 0.6, 0.05); }
  });
  S.NewShip = notes([392, 523, 659, 784, 1046], 0.06, tri, 0.45, 2);
  S.WonNewLife = notes([523, 659, 784, 1046, 0, 784, 1046, 1318], 0.09, sq, 0.22, 2);
  S.Bonus = notes([1318, 1760, 2637], 0.07, tri, 0.4, 3);
  S.CroniesOut = render(0.5, (d, n) => {
    const r = noiseGen(77); let ph = 0, f = 1200;
    for (let i = 0; i < n; i++) { const t = i / SR; if (i % 500 === 0) f = 700 + (r() + 1) * 900; ph += f / SR; d[i] = sq(ph) * 0.22 * env(t, 0.5); }
  });
  S.Disrupt = render(0.3, (d, n) => {
    const r = noiseGen(3); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (60 + 30 * Math.sin(t * 50)) / SR; d[i] = (saw(ph) * 0.6 + r() * 0.25) * 0.5 * env(t, 0.3); }
  });
  // loops (rendered as seamless cycles)
  S.Thrust = render(1.0, (d, n) => {
    const r = noiseGen(99);
    for (let i = 0; i < n; i++) d[i] = r();
    lowpass(d, () => 500); lowpass(d, () => 700);
    for (let i = 0; i < n; i++) d[i] *= 2.4;
  });
  S.Shield = render(1.0, (d, n) => {
    for (let i = 0; i < n; i++) { const t = i / SR; d[i] = (Math.sin(t * 6.283 * 110) * 0.5 + Math.sin(t * 6.283 * 220) * 0.25 + Math.sin(t * 6.283 * 330) * 0.15) * (0.7 + 0.3 * Math.sin(t * 6.283 * 6)) * 0.35; }
  });
  S.DisruptLoop = render(1.0, (d, n) => {
    const r = noiseGen(4); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += 60 / SR; d[i] = (saw(ph) * 0.4 + saw(ph * 1.5) * 0.2 + r() * 0.15) * (0.6 + 0.4 * Math.sin(t * 6.283 * 12)) * 0.5; }
  });
  return S;
}

// tiny procedural space-march loop for the optional music toggle
function buildMusic() {
  const bpm = 132, step = 60 / bpm / 2, bars = 8, n = Math.floor(bars * 8 * step * SR);
  const d = new Float32Array(n);
  const roots = [110, 110, 87.31, 98, 110, 110, 130.81, 123.47];
  const arp = [0, 7, 12, 7, 3, 7, 12, 15];
  for (let b = 0; b < bars; b++) for (let s = 0; s < 8; s++) {
    const t0 = (b * 8 + s) * step, s0 = Math.floor(t0 * SR), m = Math.floor(step * SR);
    const fb = roots[b] / 2, fa = roots[b] * 2 * Math.pow(2, arp[s] / 12);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < m && s0 + i < n; i++) {
      const t = i / SR; p1 += fb / SR; p2 += fa / SR;
      d[s0 + i] += saw(p1) * 0.22 * expEnv(t, 5) + sq(p2) * 0.07 * expEnv(t, 14);
    }
    if (s % 2 === 0) for (let i = 0; i < m && s0 + i < n; i++) { const t = i / SR; d[s0 + i] += Math.sin(t * 6.283 * (60 + 80 * expEnv(t, 30))) * 0.35 * expEnv(t, 18); }
  }
  for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i]);
  return d;
}

export class Audio {
  constructor() {
    this.ctx = null; this.buffers = null; this.sfxOn = true; this.musicOn = false;
    this.loops = new Map(); this.voices = new Map(); this.music = null;
    this.raw = buildSounds();
    this.unlocked = false;
  }
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.mus = this.ctx.createGain(); this.mus.gain.value = 0.35; this.mus.connect(this.master);
    this.buffers = {};
    for (const k in this.raw) {
      const b = this.ctx.createBuffer(1, this.raw[k].length, SR);
      b.getChannelData(0).set(this.raw[k]);
      this.buffers[k] = b;
    }
    return true;
  }
  // call from a user gesture (iOS needs this)
  unlock() {
    if (!this.ensure()) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.unlocked) {
      const b = this.ctx.createBuffer(1, 1, SR), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this.unlocked = true;
    }
    if (this.musicOn) this.startMusic();
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  ready() { return this.ctx && this.ctx.state === 'running'; }
  play(name) {
    if (!this.sfxOn || !this.ready()) return;
    const b = this.buffers[name]; if (!b) return;
    const list = (this.voices.get(name) || []).filter(v => !v.ended);
    if (list.length >= 4) { try { list[0].src.stop(); } catch (e) { /* */ } list.shift(); }
    const src = this.ctx.createBufferSource(); src.buffer = b; src.connect(this.sfx);
    const v = { src, ended: false }; src.onended = () => { v.ended = true; };
    src.start(); list.push(v); this.voices.set(name, list);
  }
  loop(id, name, on) {
    const cur = this.loops.get(id);
    if (!on) {
      if (cur) { try { cur.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); cur.src.stop(this.ctx.currentTime + 0.2); } catch (e) { /* */ } this.loops.delete(id); }
      return;
    }
    if (cur || !this.sfxOn || !this.ready()) return;
    const b = this.buffers[name === 'Disrupt' ? 'DisruptLoop' : name]; if (!b) return;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(g); g.connect(this.sfx); src.start();
    this.loops.set(id, { src, g });
  }
  stopAllLoops() { for (const id of [...this.loops.keys()]) this.loop(id, '', false); }
  setSfx(on) { this.sfxOn = on; if (!on) this.stopAllLoops(); }
  setMusic(on) {
    this.musicOn = on;
    if (on) this.startMusic(); else if (this.music) { try { this.music.stop(); } catch (e) { /* */ } this.music = null; }
  }
  startMusic() {
    if (this.music || !this.ready()) return;
    if (!this.musicBuf) { const d = buildMusic(); this.musicBuf = this.ctx.createBuffer(1, d.length, SR); this.musicBuf.getChannelData(0).set(d); }
    const s = this.ctx.createBufferSource(); s.buffer = this.musicBuf; s.loop = true; s.connect(this.mus); s.start(); this.music = s;
  }
}
