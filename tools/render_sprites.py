#!/usr/bin/env python3
"""Offline renderer for all Comet Clobber '94 art.

Everything here is generated from scratch: a tiny numpy signed-distance-field
ray tracer produces the shaded, "pre-rendered 3D" look of mid-90s shareware
sprites, and a few 2D procedural passes make the explosions, the nebula
backdrop and the app icons.  No original game files are read.

Usage:  python3 tools/render_sprites.py     (writes into public/assets/)
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
os.makedirs(OUT, exist_ok=True)
S = 3            # asset pixels per original 640x480 pixel
RNG = np.random.default_rng(1994)

# ----------------------------------------------------------------- noise ---
def _hash(ix, iy, iz, seed=0):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ \
        (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / float(0xFFFFFF)

def noise3(p, seed=0):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    ix, iy, iz = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    ux, uy, uz = fx*fx*(3-2*fx), fy*fy*(3-2*fy), fz*fz*(3-2*fz)
    ix, iy, iz = ix.astype(np.int64), iy.astype(np.int64), iz.astype(np.int64)
    def h(a, b, c): return _hash(ix+a, iy+b, iz+c, seed)
    l = lambda a, b, t: a + (b-a)*t
    return l(l(l(h(0,0,0), h(1,0,0), ux), l(h(0,1,0), h(1,1,0), ux), uy),
             l(l(h(0,0,1), h(1,0,1), ux), l(h(0,1,1), h(1,1,1), ux), uy), uz)

def fbm3(p, octaves=4, seed=0):
    a, s, tot = 0.5, 1.0, 0.0
    for o in range(octaves):
        tot = tot + a * noise3(p * s, seed + o)
        a *= 0.5; s *= 2.03
    return tot / (1 - 0.5 ** octaves)

def fbm2(x, y, octaves=5, seed=0):
    p = np.stack([x, y, np.full_like(x, 0.37 * seed)], -1)
    return fbm3(p, octaves, seed)

# ------------------------------------------------------------- sdf utils ---
def length(v): return np.sqrt(np.sum(v * v, axis=-1))
def norm(v): return v / np.maximum(length(v)[..., None], 1e-9)
def V(*a): return np.array(a, dtype=np.float64)

def rotz(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([c*p[..., 0] - s*p[..., 1], s*p[..., 0] + c*p[..., 1], p[..., 2]], -1)
def rotx(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([p[..., 0], c*p[..., 1] - s*p[..., 2], s*p[..., 1] + c*p[..., 2]], -1)
def roty(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([c*p[..., 0] + s*p[..., 2], p[..., 1], -s*p[..., 0] + c*p[..., 2]], -1)

def sd_sphere(p, c, r): return length(p - c) - r
def sd_box(p, c, b):
    q = np.abs(p - c) - b
    return length(np.maximum(q, 0)) + np.minimum(np.max(q, -1), 0)
def sd_ellipsoid(p, c, r):
    q = (p - c)
    k0 = length(q / r); k1 = length(q / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
def sd_capsule(p, a, b, r):
    pa, ba = p - a, b - a
    h = np.clip(np.sum(pa * ba, -1) / np.dot(ba, ba), 0, 1)
    return length(pa - ba * h[..., None]) - r
def sd_cone_y(p, y0, y1, r0, r1):
    """capped cone along +y from (y0, radius r0) to (y1, radius r1)"""
    h = (y1 - y0) / 2; cy = (y0 + y1) / 2
    qx = np.sqrt(p[..., 0] ** 2 + p[..., 2] ** 2); qy = p[..., 1] - cy
    k1x, k1y = r1, h; k2x, k2y = r1 - r0, 2 * h
    cax = qx - np.minimum(qx, np.where(qy < 0, r0, r1)); cay = np.abs(qy) - h
    t = np.clip(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1)
    cbx = qx - k1x + k2x * t; cby = qy - k1y + k2y * t
    s = np.where((cbx < 0) & (cay < 0), -1.0, 1.0)
    return s * np.sqrt(np.minimum(cax * cax + cay * cay, cbx * cbx + cby * cby))

def seg_box(p, a, b, half_w, half_d):
    """flat bar between 2D points a,b (in the xy plane), width 2*half_w, depth 2*half_d"""
    a = V(*a, 0); b = V(*b, 0)
    d = b - a; L = np.linalg.norm(d); u = d / L
    c = (a + b) / 2
    q = p - c
    lx = q[..., 0] * u[0] + q[..., 1] * u[1]
    ly = -q[..., 0] * u[1] + q[..., 1] * u[0]
    return sd_box(np.stack([lx, ly, q[..., 2]], -1), V(0, 0, 0), V(L / 2, half_w, half_d))

# ----------------------------------------------------------- ray tracer ---
LIGHT = norm(V(-0.55, 0.62, 0.56))      # upper-left, towards the viewer
HALF = norm(LIGHT + V(0, 0, 1))

def trace(scene, size, extent, tilt=0.0, ss=2, steps=110):
    """Orthographic render.  scene(p) -> (dist, mat).  extent = half-width
    of the view in model units.  Returns float RGBA image (size x size)."""
    n = size * ss
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(lin * extent, -lin * extent)
    ro = np.stack([X, Y, np.full_like(X, extent * 3)], -1).reshape(-1, 3)
    rd = np.tile(V(0, 0, -1), (ro.shape[0], 1))
    if tilt:
        ro = rotx(ro, tilt); rd = rotx(rd, tilt)
    t = np.zeros(ro.shape[0]); hit = np.zeros(ro.shape[0], bool)
    alive = np.ones(ro.shape[0], bool)
    eps = extent * 1e-3
    for _ in range(steps):
        idx = np.nonzero(alive)[0]
        if idx.size == 0: break
        p = ro[idx] + rd[idx] * t[idx, None]
        d, _m = scene(p)
        t[idx] += d * 0.8
        h = d < eps; hit[idx[h]] = True
        gone = h | (t[idx] > extent * 6)
        alive[idx[gone]] = False
    rgba = np.zeros((ro.shape[0], 4))
    idx = np.nonzero(hit)[0]
    if idx.size:
        p = ro[idx] + rd[idx] * t[idx, None]
        e = extent * 2e-3
        nrm = np.zeros_like(p)
        for k in range(3):
            o = np.zeros(3); o[k] = e
            nrm[:, k] = scene(p + o)[0] - scene(p - o)[0]
        nrm = norm(nrm)
        _, mat = scene(p)
        if tilt:  # shade in camera space so the light stays screen-fixed
            nv = rotx(nrm, -tilt)
        else:
            nv = nrm
        col = shade(p, nrm, nv, mat)
        rgba[idx, :3] = col; rgba[idx, 3] = 1
    rgba = rgba.reshape(n, n, 4)
    # box downsample, premultiplied
    rgba[..., :3] *= rgba[..., 3:4]
    rgba = rgba.reshape(size, ss, size, ss, 4).mean((1, 3))
    a = rgba[..., 3:4]
    rgba[..., :3] = np.where(a > 0, rgba[..., :3] / np.maximum(a, 1e-6), 0)
    return rgba

MATS = {}   # id -> function(p, n) -> (albedo[N,3], spec, shininess, emissive[N,3])
def material(i):
    def deco(f): MATS[i] = f; return f
    return deco

def shade(p, n, nv, mat):
    out = np.zeros((p.shape[0], 3))
    for m in np.unique(mat):
        sel = mat == m
        alb, spec, shin, emis = MATS[int(m)](p[sel], n[sel])
        nn = nv[sel]
        diff = np.clip(nn @ LIGHT, 0, 1)[:, None]
        fill = np.clip(nn @ norm(V(0.6, -0.3, 0.5)), 0, 1)[:, None] * 0.12
        sp = np.clip(nn @ HALF, 0, 1) ** shin
        c = alb * (0.16 + 0.95 * diff + fill) + (spec * sp)[:, None] + emis
        out[sel] = c
    return np.clip(out, 0, 1)

def const(rgb, spec=0.5, shin=30, emis=(0, 0, 0)):
    def f(p, n):
        N = p.shape[0]
        e = np.tile(V(*emis), (N, 1))
        return np.tile(V(*rgb), (N, 1)), np.full(N, spec), shin, e
    return f

def to_img(rgba):
    return Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')

def sheet(frames, cols):
    w, h = frames[0].size
    rows = (len(frames) + cols - 1) // cols
    im = Image.new('RGBA', (w * cols, h * rows))
    for i, f in enumerate(frames):
        im.paste(f, ((i % cols) * w, (i // cols) * h))
    return im

META = {'scale': S}
def save(name, img, fw, fh, n, cols, orig):
    img.save(os.path.join(OUT, name + '.png'), optimize=True)
    META[name] = {'file': name + '.png', 'fw': fw, 'fh': fh, 'frames': n, 'cols': cols, 'orig': orig}
    print('wrote', name, img.size)

def m_union(*items):
    d = items[0][0]; m = np.full(d.shape, items[0][1], np.int32)
    for dd, mm in items[1:]:
        s = dd < d; d = np.where(s, dd, d); m = np.where(s, mm, m)
    return d, m

# ================================================================ SHIP ====
material(1)(const((0.93, 0.93, 0.96), 0.9, 40))          # white hull
material(2)(const((0.45, 0.46, 0.50), 0.3, 20))          # base ring
material(3)(const((0.20, 0.66, 0.72), 0.5, 25))          # teal wing
material(4)(const((0.30, 0.74, 0.80), 0.5, 25))          # teal strut
material(5)(const((0.6, 0.05, 0.05), 0.6, 20, (0.6, 0.0, 0.0)))  # red tip lights

def ship_scene(p):
    hull = sd_cone_y(p, -11.6, 15.4, 6.5, 0.45)
    ring = sd_cone_y(p, -12.4, -11.0, 5.6, 6.4)
    wl = seg_box(p, (-5.0, -9.0), (-14.0, -10.6), 2.1, 0.9)
    wr = seg_box(p, (5.0, -9.0), (14.0, -10.6), 2.1, 0.9)
    sl = sd_box(p, V(-14.2, -7.0, 0), V(1.35, 8.0, 1.0))
    sr = sd_box(p, V(14.2, -7.0, 0), V(1.35, 8.0, 1.0))
    ll = sd_sphere(p, V(-14.2, 1.2, 0.6), 1.1)
    lr = sd_sphere(p, V(14.2, 1.2, 0.6), 1.1)
    return m_union((hull, 1), (ring, 2), (np.minimum(wl, wr), 3),
                   (np.minimum(sl, sr), 4), (np.minimum(ll, lr), 5))

def set_light(v):
    global LIGHT, HALF
    LIGHT = norm(v); HALF = norm(LIGHT + V(0, 0, 1))

def render_ship():
    """The 1994 renders keep a key light that swings the opposite way to the
    ship (lit from the right when pointing up, from above when pointing
    right); we mimic that look."""
    frames = []
    for i in range(64):
        a = -i * 2 * math.pi / 64     # clockwise rotation, frame 0 = nose up
        th = i * 2 * math.pi / 64
        set_light(V(-0.8 * math.cos(th), 0.8 * math.sin(th), 0.6))
        frames.append(to_img(trace(lambda p: ship_scene(rotz(p, -a)), 45 * S, 22.5)))
    set_light(V(-0.55, 0.62, 0.56))
    save('ship', sheet(frames, 8), 45 * S, 45 * S, 64, 8, [45, 45])

# =============================================================== SHIELD ===
def render_shield():
    n = 45 * S
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(lin, -lin)
    R = 0.96
    r2 = (X * X + Y * Y) / (R * R)
    inside = r2 < 1
    Z = np.sqrt(np.clip(1 - r2, 0, 1))
    N = np.stack([X / R, Y / R, Z], -1)
    fres = (1 - Z) ** 2.2
    swirl = fbm2(X * 3 + 4, Y * 3 - 2, 4, 7)
    base = np.stack([0.30 + 0.25 * swirl, 0.38 + 0.25 * swirl, 0.95 * np.ones_like(X)], -1)
    spec = np.clip(N @ HALF, 0, 1) ** 60
    spec2 = np.clip(N @ norm(V(0.5, -0.4, 0.75)), 0, 1) ** 90 * 0.6
    streak = np.clip(1 - np.abs((X + Y * 0.4) * 5 + 2.2 - swirl * 1.5), 0, 1) ** 3 * 0.35 * (Z > 0.3)
    col = base * (0.55 + 0.6 * fres[..., None]) + (spec + spec2 + streak)[..., None]
    a = np.clip(0.42 + 0.5 * fres + spec + 0.4 * streak + 0.15 * swirl, 0, 0.95)
    edge = np.clip((1 - np.sqrt(r2)) * n * 0.5, 0, 1)
    a = a * inside * edge
    rgba = np.concatenate([np.clip(col, 0, 1), a[..., None]], -1)
    save('shield', to_img(rgba), n, n, 1, 1, [45, 45])

# =============================================================== SAUCER ===
material(10)(const((0.50, 0.66, 0.68), 0.6, 30))          # teal rim
material(11)(const((0.80, 0.76, 0.56), 0.7, 35))          # khaki top
def _under(p, n):
    N = p.shape[0]
    glow = np.clip(1 - np.sqrt(p[:, 0] ** 2 + p[:, 2] ** 2) / 9.0, 0, 1) ** 1.5
    alb = np.tile(V(0.72, 0.66, 0.46), (N, 1))
    emis = glow[:, None] * V(0.9, 0.8, 0.35)
    return alb, np.full(N, 0.4), 20, emis
material(12)(_under)
material(13)(const((0.65, 0.05, 0.05), 0.8, 30, (0.65, 0.05, 0.02)))   # red lights
material(14)(const((0.15, 0.6, 0.2), 0.3, 20))            # green stalk
material(15)(const((0.6, 0.62, 0.65), 0.9, 50))           # grey ball
material(16)(const((0.9, 0.8, 0.2), 0.2, 10, (0.8, 0.7, 0.1)))  # yellow lamps

def saucer_scene(phase):
    def f(p):
        rim = sd_ellipsoid(p, V(0, 0, 0), V(19.5, 2.8, 19.5))
        top = np.maximum(sd_ellipsoid(p, V(0, 1.0, 0), V(14.5, 8.0, 14.5)), -p[..., 1] - 0.5)
        und = np.maximum(sd_ellipsoid(p, V(0, -0.5, 0), V(16.0, 9.0, 16.0)), p[..., 1] - 0.5)
        ld = np.full(p.shape[:-1], 1e9)
        for k in range(8):
            a = phase + k * math.pi / 4
            ld = np.minimum(ld, sd_sphere(p, V(11.0 * math.cos(a), 4.6, 11.0 * math.sin(a)), 1.7))
        yd = np.full(p.shape[:-1], 1e9)
        for k in range(4):
            a = phase + k * math.pi / 2 + 0.4
            yd = np.minimum(yd, sd_sphere(p, V(6.0 * math.cos(a), -8.0, 6.0 * math.sin(a)), 1.6))
        stalk = sd_capsule(p, V(0, 8.0, 0), V(-1.0, 13.0, -1.0), 0.65)
        ball = sd_sphere(p, V(-1.0, 14.6, -1.0), 2.4)
        return m_union((rim, 10), (top, 11), (und, 12), (ld, 13), (yd, 16), (stalk, 14), (ball, 15))
    return f

def render_saucer():
    frames = []
    for i in range(8):
        img = to_img(trace(saucer_scene(i * (math.pi / 4) / 8), 120, 20.0, tilt=-0.18))
        # sprite is 40x36: crop the square render vertically
        img = img.crop((0, 6, 120, 114))
        frames.append(img)
    save('saucer', sheet(frames, 8), 120, 108, 8, 8, [40, 36])

# ========================================================= SMILEY PEST ====
def _smiley_mat(yaw):
    def f(p, n):
        N = p.shape[0]
        q = roty(n, -yaw)   # face local direction
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        alb = np.tile(V(1.0, 0.84, 0.08), (N, 1))
        dark = np.zeros(N, bool)
        for ex in (-0.33, 0.33):
            dark |= ((x - ex) / 0.11) ** 2 + ((y - 0.30) / 0.2) ** 2 < 1
        r = np.sqrt(x * x + (y - 0.05) ** 2)
        dark |= (np.abs(r - 0.55) < 0.07) & (y < -0.05) & (z > 0)
        dark &= z > 0
        alb[dark] = V(0.12, 0.08, 0.0)
        return alb, np.full(N, 0.7), 25, np.zeros((N, 3))
    return f

def render_pest():
    frames = []
    for i in range(32):
        yaw = math.radians(-55 + 110 * i / 31)
        material(20)(_smiley_mat(yaw))
        frames.append(to_img(trace(lambda p: (sd_sphere(p, V(0, 0, 0), 6.6), np.full(p.shape[:-1], 20)), 14 * S, 7.0)))
    save('pest', sheet(frames, 8), 14 * S, 14 * S, 32, 8, [14, 14])

# ================================================================ ROCKS ===
FIB = None
def fib_dirs(n, seed=3):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n); th = math.pi * (1 + 5 ** 0.5) * i
    d = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], -1)
    r = np.random.default_rng(seed)
    d += r.normal(0, 0.08, d.shape)
    return norm(d)

def rock_lumpy():
    def f(p):
        q = p / V(1.0, 0.86, 0.95)
        b = fbm3(q * 2.2 + 3.1, 3, 11)
        bil = np.abs(noise3(q * 5.0, 12) - 0.5)
        return (length(q) - 0.86 - 0.16 * b + 0.12 * bil) * 0.8, np.full(p.shape[:-1], 30)
    def mat(p, n):
        N = p.shape[0]
        c = noise3(p * 5.0, 12)
        dark = np.clip(1 - np.abs(c - 0.5) * 6, 0, 1)
        alb = V(0.78, 0.62, 0.30) * (1 - 0.55 * dark[:, None]) + V(0.12, 0.1, 0.0) * fbm3(p * 9, 2, 13)[:, None]
        return alb, np.full(N, 1.0) * (1 - dark * 0.7), 22, np.zeros((N, 3))
    return f, mat

HOLES = fib_dirs(12, 5)
HOLE_R = np.random.default_rng(6).uniform(0.16, 0.34, 12)
def rock_cratered():
    def f(p):
        d = length(p) - 0.95
        for k in range(12):
            d = np.maximum(d, -(length(p - HOLES[k] * 0.98) - HOLE_R[k]))
        return d, np.full(p.shape[:-1], 31)
    def mat(p, n):
        N = p.shape[0]
        g = 0.70 + 0.12 * fbm3(p * 4, 3, 21)
        inner = np.clip((0.93 - length(p)) * 8, 0, 1)
        alb = np.stack([g, g * 0.97, g * 0.9], -1) * (1 - 0.6 * inner[:, None])
        return alb, np.full(N, 0.9), 35, np.zeros((N, 3))
    return f, mat

def rock_earth():
    def f(p): return length(p) - 0.95, np.full(p.shape[:-1], 32)
    def mat(p, n):
        N = p.shape[0]
        land = fbm3(p * 1.8 + 7, 5, 31)
        cloud = fbm3(p * 3.0 - 2, 4, 32)
        ocean = V(0.16, 0.38, 0.80) + V(0.1, 0.1, 0.1) * fbm3(p * 6, 2, 33)[:, None]
        grn = V(0.28, 0.58, 0.28) * (0.8 + 0.4 * fbm3(p * 7, 2, 34)[:, None])
        isl = np.clip((land - 0.52) * 12, 0, 1)[:, None]
        alb = ocean * (1 - isl) + grn * isl
        cl = np.clip((cloud - 0.55) * 4, 0, 0.85)[:, None]
        alb = alb * (1 - cl) + V(0.95, 0.95, 0.97) * cl
        return alb, np.full(N, 0.5) * (1 - isl[:, 0]), 30, np.zeros((N, 3))
    return f, mat

def _glyph_mask(ch, res=128):
    im = Image.new('L', (res, res), 0)
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', int(res * 0.95))
    except Exception:
        font = ImageFont.load_default()
    bb = d.textbbox((0, 0), ch, font=font)
    d.text(((res - (bb[2] - bb[0])) / 2 - bb[0], (res - (bb[3] - bb[1])) / 2 - bb[1]), ch, fill=255, font=font)
    return np.asarray(im, np.float64) / 255

GLYPH2 = _glyph_mask('2')
def rock_poolball():
    c = norm(V(-0.32, 0.36, 0.88))
    up = norm(V(0, 1, 0) - c * c[1]); rt = np.cross(up, c)
    def f(p): return length(p) - 0.95, np.full(p.shape[:-1], 33)
    def mat(p, n):
        N = p.shape[0]
        alb = np.tile(V(0.04, 0.10, 0.80), (N, 1))
        u = n @ rt; v = n @ up; w = n @ c
        disc = (u * u + v * v < 0.40 ** 2) & (w > 0)
        alb[disc] = V(0.97, 0.97, 0.95)
        gx = np.clip(((u / 0.30) * 0.5 + 0.5) * 127, 0, 127).astype(int)
        gy = np.clip(((-v / 0.30) * 0.5 + 0.5) * 127, 0, 127).astype(int)
        g = GLYPH2[gy, gx] * (np.abs(u) < 0.3) * (np.abs(v) < 0.3) * disc
        alb = alb * (1 - g[:, None]) + V(0.05, 0.05, 0.05) * g[:, None]
        return alb, np.full(N, 1.3), 70, np.zeros((N, 3))
    return f, mat

SPIKES = fib_dirs(46, 9)
def rock_urchin():
    def f(p):
        r = length(p)
        dn = p / np.maximum(r, 1e-6)[..., None]
        dots = dn @ SPIKES.T
        best = np.argsort(-dots, axis=-1)[..., :3]
        d = r - 0.36
        for j in range(3):
            ax = SPIKES[best[..., j]]
            along = np.sum(p * ax, -1)
            perp = length(p - ax * along[..., None])
            tt = np.clip(along / 0.98, 0, 1)
            rad = 0.13 * (1 - tt)
            ds = np.where(along > 0.98, length(p - ax * 0.98), (perp - rad) * 0.85)
            ds = np.where(along < 0, r - 0.36, ds)
            d = np.minimum(d, ds)
        return d * 0.9, np.full(p.shape[:-1], 34)
    def mat(p, n):
        N = p.shape[0]
        r = length(p)
        alb = V(0.62, 0.40, 0.36) * (0.75 + 0.35 * np.clip(r, 0, 1))[:, None]
        return alb, np.full(N, 0.6), 18, np.zeros((N, 3))
    return f, mat

def rock_eyeball():
    c = norm(V(0.12, 0.15, 0.98))
    def f(p): return length(p) - 0.95, np.full(p.shape[:-1], 35)
    def mat(p, n):
        N = p.shape[0]
        w = n @ c
        ang = np.arccos(np.clip(w, -1, 1))
        alb = np.tile(V(0.96, 0.93, 0.90), (N, 1))
        vein = np.abs(noise3(p * 3.2, 41) - 0.5) < 0.018
        vein |= np.abs(noise3(p * 5.5, 42) - 0.5) < 0.012
        alb[vein & (ang > 0.55)] = V(0.75, 0.08, 0.08)
        iris = ang < 0.52
        rad = fbm3(p * 14, 2, 43)
        alb[iris] = (V(0.50, 0.28, 0.75) * (0.7 + 0.6 * rad[iris, None]))
        ring = (ang > 0.46) & iris
        alb[ring] = V(0.30, 0.12, 0.45)
        alb[ang < 0.22] = V(0.03, 0.02, 0.04)
        return alb, np.full(N, 1.1), 60, np.zeros((N, 3))
    return f, mat

def rock_moon():
    def f(p):
        return length(p) - 0.94 - 0.02 * fbm3(p * 6, 2, 51), np.full(p.shape[:-1], 36)
    def mat(p, n):
        N = p.shape[0]
        m = fbm3(p * 3.5, 5, 52)
        g = 0.62 + 0.38 * m
        alb = np.stack([g, g, g * 1.02], -1)
        crat = np.clip((noise3(p * 7, 53) - 0.72) * 6, 0, 1)
        alb *= (1 - 0.35 * crat)[:, None]
        tint = np.clip((p[:, 0] - p[:, 1]) * 0.8 - 0.3, 0, 1)[:, None]
        alb = alb * (1 - tint) + V(0.70, 0.55, 0.35) * tint
        return alb, np.full(N, 0.7), 25, np.zeros((N, 3))
    return f, mat

def rock_creature():
    """original purple critter (big-grin ball) - stands in for level 8"""
    def f(p):
        d = sd_ellipsoid(p, V(0, 0, 0), V(0.92, 0.95, 0.9))
        snout = sd_ellipsoid(p, V(0.05, -0.15, 0.45), V(0.62, 0.48, 0.55))
        k = 0.15
        h = np.clip(0.5 + 0.5 * (snout - d) / k, 0, 1)
        d = snout * (1 - h) + d * h - k * h * (1 - h)
        return d, np.full(p.shape[:-1], 37)
    def mat(p, n):
        N = p.shape[0]
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        alb = np.tile(V(0.86, 0.26, 0.62), (N, 1))
        mouth = ((x - 0.05) ** 2 / 0.33 + (y + 0.32) ** 2 / 0.05 < 1) & (z > 0.5)
        teeth = mouth & (y > -0.27)
        alb[mouth] = V(0.35, 0.02, 0.08)
        alb[teeth] = V(0.98, 0.98, 0.95)
        for ex in (-0.28, 0.32):
            eye = ((x - ex) ** 2 + (y - 0.38) ** 2 < 0.03) & (z > 0.4)
            alb[eye] = V(0.98, 0.98, 0.98)
            pup = ((x - ex - 0.03) ** 2 + (y - 0.36) ** 2 < 0.008) & (z > 0.4)
            alb[pup] = V(0.05, 0.05, 0.1)
        spots = (noise3(p * 6, 61) > 0.78) & ~mouth
        alb[spots] = V(0.55, 0.85, 0.35)
        return alb, np.full(N, 0.7), 30, np.zeros((N, 3))
    return f, mat

ROCKS = [rock_lumpy, rock_cratered, rock_earth, rock_poolball,
         rock_urchin, rock_eyeball, rock_moon, rock_creature]
ROCK_PX = [64, 32, 16]

def render_rocks():
    radii = []
    for ti, mk in enumerate(ROCKS):
        sdf, mat = mk()
        material(int(sdf(np.zeros((1, 3)))[1][0]))(mat)
        frames = []
        for size in ROCK_PX:
            img = trace(sdf, size * S, 1.0)
            frames.append(img)
        # collision radius (fraction of half-size) from the big render alpha
        a = frames[0][..., 3]
        ys, xs = np.nonzero(a > 0.5)
        c = (frames[0].shape[0] - 1) / 2
        r = np.sqrt((xs - c) ** 2 + (ys - c) ** 2)
        radii.append(round(float(np.percentile(r, 97) / (frames[0].shape[0] / 2)), 3))
        W = sum(s * S for s in ROCK_PX)
        im = Image.new('RGBA', (W, ROCK_PX[0] * S))
        x = 0
        for img, size in zip(frames, ROCK_PX):
            im.paste(to_img(img), (x, 0)); x += size * S
        name = 'rock%d' % (ti + 1)
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
        print('wrote', name)
    META['rocks'] = {'files': ['rock%d.png' % (i + 1) for i in range(8)], 'sizes': ROCK_PX, 'radius': radii}

# ========================================================== EXPLOSIONS ====
def render_explosions():
    n = 256
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(lin, lin)
    R = np.sqrt(X * X + Y * Y)
    frames = []
    # frame 0: hot red ball with a white-pink core
    core = np.clip(1 - R / 0.62, 0, 1)
    col = np.stack([np.clip(0.55 + core * 1.2, 0, 1), core ** 2.2 * 0.85, core ** 3 * 0.8], -1)
    a = np.clip(core * 1.6, 0, 1) ** 0.8
    frames.append(np.concatenate([col, a[..., None]], -1))
    for k in range(1, 5):
        f = fbm2(X * 4 + k * 3.1, Y * 4 - k * 1.7, 5, 70 + k)
        rad = 0.45 + 0.13 * k
        m = np.clip(1 - R / rad, 0, 1)
        heat = np.clip((f - 0.35) * 2.2 + m - 0.25 * k, 0, 1) * (m > 0)
        bright = [1.0, 0.75, 0.45, 0.25][k - 1]
        r = np.clip(heat * 1.8 * bright + 0.25 * m, 0, 1)
        g = np.clip((heat - 0.35) * 1.6 * bright, 0, 1)
        b = np.clip((heat - 0.75) * 2.0 * bright, 0, 1)
        aa = np.clip(heat * 1.5, 0, 1) * np.clip(m * 3, 0, 1) * [1, 0.95, 0.85, 0.7][k - 1]
        frames.append(np.concatenate([np.stack([r, g, b], -1), aa[..., None]], -1))
    save('explosion', sheet([to_img(f) for f in frames], 5), n, n, 5, 5, [128, 128])

# ============================================= small sprites (2D shading) ==
def radial(n, cx=0, cy=0):
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(lin, lin)
    return X - cx, Y - cy

def render_small():
    # thrust flame: 14x14, 2 frames: glowing orange teardrop (exhaust downwards)
    frames = []
    for k in range(2):
        X, Y = radial(42)
        Yc = Y + 0.05 + 0.08 * k
        w = 0.62 * np.sqrt(np.clip((Yc + 0.95) / 1.5, 0, 1)) * np.clip((0.75 - Yc) / 0.3, 0, 1) ** 0.5
        d = np.abs(X) / np.maximum(w, 1e-4)
        inside = np.clip((1 - d) * 3, 0, 1) * (Yc < 0.75) * (Yc > -0.95)
        core = np.clip(1 - np.sqrt((X / 0.32) ** 2 + ((Yc - 0.25) / 0.38) ** 2), 0, 1)
        col = np.stack([0.85 + 0.15 * core, 0.22 + 0.6 * core, 0.05 + 0.45 * core ** 2], -1)
        frames.append(to_img(np.concatenate([col, np.clip(inside * (0.55 + 0.45 * np.clip(1 - d, 0, 1)) + core, 0, 1)[..., None]], -1)))
    save('thrust', sheet(frames, 2), 42, 42, 2, 2, [14, 14])
    # ship torpedo: 8x8, 4 frames, pink/lilac sparkle
    frames = []
    for k in range(4):
        X, Y = radial(24)
        ang = k * math.pi / 8
        Xr = X * math.cos(ang) - Y * math.sin(ang); Yr = X * math.sin(ang) + Y * math.cos(ang)
        R = np.sqrt(X * X + Y * Y)
        star = np.clip(1 - (np.abs(Xr) * np.abs(Yr)) * 18 - R * 0.9, 0, 1)
        blob = np.clip(1.15 - R / 0.85, 0, 1)
        i = np.clip(blob * 1.3 + star * 0.8, 0, 1)
        col = np.stack([0.72 + 0.28 * i ** 2, 0.52 + 0.48 * i ** 3, 0.95 + 0.05 * i], -1)
        frames.append(to_img(np.concatenate([col, i[..., None]], -1)))
    save('torpedo', sheet(frames, 4), 24, 24, 4, 4, [8, 8])
    # alien torpedo: 9x9 red dot
    X, Y = radial(27)
    R = np.sqrt(X * X + Y * Y)
    i = np.clip(1 - R / 0.85, 0, 1)
    col = np.stack([np.ones_like(i), i ** 3 * 0.6, i ** 4 * 0.5], -1)
    save('atorpedo', to_img(np.concatenate([col, np.clip(i * 2, 0, 1)[..., None]], -1)), 27, 27, 1, 1, [9, 9])

# ============================================================ BACKDROP ====
def render_backdrop(W=1280, H=960):
    r = np.random.default_rng(42)
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    u, v = x / W, y / H
    img = np.zeros((H, W, 3))
    def blob(cx, cy, sx, sy, col, amt, seed, rot=0.0, scale=6.0, power=2.0):
        dx, dy = u - cx, v - cy
        c, s = math.cos(rot), math.sin(rot)
        rx, ry = c * dx + s * dy, -s * dx + c * dy
        m = np.exp(-((rx / sx) ** 2 + (ry / sy) ** 2))
        n = fbm2(u * scale + seed, v * scale - seed, 6, seed)
        val = np.clip(m * (n * 1.6 - 0.45), 0, None) ** power * amt
        return val[..., None] * V(*col)
    def ribbon(pts, width, col, amt, seed, scale=9.0):
        width *= 0.7; amt *= 0.42
        pts = np.array(pts)
        d = np.full((H, W), 9.0)
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            pa = np.stack([u - ax, v - ay], -1); ba = np.array([bx - ax, by - ay])
            h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
            dd = np.sqrt(np.sum((pa - h[..., None] * ba) ** 2, -1))
            d = np.minimum(d, dd)
        n = fbm2(u * scale + seed, v * scale + seed * 0.5, 6, seed)
        n2 = fbm2(u * scale * 2.3 - seed, v * scale * 2.3 + seed, 5, seed + 11)
        wob = d + (n - 0.5) * width * 2.2
        m = np.exp(-(wob / (width * 1.6)) ** 2)
        ridge = (1 - np.abs(2 * n2 - 1)) ** 6          # thin wispy strands
        val = np.clip(m * (0.25 * n + 1.1 * ridge * (0.5 + n)), 0, None) ** 1.3 * amt
        return val[..., None] * V(*col)
    # left magenta/red filament
    img += ribbon([(0.13, 0.02), (0.09, 0.18), (0.06, 0.32), (0.0, 0.45)], 0.05, (0.75, 0.10, 0.55), 0.85, 3)
    img += blob(0.04, 0.25, 0.08, 0.18, (0.45, 0.05, 0.08), 0.6, 4)
    img += ribbon([(0.0, 0.7), (0.05, 0.85), (0.12, 1.0)], 0.03, (0.55, 0.05, 0.25), 0.5, 5)
    # right blue-violet filament (diagonal)
    img += ribbon([(0.68, 0.08), (0.74, 0.22), (0.83, 0.38), (0.90, 0.55), (0.97, 0.75), (1.0, 0.82)], 0.04,
                  (0.40, 0.16, 0.95), 1.0, 6)
    # bottom centre purple / green cloud
    img += ribbon([(0.40, 0.62), (0.50, 0.78), (0.58, 0.92), (0.66, 1.0)], 0.07, (0.62, 0.25, 0.80), 1.0, 7, scale=7.0)
    img += ribbon([(0.62, 0.70), (0.55, 0.85), (0.45, 1.0)], 0.06, (0.70, 0.30, 0.75), 0.7, 12, scale=8.0)
    img += blob(0.52, 0.78, 0.16, 0.12, (0.30, 0.36, 0.26), 0.6, 8, power=1.5)
    img += ribbon([(0.0, 0.50), (0.03, 0.70), (0.0, 0.95)], 0.04, (0.45, 0.10, 0.45), 0.5, 13)
    img += ribbon([(0.78, 0.45), (0.86, 0.60), (0.92, 0.72)], 0.05, (0.20, 0.10, 0.65), 0.6, 14)
    # central grey-white galaxy glow
    dx, dy = u - 0.49, v - 0.48
    g = np.exp(-((dx / 0.10) ** 2 + (dy / 0.09) ** 2)) * 0.55
    g2 = np.exp(-((dx / 0.28) ** 2 + (dy / 0.25) ** 2)) * 0.18
    gn = fbm2(u * 30, v * 30, 3, 9)
    img += ((g + g2) * (0.6 + 0.6 * gn))[..., None] * V(0.80, 0.80, 0.82)
    img += blob(0.55, 0.45, 0.28, 0.26, (0.26, 0.27, 0.29), 0.35, 10)
    # pink speckle haze around the galaxy
    sp = (r.random((H, W)) > 0.9965) * np.exp(-(((u - 0.52) / 0.3) ** 2 + ((v - 0.55) / 0.35) ** 2))
    sp = np.asarray(Image.fromarray((sp * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), np.float64) / 255
    img += (sp * 6)[..., None] * V(0.6, 0.25, 0.5)
    # star field
    n_st = int(W * H / 70)
    sx = r.integers(0, W, n_st); sy = r.integers(0, H, n_st)
    br = r.uniform(0.15, 1.0, n_st) ** 2.4
    tint = np.stack([1 - r.uniform(0, 0.35, n_st), 1 - r.uniform(0, 0.35, n_st), 1 - r.uniform(0, 0.2, n_st)], -1)
    np.add.at(img, (sy, sx), br[:, None] * tint)
    # bigger cross stars
    big = np.zeros((H, W))
    for _ in range(140):
        cx, cy = r.integers(2, W - 2), r.integers(2, H - 2); b = r.uniform(0.4, 1.0)
        big[cy, cx] += b; big[cy, cx - 1] += b * 0.4; big[cy, cx + 1] += b * 0.4
        big[cy - 1, cx] += b * 0.4; big[cy + 1, cx] += b * 0.4
    img += big[..., None] * V(0.95, 0.95, 1.0)
    # flare stars with diffraction spikes (green-yellow) and small blue stars
    def flare(cx, cy, col, size):
        dx, dy = x - cx * W, y - cy * H
        rr = np.sqrt(dx * dx + dy * dy) + 1
        halo = np.exp(-(rr / (size * 0.35)) ** 2) * 1.0 + np.exp(-(rr / size) ** 2) * 0.35
        spk = 0
        for a in (0.6, 0.6 + math.pi / 2):
            c, s = math.cos(a), math.sin(a)
            along = np.abs(c * dx + s * dy); perp = np.abs(-s * dx + c * dy)
            spk = spk + np.exp(-perp / 0.8) * np.exp(-along / (size * 1.2)) * 0.5
        return (halo + spk)[..., None] * V(*col)
    img += blob(0.37, 0.21, 0.07, 0.07, (0.35, 0.55, 0.25), 0.6, 15, power=1.2)
    img += blob(0.73, 0.38, 0.08, 0.08, (0.35, 0.55, 0.25), 0.6, 16, power=1.2)
    img += flare(0.37, 0.21, (0.60, 0.70, 0.50), 34)
    img += flare(0.73, 0.38, (0.65, 0.70, 0.50), 38)
    img += flare(0.585, 0.78, (0.55, 0.65, 1.0), 14)
    for cx, cy in [(0.91, 0.30), (0.98, 0.34), (0.78, 0.09), (0.06, 0.87), (0.72, 0.17)]:
        img += flare(cx, cy, (0.3, 0.55, 1.0), 9)
    img = np.clip(img, 0, 1) ** 0.95
    Image.fromarray((img * 255).astype(np.uint8)).save(os.path.join(OUT, 'backdrop.jpg'), quality=86)
    print('wrote backdrop')

# =============================================================== ICONS ====
def render_icons():
    bg = Image.open(os.path.join(OUT, 'backdrop.jpg')).convert('RGBA')
    ship = Image.open(os.path.join(OUT, 'ship.png')).crop((45 * S * 7, 0, 45 * S * 8, 45 * S))   # frame 7
    rock = Image.open(os.path.join(OUT, 'rock1.png')).crop((0, 0, 64 * S, 64 * S))
    for size in (512, 192, 180):
        base = bg.crop((300, 200, 300 + 480, 200 + 480)).resize((size, size), Image.LANCZOS)
        r = rock.resize((int(size * 0.55),) * 2, Image.LANCZOS)
        base.alpha_composite(r, (int(size * 0.40), int(size * 0.06)))
        s = ship.resize((int(size * 0.62),) * 2, Image.LANCZOS)
        base.alpha_composite(s, (int(size * 0.04), int(size * 0.36)))
        name = 'apple-touch-icon.png' if size == 180 else 'icon-%d.png' % size
        base.convert('RGB').save(os.path.join(OUT, name))
    # maskable: same art with padding
    base = bg.crop((300, 200, 780, 680)).resize((512, 512), Image.LANCZOS)
    r = rock.resize((220, 220), Image.LANCZOS); base.alpha_composite(r, (230, 90))
    s = ship.resize((250, 250), Image.LANCZOS); base.alpha_composite(s, (90, 190))
    base.convert('RGB').save(os.path.join(OUT, 'icon-maskable-512.png'))
    print('wrote icons')

if __name__ == '__main__':
    import sys
    which = sys.argv[1:] or ['ship', 'shield', 'saucer', 'pest', 'rocks', 'explosions', 'small', 'backdrop', 'icons']
    metaf = os.path.join(OUT, 'sprites.json')
    if os.path.exists(metaf):
        META.update(json.load(open(metaf)))
    for w in which:
        globals()['render_' + w]()
    json.dump(META, open(metaf, 'w'), indent=1)
