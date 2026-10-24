// Game simulation: a fresh JavaScript re-implementation of the rules of
// a 1994 Windows game.  The behaviour was studied from the
// original Pascal source; see docs/mechanics.md for the cited rules.
// Coordinates: world units, x in [-30000,30000), y in [-22500,22500),
// 93.75 units per 640x480 screen pixel, y grows downwards.

export const RES = 640, RESY = 480;
export const ORGX = -30000, ORGY = -22500, SIZEX = 60000, SIZEY = 45000;
export const UPP = SIZEX / RES;               // world units per pixel
export const TICK_MS = 42;

// game modes (same numbering as the original)
export const M = {
  Stop: 0, Attract: 1, Attract2: 2, HiScores: 3, HiScores2: 4, TourWin: 9,
  NewLevel: 10, Play: 11, GameOver: 12, GameOver2: 13, LogHi: 14, LogHi2: 15,
};
const PLAYING = new Set([M.TourWin, M.NewLevel, M.Play]);

const SafeRadius = 4687, VelocRadius = 6, AlienSpeed = 156, RocksPerLevel = 214;
const RockMass = 80, ShipMass = 20, TorpedoMass = 10, BoomMass = 2, PestMass = 10;
const MinPests = 4, MaxPests = 8;
const BulletLast = 20, TimeToReturn = 50, HyperRechargeTime = 150, MaterializeTime = 30;
const MaxBulletsOut = 4, NumLives = 5;
const HyperTime = 8, HyperSpeed = 32, HyperSoundPlay = 12, HyperDelay = 36, RotHit = 2;
const DefShieldStrength = 162, SpecLimit = 2048;
const ScoreAmts = [20, 50, 100, 150, 250, 1, 500, 5000, 1000];
const scor_Rocks = 0, scor_Pest = 3, scor_Alien = 4, scor_Bonuses = 6;
const NewShipScore = 10000;
const BeforeGameOverWait = 70;
export const BONUS = { CronieLover: 0, Marksman: 1, AlienFirst: 2 };
export const ABIL = { Hyper: 0, Shield: 1, Disrupt: 2, Cloak: 3 };
export const ABIL_NAMES = ['Hyperspace', 'Shields', 'Disruptor', 'Cloak'];

// colours as [r,g,b]
export const PLAYER_COLORS = [[0, 255, 255], [255, 0, 255], [0, 255, 0], [255, 255, 0]];
const START_POS_MULTI = [[-16000, -8000], [16000, 8000], [16000, -8000], [-16000, 8000]];

// 1024-step sine table scaled to +-32767 like the original ISin/ICos
const SIN = new Int32Array(1024), COS = new Int32Array(1024);
for (let i = 0; i < 1024; i++) {
  SIN[i] = Math.round(Math.sin(i * Math.PI / 512) * 32767);
  COS[i] = Math.round(Math.cos(i * Math.PI / 512) * 32767);
}
const trunc = Math.trunc;
const idiv = (a, b) => trunc(a / b);
const i16 = v => ((((v + 32768) % 65536) + 65536) % 65536) - 32768;   // Pascal integer()
const hiword = v => Math.floor(v / 65536);
const rnd = n => Math.floor(Math.random() * n);
const muldiv = (a, b, c) => Math.round(a * b / c);
export function irotate(x, y, rot) {
  const s = SIN[rot & 1023], c = COS[rot & 1023];
  return [trunc((x * c + y * s) / 65536), trunc((x * s - y * c) / 65536)];
}
const isqrt = v => Math.floor(Math.sqrt(Math.max(0, v)));

// ------------------------------------------------------------- objects ---
let NEXT_ID = 1;
class Obj {
  constructor(g, x, y) {
    this.g = g; this.id = NEXT_ID++;
    this.x = x | 0; this.y = y | 0; this.px = this.x; this.py = this.y;
    this.vx = 0; this.vy = 0; this.rot = 0; this.prot = 0; this.rotvel = 0;
    this.size = 256; this.mass = 0; this.frame = 0;
    this.wrapX = true; this.wrapY = true;
    this.invul = false; this.hidden = false; this.maskOnly = false; this.dead = false;
    this.color = [255, 255, 255];
  }
  move() {
    this.px = this.x; this.py = this.y; this.prot = this.rot;
    this.x += this.vx; this.y += this.vy;
    this.rot = (this.rot + this.rotvel) & 1023;
    if (this.wrapX) {
      while (this.x < ORGX) this.x += SIZEX;
      while (this.x >= ORGX + SIZEX) this.x -= SIZEX;
    }
    if (this.wrapY) {
      while (this.y < ORGY) this.y += SIZEY;
      while (this.y >= ORGY + SIZEY) this.y -= SIZEY;
    }
  }
  cue() {}
  done() {}
  kill() { this.dead = true; }
  chkCollide() { return !this.invul && !this.dead; }
  // collision mask for current costume: {mask, frame}
  maskInfo() { return null; }
  explode(siz) {
    const g = this.g;
    if (siz <= 2) {
      if (g.params.fragmentExplosions) {
        const mi = this.maskInfo();
        if (mi) {
          const b = new Boom(g, this.x, this.y, mi.mask, mi.w * mi.h);
          b.vx = this.vx; b.vy = this.vy;
          g.add(b);
        }
      }
    } else siz--;
    g.add(new Explosion(g, this.x, this.y, siz));
  }
  // screen rect in 640x480 pixels
  scr() { return [Math.floor((this.x - ORGX) / UPP), Math.floor((this.y - ORGY) / UPP)]; }
  collide(p) {
    if (!this.chkCollide() || !p.chkCollide()) return false;
    if (((Math.abs(i16(this.x - p.x)) + Math.abs(i16(this.y - p.y))) & 0xFFFF) > 0x2000) return false;
    const a = this.maskInfo(), b = p.maskInfo();
    if (!a || !b) return false;
    const [ax, ay] = this.scr(), [bx, by] = p.scr();
    const al = ax - (a.w >> 1), at = ay - (a.h >> 1), bl = bx - (b.w >> 1), bt = by - (b.h >> 1);
    const l = Math.max(al, bl), r = Math.min(al + a.w, bl + b.w);
    const t = Math.max(at, bt), bo = Math.min(at + a.h, bt + b.h);
    if (l >= r || t >= bo) return false;
    const am = a.mask.bits, bm = b.mask.bits;
    for (let y = t; y < bo; y++) {
      const ra = (y - at) * a.w - al, rb = (y - bt) * b.w - bl;
      for (let x = l; x < r; x++) if (am[ra + x] && bm[rb + x]) return true;
    }
    return false;
  }
}

class Explosion extends Obj {
  constructor(g, x, y, siz) {
    super(g, x, y);
    this.kind = 'expl'; this.siz = siz; this.invul = true; this.wrapX = this.wrapY = false;
  }
  move() { super.move(); this.frame++; if (this.frame === 4) this.kill(); }
}

// fragment "pixel cloud": a few pixels of the dying sprite that fly apart and glow out
class Boom extends Obj {
  constructor(g, x, y, mask, area) {
    super(g, x, y);
    this.kind = 'boom'; this.invul = true; this.mass = BoomMass; this.wrapX = this.wrapY = false;
    const n = Math.max(1, Math.floor(isqrt(area) / 2));
    this.pix = [];
    const src = mask.pix;
    for (let i = 0; i < n && src.length; i++) this.pix.push(src[rnd(src.length)]);
  }
  move() {
    super.move();
    this.frame = (1024 - this.size) * 2;
    this.size += 40;
    if (this.size > 1024) this.kill();
  }
}

class Torpedo extends Obj {
  constructor(g, x, y, alienShape) {
    super(g, x, y);
    this.kind = 'torp'; this.alienShape = alienShape;
    this.mass = TorpedoMass; this.timeLeft = BulletLast; this.deflects = false; this.owner = null;
  }
  maskInfo() {
    const s = this.alienShape ? this.g.A.sheets.atorpedo : this.g.A.sheets.torpedo;
    const f = this.alienShape ? 0 : ((this.rot + 128) & 1023) >> 8;
    return { mask: s.mask(f), w: s.ow, h: s.oh };
  }
  done() { if (this.owner) this.owner.removeBullet(this); }
  cue() {
    if (this.timeLeft > 0) this.timeLeft--;
    else {
      if (this.owner && this.owner.kind === 'ship') this.g.activeBonuses.delete(BONUS.Marksman);
      this.kill();
    }
  }
}

class Craft extends Obj {
  constructor(g, x, y) { super(g, x, y); this.bullets = []; }
  addBullet(b) { if (this.bullets.length < MaxBulletsOut) { this.bullets.push(b); b.owner = this; } }
  removeBullet(b) { const i = this.bullets.indexOf(b); if (i >= 0) this.bullets.splice(i, 1); }
  done() { for (const b of this.bullets) b.owner = null; this.bullets = []; }
  kill() { if (this.dead) return; this.dead = true; this.explode(0); }
  addScore() {}
}

class Rock extends Obj {
  constructor(g, x, y, size) {
    super(g, x, y);
    this.kind = 'rock'; this.rockSize = size; this.mass = RockMass >> size;
  }
  maskInfo() {
    const s = this.g.rockSheets()[this.rockSize];
    return { mask: s.mask(0), w: s.ow, h: s.oh };
  }
  kill() {
    if (this.dead) return;
    const g = this.g;
    this.explode(this.rockSize);
    if (this.rockSize < 2) {
      for (let k = 0; k < 2; k++) {
        const dir = rnd(1024);
        const [nvx, nvy] = irotate(rnd(g.maxRockVel * 2) + (g.maxRockVel >> 1), 0, dir);
        const [nx, ny] = irotate((idiv(30000 * 64, RES)) >> this.rockSize, 0, dir);
        const r = new Rock(g, this.x + nx, this.y + ny, this.rockSize + 1);
        r.vx = this.vx + nvx; r.vy = this.vy + nvy;
        g.add(r);
      }
      if (rnd(Math.max(1, g.numHatchRocks)) < g.hatchesLeft) {
        g.sound('CroniesOut');
        const size = idiv(30000 * 45, RES) >> this.rockSize;
        const n = rnd(MaxPests - MinPests) + MinPests;
        for (let i = 0; i < n; i++)
          g.add(new Pest(g, this.x + rnd(size) - (size >> 1), this.y + rnd(size) - (size >> 1)));
        g.hatchesLeft--;
      }
      g.numHatchRocks--;
    }
    g.numRocksLeft--;
    this.dead = true;
  }
  cue() {
    const g = this.g;
    for (const p of g.objs) {
      if (p.kind === 'torp' && this.collide(p)) {
        if (!g.tournament || g.params.tournamentRocks === 2) {
          g.sound(['ExplodeLo', 'Explode', 'ExplodeHi'][this.rockSize]);
          this.kill();
          if (!g.tournament && p.owner) p.owner.addScore(scor_Rocks + this.rockSize);
          p.kill();
        } else {
          g.sound('RockBounce');
          p.explode(2); p.kill();
          this.vx += muldiv(p.vx - this.vx, Math.abs(p.mass), Math.abs(this.mass));
          this.vy += muldiv(p.vy - this.vy, Math.abs(p.mass), Math.abs(this.mass));
        }
        if (this.dead) return;
      }
    }
  }
}

class Alien extends Craft {
  constructor(g, x, y) { super(g, x, y); this.kind = 'alien'; this.wrapX = false; }
  maskInfo() {
    const s = this.g.A.sheets.saucer;
    return { mask: s.mask(this.rot >> 7), w: s.ow, h: s.oh };
  }
  shoot() {
    const g = this.g;
    const b = new Torpedo(g, this.x, this.y, true);
    b.rotvel = 256;
    const [x, y] = irotate(0, AlienSpeed * 14, rnd(1024));
    b.vx = this.vx + x; b.vy = this.vy + y;
    g.add(b); this.addBullet(b);
    g.sound('AlienShoot');
  }
  cue() {
    const g = this.g;
    for (const p of g.objs) {
      if (p.kind === 'torp' && p.owner !== this && this.collide(p)) {
        if (p.owner) p.owner.addScore(scor_Alien);
        g.sound('Explode'); g.sound('ExplodeLo');
        this.kill(); p.kill();
        return;
      }
    }
    if (this.x < ORGX || this.x > ORGX + SIZEX) { this.dead = true; return; }
    if (this.bullets.length === 0) this.shoot();
    const D = g.params.difficulty;
    if (g.nextAlien % (42 - D * 8) === 0) {
      if (this.vy !== 0) this.vy = 0;
      else { this.vy = 250 + D * 128; if (rnd(2) === 0) this.vy = -this.vy; }
    }
  }
}

class Pest extends Obj {
  constructor(g, x, y) {
    super(g, x, y);
    this.kind = 'pest'; this.mass = PestMass;
    this.frame = rnd(32 - 2) + 1; this.incFrame = !!rnd(2);
  }
  maskInfo() { const s = this.g.A.sheets.pest; return { mask: s.mask(this.frame), w: s.ow, h: s.oh }; }
  kill() { if (this.dead) return; this.explode(2); this.dead = true; }
  move() {
    super.move();
    if (this.incFrame) { this.frame++; if (this.frame >= 31) this.incFrame = false; }
    else { this.frame--; if (this.frame <= 0) this.incFrame = true; }
  }
  cue() {
    const g = this.g;
    let bestDist = 0, priority = 0, bxx = 0, byy = 0;
    const attractDist = 20, attractAmt = idiv(20000000, RES);
    for (const it of g.objs) {
      if ((it.kind === 'ship' || it.kind === 'alien') && !it.hidden) {
        if (it.kind !== 'ship' || it.cloaked === 0) {
          const xx = i16(it.x - this.x), yy = i16(it.y - this.y);
          const dist = (isqrt(idiv(xx, 2) ** 2 + idiv(yy, 2) ** 2) >> 4) + 8;
          if (priority === 0 || dist < bestDist) { bestDist = dist; bxx = xx; byy = yy; priority = 1; }
        }
      } else if ((it.kind === 'pest' && it !== this) || it.kind === 'rock') {
        const xx = i16(it.x - this.x), yy = i16(it.y - this.y);
        let dist = idiv(idiv(xx, 2) ** 2 + idiv(yy, 2) ** 2, attractAmt) + 4;
        if (it.kind === 'rock') dist = dist >> (2 - it.rockSize);
        if (dist <= attractDist) {
          if (bestDist === 0 || dist < bestDist) { bestDist = dist; bxx = -xx; byy = -yy; priority = 1; }
        } else if (it.kind !== 'rock' && priority === 0 && dist > bestDist) {
          bestDist = dist; bxx = xx; byy = yy;
        }
      } else if (it.kind === 'torp' && this.collide(it)) {
        if (it.owner) it.owner.addScore(scor_Pest);
        g.sound('Pop');
        this.kill(); it.kill();
      }
    }
    if (bestDist > 0) {
      let vx, vy;
      if (priority > 0) { vx = idiv(bxx, bestDist); vy = idiv(byy, bestDist); }
      else {
        const q = Math.max(1, isqrt(bestDist - attractDist));
        vx = idiv(idiv(bxx, q), 8); vy = idiv(idiv(byy, q), 8);
      }
      this.vx += vx; this.vy += vy;
    }
    this.vx = muldiv(this.vx, 15, 16); this.vy = muldiv(this.vy, 15, 16);
  }
}

export class Ship extends Craft {
  constructor(g, stat, x, y) {
    super(g, x, y);
    this.kind = 'ship'; this.stat = stat; this.mass = ShipMass;
    const sp = stat.specs;
    this.rotSpeed = 16 + idiv(sp.rot, SpecLimit / 16);
    this.thrustSpeed = muldiv(sp.thrust + idiv(SpecLimit, 6), idiv(170000, SpecLimit), RES);
    this.velocAtten = idiv((idiv(SpecLimit, 5) + sp.speed) ** 2 * 8, RES);
    this.abilityStrength = sp.ability * idiv(24576, SpecLimit);
    this.bulletSpeed = muldiv(sp.bullet + SpecLimit / 2, idiv(1200000, SpecLimit), RES);
    this.maxShield = muldiv(DefShieldStrength, this.abilityStrength, 24576);
    this.shieldStrength = this.maxShield;
    this.rotate = 0; this.thrust = false; this.fire = false;
    this.shieldsOn = false; this.disruptor = false; this.cloaked = 0; this.cloakTime = 0;
    this.hyperSpace = 0; this.hyperCharge = 0;
    this.materializing = MaterializeTime; this.hidden = true;
    this.thrustLoop = this.shieldLoop = this.disruptLoop = false;
  }
  get specialType() { return this.stat.special; }
  maskInfo() {
    const A = this.g.A;
    if (this.shieldsOn) { const s = A.sheets.shield; return { mask: s.mask(0), w: s.ow, h: s.oh }; }
    const s = A.sheets.ship;
    return { mask: s.mask(((this.rot + 8) & 1023) >> 4), w: s.ow, h: s.oh };
  }
  addScore(n) { this.stat.addScore(n); }
  bounce(p) {
    this.vx += muldiv(p.vx - this.vx, Math.abs(p.mass), Math.abs(this.mass));
    this.vy += muldiv(p.vy - this.vy, Math.abs(p.mass), Math.abs(this.mass));
    this.rotate += rnd(RotHit * 2 + 1) - RotHit;
  }
  move() {
    super.move();
    const g = this.g;
    if (this.hyperSpace > 0) {
      if (this.hyperSpace === HyperTime + HyperSoundPlay) g.sound('HyperSpace');
      this.hyperSpace++;
      if (this.hyperSpace <= HyperTime) {
        this.invul = true; this.maskOnly = true;
        this.size -= HyperSpeed;
        if (this.hyperSpace === HyperTime) this.hidden = true;
      }
      if (this.hyperSpace > HyperTime + HyperDelay) {
        this.hidden = false;
        if (this.hyperSpace === HyperTime * 2 + HyperDelay) {
          this.hyperSpace = 0; this.invul = false; this.maskOnly = false;
        } else this.size += HyperSpeed;
      } else if (this.hyperSpace === HyperTime ||
        (this.hyperSpace > HyperTime && this.hyperSpace < HyperTime + muldiv(this.abilityStrength, HyperDelay, 24576) &&
          !g.safeHaven(this.x, this.y, this))) {
        const sx = SIZEX / 8, sy = SIZEY / 8;
        this.x = rnd(sx * 6) + ORGX + sx; this.y = rnd(sy * 6) + ORGY + sy;
        this.px = this.x; this.py = this.y;
        this.vx = 0; this.vy = 0;
      }
    }
  }
  setAbility(state, type = this.specialType) {
    const g = this.g;
    switch (type) {
      case ABIL.Hyper:
        if (state && this.hyperSpace === 0) {
          if (this.hyperCharge > 0) g.sound('RockBounce');
          else { this.hyperSpace = 1; this.hyperCharge = HyperRechargeTime; }
        }
        break;
      case ABIL.Shield:
        if (state !== this.shieldsOn) {
          if (state) {
            if (!this.invul && this.shieldStrength > 0) {
              this.shieldsOn = true; this.mass = -ShipMass; this.thrust = false;
            }
          } else {
            this.invul = false; this.maskOnly = false; this.mass = ShipMass; this.shieldsOn = false;
          }
        }
        break;
      case ABIL.Disrupt:
        if (state !== this.disruptor) {
          if (state) { this.disruptor = true; this.color = this.stat.color.slice(); this.maskOnly = true; }
          else { this.disruptor = false; this.color = [255, 255, 255]; this.maskOnly = false; }
        }
        break;
      case ABIL.Cloak:
        if (state !== (this.cloaked !== 0)) {
          if (state) { this.cloaked = 1; this.cloakTime = idiv(this.abilityStrength, 50); }
          else this.cloaked = -5;
        }
        break;
    }
  }
  allAbilitiesOff() {
    if (this.g.params.allSpecials) for (let t = 0; t < 4; t++) this.setAbility(false, t);
    else this.setAbility(false);
  }
  // key event from a controller: ctl in left,right,thrust,fire,special; type = special type
  message(down, ctl, type) {
    if (down) {
      if (!(this.hyperSpace === 0 || this.hyperSpace > HyperTime + HyperDelay)) return;
      switch (ctl) {
        case 'left': this.rotate = -1; break;
        case 'right': this.rotate = 1; break;
        case 'thrust': if (!this.shieldsOn) this.thrust = true; break;
        case 'fire':
          if (!this.shieldsOn) {
            if (this.cloaked > 0) this.setAbility(false, ABIL.Cloak);
            this.fire = true;
          }
          break;
        case 'special':
          if (type === ABIL.Cloak) this.setAbility(this.cloaked === 0, type);
          else this.setAbility(true, type);
          break;
      }
    } else {
      switch (ctl) {
        case 'left': case 'right': this.rotate = 0; break;
        case 'thrust': this.thrust = false; break;
        case 'fire': if (this.g.cheats.has('AUTOFIRE')) this.fire = false; break;
        case 'special': if (type !== ABIL.Cloak) this.setAbility(false, type); break;
      }
    }
  }
  cue() {
    const g = this.g;
    this.rotvel = this.rotate * this.rotSpeed;
    if (this.thrust) {
      this.vx += hiword(SIN[this.rot] * this.thrustSpeed);
      this.vy += -hiword(COS[this.rot] * this.thrustSpeed);
    }
    let spd = idiv(isqrt(this.vx * this.vx + this.vy * this.vy), 2);
    if (this.disruptor) spd *= 16;
    if (spd > 0) {
      this.vx = idiv(this.vx * this.velocAtten, spd + this.velocAtten);
      this.vy = idiv(this.vy * this.velocAtten, spd + this.velocAtten);
    }
    if (this.shieldsOn) {
      this.shieldStrength--;
      if (this.shieldStrength < 20) this.maskOnly = !this.maskOnly;
      else this.maskOnly = false;
      if (this.shieldStrength <= 0) this.setAbility(false, ABIL.Shield);
    } else if (this.shieldStrength < this.maxShield && g.gameFrame % 32 === 0) this.shieldStrength++;

    if (this.disruptor) {
      for (const it of g.objs) {
        if (it !== this && it.mass !== 0) {
          let xx = i16(it.x - this.x), yy = i16(it.y - this.y);
          const dist = hiword(idiv(xx, 2) ** 2 + idiv(yy, 2) ** 2) + 1;
          xx = idiv(i16(hiword(xx * this.abilityStrength)), dist);
          yy = idiv(i16(hiword(yy * this.abilityStrength)), dist);
          it.vx += muldiv(xx, this.mass, it.mass);
          it.vy += muldiv(yy, this.mass, it.mass);
        }
      }
      this.color = this.color.map(c => c ^ 255);
    }
    if (this.hyperCharge > 0) this.hyperCharge--;

    if (this.cloaked !== 0) {
      if (g.numPlayers === 1) {
        this.cloaked++;
        this.color = [255, 255, 255];
        this.maskOnly = (this.cloaked & 2) !== 0;
      } else {
        const a = Math.abs(this.cloaked);
        if (a < 8) {
          const sh = (a >> 1) - 1;
          const i = sh < 0 ? 0 : 255 >> sh;
          this.color = [i, i, i];
        } else this.color = [0, 0, 0];
        this.cloaked++;
        if (this.cloaked > 0) this.maskOnly = true;
        else if (this.cloaked === 0) { this.maskOnly = false; this.color = [255, 255, 255]; }
      }
      this.cloakTime--;
      if (this.cloakTime === 0) this.setAbility(false, ABIL.Cloak);
    }

    if (this.fire && this.bullets.length < MaxBulletsOut) {
      const [ox, oy] = irotate(0, Math.round((this.size * 36 / 256) * UPP), this.rot);
      const b = new Torpedo(g, ox + this.x, oy + this.y, g.params.bulletsKillPlayers);
      b.rotvel = 256;
      if (!g.params.bulletsKillPlayers) b.deflects = true;
      const [vx, vy] = irotate(0, this.bulletSpeed, this.rot);
      b.vx = vx + idiv(this.vx, 2); b.vy = vy + idiv(this.vy, 2);
      g.add(b); this.addBullet(b);
      g.sound('Shoot');
    }
    if (!g.cheats.has('AUTOFIRE')) this.fire = false;

    let okToEnter = true;
    for (const p of g.objs) {
      if (p === this || this.dead) continue;
      if ((p.kind !== 'torp' || p.owner !== this) && this.collide(p)) {
        if (this.materializing > 0) okToEnter = false;
        else {
          const isPlayerTorp = p.kind === 'torp' && p.deflects;
          if (this.shieldsOn || isPlayerTorp) {
            p.kill();
            const r2 = this.rotate;
            this.bounce(p);
            if (this.shieldsOn && isPlayerTorp) this.rotate = r2;
            if (this.cloaked > 0) this.cloaked = 4;
            if (p.kind === 'torp') p.explode(3);
            if (this.shieldsOn) {
              g.sound('ShieldBounce');
              this.maskOnly = true;
              this.shieldStrength = idiv(this.shieldStrength * (100 - p.mass), 100);
            } else g.sound('Bounce');
          } else {
            g.sound('PlayerBlowUp');
            this.kill(); p.kill();
          }
        }
      }
    }
    if (this.materializing === MaterializeTime) {
      if (okToEnter) {
        this.hyperSpace = HyperTime + HyperDelay;
        this.size = HyperSpeed;
        this.materializing--;
        this.invul = true; this.maskOnly = true;
      }
    } else if (this.materializing > 0) {
      this.materializing--;
      if (this.materializing === 0) this.invul = false;
    }
    if (g.cheats.has('PHASEOUT')) this.invul = true;
    // looping sounds
    g.loop('Thrust' + this.stat.num, 'Thrust', this.thrust && !this.dead);
    g.loop('Shield' + this.stat.num, 'Shield', this.shieldsOn && !this.dead);
    g.loop('Disrupt' + this.stat.num, 'Disrupt', this.disruptor && !this.dead);
  }
  kill() {
    if (this.g.cheats.has('JUGGER')) return;
    if (!this.shieldsOn) {
      this.allAbilitiesOff();
      if (!this.dead) { this.dead = true; this.explode(0); }
    }
  }
  done() {
    super.done();
    this.stat.curShip = null;
    this.stat.returnTime = TimeToReturn;
    const g = this.g, n = this.stat.num;
    g.loop('Thrust' + n, 'Thrust', false); g.loop('Shield' + n, 'Shield', false); g.loop('Disrupt' + n, 'Disrupt', false);
  }
}

// ------------------------------------------------------------ players ---
class PlayerStat {
  constructor(g, num, pos, nplayers, cfg) {
    this.g = g; this.num = num; this.pos = pos;
    this.color = PLAYER_COLORS[num];
    this.special = cfg.special; this.specs = cfg.specs;
    this.newX = nplayers === 1 ? 0 : START_POS_MULTI[num][0];
    this.newY = nplayers === 1 ? 0 : START_POS_MULTI[num][1];
    this.boardX = (pos === 0 || pos === 3) ? 16 : RES - 140;
    this.boardY = (pos === 0 || pos === 2) ? 16 : RESY - 52;
    this.curShip = null; this.score = 0; this.lives = NumLives; this.returnTime = 0;
    this.lifeAnim = [];   // {type:'add'|'kill', t}
  }
  reset() {
    this.curShip = null; this.score = 0;
    this.lives = this.g.tournament ? this.g.params.tournamentLives : NumLives;
    this.returnTime = 0;
  }
  addScore(n) {
    const g = this.g;
    if (Math.floor(this.score / NewShipScore) < Math.floor((this.score + ScoreAmts[n]) / NewShipScore)) {
      g.sound('WonNewLife');
      this.lives++; this.lifeAnim.push({ type: 'add', t: 0, idx: this.lives - 1 });
    }
    this.score += ScoreAmts[n];
    if (n === scor_Pest) g.activeBonuses.delete(BONUS.CronieLover);
    else if (n === scor_Rocks + 2 && g.numRocksLeft === 0) {
      this.addBonus(BONUS.CronieLover); this.addBonus(BONUS.Marksman);
    } else if (n === scor_Alien) this.addBonus(BONUS.AlienFirst);
    g.activeBonuses.delete(BONUS.AlienFirst);
  }
  addBonus(b) {
    const g = this.g;
    if (g.activeBonuses.has(b)) {
      g.sound('Bonus');
      const amt = ScoreAmts[b + scor_Bonuses] * (g.level * g.params.difficulty);
      this.score += amt;
      g.activeBonuses.delete(b);
      g.events.push({ type: 'bonus', bonus: b, amount: amt, player: this.num });
    }
  }
  safeToAdd() {
    if (this.returnTime > 0) { this.returnTime--; return false; }
    return this.g.safeHaven(this.newX, this.newY, null);
  }
  addNewShip() {
    const g = this.g;
    if (this.curShip) return;
    const s = new Ship(g, this, this.newX, this.newY);
    this.curShip = s;
    g.input.resetPlayer(this.num);
    g.add(s);
    g.sound('NewShip');
    this.lives--; this.lifeAnim.push({ type: 'kill', t: 0, idx: this.lives });
  }
}

// ---------------------------------------------------------------- game ---
export class Game {
  constructor(A, audio, input, hiscores, params) {
    this.A = A; this.audio = audio; this.input = input; this.hiscores = hiscores;
    this.params = params;
    this.objs = []; this.newObjs = [];
    this.mode = M.Stop; this.waitTime = 0; this.level = 0; this.gameFrame = 0;
    this.numRocksLeft = 0; this.numHatchRocks = 0; this.hatchesLeft = 0; this.maxRockVel = 0;
    this.alienFreq = 400; this.nextAlien = 400;
    this.stats = []; this.numPlayers = 1; this.tournament = false;
    this.activeBonuses = new Set(); this.cheats = new Set(); this.cheatsWereOn = false;
    this.texts = []; this.events = []; this.loops = new Map();
    this.hiList = null; this.logPlayer = -1; this.loggedPlayers = new Set(); this.initials = '';
    this.paused = 0; this.ticks = 0;
    this.round = 0; this.tourWins = [];
  }
  sound(n) { this.audio && this.audio.play(n); }
  loop(id, n, on) {
    if (!!this.loops.get(id) === on) return;
    this.loops.set(id, on);
    this.audio && this.audio.loop(id, n, on);
  }
  stopLoops() { for (const id of this.loops.keys()) this.loop(id, '', false); }
  add(o) { this.newObjs.push(o); }
  rockSheets() {
    const L = Math.max(1, this.level);
    return this.A.getRock((L - 1) % 8, Math.floor((L - 1) / 8));
  }
  safeHaven(x, y, excl) {
    for (const p of this.objs) {
      if (p.chkCollide() && p !== excl) {
        const dist = (Math.abs(i16(x - p.x)) >> 1) + (Math.abs(i16(y - p.y)) >> 1);
        const veloc = Math.abs(p.vx) + Math.abs(p.vy);
        if (dist < SafeRadius + VelocRadius * veloc) return false;
      }
    }
    return true;
  }
  isPlaying() { return PLAYING.has(this.mode); }

  text(t, y, size, color) { this.texts.push({ t, y, size, color }); }

  setMode(mode) {
    this.mode = mode;
    this.texts = [];
    const H = RESY;
    switch (mode) {
      case M.Attract:
        this.setMode(M.Attract2); return;       // (registered copies skip the shareware banner)
      case M.Attract2:
        this.waitTime = 180;
        this.text('COMET CLOBBER!', H / 4, H / 6, [192, 160, 0]);
        this.text('A tribute to a 1994 classic', H / 2, H / 16, [128, 0, 0]);
        this.text('Not affiliated.', H * 3 / 4, H / 16, [128, 0, 0]);
        this.text('\u2014 browser remake \u2014', H * 5 / 8, H / 24, [96, 96, 128]);
        this.text(this.input.touchMode ? 'Tap the screen to start  \u2022  1-4 picks players' : 'Press Enter to start  \u2022  1-4 picks players',
          H * 5 / 6, H / 24, [128, 0, 192]);
        break;
      case M.HiScores:
        this.waitTime = 180;
        this.hiList = this.hiscores.list();
        this.text('IMMORTALS', H / 16, H / 16, [128, 0, 192]);
        break;
      case M.HiScores2:
        this.setMode(M.Attract); return;
      case M.NewLevel: {
        this.level++;
        this.waitTime = 70;
        if (this.tournament) {
          const best = Math.max(...this.stats.map(s => s.score));
          if (this.round >= this.params.tournamentRounds && this.stats.filter(s => s.score === best).length === 1) {
            this.level--; this.setMode(M.GameOver); return;
          }
          this.round++;
          this.objs = []; this.newObjs = [];
          for (const s of this.stats) { s.curShip = null; s.lives = this.params.tournamentLives; s.returnTime = 0; }
          this.text(this.round > this.params.tournamentRounds ? `TIEBREAKER #${this.round - this.params.tournamentRounds}`
            : `ROUND ${this.round} of ${this.params.tournamentRounds}`, H / 4, H / 8, [255, 32, 128]);
        } else this.text(`LEVEL ${this.level}`, H / 4, H / 8, [255, 32, 128]);
        this.alienFreq = 200 + idiv(1250, this.level + 3);
        this.nextAlien = this.alienFreq;
        break;
      }
      case M.Play:
        if (!this.tournament || this.params.tournamentRocks > 0) this.makeRocks();
        else this.numRocksLeft = 1;     // rock-free round: only a TourWin ends it
        this.activeBonuses = new Set([0, 1, 2]);
        if (this.hatchesLeft === 0) this.activeBonuses.delete(BONUS.CronieLover);
        break;
      case M.TourWin: {
        this.waitTime = 140;
        const alive = this.stats.filter(s => s.lives > 0 || s.curShip);
        if (alive.length === 1) { alive[0].score++; this.text(`PLAYER ${alive[0].num + 1} WINS`, H / 2, H / 8, [32, 255, 64]); }
        else this.text('DRAW', H / 2, H / 8, [32, 255, 64]);
        break;
      }
      case M.GameOver:
        this.waitTime = 140;
        this.stopLoops();
        this.text('GAME OVER', H / 2, H / 6, [32, 255, 64]);
        break;
      case M.GameOver2: {
        const next = this.stats.find(s => !this.loggedPlayers.has(s.num));
        if (next) {
          this.loggedPlayers.add(next.num);
          const rank = (this.cheatsWereOn || this.tournament) ? 0 : this.hiscores.rank(next.score);
          if (rank > 0) { this.logPlayer = next.num; this.logRank = rank; this.setMode(M.LogHi); return; }
          this.setMode(M.GameOver2); return;
        }
        this.setMode(M.HiScores); return;
      }
      case M.LogHi:
        this.initials = '';
        this.text(`Player ${this.logPlayer + 1}`, H * 2 / 3, H / 8, [64, 64, 160]);
        if (this.logRank === 1) {
          this.text('CONGRATULATIONS!', H / 8, H / 8, [64, 64, 160]);
          this.text('YOU GOT THE HIGH SCORE!', H / 4, H / 16, [128, 0, 192]);
        } else {
          this.text('You have earned a ranking', H / 4, H / 16, [128, 0, 192]);
          this.text('in the List of Immortals.', H / 3, H / 16, [128, 0, 192]);
        }
        this.text('Please enter your initials:', H * 4 / 5, H / 16, [255, 32, 128]);
        this.initialsText = { t: '_ _ _', y: H / 2, size: H / 6, color: [192, 192, 192] };
        this.texts.push(this.initialsText);
        this.events.push({ type: 'initials', player: this.logPlayer });
        break;
      case M.LogHi2:
        this.setMode(M.GameOver2); return;
    }
  }

  // letters typed during high score entry
  typeInitial(ch) {
    if (this.mode !== M.LogHi) return;
    if (ch === '\b') this.initials = this.initials.slice(0, -1);
    else if (/^[A-Z ]$/.test(ch) && this.initials.length < 3) this.initials += ch;
    const s = (this.initials + '___').slice(0, 3);
    this.initialsText.t = s.split('').join(' ');
    if (this.initials.length === 3) this.submitInitials(this.initials);
  }
  submitInitials(str) {
    if (this.mode !== M.LogHi) return;
    const st = this.stats[this.logPlayer];
    this.hiscores.insert((str + '   ').slice(0, 3).toUpperCase(), st.score);
    this.events.push({ type: 'initialsDone' });
    this.setMode(M.LogHi2);
  }

  makeRocks() {
    const D = this.params.difficulty, L = this.level;
    this.maxRockVel = idiv((L + D * 3) * 30000, RES);
    const n = ((L + 2 + D) * RocksPerLevel) >> 8;
    this.numHatchRocks = n * 3;
    this.numRocksLeft = n * 7;
    this.hatchesLeft = idiv(this.numHatchRocks, 25 - D * 6);
    if (this.tournament) this.hatchesLeft = 0;
    const mv = Math.max(1, this.maxRockVel);
    for (let i = 0; i < n; i++) {
      const r = new Rock(this, ORGX, ORGY, 0);
      r.vx = i16(rnd(mv * 2) - mv); r.vy = i16(rnd(mv * 2) - mv);
      if (rnd(2) === 0) {          // left or right edge (the original reuses the X range for Y)
        r.y = i16(rnd(SIZEX) + ORGX);
        if (r.vx < 0) r.x += SIZEX - 1;
      } else {                     // top or bottom edge
        r.x = i16(rnd(SIZEY) + ORGY);
        if (r.vy < 0) r.y += SIZEY - 1;
      }
      r.px = r.x; r.py = r.y;
      this.add(r);
    }
  }
  newAlien() {
    const side = rnd(2);
    const x = side === 0 ? ORGX : ORGX + SIZEX - 1;
    const a = new Alien(this, x, rnd(SIZEY >> 1) - (SIZEY >> 2));
    a.vx = (this.params.difficulty + 2) * AlienSpeed;
    if (side === 1) a.vx = -a.vx;
    a.rotvel = 128;
    this.add(a);
  }
  armageddon() {
    for (const p of this.objs) if (p.kind === 'rock' && !p.dead) p.kill();
  }

  newGame(players) {
    this.objs = []; this.newObjs = [];
    this.stopLoops();
    this.numPlayers = players;
    this.level = this.params.startingLevel || 0;
    this.tournament = !!this.params.tournament && players > 1;
    this.round = 0;
    this.gameFrame = 0;
    this.cheats = new Set(); this.cheatsWereOn = false;
    this.loggedPlayers = new Set();
    this.mode = M.Stop;
    this.stats = [];
    for (let i = 0; i < players; i++) {
      const st = new PlayerStat(this, i, i, players, this.params.players[i]);
      this.stats.push(st);
    }
    this.setMode(M.NewLevel);
    for (const st of this.stats) { st.reset(); st.addNewShip(); }
    this.commit();
  }
  stopGame() {
    this.objs = []; this.newObjs = [];
    this.stopLoops();
    this.numRocksLeft = 0;
    this.level = 0;
    this.setMode(M.Attract);
  }
  cheat(name) {
    if (!this.isPlaying()) return;
    this.sound('Disrupt');
    this.cheatsWereOn = true;
    if (name === 'NUKE') this.armageddon();
    else if (this.cheats.has(name)) this.cheats.delete(name); else this.cheats.add(name);
  }

  commit() {
    if (this.newObjs.length) { this.objs.push(...this.newObjs); this.newObjs = []; }
    let j = 0;
    for (const o of this.objs) { if (o.dead) o.done(); else this.objs[j++] = o; }
    this.objs.length = j;
  }

  tick() {
    this.ticks++;
    for (const o of this.objs) o.move();
    for (const s of this.stats) for (const a of s.lifeAnim) a.t++;
    for (const s of this.stats) s.lifeAnim = s.lifeAnim.filter(a => a.t < 12);
    this.input.feed(this);
    for (const o of this.objs) if (!o.dead) o.cue();
    this.update();
    this.commit();
  }

  update() {
    if (this.numRocksLeft <= 0) {
      if (this.mode === M.Play) this.setMode(M.NewLevel);
      else if (!this.isPlaying() && this.mode !== M.Stop) this.makeRocks();
    }
    if (this.waitTime > 0) {
      this.waitTime--;
      if (this.waitTime === 0) this.setMode(this.mode + 1);
    }
    this.gameFrame++;
    if (!this.tournament) {
      if (--this.nextAlien <= 0) { this.nextAlien = this.alienFreq; this.newAlien(); }
    }
    if (this.isPlaying()) {
      let shipsLeft = 0;
      for (const s of this.stats) {
        if (!s.curShip && s.lives > 0) {
          const c = this.input.held(s.num);
          if (s.safeToAdd() || (s.returnTime === 0 && c.fire && c.special)) s.addNewShip();
        }
        if (s.lives > 0 || s.curShip) shipsLeft++;
      }
      if (this.tournament) {
        if (shipsLeft <= 1 && this.mode === M.Play && this.waitTime === 0) this.setMode(M.TourWin);
      } else if (shipsLeft === 0 && this.waitTime === 0) {
        this.waitTime = BeforeGameOverWait;
        this.mode = M.Play;            // advances to GameOver when the wait expires
      }
    }
  }
}
