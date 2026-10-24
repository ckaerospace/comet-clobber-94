import { chromium, webkit, devices } from '@playwright/test';
const url = process.env.URL || 'http://localhost:8080/';
const which = process.argv[2] || 'desktop';
const conf = which === 'iphone' ? [webkit, devices['iPhone 14']] : which === 'pixel' ? [chromium, devices['Pixel 7']] :
  which === 'iphoneL' ? [webkit, devices['iPhone 14 landscape']] : [chromium, { viewport: { width: 1440, height: 900 } }];
const b = await conf[0].launch(); const ctx = await b.newContext(conf[1]); const p = await ctx.newPage();
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
await p.goto(url); await p.waitForFunction(() => window.__game && window.__game.game && window.__game.game.ticks > 30);
await p.screenshot({ path: `/tmp/s_${which}_title.png` });
await p.evaluate(() => __game.start(1)); await p.waitForTimeout(4000);
await p.screenshot({ path: `/tmp/s_${which}_play.png` });
console.log(JSON.stringify(await p.evaluate(() => __game.state())), errs);
await b.close();
