[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/soedirman566-stack/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/soedirman566-stack/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Coral City Heat

An original open-world crime game that runs entirely in a desktop browser —
no build step, no assets, no network. A hand-written raw-WebGL engine
(matrix math, shaders, geometry builders and canvas-painted textures, all
in `game/js/engine.js` and `game/js/world.js`) renders a procedural sunset
coastal city: a grid of tower blocks with lit windows, palm-lined streets,
a beach and an animated sea.

Coral City, 1987. Marina at the Pier Bar has a job: a crate walked off a
truck at the North Depot. Steal what you need, pick it up against the
clock, and deliver it to the Old Warehouse — quiet, with no heat.

## What's in the city

- **Driving** — arcade car physics (handbrake turns included), traffic AI
  that follows the road grid, brakes and turns at intersections, parked
  cars along every kerb.
- **Car stealing** — hot-wire parked cars or yank drivers out of traffic;
  every crime feeds the 0–5 star wanted system.
- **Police** — Coral City PD spawns, chases, rams and pins you; break
  line of sight to cool the heat, or get **BUSTED** / **WASTED** and wake
  up at Coral General minus a fine.
- **On foot** — third-person movement with mouse-orbit camera, sprint,
  fists and a hitscan pistol, pedestrians who stroll the blocks and flee
  gunfire and bad driving.
- **A three-mission story chain** — meet Marina, run the timed depot
  pickup (which makes you very hot), then deliver only once the stars
  are gone. $1,500 a run, replayable, with free-roam in between.
- **HUD & minimap** — health, cash, wanted stars, objective with live
  distance and timer, speedometer, and a top-down minimap with roads,
  traffic, flashing police blips and the objective marker.
- **Sound, synthesized live** — engine hum, two-tone sirens, gunshots,
  crashes, jingles and a sunset-funk loop. No audio files.
- **Saving** — cash, mission progress, pistol and position persist in
  `localStorage`; Continue picks up where you left off.

## Controls

| Keys | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Mouse | Camera (click the game to lock the pointer) |
| Shift | Sprint |
| E | Enter/exit car, talk, interact |
| Mouse click | Punch or shoot |
| 1 / 2 | Fists / pistol |
| Space | Handbrake |
| P | Pause |
| N | Mute |

## Run it

```sh
node serve.ts          # then open http://localhost:8377/
```

Or serve the `game/` folder with any static file server and open
`index.html`. Deterministic screenshot scenes live in `shots.json`
(e.g. `game/index.html?shot=chase&seed=1`).

## Entry layout

- `main.ts` — copies `game/` + `screenshots/` to the output directory and
  writes `dossier.json` with the vendored make.fun library.
- `game/` — the whole game: `index.html`, `js/engine.js` (WebGL engine),
  `js/world.js` (city generation), `js/audio.js` (synth), `js/game.js`
  (gameplay).
- `screenshots/` — the four staged scenes listed in `shots.json`.
- `vendor/makefun-game.ts` — the competition's dossier library, vendored
  unchanged as supplied.

MIT licensed — see `LICENSE`.
