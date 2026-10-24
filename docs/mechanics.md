# Comet Clobber '94: game mechanics

Comet Clobber '94 is a fresh JavaScript re-implementation of the **rules** of
a 1994 Windows game. It is a tribute and is not affiliated with the original.

## Source

The behaviour was studied from the original Borland Pascal for Windows source.

No source code was copied. The rules below were rewritten from scratch in
`public/js/sim.js`, and no original sprite, bitmap, sound or MIDI file is used or shipped.
The graphics come from `tools/render_sprites.py` (a numpy ray-marcher plus procedural
noise), and every sound is synthesised in `public/js/audio.js`.

File and line references below point into that source archive. `CL` is `COMETLIB.PAS`, `C` is `COMET.PAS`,
`CI` is `COMETINI.PAS` and `RC` is `COMETENU.RC`.

## World and timing

| Rule | Value | Source |
|---|---|---|
| Playfield | 60000 × 45000 world units, origin (−30000, −22500), wraps on both axes. Displayed at 640×480 (93.75 units per pixel) | CL constants |
| Game tick | fixed 42 ms (≈ 23.8 Hz) | C `ProcessTimerTick` |
| Angles | 1024 steps per turn, fixed-point sine table ±32767 | CL `ISin/ICos` |
| Collisions | Manhattan pre-check (`|dx|+|dy| ≤ 0x2000`), then a pixel-exact mask overlap on the 640×480 grid | `SPRITEWG.PAS` `TPlayer.Collide` |

The browser build runs the simulation at exactly 42 ms per tick, with an accumulator
and at most 5 catch-up ticks per frame. The renderer interpolates positions between
ticks so the motion looks smooth at 60, 90 or 120 Hz. The game speed is the same as the original.

## Levels

* Rocks per level: `n = ((Level + 2 + Difficulty) * RocksPerLevel) >> 8` big rocks
  (C:245, `MakeRocks`), with `RocksPerLevel = 214`. Each big rock becomes 2 medium rocks,
  then 4 small ones, so a level holds `7n` rocks.
* Maximum rock speed: `(Level + 3·Difficulty) · 30000 / 640`. A rock is spawned on a random edge with a random velocity.
* Hatching rocks ("cronies"): `NumHatchRocks = 3n`, `HatchesLeft = 3n div (25 − 6·Difficulty)`.
  A splitting rock hatches 4–7 pests with probability `HatchesLeft / NumHatchRocks` (CL:1427 `TRock.Kill`).
* Splitting: every child gets the parent velocity plus a random vector
  `rnd(2·maxVel) + maxVel/2` and is offset `(30000·64/640) >> size` from the centre (CL:1427).
* Rock artwork changes every level and cycles through 8 rock types. Each later
  cycle of 8 levels is hue-shifted (C:159 `LoadRockShape`). The remake keeps this with 8 newly
  rendered rock types and a 60° hue shift for each cycle.
* Saucer frequency: `AlienFreq = 200 + 1250 div (Level + 3)` ticks (C:575). The saucer flies
  horizontally at `(Difficulty + 2) · 156` units/tick. Every `42 − 8·Difficulty` ticks it toggles a
  vertical drift of `±(250 + 128·Difficulty)`. It always keeps one shot in flight, aimed randomly (CL:1522–1560).
* A level ends when every rock is gone. "LEVEL n" shows for 70 ticks, then play resumes.

## Scoring (CL:438 `ScoreAmts`, CL:507 `AddScore`)

| Target | Points |
|---|---|
| Big / medium / small rock | 20 / 50 / 100 |
| Pest (crony) | 150 |
| Saucer | 250 |
| Bonus "Cronie lover": no pest shot before the level is cleared | 500 × Level × Difficulty |
| Bonus "Marksman": no player shot missed in the level | 5000 × Level × Difficulty |
| Bonus "Alien first": shot the saucer before scoring anything else | 1000 × Level × Difficulty |
| Extra ship | every 10,000 points (`NewShipScore`) |

You start with 5 ships. A new ship only materialises once its spawn point is safe:
`SafeHaven` checks `dist < 4687 + 6·|v|` against every collidable object (CL:537).
Holding FIRE and SPECIAL together brings it in early. After a death you wait 50 ticks before the next ship appears.

## Ship (CL:942–1414)

The five Players-dialog sliders always sum to `SpecLimit·5/2 = 5120`
(`SpecLimit = 2048`, default 1024 each). Each slider sets one derived constant:

* rotation speed `16 + rot / 128` angle steps per tick
* thrust `(thrust + 2048/6) · (170000/2048) / 640`
* top speed through an attenuation `((2048/5 + speed)² · 8) / 640`
* special strength `ability · (24576/2048)`, which scales the shield capacity (162 at default), the hyperspace safe-search and the disruptor force
* bullet speed `(bullet + 1024) · (1200000/2048) / 640`

Other ship rules:

* At most 4 bullets in flight. Each lives 20 ticks and inherits half the ship's velocity.
* Holding fire auto-repeats like the original keyboard typematic.
* Your own bullets (and other players' bullets unless *Deadly bullets* is on) bounce ships instead of killing them.
* **Specials** (CL:1325 `SetAbility`):
  * *Hyperspace* shrinks the ship away and re-appears at a random safe spot. It recharges for 150 ticks.
  * *Shields* make a bubble with negative mass that bounces everything. It drains 1 per tick plus a share of every hit's mass, recharges 1 every 32 ticks and flickers below 20.
  * *Disruptor* pushes every massive object away by `strength / distance`. The ship flashes in its player colour.
  * *Cloak* makes you invisible to pests and, in multiplayer, to other players. It lasts `strength/50` ticks and breaks when you fire.
* Pests home on the nearest visible ship or saucer, keep away from rocks and each other, and their velocity is damped by 15/16 each tick (CL:747).

## Modes and flow (C:385 `SetGameMode`)

Attract (title) → high-score table ("IMMORTALS") → attract …;
New level → Play → … → Game over → initials entry for each ranking player (top 10) → IMMORTALS.
In tournament mode (2–4 players) there are 7 rounds and 5 lives each, and the last ship flying wins the round
(`TournamentWin`, C:873). Rocks can be off, bouncing, or destructible (RC `DLG_GAME`).

## Original options kept

| Option | Values | Source |
|---|---|---|
| Difficulty | Simple / Challenging / Impossible | RC `DLG_GAME` |
| Fragmented explosions | on (default) | RC `DLG_GAME` |
| Pause when inactive | on (default) | RC `DLG_GAME` |
| Deadly bullets | off (default) | RC `DLG_GAME` |
| Tournament mode | off; rocks: none / bounce / destroy | RC `DLG_GAME` |
| Special per player | None / Hyperspace (default) / Shields / Disruptor / Cloak | CI:141, RC `DLG_PLAYERS` |
| Spec sliders | five, sum held constant, Reset to 1024 | RC `DLG_PLAYERS` |

Default keys follow the original (`CI` `DefGameKeys`):

| Player | Left | Right | Thrust | Fire | Special |
|---|---|---|---|---|---|
| 1 | ← | → | ↑ | Space | Right Ctrl |
| 2 | A | D | S | Left Shift | Left Ctrl |
| 3 | Num 4 | Num 6 | Num 8 | Num 0 | Num 2 |

The original had no default keys for player 4. The remake gives player 4 J / L / I / K / U.

The cheat words are typed during play: PHASEOUT, JUGGER, NUKE and AUTOFIRE (C:1505). Using any of them disables the high-score entry for that game, as in the original.

## Deliberate differences

* Remote play over modem or serial cable, and the update-interval setting, are not included.
* The title screen shows tribute credits and an original "WEB remake" mark in place of the publisher logo.
* Touch controls (virtual stick, FIRE, four special buttons), gamepad support and a 4-special
  mode (Z X C V keys) are additions.
