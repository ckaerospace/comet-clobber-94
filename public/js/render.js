// Draws the simulation onto a 640x480 logical canvas (scaled to device pixels).
import { RES, RESY, ORGX, ORGY, UPP, SIZEX, SIZEY, M, irotate } from './sim.js';

const SERIF = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", "Noto Serif", Georgia, serif';
const SANS = 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans", "Noto Sans", sans-serif';

const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const clamp = v => Math.max(0, Math.min(255, v));

// three-layer "BigText" look: light rim up-left, dark shadow down-right, main colour between
export function bigText(ctx, text, x, y, size, color, font = SERIF, maxW = RES * 0.96) {
  let px = size * 0.86;
  ctx.font = `bold ${px}px ${font}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) { px *= maxW / w; ctx.font = `bold ${px}px ${font}`; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const hi = color.map(c => clamp(c * 1.5 + 64)), lo = color.map(c => c / 2);
  const d = Math.max(1, px / 40);
  ctx.fillStyle = rgb(hi); ctx.fillText(text, x - d, y - d);
  ctx.fillStyle = rgb(lo); ctx.fillText(text, x + d, y + d);
  ctx.fillStyle = rgb(color); ctx.fillText(text, x, y);
}

// 7 segment LED digits like the original scoreboards
const SEG = { a: [2, 1, 10, 3, 'h'], b: [11, 2, 3, 6, 'v'], c: [11, 9, 3, 6, 'v'], d: [2, 14, 10, 3, 'h'],
  e: [0, 9, 3, 6, 'v'], f: [0, 2, 3, 6, 'v'], g: [2, 7.5, 10, 3, 'h'] };
const DIG = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function segPath(ctx, s, ox, oy) {
  const [x, y, w, h, o] = s;
  ctx.beginPath();
  if (o === 'h') {
    ctx.moveTo(ox + x, oy + y + h / 2); ctx.lineTo(ox + x + 1.5, oy + y); ctx.lineTo(ox + x + w - 1.5, oy + y);
    ctx.lineTo(ox + x + w, oy + y + h / 2); ctx.lineTo(ox + x + w - 1.5, oy + y + h); ctx.lineTo(ox + x + 1.5, oy + y + h);
  } else {
    ctx.moveTo(ox + x + w / 2, oy + y); ctx.lineTo(ox + x + w, oy + y + 1.5); ctx.lineTo(ox + x + w, oy + y + h - 1.5);
    ctx.lineTo(ox + x + w / 2, oy + y + h); ctx.lineTo(ox + x, oy + y + h - 1.5); ctx.lineTo(ox + x, oy + y + 1.5);
  }
  ctx.closePath();
}
function drawLED(ctx, x, y, value, col) {
  const s = String(Math.max(0, Math.floor(value)) % 10000000).padStart(7, '0');
  const dim = col.map(c => c * 0.13), mid = col.map(c => c * 0.34);
  for (let i = 0; i < 7; i++) {
    const ox = x + (i + 1) * 16 + 1, oy = y;
    ctx.fillStyle = rgb(dim);
    ctx.fillRect(ox - 1, oy - 1, 16, 19);
    const on = DIG[+s[i]];
    for (const k in SEG) {
      segPath(ctx, SEG[k], ox, oy);
      if (on.includes(k)) { ctx.fillStyle = rgb(col); ctx.fill(); }
      else { ctx.strokeStyle = rgb(mid); ctx.lineWidth = 0.8; ctx.stroke(); }
    }
  }
}

function lerpWrap(a, b, t, span) {
  const d = b - a;
  if (Math.abs(d) > span / 2) return b;
  return a + d * t;
}
function lerpRot(a, b, t) {
  let d = ((b - a + 512) & 1023) - 512;
  return (a + d * t + 1024) & 1023;
}
const toScr = (x, y) => [(x - ORGX) / UPP, (y - ORGY) / UPP];

function drawFrame(ctx, sheet, f, x, y, k = 1, rot = null) {
  const w = sheet.ow * k, h = sheet.oh * k;
  if (w < 0.5 || h < 0.5) return;
  if (rot === null) {
    ctx.drawImage(sheet.canvas, sheet.sx(f), sheet.sy(f), sheet.fw, sheet.fh, x - w / 2, y - h / 2, w, h);
  } else {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(sheet.canvas, sheet.sx(f), sheet.sy(f), sheet.fw, sheet.fh, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

export class Renderer {
  constructor(A) { this.A = A; }

  draw(ctx, g, t, ui) {
    const A = this.A;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(A.backdrop, 0, 0, RES, RESY);
    const rocks = g.rockSheets();
    // objects in list order (same layering as the original)
    for (const o of g.objs) {
      if (o.hidden) continue;
      const x = lerpWrap(o.px, o.x, t, SIZEX), y = lerpWrap(o.py, o.y, t, SIZEY);
      const [sx, sy] = toScr(x, y);
      const rot = lerpRot(o.prot, o.rot, t);
      switch (o.kind) {
        case 'rock': drawFrame(ctx, rocks[o.rockSize], 0, sx, sy); break;
        case 'alien': drawFrame(ctx, A.sheets.saucer, o.rot >> 7, sx, sy); break;
        case 'pest': drawFrame(ctx, A.sheets.pest, o.frame, sx, sy); break;
        case 'torp':
          if (o.alienShape) drawFrame(ctx, A.sheets.atorpedo, 0, sx, sy);
          else drawFrame(ctx, A.sheets.torpedo, ((o.rot + 128) & 1023) >> 8, sx, sy);
          break;
        case 'expl': {
          const k = [1, 0.5, 0.25][Math.min(2, o.siz)];
          drawFrame(ctx, A.sheets.explosion, Math.min(4, o.frame), sx, sy, k);
          break;
        }
        case 'boom': this.drawBoom(ctx, o, sx, sy, t); break;
        case 'ship': this.drawShip(ctx, g, o, sx, sy, rot); break;
      }
    }
    this.drawHUD(ctx, g, ui);
  }

  drawBoom(ctx, o, sx, sy, t) {
    const size = o.size - 40 + 40 * t;
    const fr = o.frame;
    const k = size / 256;
    for (const p of o.pix) {
      const r = clamp(p[2] * fr / 256 + (fr >> 6)), gg = clamp(p[3] * fr / 256 + (fr >> 6)), b = clamp(p[4] * fr / 256 + (fr >> 6));
      if (r + gg + b < 6) continue;
      ctx.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      ctx.fillRect(sx + p[0] * k - 0.6, sy + p[1] * k - 0.6, 1.25, 1.25);
    }
  }

  drawShip(ctx, g, s, sx, sy, rot) {
    const A = this.A, n = s.stat.num;
    const k = Math.max(0, s.size) / 256;
    const f = ((Math.round(rot) + 8) & 1023) >> 4;
    const black = s.color[0] === 0 && s.color[1] === 0 && s.color[2] === 0;
    if (Math.abs(s.cloaked) >= 8 && black) {
      // fully cloaked (multiplayer): only a faint 1-pixel shimmer of the background
      const m = ctx.getTransform();
      const w = 45 * m.a, h = 45 * m.d;
      const dx = m.a * (sx - 22) + m.e, dy = m.d * (sy - 22) + m.f;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      try { ctx.drawImage(ctx.canvas, dx + m.a, dy + m.d, w, h, dx, dy, w, h); } catch (e) { /* ignore */ }
      ctx.restore();
      return;
    }
    const shipSheet = A.shipSheets[n], shieldSheet = A.shieldSheets[n];
    if (s.maskOnly) {
      const key = s.color.join(',');
      if (s.shieldsOn) drawFrame(ctx, shieldSheet.silhouette(key, s.color), 0, sx, sy, k);
      else drawFrame(ctx, shipSheet.silhouette(key, s.color), f, sx, sy, k);
    } else {
      drawFrame(ctx, shipSheet, f, sx, sy, k);
      if (s.shieldsOn) drawFrame(ctx, shieldSheet, 0, sx, sy, k);
    }
    if (s.thrust && !s.maskOnly && s.hyperSpace === 0) {
      const [ox, oy] = irotate(0, -36, Math.round(rot));
      ctx.globalCompositeOperation = 'lighter';
      drawFrame(ctx, A.sheets.thrust, g.gameFrame & 1, sx + ox, sy + oy, k, (rot + 512) * Math.PI / 512);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (s.hyperSpace === 0 && s.materializing > 0 && s.materializing < 30) {
      const radius = 20 * k;
      if (!s.dust) s.dust = new Array(32).fill(null);
      const count = Math.floor(s.materializing * 31 / 30);
      ctx.fillStyle = rgb(s.stat.color);
      for (let i = 0; i <= count; i++) {
        if (!s.dust[i] || Math.random() < 1 / 8) {
          let x, y;
          do { x = Math.random() * radius * 2 - radius; y = Math.random() * radius * 2 - radius; } while (x * x + y * y > radius * radius);
          s.dust[i] = [x, y];
        }
        ctx.fillRect(sx + s.dust[i][0] - 0.5, sy + s.dust[i][1] - 0.5, 1.2, 1.2);
      }
    }
  }

  drawHUD(ctx, g, ui) {
    const A = this.A;
    for (const st of g.stats) {
      drawLED(ctx, st.boardX, st.boardY, st.score, st.color);
      const sil = A.shipSheets[st.num].silhouette(st.color.join(','), st.color);
      const shown = Math.min(st.lives, 12);
      for (let i = 0; i < shown; i++) {
        let k = 0.5;
        const anim = st.lifeAnim.find(a => a.idx === i && a.type === 'add');
        if (anim) k = 0.5 * Math.min(1, anim.t / 8) * (1 + 0.5 * Math.sin(anim.t));
        drawFrame(ctx, sil, 0, st.boardX + i * 20 + 8 + 16, st.boardY + 24 + 11, k);
      }
      for (const a of st.lifeAnim) {
        if (a.type !== 'kill' || a.idx >= 12) continue;
        const k = 0.5 * Math.max(0, 1 - a.t / 10);
        drawFrame(ctx, sil, (a.t * 6) & 63, st.boardX + a.idx * 20 + 8 + 16, st.boardY + 24 + 11, k);
      }
    }
    for (const tx of g.texts) {
      const isTitle = tx.t === 'COMET CLOBBER!';
      if (isTitle) bigText(ctx, tx.t, RES / 2, tx.y, tx.size, tx.color, SANS, RES * 0.62);
      else if (tx.y === RESY * 5 / 6 && g.mode === M.Attract2) bigText(ctx, tx.t, RES / 2, tx.y, tx.size, tx.color, SANS);
      else if (tx.y === RESY * 5 / 8 && g.mode === M.Attract2) this.drawLogo(ctx, tx);
      else bigText(ctx, tx.t, RES / 2, tx.y, tx.size, tx.color);
    }
    if (g.mode === M.HiScores && g.hiList) {
      const left = 160, right = 480, top = 60, cs = 30, ls = 36;
      g.hiList.forEach((e, i) => {
        const y = top + cs / 2 + i * ls;
        bigText(ctx, `${i + 1}.`, left, y, cs, [0, 160, 0]);
        bigText(ctx, e.initials, left + cs * 2, y, cs, [160, 160, 160]);
        bigText(ctx, e.score.toLocaleString('en-US'), (left + right * 3) / 4, y, cs, [0, 160, 0]);
      });
    }
    if (g.paused && g.mode !== M.LogHi) {
      bigText(ctx, 'PAUSED', RES / 2, RESY * 0.42, RESY / 8, [160, 160, 160]);
      bigText(ctx, ui && ui.touch ? 'tap to continue' : 'press P to continue', RES / 2, RESY * 0.55, RESY / 24, [128, 0, 192], SANS);
    }
  }

  // stand-in for the publisher logo on the title screen: an original mark
  drawLogo(ctx, tx) {
    const y = tx.y;
    ctx.save();
    ctx.translate(RES / 2 - 150, y);
    ctx.fillStyle = '#1428ff';
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(28, -18); ctx.lineTo(18, 18); ctx.lineTo(-10, 18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.moveTo(8, -18); ctx.lineTo(14, -18); ctx.lineTo(4, 18); ctx.lineTo(-2, 18); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `italic bold 38px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('WEB', RES / 2 - 108, y + 1);
    const w = ctx.measureText('WEB').width;
    ctx.font = `bold 26px ${SANS}`;
    ctx.fillStyle = '#c8c8c8';
    ctx.fillText('remake \u201926', RES / 2 - 104 + w, y + 4);
  }
}
