import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const LIVE = !!process.env.BASE_URL;
const SHOTS = process.env.SHOT_DIR || 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const M = { Play: 11, NewLevel: 10, GameOver: 12, HiScores: 3, Attract2: 2 };

async function open(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('./');
  await page.waitForFunction(() => window.__game && window.__game.game && window.__game.game.ticks > 20, null, { timeout: 30000 });
  return errors;
}
const state = page => page.evaluate(() => __game.state());
const isTouch = testInfo => testInfo.project.name !== 'desktop';

test('loads cleanly and shows the title', async ({ page }, testInfo) => {
  const errors = await open(page);
  await page.waitForTimeout(1500);
  const s = await state(page);
  expect(s.mode).toBe(M.Attract2);
  expect(s.touch).toBe(isTouch(testInfo));
  // no page scroll possible
  const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
  expect(scroll.w).toBeLessThanOrEqual(scroll.iw); expect(scroll.h).toBeLessThanOrEqual(scroll.ih);
  // canvas is 4:3 and crisp at device pixel ratio
  const cv = await page.evaluate(() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(); return { w: r.width, h: r.height, bw: c.width, bh: c.height, dpr: devicePixelRatio }; });
  expect(Math.abs(cv.w / cv.h - 4 / 3)).toBeLessThan(0.01);
  expect(Math.abs(cv.bw - cv.w * Math.min(3, cv.dpr))).toBeLessThan(2);
  if (!LIVE) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-title.png` });
  expect(errors).toEqual([]);
});

test('starts via keyboard / touch', async ({ page }, testInfo) => {
  const errors = await open(page);
  if (isTouch(testInfo)) {
    const box = await page.locator('#cv').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.7, box.y + box.height * 0.4);
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => __game.state().playing, null, { timeout: 5000 });
  await page.waitForFunction(() => __game.state().mode === 11, null, { timeout: 8000 });
  expect((await state(page)).stats.length).toBe(1);
  expect(errors).toEqual([]);
});

test('keyboard controls fly the ship', async ({ page }, testInfo) => {
  test.skip(isTouch(testInfo), 'desktop only');
  const errors = await open(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __game.state().mode === 11 && __game.state().stats[0].ship);
  await page.waitForTimeout(1200);  // materialize
  const r0 = (await state(page)).stats[0].rot;
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400); await page.keyboard.up('ArrowLeft');
  expect((await state(page)).stats[0].rot).not.toBe(r0);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(200);
  expect((await state(page)).stats[0].thrust).toBe(true);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('Space'); await page.waitForTimeout(100);
  expect((await page.evaluate(() => __game.counts())).torp || 0).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyP');
  expect((await state(page)).paused).toBe(true);
  await page.keyboard.press('KeyP');
  expect((await state(page)).paused).toBe(false);
  expect(errors).toEqual([]);
});

test('multitouch: joystick and fire held together', async ({ page, browserName }, testInfo) => {
  test.skip(!isTouch(testInfo), 'touch devices only');
  const errors = await open(page);
  const box = await page.locator('#cv').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await page.waitForFunction(() => __game.state().mode === 11 && __game.state().stats[0].ship);
  await page.waitForTimeout(1200);
  const vp = page.viewportSize();
  const fire = await page.locator('.t-fire').boundingBox();
  const sx = vp.width * 0.15, sy = vp.height * 0.8;
  const fx = fire.x + fire.width / 2, fy = fire.y + fire.height / 2;
  const r0 = (await state(page)).stats[0].rot;
  if (browserName === 'chromium') {
    // real multi-point touch events through CDP
    const cdp = await page.context().newCDPSession(page);
    const pts = (a, b) => [{ x: sx, y: sy, id: 1 }, ...(b ? [{ x: fx, y: fy, id: 2 }] : [])].map((p, i) => i === 0 ? { ...p, x: sx + a, y: sy } : p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0, false) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0, true) });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i * 9, true) });
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.stick && s.stick.d).toBeGreaterThan(0.7);
    expect(s.fire).toBe(true);
    expect(s.stats[0].thrust).toBe(true);
    expect(s.stats[0].rot).not.toBe(r0);
    expect((await page.evaluate(() => __game.counts())).torp || 0).toBeGreaterThan(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    // WebKit: Playwright has no multi-touch, so dispatch two concurrent touch pointers
    await page.evaluate(({ sx, sy, fx, fy }) => {
      const fireEl = document.querySelector('.t-fire'), zone = document.querySelector('.t-zone');
      const ev = (t, el, id, x, y) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', zone, 1, sx, sy);
      ev('pointerdown', fireEl, 2, fx, fy);
      for (let i = 1; i <= 10; i++) ev('pointermove', zone, 1, sx + i * 9, sy);
      window.__mt = { ev, fireEl, zone };
    }, { sx, sy, fx, fy });
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.stick && s.stick.d).toBeGreaterThan(0.7);
    expect(s.fire).toBe(true);
    expect(s.stats[0].thrust).toBe(true);
    expect(s.stats[0].rot).not.toBe(r0);
    expect((await page.evaluate(() => __game.counts())).torp || 0).toBeGreaterThan(0);
    await page.evaluate(() => { const m = window.__mt; m.ev('pointerup', m.zone, 1, 0, 0); m.ev('pointerup', m.fireEl, 2, 0, 0); });
  }
  await page.waitForTimeout(200);
  const s2 = await state(page);
  expect(s2.fire).toBe(false); expect(s2.stick).toBe(null);
  if (!LIVE) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-gameplay.png` });
  expect(errors).toEqual([]);
});

test('level advance (test hook) and game over', async ({ page }, testInfo) => {
  const errors = await open(page);
  await page.evaluate(() => __game.start(1));
  await page.waitForFunction(() => __game.state().mode === 11);
  await page.evaluate(() => __game.skipLevel());
  await page.waitForFunction(() => __game.state().level === 2, null, { timeout: 5000 });
  await page.waitForFunction(() => __game.state().mode === 11 && __game.state().rocksLeft > 0, null, { timeout: 8000 });
  if (!LIVE && !isTouch(testInfo)) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-gameplay.png` });
  }
  await page.waitForFunction(() => { const s = __game.state().stats[0]; return s.ship && __game.game.stats[0].curShip.materializing <= 0; }, null, { timeout: 8000 });
  await page.evaluate(() => __game.gameOver());
  await page.waitForFunction(() => __game.state().mode === 12, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  if (!LIVE) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-gameover.png` });
  expect(errors).toEqual([]);
});

test('60 seconds of play without exceptions, steady frame timing', async ({ page }, testInfo) => {
  test.setTimeout(140000);
  const errors = await open(page);
  await page.evaluate(() => {
    __game.params.startingLevel = 0;
    __game.start(1);
    __game.perf.dts.length = 0;
    // an autopilot that mashes the game's input so all code paths get exercised
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'ControlRight'];
    window.__auto = setInterval(() => {
      const g = __game.game;
      for (const k of keys) { if (Math.random() < 0.3) g.input.keys.add(k); else g.input.keys.delete(k); }
      if (!g.isPlaying()) __game.start(1);
    }, 120);
  });
  const t0 = await page.evaluate(() => [performance.now(), __game.perf.ticks]);
  await page.waitForTimeout(60000);
  const r = await page.evaluate(() => {
    clearInterval(window.__auto);
    const d = __game.perf.dts.slice().sort((a, b) => a - b);
    return { now: performance.now(), ticks: __game.perf.ticks, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], maxTick: __game.perf.maxTickMs, errs: __game.perf.errors, s: __game.state() };
  });
  const elapsed = r.now - t0[0], ticks = r.ticks - t0[1];
  const rate = ticks / (elapsed / 42);
  testInfo.annotations.push({ type: 'timing', description: `ticks ${ticks} in ${Math.round(elapsed)} ms (${(rate * 100).toFixed(1)}% of 42 ms rate), frame median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, worst tick ${r.maxTick.toFixed(2)} ms, level ${r.s.level}` });
  console.log(testInfo.project.name, testInfo.annotations.at(-1).description);
  expect(rate).toBeGreaterThan(0.93);
  expect(rate).toBeLessThan(1.03);
  expect(r.median).toBeLessThan(34);
  expect(r.errs).toEqual([]);
  expect(errors).toEqual([]);
});

test('works offline after first load (service worker)', async ({ page, context }, testInfo) => {
  // a private server that we can really switch off (WebKit's setOffline also breaks its service worker)
  let server = null, url = './';
  if (!LIVE) {
    const port = 8100 + testInfo.workerIndex * 7 + testInfo.retry;
    server = spawn(process.execPath, ['tools/serve.mjs', 'public', String(port)], { stdio: 'ignore' });
    url = `http://localhost:${port}/`;
    for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.game && window.__game.game.ticks > 20, null, { timeout: 30000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  if (!server && testInfo.project.name === 'iphone14') {
    // Playwright WebKit cannot reload while context.setOffline is on ("internal error"), so against a live
    // site verify the precondition instead: SW in control and every app file in its cache.
    // Real offline reload on WebKit is covered by the local run, where the server itself is stopped.
    const r = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return { ctl: !!navigator.serviceWorker.controller, n: (await c.keys()).length };
    });
    expect(r.ctl).toBe(true);
    expect(r.n).toBeGreaterThan(20);
    testInfo.annotations.push({ type: 'note', description: 'WebKit live: verified SW control + cache contents only' });
    return;
  }
  if (server) { server.kill(); await new Promise(r => setTimeout(r, 300)); } else await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.game && window.__game.game.ticks > 20, null, { timeout: 20000 });
  expect((await state(page)).mode).toBe(M.Attract2);
  if (!server) await context.setOffline(false);
});
