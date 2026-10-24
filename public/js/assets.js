// Loads the newly rendered sprite sheets (see tools/render_sprites.py),
// makes hue-shifted variants (players 2-4, rock colour cycles) with plain
// pixel maths (no ctx.filter, which Safari lacks) and builds 1-bit collision
// masks at the original 640x480 sprite resolution.
const BASE = 'assets/';

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('failed to load ' + src));
    im.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// rotate hue by deg degrees (RGB-space rotation matrix, like a hue-rotate filter)
export function hueShift(src, deg) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  if (!deg) return c;
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const m = [
    0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
    0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
    0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072];
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    const R = a[i], G = a[i + 1], B = a[i + 2];
    a[i] = m[0] * R + m[1] * G + m[2] * B;
    a[i + 1] = m[3] * R + m[4] * G + m[5] * B;
    a[i + 2] = m[6] * R + m[7] * G + m[8] * B;
  }
  g.putImageData(d, 0, 0);
  return c;
}

// solid-colour silhouette of a sheet (plyr_MaskOnly drawing)
export function silhouette(src, rgb) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

class Sheet {
  // frames laid out in a grid of fw x fh cells; ow x oh = original size in 640x480 pixels
  constructor(canvas, fw, fh, frames, cols, ow, oh) {
    Object.assign(this, { canvas, fw, fh, frames, cols, ow, oh });
    this.masks = new Array(frames);
    this.sil = new Map();
  }
  sx(f) { return (f % this.cols) * this.fw; }
  sy(f) { return Math.floor(f / this.cols) * this.fh; }
  silhouette(key, rgb) {
    let s = this.sil.get(key);
    if (!s) { s = new Sheet(silhouette(this.canvas, rgb), this.fw, this.fh, this.frames, this.cols, this.ow, this.oh); this.sil.set(key, s); }
    return s;
  }
  // 1-bit mask of a frame at the original resolution, rows of booleans in a Uint8Array
  mask(f) {
    let m = this.masks[f];
    if (m) return m;
    const c = makeCanvas(this.ow, this.oh);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.canvas, this.sx(f), this.sy(f), this.fw, this.fh, 0, 0, this.ow, this.oh);
    const d = g.getImageData(0, 0, this.ow, this.oh).data;
    const bits = new Uint8Array(this.ow * this.oh);
    const pix = []; // opaque pixel list for the explosion "pixel cloud"
    for (let i = 0; i < bits.length; i++) {
      if (d[i * 4 + 3] >= 128) {
        bits[i] = 1;
        pix.push([i % this.ow - (this.ow >> 1), Math.floor(i / this.ow) - (this.oh >> 1),
          d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
      }
    }
    m = { w: this.ow, h: this.oh, bits, pix };
    this.masks[f] = m;
    return m;
  }
}

export const PLAYER_HUES = [0, 60, 120, 180];

export async function loadAssets() {
  const meta = await (await fetch(BASE + 'sprites.json')).json();
  const S = meta.scale;
  const names = ['ship', 'shield', 'saucer', 'pest', 'explosion', 'thrust', 'torpedo', 'atorpedo'];
  const imgs = {};
  await Promise.all([
    ...names.map(n => loadImage(BASE + meta[n].file).then(i => { imgs[n] = i; })),
    ...meta.rocks.files.map((f, i) => loadImage(BASE + f).then(im => { imgs['rock' + i] = im; })),
    loadImage(BASE + 'backdrop.jpg').then(i => { imgs.backdrop = i; }),
  ]);
  const A = { scale: S, backdrop: imgs.backdrop, sheets: {}, rocks: [], shipSheets: [], shieldSheets: [] };
  for (const n of names) {
    const m = meta[n];
    A.sheets[n] = new Sheet(toCanvas(imgs[n]), m.fw, m.fh, m.frames, m.cols, m.orig[0], m.orig[1]);
  }
  // one ship / shield sheet per player, hue shifted 60 degrees per player
  for (let p = 0; p < 4; p++) {
    const sm = meta.ship, sh = meta.shield;
    A.shipSheets.push(p === 0 ? A.sheets.ship :
      new Sheet(hueShift(imgs.ship, PLAYER_HUES[p]), sm.fw, sm.fh, sm.frames, sm.cols, sm.orig[0], sm.orig[1]));
    A.shieldSheets.push(p === 0 ? A.sheets.shield :
      new Sheet(hueShift(imgs.shield, PLAYER_HUES[p]), sh.fw, sh.fh, 1, 1, sh.orig[0], sh.orig[1]));
  }
  // rocks: strip of 3 sizes (64,32,16 original px). Levels 1-8 use rock1-8,
  // later 8-level cycles are hue shifted by 60 degrees (built lazily).
  A.rockImgs = meta.rocks.files.map((_, i) => imgs['rock' + i]);
  A.rockCache = new Map();
  A.getRock = (idx, cycle) => {
    const key = idx + ':' + (cycle % 6);
    let r = A.rockCache.get(key);
    if (!r) {
      const cv = hueShift(A.rockImgs[idx], (cycle % 6) * 60);
      let x = 0;
      r = meta.rocks.sizes.map(o => {
        const px = o * S;
        const c = makeCanvas(px, px);
        c.getContext('2d').drawImage(cv, x, 0, px, px, 0, 0, px, px);
        x += px;
        return new Sheet(c, px, px, 1, 1, o, o);
      });
      A.rockCache.set(key, r);
    }
    return r;
  };
  return A;
}
