// game.js — Coral City Heat. An original open-world crime game:
// cruise a sunset coastal city, boost cars, run one big job for Marina,
// and shake the Coral City PD. All systems live here: driving, traffic,
// police AI, pedestrians, combat, missions, HUD, minimap and saving.

import {
  Renderer, GeoBuilder, m4Perspective, m4LookAt, m4Compose, m4ComposeEuler,
  m4Multiply, mulberry32,
} from './engine.js';
import { buildWorld, LAYOUT, collideCircle, pointInColliders } from './world.js';
import { SoundFX } from './audio.js';

// ------------------------------------------------------------------ setup
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '7', 10) || 7;

const canvas = document.getElementById('gl');
const renderer = new Renderer(canvas);
const world = buildWorld(renderer, SEED);
const sfx = new SoundFX();
const rng = mulberry32(SEED * 977 + 13);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const $ = (id) => document.getElementById(id);
const hud = $('hud'), objText = $('objtext'), cashEl = $('cash'), starsEl = $('stars');
const healthEl = $('healthbar'), weaponEl = $('weapon'), speedoEl = $('speedo');
const speedNum = $('speednum'), promptEl = $('prompt'), toastEl = $('toast');
const dlgEl = $('dialogue'), dlgWho = $('dlgwho'), dlgLine = $('dlgline');
const minimap = $('minimap').getContext('2d');

// ------------------------------------------------------------------ state
const S = {
  mode: 'menu',           // menu | play | dead | pause
  deadKind: '',           // wasted | busted
  cash: 120,
  hp: 100,
  heat: 0,                // wanted heat 0..10 -> stars = ceil(heat/2)
  unseen: 0,              // seconds since police last saw the player
  dmgT: 0,                // recent-damage vignette strength
  stage: 0,               // mission stage 0..3
  hasPistol: false,
  weapon: 'fist',         // fist | pistol
  timer: 0,               // mission countdown (stage 1)
  time: 0,
  bustMeter: 0,
  dialogue: null,         // { lines: [[who, text]...], i, onDone }
  toastT: 0,
  flashT: 0,
  shotT: 0,
  saveDirty: false,
};

const player = {
  x: 138, z: 104, heading: -0.6, // starts on the promenade by the Pier Bar
  car: null,                      // car object while driving
  punchT: 0,
};

const keys = {};
let camYaw = 2.6, camPitch = 0.32, mouseDX = 0;
let locked = false;

// ---------------------------------------------------------------- meshes
function carMesh(body, opts = {}) {
  const gb = new GeoBuilder();
  const dark = [0.08, 0.08, 0.1];
  const glass = [0.1, 0.16, 0.22];
  gb.box(0, 0.62, 0, 1.8, 0.55, 4.3, body);                    // body
  gb.box(0, 1.08, -0.25, 1.6, 0.5, 2.1, opts.openTop ? body : glass); // cabin
  gb.box(0, 0.42, 2.05, 1.7, 0.28, 0.3, dark);                 // nose trim
  gb.box(0, 0.42, -2.05, 1.7, 0.28, 0.3, dark);                // tail trim
  gb.box(-0.62, 0.68, 2.16, 0.34, 0.16, 0.06, [1.3, 1.2, 0.8]); // headlights
  gb.box(0.62, 0.68, 2.16, 0.34, 0.16, 0.06, [1.3, 1.2, 0.8]);
  gb.box(-0.62, 0.68, -2.16, 0.34, 0.14, 0.06, [1.1, 0.15, 0.15]); // taillights
  gb.box(0.62, 0.68, -2.16, 0.34, 0.14, 0.06, [1.1, 0.15, 0.15]);
  for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    gb.cylinder(wx - 0.16, 0.36, wz, wx + 0.16, 0.36, wz, 0.36, dark, 9);
  }
  if (opts.police) {
    gb.box(0, 0.66, 0.9, 1.84, 0.4, 1.1, [0.12, 0.12, 0.14]);  // black band
    gb.box(0, 0.66, -1.15, 1.84, 0.4, 1.0, [0.12, 0.12, 0.14]);
    gb.box(-0.34, 1.42, -0.25, 0.55, 0.16, 0.5, [1.4, 0.15, 0.15]); // light bar
    gb.box(0.34, 1.42, -0.25, 0.55, 0.16, 0.5, [0.2, 0.4, 1.5]);
  }
  if (opts.spoiler) gb.box(0, 1.05, -2.0, 1.7, 0.1, 0.4, dark);
  return renderer.buildMesh(gb);
}

const CAR_COLORS = [
  [0.85, 0.2, 0.25], [0.2, 0.45, 0.9], [0.95, 0.75, 0.2], [0.9, 0.9, 0.92],
  [0.15, 0.7, 0.5], [0.95, 0.5, 0.15], [0.6, 0.3, 0.75], [0.25, 0.25, 0.3],
];
const carMeshes = CAR_COLORS.map((c, i) => carMesh(c, { spoiler: i % 3 === 0, openTop: i === 5 }));
const policeMesh = carMesh([0.92, 0.92, 0.95], { police: true });

function personMesh(shirt, pants, skin) {
  const gb = new GeoBuilder();
  gb.box(0, 0.45, 0, 0.52, 0.9, 0.3, pants);          // legs
  gb.box(0, 1.18, 0, 0.64, 0.62, 0.36, shirt);        // torso
  gb.box(-0.42, 1.15, 0, 0.18, 0.6, 0.2, shirt);      // arms
  gb.box(0.42, 1.15, 0, 0.18, 0.6, 0.2, shirt);
  gb.sphere(0, 1.74, 0, 0.21, skin, 8, 6);            // head
  gb.box(0, 1.9, 0, 0.44, 0.1, 0.44, [0.12, 0.1, 0.1]); // hair
  return renderer.buildMesh(gb);
}
const playerMesh = personMesh([0.1, 0.65, 0.7], [0.16, 0.14, 0.2], [0.85, 0.62, 0.45]);
const pedPalettes = [
  [[0.9, 0.4, 0.2], [0.2, 0.3, 0.6], [0.95, 0.75, 0.55]],
  [[0.3, 0.8, 0.4], [0.85, 0.85, 0.85], [0.6, 0.42, 0.3]],
  [[0.95, 0.85, 0.3], [0.5, 0.2, 0.5], [0.85, 0.62, 0.45]],
  [[0.4, 0.5, 0.95], [0.3, 0.3, 0.35], [0.45, 0.3, 0.2]],
  [[0.95, 0.5, 0.7], [0.95, 0.95, 0.95], [0.95, 0.75, 0.55]],
];
const pedMeshes = pedPalettes.map(([s, p, k]) => personMesh(s, p, k));
const marinaMesh = personMesh([0.95, 0.3, 0.45], [0.95, 0.9, 0.8], [0.8, 0.55, 0.38]);

const flashMesh = (() => {
  const gb = new GeoBuilder();
  gb.sphere(0, 0, 0, 0.34, [1.6, 1.3, 0.6], 6, 5);
  return renderer.buildMesh(gb);
})();
const gunMesh = (() => {
  const gb = new GeoBuilder();
  gb.box(0, 0, 0, 0.09, 0.16, 0.5, [0.1, 0.1, 0.12]);
  return renderer.buildMesh(gb);
})();

// ------------------------------------------------------------------ cars
const cars = [];       // traffic + parked (stealable)
const police = [];     // active police cars
let carId = 0;

function spawnTrafficCar() {
  const onV = rng() < 0.5;
  const line = onV ? LAYOUT.vRoads[(rng() * LAYOUT.vRoads.length) | 0]
                   : LAYOUT.hRoads[(rng() * LAYOUT.hRoads.length) | 0];
  const dir = rng() < 0.5 ? 1 : -1;
  const s = -190 + rng() * 380;
  const c = {
    id: carId++, kind: 'traffic', axis: onV ? 'v' : 'h', line, dir, s,
    speed: 9 + rng() * 5, mesh: carMeshes[(rng() * carMeshes.length) | 0],
    x: 0, z: 0, heading: 0, hp: 100, dead: false,
  };
  placeTrafficCar(c);
  cars.push(c);
}
function placeTrafficCar(c) {
  const off = 3.4;
  if (c.axis === 'v') { c.x = c.line - off * c.dir; c.z = c.s; c.heading = c.dir > 0 ? 0 : Math.PI; }
  else { c.x = c.s; c.z = c.line + off * c.dir; c.heading = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
}
function spawnParkedCar(x, z, heading) {
  const c = {
    id: carId++, kind: 'parked', x, z, heading, speed: 0,
    mesh: carMeshes[(rng() * carMeshes.length) | 0], hp: 100, dead: false,
  };
  cars.push(c);
  return c;
}
// parked cars along kerbs and in the two plaza blocks
for (const x of LAYOUT.vRoads) {
  for (let i = 0; i < 3; i++) {
    const z = -195 + rng() * 290;
    spawnParkedCar(x + (rng() < 0.5 ? -7.6 : 7.6), z, rng() < 0.5 ? 0 : Math.PI);
  }
}
for (const blk of [world.blockCenters[3], world.blockCenters[10]]) {
  for (let i = 0; i < 4; i++) {
    spawnParkedCar(blk.cx - 20 + i * 12, blk.cz + 18, Math.PI / 2);
  }
}
for (let i = 0; i < 11; i++) spawnTrafficCar();

// ------------------------------------------------------------------ peds
const peds = [];
function pedLoopPoints(blk) {
  const h = LAYOUT.blockHalf - 2;
  return [
    [blk.cx - h, blk.cz - h], [blk.cx + h, blk.cz - h],
    [blk.cx + h, blk.cz + h], [blk.cx - h, blk.cz + h],
  ];
}
function spawnPed() {
  const blk = world.blockCenters[(rng() * world.blockCenters.length) | 0];
  const loop = pedLoopPoints(blk);
  const p = {
    loop, wp: (rng() * 4) | 0, speed: 1.4 + rng() * 0.7,
    x: loop[0][0], z: loop[0][1], heading: 0, hp: 100,
    state: 'walk', fleeT: 0, deadT: 0, bob: rng() * 6,
    mesh: pedMeshes[(rng() * pedMeshes.length) | 0],
  };
  peds.push(p);
  return p;
}
for (let i = 0; i < 18; i++) spawnPed();
// Marina stands outside her bar.
const marina = { x: LAYOUT.barPos.x - 4, z: LAYOUT.barPos.z - 3, heading: 2.6, mesh: marinaMesh };

// ------------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyN') { sfx.init(); sfx.setMuted(!sfx.muted); toast(sfx.muted ? 'SOUND OFF' : 'SOUND ON'); }
  if (e.code === 'KeyP' && (S.mode === 'play' || S.mode === 'pause')) togglePause();
  if (e.code === 'Digit1') setWeapon('fist');
  if (e.code === 'Digit2') setWeapon('pistol');
  if (e.code === 'KeyE') interact();
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => {
  sfx.init();
  if (S.mode === 'play' && !player.car && !S.dialogue) attack();
  if (S.mode === 'play' && !locked && !SHOT) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
addEventListener('mousemove', (e) => {
  if (!locked || S.mode !== 'play') return;
  camYaw -= e.movementX * 0.0032;
  camPitch = Math.max(-0.15, Math.min(1.1, camPitch + e.movementY * 0.0028));
});

function setWeapon(w) {
  if (w === 'pistol' && !S.hasPistol) { toast('NO PISTOL — SEE MARINA'); return; }
  S.weapon = w;
}
function togglePause() {
  if (S.mode === 'play') { S.mode = 'pause'; $('paused').classList.remove('hidden'); document.exitPointerLock(); }
  else if (S.mode === 'pause') { S.mode = 'play'; $('paused').classList.add('hidden'); }
}

// ---------------------------------------------------------------- helpers
function toast(text, secs = 2.6) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  S.toastT = secs;
}
function stars() { return S.heat <= 0 ? 0 : Math.min(5, Math.ceil(S.heat / 2)); }
function addHeat(n) {
  S.heat = Math.max(0, Math.min(10, S.heat + n));
  S.saveDirty = true;
}
function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
function markerPos() {
  if (S.stage === 0 || S.stage === 3) return LAYOUT.barPos;
  if (S.stage === 1) return LAYOUT.depotPos;
  return LAYOUT.dropPos;
}

function saveGame() {
  try {
    localStorage.setItem('cch_save_v1', JSON.stringify({
      cash: S.cash, stage: S.stage, hasPistol: S.hasPistol,
      x: player.x, z: player.z,
    }));
  } catch (e) { /* storage unavailable */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem('cch_save_v1');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- combat
function attack() {
  if (S.weapon === 'pistol' && S.hasPistol) {
    sfx.shot();
    S.flashT = 0.07; S.shotT = 0.07;
    addHeat(1.5);
    scarePeds(player.x, player.z, 16);
    // hitscan along the player's facing
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let best = null, bestD = 42;
    const test = (ox, oz, r, obj) => {
      const rx = ox - player.x, rz = oz - player.z;
      const along = rx * fx + rz * fz;
      if (along < 0.5 || along > bestD) return;
      const perp = Math.abs(rx * fz - rz * fx);
      if (perp < r) { best = obj; bestD = along; }
    };
    for (const p of peds) if (p.state !== 'dead') test(p.x, p.z, 1.1, { ped: p });
    for (const c of cars) if (!c.dead) test(c.x, c.z, 2.0, { car: c });
    for (const c of police) test(c.x, c.z, 2.0, { car: c, cop: true });
    if (best) {
      if (best.ped) hurtPed(best.ped, 55);
      else { best.car.hp -= 30; if (best.cop) addHeat(1); sfx.crash(0.4); }
    }
  } else {
    player.punchT = 0.25;
    sfx.punch();
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    for (const p of peds) {
      if (p.state === 'dead') continue;
      const dx = p.x - player.x, dz = p.z - player.z;
      if (Math.hypot(dx, dz) < 2.3 && dx * fx + dz * fz > 0) {
        hurtPed(p, 34);
        addHeat(1.2);
      }
    }
  }
}
function hurtPed(p, dmg) {
  p.hp -= dmg;
  if (p.hp <= 0 && p.state !== 'dead') {
    p.state = 'dead'; p.deadT = 0;
    addHeat(2.5);
    toast('WASTED A CIVILIAN — HEAT RISING');
  } else if (p.state !== 'dead') {
    p.state = 'flee'; p.fleeT = 4;
    p.fleeFrom = { x: player.x, z: player.z };
  }
}
function scarePeds(x, z, r) {
  for (const p of peds) {
    if (p.state === 'walk' && dist2d(p.x, p.z, x, z) < r) {
      p.state = 'flee'; p.fleeT = 3.5; p.fleeFrom = { x, z };
    }
  }
}

// ------------------------------------------------------------- interaction
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of [...cars, ...police]) {
    if (c.dead) continue;
    const d = dist2d(player.x, player.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function interact() {
  if (S.mode !== 'play') return;
  if (S.dialogue) { advanceDialogue(); return; }
  if (player.car) { exitCar(); return; }
  // talk to Marina?
  if (dist2d(player.x, player.z, marina.x, marina.z) < 3.4 && (S.stage === 0 || S.stage === 3)) {
    startDialogue(marinaLines(), () => {
      S.hasPistol = true;
      S.weapon = 'pistol';
      S.stage = 1;
      S.timer = 150;
      toast('PISTOL ACQUIRED');
      sfx.pickup();
      S.saveDirty = true;
    });
    return;
  }
  const c = nearestCar(3.4);
  if (c) enterCar(c);
}
function enterCar(c) {
  if (c.kind === 'traffic') {
    // yank the driver out — he becomes a fleeing pedestrian
    const p = spawnPed();
    p.x = c.x + 2; p.z = c.z; p.state = 'flee'; p.fleeT = 5; p.fleeFrom = { x: c.x, z: c.z };
    c.kind = 'player';
    addHeat(2);
    toast('CAR JACKED!');
  } else if (c.kind === 'parked') {
    c.kind = 'player';
    addHeat(2);
    toast('HOT-WIRED!');
  } else if (c.police) {
    // a stolen cruiser leaves the police fleet and becomes a normal car
    const i = police.indexOf(c);
    if (i >= 0) police.splice(i, 1);
    c.police = false;
    c.kind = 'player';
    cars.push(c);
    addHeat(3);
    toast('YOU STOLE A COP CAR?!');
  }
  player.car = c;
  c.speed = 0;
  sfx.engineStart();
  scarePeds(c.x, c.z, 10);
}
function exitCar() {
  const c = player.car;
  if (!c) return;
  player.x = c.x + Math.cos(c.heading) * 2.2;
  player.z = c.z - Math.sin(c.heading) * 2.2;
  player.heading = c.heading;
  if (c.kind === 'player') c.kind = 'parked';
  player.car = null;
  sfx.engineStop();
}

// --------------------------------------------------------------- dialogue
function marinaLines() {
  if (S.stage === 3) {
    return [
      ['MARINA', 'You again. The crate job made us both friends in low places.'],
      ['MARINA', 'Same run is available if you want the exercise — depot, warehouse, no heat. Fifteen hundred.'],
      ['YOU', 'You had me at fifteen hundred.'],
    ];
  }
  return [
    ['MARINA', 'You must be the new wheel in town. I\'m Marina. I run this bar — and half the docks.'],
    ['MARINA', 'A crate walked off a truck up at the North Depot. I need it back before the wrong people open it.'],
    ['YOU', 'And the pay?'],
    ['MARINA', 'Fifteen hundred, clean. Take my spare piece — the depot crew plays rough.'],
    ['MARINA', 'Bring the crate to the Old Warehouse on the east side. And kid… deliver it quiet. No heat.'],
  ];
}
function startDialogue(lines, onDone) {
  S.dialogue = { lines, i: 0, onDone };
  dlgEl.classList.remove('hidden');
  showDlgLine();
}
function showDlgLine() {
  const [who, text] = S.dialogue.lines[S.dialogue.i];
  dlgWho.textContent = who;
  dlgLine.textContent = text;
}
function advanceDialogue() {
  if (!S.dialogue) return;
  sfx.click();
  S.dialogue.i++;
  if (S.dialogue.i >= S.dialogue.lines.length) {
    const done = S.dialogue.onDone;
    S.dialogue = null;
    dlgEl.classList.add('hidden');
    if (done) done();
  } else showDlgLine();
}

// ------------------------------------------------------------- traffic AI
function trafficObstacleAhead(c) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const rx = Math.cos(c.heading), rz = -Math.sin(c.heading);
  let limit = Infinity;
  const test = (ox, oz, ospeed) => {
    const dx = ox - c.x, dz = oz - c.z;
    const along = dx * fx + dz * fz;
    const lat = dx * rx + dz * rz;
    if (along > 2.5 && along < 12 && Math.abs(lat) < 2.4) {
      limit = Math.min(limit, ospeed);
    }
  };
  for (const o of cars) if (o !== c && !o.dead) test(o.x, o.z, o.kind === 'traffic' ? o.speed : 0);
  for (const o of police) test(o.x, o.z, 0);
  if (!player.car) test(player.x, player.z, 0);
  return limit;
}
function updateTrafficCar(c, dt) {
  // intersection decisions
  const crossLines = c.axis === 'v' ? LAYOUT.hRoads : LAYOUT.vRoads;
  const sNow = c.axis === 'v' ? c.z : c.x;
  for (const cl of crossLines) {
    if (Math.abs(sNow - cl) < 2.2) {
      const key = c.axis + ':' + cl;
      if (c.lastTurn !== key) {
        c.lastTurn = key;
        const atEdge =
          (c.axis === 'v' && ((c.dir > 0 && cl === LAYOUT.hRoads[LAYOUT.hRoads.length - 1]) ||
                              (c.dir < 0 && cl === LAYOUT.hRoads[0]))) ||
          (c.axis === 'h' && ((c.dir > 0 && cl === LAYOUT.vRoads[LAYOUT.vRoads.length - 1]) ||
                              (c.dir < 0 && cl === LAYOUT.vRoads[0])));
        if (atEdge || rng() < 0.42) {
          // turn onto the crossing road
          const oldLine = c.line;
          c.axis = c.axis === 'v' ? 'h' : 'v';
          c.line = cl;
          c.s = c.axis === 'h' ? c.x : c.z;
          c.dir = rng() < 0.5 ? 1 : -1;
          // keep s within the new road's span
          c.s = Math.max(-195, Math.min(195, c.s));
          void oldLine;
        }
      }
    }
  }
  const limit = trafficObstacleAhead(c);
  const cruise = 10.5;
  let target = cruise;
  if (limit !== Infinity) target = Math.min(cruise, Math.max(0, limit - 1));
  c.speed += Math.max(-14 * dt, Math.min(7 * dt, target - c.speed));
  c.s += c.speed * dt * c.dir;
  if (c.s > 205) { c.s = 205; c.dir = -1; }
  if (c.s < -205) { c.s = -205; c.dir = 1; }
  placeTrafficCar(c);
}

// -------------------------------------------------------------- police AI
let spawnT = 0;
function spawnPolice() {
  const onV = rng() < 0.5;
  const line = onV ? LAYOUT.vRoads[(rng() * LAYOUT.vRoads.length) | 0]
                   : LAYOUT.hRoads[(rng() * LAYOUT.hRoads.length) | 0];
  let x, z;
  if (onV) { x = line; z = player.z + (rng() < 0.5 ? -75 : 75); z = Math.max(-205, Math.min(105, z)); }
  else { z = line; x = player.x + (rng() < 0.5 ? -75 : 75); x = Math.max(-205, Math.min(205, x)); }
  const c = {
    id: carId++, kind: 'police', police: true, x, z, heading: rng() * 6.28,
    speed: 0, mesh: policeMesh, hp: 140, dead: false, avoidT: 0, avoidDir: 1,
  };
  police.push(c);
}
function updatePolice(dt) {
  const want = stars();
  spawnT -= dt;
  if (police.length < want && spawnT <= 0) { spawnPolice(); spawnT = 2.5; }
  let anyNear = false;
  for (let i = police.length - 1; i >= 0; i--) {
    const c = police[i];
    if (c.staged && player.car) {
      // screenshot dressing: hold a fixed offset from the player's car
      const sh = Math.sin(player.car.heading), ch = Math.cos(player.car.heading);
      c.x = player.car.x + sh * c.oz + ch * c.ox;
      c.z = player.car.z + ch * c.oz - sh * c.ox;
      c.heading = player.car.heading;
      c.speed = player.car.speed;
      continue;
    }
    const tx = player.car ? player.car.x : player.x;
    const tz = player.car ? player.car.z : player.z;
    const d = dist2d(c.x, c.z, tx, tz);
    if (d < 58) anyNear = true;
    if (want === 0 && d > 110) { police.splice(i, 1); continue; }
    // steering
    let desired = Math.atan2(tx - c.x, tz - c.z);
    if (want === 0) desired = c.heading; // no target: cruise off
    c.avoidT -= dt;
    const aheadX = c.x + Math.sin(c.heading) * 7, aheadZ = c.z + Math.cos(c.heading) * 7;
    if (c.avoidT <= 0 && pointInColliders(world.colliders, aheadX, aheadZ, 1.6)) {
      const lx = c.x + Math.sin(c.heading + 0.9) * 8, lz = c.z + Math.cos(c.heading + 0.9) * 8;
      c.avoidDir = pointInColliders(world.colliders, lx, lz, 1.6) ? -1 : 1;
      c.avoidT = 0.45;
    }
    if (c.avoidT > 0) desired = c.heading + c.avoidDir * 1.1;
    const turnRate = 2.4;
    let dh = desired - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, dh));
    const topSpeed = want === 0 ? 12 : 30 + want * 1.6;
    const target = d < 6 ? Math.min(topSpeed, (player.car ? Math.abs(player.car.speed) : 0) + 2) : topSpeed;
    c.speed += Math.max(-16 * dt, Math.min(9 * dt, target - c.speed));
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
    const [nx, nz] = collideCircle(world.colliders, c.x, c.z, 1.6);
    if (nx !== c.x || nz !== c.z) { c.speed *= 0.5; }
    c.x = nx; c.z = nz;
    // contact with the player's car
    if (player.car && dist2d(c.x, c.z, player.car.x, player.car.z) < 3.1) {
      const rel = Math.abs(c.speed - player.car.speed);
      if (rel > 6) { sfx.crash(0.8); damagePlayer(rel * 0.5); }
      player.car.speed *= 0.92; c.speed *= 0.9;
    }
    // running down a player on foot hurts
    if (!player.car && d < 2.3 && Math.abs(c.speed) > 5) {
      damagePlayer(13);
      player.x += Math.sin(c.heading) * 3; player.z += Math.cos(c.heading) * 3;
      sfx.crash(0.7);
      c.speed *= 0.4;
    }
  }
  if (anyNear) S.unseen = 0; else S.unseen += dt;
  if (S.unseen > 6 && S.heat > 0) addHeat(-dt * 0.3);
  // siren follows the nearest unit
  if (police.length && stars() > 0) {
    sfx.sirenStart();
    let nd = 1e9;
    for (const c of police) nd = Math.min(nd, dist2d(c.x, c.z, player.x, player.z));
    sfx.sirenUpdate(nd);
  } else sfx.sirenStop();
  // busted?
  if (S.mode === 'play' && stars() > 0 && !S.dialogue) {
    let pinned = false;
    for (const c of police) {
      if (!player.car && dist2d(c.x, c.z, player.x, player.z) < 4.6) pinned = true;
      if (player.car && Math.abs(player.car.speed) < 2.5 &&
          dist2d(c.x, c.z, player.car.x, player.car.z) < 7.5) pinned = true;
    }
    S.bustMeter = pinned ? S.bustMeter + dt : Math.max(0, S.bustMeter - dt * 1.6);
    if (S.bustMeter > 2.4) die('busted');
  } else S.bustMeter = Math.max(0, S.bustMeter - dt);
}

// ------------------------------------------------------------------ peds
function updatePed(p, dt) {
  if (p.state === 'dead') { p.deadT += dt; return; }
  let tx, tz, speed = p.speed;
  if (p.state === 'flee') {
    p.fleeT -= dt;
    const dx = p.x - (p.fleeFrom ? p.fleeFrom.x : 0), dz = p.z - (p.fleeFrom ? p.fleeFrom.z : 0);
    const l = Math.hypot(dx, dz) || 1;
    tx = p.x + (dx / l) * 10; tz = p.z + (dz / l) * 10;
    speed = 5.2;
    if (p.fleeT <= 0) p.state = 'walk';
  } else {
    const [wx, wz] = p.loop[p.wp];
    tx = wx; tz = wz;
    if (dist2d(p.x, p.z, wx, wz) < 1.2) p.wp = (p.wp + 1) % p.loop.length;
  }
  const dx = tx - p.x, dz = tz - p.z;
  const l = Math.hypot(dx, dz);
  if (l > 0.05) {
    const vx = (dx / l) * speed, vz = (dz / l) * speed;
    let nx = p.x + vx * dt, nz = p.z + vz * dt;
    [nx, nz] = collideCircle(world.colliders, nx, nz, 0.45);
    p.x = nx; p.z = nz;
    p.heading = angleLerp(p.heading, Math.atan2(vx, vz), dt * 8);
  }
  p.bob += dt * speed * 2.4;
  // cars are dangerous
  const threats = player.car ? [player.car, ...police] : police;
  for (const c of threats) {
    if (Math.abs(c.speed) > 4 && dist2d(p.x, p.z, c.x, c.z) < 2.1) {
      hurtPed(p, 100);
      sfx.crash(0.6);
      if (c === player.car) toast('YOU RAN SOMEONE DOWN!');
    }
  }
  if (player.car && Math.abs(player.car.speed) > 6 && dist2d(p.x, p.z, player.car.x, player.car.z) < 7 && p.state === 'walk') {
    p.state = 'flee'; p.fleeT = 2.5; p.fleeFrom = { x: player.car.x, z: player.car.z };
  }
}

// ---------------------------------------------------------------- player
function damagePlayer(n) {
  if (S.mode !== 'play' || SHOT) return; // staged scenes are invulnerable
  S.hp -= n;
  S.dmgT = Math.min(1, S.dmgT + 0.5);
  if (S.hp <= 0) { S.hp = 0; die('wasted'); }
}
function die(kind) {
  if (S.mode === 'dead' || SHOT) return; // staged scenes never end
  S.mode = 'dead';
  S.deadKind = kind;
  $('bigword').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('bigword').style.color = kind === 'busted' ? '#6ab8ff' : '#ff4757';
  $('bigsub').textContent = kind === 'busted'
    ? 'Coral City PD walks you to a cell. The fine stings worse.'
    : 'You wake up outside Coral General, lighter in the wallet.';
  $('dead').classList.remove('hidden');
  sfx.engineStop(); sfx.sirenStop(); sfx.failBuzz();
  document.exitPointerLock();
}
function respawn() {
  const penalty = S.deadKind === 'busted' ? 150 : 200;
  S.cash = Math.max(0, S.cash - penalty);
  S.hp = 100; S.heat = 0; S.bustMeter = 0;
  police.length = 0;
  if (player.car) { player.car.kind = 'parked'; player.car.speed = 0; player.car = null; }
  player.x = LAYOUT.hospitalPos.x + 14; player.z = LAYOUT.hospitalPos.z + 6;
  S.mode = 'play';
  $('dead').classList.add('hidden');
  toast(penalty ? `MEDICAL/FINE: -$${penalty}` : 'BACK ON THE STREETS');
  S.saveDirty = true;
}

function updatePlayer(dt) {
  if (S.dialogue) return;
  if (player.car) {
    const c = player.car;
    let accel = 0, steer = 0;
    if (!S.autoDrive) {
      if (keys.KeyW || keys.ArrowUp) accel = 1;
      if (keys.KeyS || keys.ArrowDown) accel = -0.7;
      if (keys.KeyA || keys.ArrowLeft) steer = 1;
      if (keys.KeyD || keys.ArrowRight) steer = -1;
    } else {
      accel = c.speed < S.autoSpeed ? 0.7 : 0;
    }
    const handbrake = keys.Space && !S.autoDrive;
    const maxF = 33, maxR = -11;
    if (accel > 0) c.speed += 15 * dt * accel;
    else if (accel < 0) c.speed += (c.speed > 0.5 ? -22 : 9 * accel) * dt;
    else c.speed -= c.speed * 0.35 * dt;
    if (handbrake) c.speed -= c.speed * 2.2 * dt;
    c.speed = Math.max(maxR, Math.min(maxF, c.speed));
    if (Math.abs(c.speed) > 0.1) {
      const turn = steer * 0.62 * (handbrake ? 1.7 : 1) * Math.min(1, Math.abs(c.speed) / 9);
      c.heading += turn * dt * (c.speed >= 0 ? 1 : -1) * 1.9;
    }
    const ox = c.x, oz = c.z;
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
    const [nx, nz] = collideCircle(world.colliders, c.x, c.z, 1.7);
    if (nx !== c.x || nz !== c.z) {
      if (Math.abs(c.speed) > 9) { sfx.crash(1); damagePlayer((Math.abs(c.speed) - 8) * 0.8); }
      else if (Math.abs(c.speed) > 3) sfx.crash(0.3);
      c.speed *= -0.3;
      c.x = ox; c.z = oz;
      const [px2, pz2] = collideCircle(world.colliders, ox, oz, 1.7);
      c.x = px2; c.z = pz2;
    }
    // car-car bumps
    for (const o of [...cars, ...police]) {
      if (o === c || o.dead) continue;
      const d = dist2d(c.x, c.z, o.x, o.z);
      if (d < 3.2 && d > 0.01) {
        const push = (3.2 - d) / 2;
        const ux = (o.x - c.x) / d, uz = (o.z - c.z) / d;
        if (o.kind === 'traffic') { /* traffic cars are kinematic; just stop */ }
        else { o.x += ux * push; o.z += uz * push; }
        c.x -= ux * push; c.z -= uz * push;
        if (Math.abs(c.speed) > 6) {
          sfx.crash(0.7);
          addHeat(0.7);
          if (o.police) addHeat(1.2);
          c.speed *= 0.55;
        }
      }
    }
    player.x = c.x; player.z = c.z;
    player.heading = c.heading;
    sfx.engineUpdate(c.speed / 33, true);
    return;
  }
  // on foot
  let mx = 0, mz = 0;
  if (!S.autoDrive) {
    const f = [-Math.sin(camYaw), -Math.cos(camYaw)];
    const r = [Math.cos(camYaw), -Math.sin(camYaw)];
    if (keys.KeyW || keys.ArrowUp) { mx += f[0]; mz += f[1]; }
    if (keys.KeyS || keys.ArrowDown) { mx -= f[0]; mz -= f[1]; }
    if (keys.KeyD || keys.ArrowRight) { mx += r[0]; mz += r[1]; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= r[0]; mz -= r[1]; }
  }
  const moving = Math.hypot(mx, mz) > 0.01;
  if (moving) {
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
    const sp = (keys.ShiftLeft || keys.ShiftRight) ? 9.6 : 5.8;
    let nx = player.x + mx * sp * dt;
    let nz = player.z + mz * sp * dt;
    [nx, nz] = collideCircle(world.colliders, nx, nz, 0.55);
    for (const c of [...cars, ...police]) {
      if (c.dead) continue;
      const d = dist2d(nx, nz, c.x, c.z);
      if (d < 2.0) { nx = player.x; nz = player.z; }
    }
    player.x = Math.max(-230, Math.min(230, nx));
    player.z = Math.max(-230, Math.min(150, nz));
    player.heading = angleLerp(player.heading, Math.atan2(mx, mz), dt * 10);
    player.bob = (player.bob || 0) + dt * sp * 1.6;
  }
  if (player.punchT > 0) player.punchT -= dt;
}

// --------------------------------------------------------------- missions
function updateMissions(dt) {
  const mp = markerPos();
  const d = dist2d(player.x, player.z, mp.x, mp.z);
  if (S.stage === 1) {
    S.timer -= dt;
    if (S.timer <= 0) {
      S.timer = 150;
      toast('TOO SLOW — THE CRATE MOVED. CLOCK RESET.');
      sfx.failBuzz();
    }
    if (d < 10) {
      S.stage = 2;
      S.heat = Math.max(S.heat, 6); // the pickup makes you hot: 3 stars
      toast('PACKAGE SECURED!');
      sfx.pickup();
      S.saveDirty = true;
    }
  } else if (S.stage === 2) {
    if (d < 10 && stars() === 0) {
      S.stage = 3;
      S.cash += 1500;
      toast('JOB DONE — +$1,500');
      sfx.cashJingle();
      S.saveDirty = true;
    }
  }
}

// ---------------------------------------------------------------- camera
const camPos = [140, 4, 118];
function updateCamera(dt) {
  let target, desired;
  if (S.fixedCam) {
    camPos[0] = S.fixedCam.pos[0]; camPos[1] = S.fixedCam.pos[1]; camPos[2] = S.fixedCam.pos[2];
    return S.fixedCam.look;
  }
  if (player.car) {
    const c = player.car;
    target = [c.x + Math.sin(c.heading) * 5, 1.6, c.z + Math.cos(c.heading) * 5];
    desired = [
      c.x - Math.sin(c.heading) * 10.5,
      4.4,
      c.z - Math.cos(c.heading) * 10.5,
    ];
    const k = 1 - Math.exp(-dt * 3.6);
    camPos[0] += (desired[0] - camPos[0]) * k;
    camPos[1] += (desired[1] - camPos[1]) * k;
    camPos[2] += (desired[2] - camPos[2]) * k;
  } else {
    target = [player.x, 1.7, player.z];
    const dist = 7.6;
    desired = [
      player.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
      1.7 + Math.sin(camPitch) * dist,
      player.z + Math.cos(camYaw) * Math.cos(camPitch) * dist,
    ];
    const k = 1 - Math.exp(-dt * 14);
    camPos[0] += (desired[0] - camPos[0]) * k;
    camPos[1] += (desired[1] - camPos[1]) * k;
    camPos[2] += (desired[2] - camPos[2]) * k;
  }
  camPos[1] = Math.max(0.7, camPos[1]);
  return target;
}

// ------------------------------------------------------------------- HUD
let lastStars = -1;
function updateHUD() {
  healthEl.style.width = Math.max(0, S.hp) + '%';
  cashEl.textContent = '$' + S.cash.toLocaleString('en-US');
  weaponEl.textContent = player.car ? 'DRIVING' : (S.weapon === 'pistol' ? 'PISTOL' : 'FISTS');
  const st = stars();
  if (st !== lastStars) {
    lastStars = st;
    starsEl.innerHTML = '★'.repeat(st) + '<span class="off">' + '★'.repeat(5 - st) + '</span>';
  }
  const mp = markerPos();
  const d = Math.round(dist2d(player.x, player.z, mp.x, mp.z));
  let obj = '';
  if (S.stage === 0) obj = `Meet <b>Marina</b> at the Pier Bar — ${d}m`;
  else if (S.stage === 1) obj = `Pick up the package at the North Depot — ${d}m · <span class="timer">${Math.max(0, Math.ceil(S.timer))}s</span>`;
  else if (S.stage === 2) obj = st > 0
    ? `Lose the heat, then deliver to the Old Warehouse — ${d}m`
    : `Deliver the package to the Old Warehouse — ${d}m`;
  else obj = `Free roam. Marina at the Pier Bar has more work — ${d}m`;
  objText.innerHTML = obj;
  // context prompt
  let prompt = '';
  if (S.bustMeter > 0.4 && st > 0) prompt = '⚠ THE COPS HAVE YOU PINNED — MOVE! ⚠';
  else if (!player.car && !S.dialogue) {
    if (dist2d(player.x, player.z, marina.x, marina.z) < 3.4 && (S.stage === 0 || S.stage === 3)) prompt = '<b>E</b> Talk to Marina';
    else {
      const c = nearestCar(3.4);
      if (c) prompt = c.police ? '<b>E</b> Steal the cop car' : (c.kind === 'traffic' ? '<b>E</b> Jack this car' : '<b>E</b> Get in / hot-wire');
    }
  } else if (player.car) prompt = '<b>E</b> Exit car';
  if (prompt) { promptEl.innerHTML = prompt; promptEl.classList.remove('hidden'); }
  else promptEl.classList.add('hidden');
  if (player.car) {
    speedoEl.classList.remove('hidden');
    speedNum.textContent = Math.round(Math.abs(player.car.speed) * 3.6);
  } else speedoEl.classList.add('hidden');
  $('crosshair').classList.toggle('hidden', !(S.weapon === 'pistol' && !player.car && S.mode === 'play'));
  if (S.toastT > 0) { S.toastT -= 1 / 60; if (S.toastT <= 0) toastEl.classList.add('hidden'); }
  $('vignette').style.opacity = Math.min(0.9, S.dmgT).toFixed(2);
}

function drawMinimap() {
  const g = minimap;
  const W = 190;
  const px = (x) => ((x + 240) / 480) * W;
  const py = (z) => ((z + 240) / 500) * W;
  g.fillStyle = '#274b5c'; g.fillRect(0, 0, W, W); // sea base
  g.fillStyle = '#3d4a3a'; g.fillRect(px(-240), py(-240), px(240) - px(-240), py(LAYOUT.beachZ) - py(-240));
  g.fillStyle = '#d9b878'; g.fillRect(px(-240), py(LAYOUT.beachZ), px(240) - px(-240), py(LAYOUT.oceanZ) - py(LAYOUT.beachZ));
  g.fillStyle = '#565d63';
  for (const blk of world.blockCenters) {
    g.fillRect(px(blk.cx - 33), py(blk.cz - 33), (66 / 480) * W, (66 / 500) * W);
  }
  g.strokeStyle = '#22242a'; g.lineWidth = 5;
  for (const x of LAYOUT.vRoads) { g.beginPath(); g.moveTo(px(x), py(-215)); g.lineTo(px(x), py(116)); g.stroke(); }
  for (const z of LAYOUT.hRoads) { g.beginPath(); g.moveTo(px(-215), py(z)); g.lineTo(px(215), py(z)); g.stroke(); }
  const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(px(x), py(z), r, 0, 6.29); g.fill(); };
  for (const c of cars) dot(c.x, c.z, c.kind === 'parked' ? '#9aa0a6' : '#e8e8e8', 2);
  const flash = Math.floor(S.time * 3) % 2 === 0;
  for (const c of police) dot(c.x, c.z, flash ? '#ff3b30' : '#3b82f6', 3);
  const mp = markerPos();
  dot(mp.x, mp.z, '#ffd23e', 3.5 + Math.sin(S.time * 5) * 1.2);
  // player arrow
  const cx = px(player.x), cy = py(player.z);
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI - player.heading);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill();
  g.restore();
}

// ---------------------------------------------------------------- render
function render() {
  const aspect = canvas.width / canvas.height;
  const proj = m4Perspective(1.15, aspect, 0.1, 900);
  const target = updateCamera(0.016);
  const view = m4LookAt(camPos, target, [0, 1, 0]);
  const vp = m4Multiply(proj, view);
  renderer.time = S.time;
  renderer.beginFrame(vp, camPos);
  const I = m4Compose(0, 0, 0, 0, 1, 1, 1);
  for (const d of world.draws) renderer.draw(d.mesh, I, { tex: d.tex });
  renderer.draw(world.ocean, I, { wave: true });
  // mission beacon
  if (S.mode === 'play' || S.mode === 'pause') {
    const mp = markerPos();
    const s = 1 + Math.sin(S.time * 4) * 0.13;
    renderer.draw(world.beacon, m4Compose(mp.x, 0, mp.z, 0, s, 1, s),
      { tint: [0.9 + 0.2 * Math.sin(S.time * 4), 0.9, 0.7] });
  }
  for (const c of cars) if (!c.dead) renderer.draw(c.mesh, m4Compose(c.x, 0, c.z, c.heading, 1, 1, 1));
  for (const c of police) renderer.draw(c.mesh, m4Compose(c.x, 0, c.z, c.heading, 1, 1, 1));
  for (const p of peds) {
    if (p.state === 'dead') {
      if (p.deadT < 9) renderer.draw(p.mesh, m4ComposeEuler(p.x, 0.3, p.z, Math.PI / 2, p.heading, 0, 1));
    } else {
      const bobY = Math.abs(Math.sin(p.bob)) * 0.07;
      renderer.draw(p.mesh, m4Compose(p.x, bobY, p.z, p.heading, 1, 1, 1));
    }
  }
  renderer.draw(marina.mesh, m4Compose(marina.x, 0, marina.z, marina.heading, 1, 1, 1));
  if (!player.car) {
    const lean = player.punchT > 0 ? 0.35 : 0;
    renderer.draw(playerMesh, m4ComposeEuler(player.x, 0, player.z, lean, player.heading, 0, 1));
    if (S.weapon === 'pistol') {
      const gx = player.x + Math.cos(player.heading) * 0.42 + Math.sin(player.heading) * 0.25;
      const gz = player.z - Math.sin(player.heading) * 0.42 + Math.cos(player.heading) * 0.25;
      renderer.draw(gunMesh, m4Compose(gx, 1.22, gz, player.heading, 1, 1, 1));
      if (S.flashT > 0) {
        const fx = player.x + Math.sin(player.heading) * 1.1;
        const fz = player.z + Math.cos(player.heading) * 1.1;
        renderer.draw(flashMesh, m4Compose(fx, 1.3, fz, 0, 1, 1, 1));
      }
    }
  }
}

// ------------------------------------------------------------------ loop
let lastT = performance.now();
let saveT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (S.mode === 'play') {
    S.time += dt;
    updatePlayer(dt);
    for (const c of cars) if (c.kind === 'traffic' && !c.dead) updateTrafficCar(c, dt);
    updatePolice(dt);
    for (const p of peds) updatePed(p, dt);
    // recycle long-dead peds
    for (let i = 0; i < peds.length; i++) {
      if (peds[i].state === 'dead' && peds[i].deadT > 10) { peds.splice(i, 1); spawnPed(); }
    }
    if (!S.dialogue) updateMissions(dt);
    if (S.flashT > 0) S.flashT -= dt;
    if (S.dmgT > 0) S.dmgT = Math.max(0, S.dmgT - dt * 0.7);
    saveT += dt;
    if (S.saveDirty && saveT > 3) { saveGame(); S.saveDirty = false; saveT = 0; }
  } else if (S.mode === 'menu') {
    S.time += dt; // keep the ocean moving behind the menu
  }
  render();
  if (S.mode === 'play' || S.mode === 'pause') { updateHUD(); drawMinimap(); }
}

// ------------------------------------------------------------ game start
function startGame(cont) {
  sfx.init();
  sfx.musicStart();
  $('menu').classList.add('hidden');
  hud.classList.remove('hidden');
  if (cont) {
    const sv = loadGame();
    if (sv) {
      S.cash = sv.cash ?? 120;
      S.stage = sv.stage ?? 0;
      S.hasPistol = !!sv.hasPistol;
      if (S.hasPistol) S.weapon = 'pistol';
      if (typeof sv.x === 'number') { player.x = sv.x; player.z = sv.z; }
      if (S.stage === 1) S.timer = 150;
      if (S.stage === 2) { S.stage = 1; S.timer = 150; } // package run restarts
    }
  }
  S.mode = 'play';
  toast(cont ? 'WELCOME BACK TO CORAL CITY' : 'FIND MARINA AT THE PIER BAR');
}
$('btnNew').addEventListener('click', () => { sfx.click(); startGame(false); });
$('btnContinue').addEventListener('click', () => { sfx.click(); startGame(true); });
$('btnRespawn').addEventListener('click', () => { sfx.init(); respawn(); });
$('btnResume').addEventListener('click', () => togglePause());
if (loadGame()) $('btnContinue').classList.remove('hidden');

// ---------------------------------------------------------- shot staging
if (SHOT) {
  $('menu').classList.add('hidden');
  hud.classList.remove('hidden');
  S.mode = 'play';
  S.noInput = true;
  if (SHOT === 'vista') {
    player.x = 40; player.z = 110; player.heading = 2.8;
    S.fixedCam = { pos: [150, 52, 208], look: [-20, 0, -60] };
    S.hasPistol = true;
  } else if (SHOT === 'drive') {
    const c = spawnParkedCar(-84 - 3.4, -50, 0);
    player.car = c; c.kind = 'player'; c.speed = 13;
    S.autoDrive = true; S.autoSpeed = 13;
    player.x = c.x; player.z = c.z;
    camPos[0] = c.x; camPos[1] = 4.4; camPos[2] = c.z - 12;
  } else if (SHOT === 'chase') {
    const c = spawnParkedCar(84 + 3.4, 26, Math.PI);
    player.car = c; c.kind = 'player'; c.speed = 17;
    S.autoDrive = true; S.autoSpeed = 17;
    S.heat = 8;
    player.x = c.x; player.z = c.z;
    camPos[0] = c.x; camPos[1] = 4.4; camPos[2] = c.z + 12;
    // Staged units hold formation around the player's car (see updatePolice).
    for (const [ox, oz] of [[-4.6, 1], [4.4, -13], [-4.4, 12], [5, 15]]) {
      police.push({
        id: carId++, kind: 'police', police: true, staged: true, ox, oz,
        x: c.x + ox, z: c.z + oz, heading: Math.PI, speed: 17,
        mesh: policeMesh, hp: 140, dead: false, avoidT: 0, avoidDir: 1,
      });
    }
  } else if (SHOT === 'mission') {
    player.x = marina.x + 1.5; player.z = marina.z - 2.5; player.heading = Math.atan2(marina.x - player.x, marina.z - player.z);
    S.fixedCam = { pos: [marina.x - 5.5, 2.3, marina.z - 9], look: [marina.x + 1, 1.2, marina.z + 1] };
    S.dialogue = { lines: marinaLines(), i: 1, onDone: null };
    dlgEl.classList.remove('hidden');
    showDlgLine();
  }
  let frames = 0;
  const iv = setInterval(() => {
    frames++;
    if (frames > 40) { window.__shotReady = true; clearInterval(iv); }
  }, 50);
}

requestAnimationFrame(loop);
