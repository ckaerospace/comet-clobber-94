# Comet Clobber '94

**COMET CLOBBER!** is a browser remake that plays like the 1994 Windows classic. It runs on desktop, iPhone and Android, installs as a PWA and works offline.

> A tribute to a 1994 Windows game. Not affiliated.

* The rules, constants and level progression follow the original. See [docs/mechanics.md](docs/mechanics.md) for the source citations.
* All art is new: `tools/render_sprites.py` ray-traces the ships, saucer, pests, rocks, explosions and backdrop with numpy. All sounds are synthesised live with WebAudio.
* The game is a static site with no build step, in `public/`.

## Play

| | |
|---|---|
| Player 1 | ← → rotate, ↑ thrust, Space fire, Right Ctrl special (solo: also A/D/W, ↓/Shift) |
| Player 2 | A D rotate, S thrust, Left Shift fire, Left Ctrl special |
| Player 3 | Numpad 4 6 rotate, 8 thrust, 0 fire, 2 special |
| Player 4 | J L rotate, I thrust, K fire, U special |
| Game | Enter start, 1–4 start with N players, P / Esc pause |
| Touch | Drag on the left half to steer (the ship turns toward the stick; push to the rim to thrust). FIRE and the four special buttons sit on the right. True multitouch. |
| Gamepad | Stick or d-pad rotates, up / RT thrusts, A fires, B special, Start pauses |

## Develop

```sh
npm install
npx playwright install --with-deps chromium webkit
npm run serve          # http://localhost:8080
npx playwright test    # iPhone 14 (WebKit), Pixel 7 (Chromium), desktop 1440x900
BASE_URL=https://… npx playwright test   # smoke-test a deployment
python3 tools/render_sprites.py          # re-render all art into public/assets
```

When you change any cached file, bump `VERSION` in `public/sw.js`.

## Licence

The code and art in this repository are MIT licensed. The original game belongs to its author. This project contains none of its files.
