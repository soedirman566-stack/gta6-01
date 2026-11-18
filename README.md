[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/soedirman566-stack/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/soedirman566-stack/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# CORAL CITY HEAT

An original open-world crime game that runs entirely offline in a desktop
browser. One courier, one corrupt coastal city, one long sunset: take jobs
from Sal at the beach bar, steal cars, run a hot package across town, and
lose the Coral City PD before the drop.

Built with three.js (vendored — the game makes no network requests) and
plain WebAudio synthesis for every sound. No assets, no build step.

## The city

A procedural sunset city generated from a seed: a 7×7 street grid with
intersections, crosswalks and lane markings, ~150 buildings with lit
windows, sidewalks, streetlights, palm trees, beach umbrellas, a sand
beach and the ocean. Every building and car collides.

## What you can do

- **On foot** — third-person WASD movement with a mouse-orbit camera,
  sprinting, and collision with the whole city.
- **Drive anything** — press E next to any car to get in. Parked cars are
  hot-wired; traffic cars are taken by pulling the driver out. Arcade
  physics: acceleration, braking, reverse, steering that tightens with
  speed, and a handbrake for sliding turns. Traffic AI cruises the grid,
  turns at intersections and brakes for obstacles.
- **Wanted system** — stealing, shooting, punching and running people
  down earn up to 5 stars. Police cruisers spawn, chase, ram and box you
  in with strobing light bars. Break their line of sight and the heat
  cools. Get pinned and you're **BUSTED**; hit zero health and you're
  **WASTED** — either way you respawn, poorer.
- **Combat** — fists from the start (click or F), and a pistol once Sal
  arms you: hitscan shots with muzzle flash, hit reactions, panicking
  crowds.
- **Story chain** — three linked missions with dialogue, a gold beacon
  and minimap marker: meet Sal → grab a package across town against a
  150-second clock → deliver it only once you've lost the heat, for
  $1,500. Then free-roam, or run Sal's jobs again.
- **HUD** — health bar, cash, wanted stars, objective with distance and
  timer, speedometer, and a live top-down minimap with roads, traffic,
  police blips and the objective marker.
- **Sound** — synthesized engine hum, two-tone sirens, gunshots, punches,
  crashes, reward jingles and a bassline groove. N mutes.
- **Saves** — cash, story progress and position persist in localStorage;
  Continue picks up where you left off.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move / drive |
| Mouse | Orbit camera (click the game to lock the pointer) |
| Shift | Sprint |
| E | Enter / exit car, advance dialogue |
| Mouse click | Punch / shoot |
| F | Punch |
| Space | Handbrake |
| P | Pause |
| N | Mute |

## Run it

The game is static files — serve the folder any way you like:

```sh
node serve.ts 8377
# open http://localhost:8377/game/
```

or just open `game/index.html` through any static host. Deterministic
screenshot scenes live at `game/?shot=vista|drive|chase|mission&seed=1`
(see `shots.json`).

## Entry plumbing

`main.ts` is the make.fun program entrypoint: it copies `game/` and
`screenshots/` into `MAKEFUN_OUTPUT_DIR` (default `/output`) and writes
`dossier.json` using the vendored `vendor/makefun-game.ts` builder.
`vendor/three.module.js` inside `game/` is the three.js r160 module
build, loaded through an import map.

## License

MIT — see `LICENSE`.
