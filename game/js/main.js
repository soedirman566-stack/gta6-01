// CORAL CITY HEAT — an original mini open-world crime game.
// Third-person on foot + arcade driving, traffic, pedestrians, a 0-5 star
// wanted system with police chases, melee + pistol combat, a 3-mission
// story chain, HUD + minimap, localStorage saves, synth sound, and
// deterministic screenshot scenes (?shot=vista|drive|chase|mission).
import * as THREE from 'three';
import { buildCity, GRID, mulberry32 } from './city.js';
import { SoundEngine } from './audio.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot');
const rng = mulberry32(SEED * 31337 + 5);
const sound = new SoundEngine();

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const world = buildCity(scene, SEED);
const colliders = world.colliders;

// ---------------- helpers ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// circle vs building AABBs; returns corrected position + whether it hit
function collideCircle(x, z, r) {
  let hit = false;
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) {
      const dxl = x - (c.minX - r), dxr = (c.maxX + r) - x;
      const dzl = z - (c.minZ - r), dzr = (c.maxZ + r) - z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) x = c.minX - r; else if (m === dxr) x = c.maxX + r;
      else if (m === dzl) z = c.minZ - r; else z = c.maxZ + r;
      hit = true;
    }
  }
  const E = GRID.extent + 24;
  x = clamp(x, -E, E); z = clamp(z, -E, GRID.waterZ - 2);
  return { x, z, hit };
}

// ---------------- people ----------------
const skinTones = [0xf2c79b, 0xc68863, 0x8a5a3b, 0xffe0bd];
const shirtColors = [0xff5470, 0x4ecdc4, 0xffd23e, 0x95e06c, 0xff9f43, 0xb388ff, 0xf5f5f5, 0x45aaf2];
function makePerson(shirt, pants, skin) {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(shirt));
  torso.position.y = 1.06; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), mat(skin));
  head.position.y = 1.62; g.add(head);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  legGeo.translate(0, -0.36, 0);
  const legL = new THREE.Mesh(legGeo, mat(pants)); legL.position.set(-0.16, 0.72, 0); g.add(legL);
  const legR = new THREE.Mesh(legGeo, mat(pants)); legR.position.set(0.16, 0.72, 0); g.add(legR);
  const armGeo = new THREE.BoxGeometry(0.15, 0.62, 0.17);
  armGeo.translate(0, -0.28, 0);
  const armL = new THREE.Mesh(armGeo, mat(shirt)); armL.position.set(-0.4, 1.36, 0); g.add(armL);
  const armR = new THREE.Mesh(armGeo, mat(shirt)); armR.position.set(0.4, 1.36, 0); g.add(armR);
  g.userData.parts = { legL, legR, armL, armR, torso };
  return g;
}
function animPerson(mesh, phase, amount) {
  const p = mesh.userData.parts;
  const s = Math.sin(phase) * amount;
  p.legL.rotation.x = s; p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
}

// ---------------- cars ----------------
const carColors = [0xd64545, 0x457ad6, 0xf2f2f2, 0x2b2b30, 0xf5a623, 0x7ed321, 0xb065d8, 0x26c6da, 0xec407a];
function makeCarMesh(color, police = false) {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.3), mat(police ? 0xf4f4f4 : color));
  body.position.y = 0.55; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.1), mat(police ? 0x22242a : 0x1c2126));
  cabin.position.set(0, 1.05, -0.15); g.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.2, 4.32), mat(police ? 0x22242a : color));
  stripe.position.y = 0.42; if (police) g.add(stripe);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(0x17181c);
  const wheels = [];
  for (const [wx, wz] of [[-0.9, 1.35], [0.9, 1.35], [-0.9, -1.35], [0.9, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.36, wz); g.add(w); wheels.push(w);
  }
  const lightGeo = new THREE.BoxGeometry(0.5, 0.16, 0.3);
  const hl = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  hl.position.set(0, 0.62, 2.16); hl.scale.x = 1.6; g.add(hl);
  let barR = null, barB = null;
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.4), mat(0x22242a));
    bar.position.set(0, 1.38, -0.15); g.add(bar);
    barR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    barR.position.set(-0.33, 1.4, -0.15); g.add(barR);
    barB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.34), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    barB.position.set(0.33, 1.4, -0.15); g.add(barB);
  }
  g.userData.wheels = wheels;
  g.userData.barR = barR; g.userData.barB = barB;
  return g;
}

function spawnCar(x, z, angle, opts = {}) {
  const police = !!opts.police;
  const mesh = makeCarMesh(opts.color ?? carColors[Math.floor(rng() * carColors.length)], police);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  const car = {
    mesh, x, z, angle, speed: 0, police,
    parked: !!opts.parked, traffic: !!opts.traffic,
    driver: null, health: 100, wp: null, turnCool: 0,
    cruise: 8.5 + rng() * 3.5, dead: false, sirenPhase: rng() * 6,
  };
  mesh.userData.car = car;
  return car;
}

// ---------------- game state ----------------
const G = {
  mode: 'start',           // start | play | pause | over
  cash: 120, health: 100,
  wanted: 0, lastCrime: -99, lastDamage: -99,
  hasPistol: false, objectiveOverride: null,
  missionIdx: 0, chainDone: false, missionPhase: 'go', timer: 0,
  time: 0, bustedMeter: 0, shotCooldown: 0, punchCooldown: 0,
  clockMin: 18 * 60 + 24, saveTick: 0,
};
const player = {
  mesh: makePerson(0x14c8b0, 0x263238, 0xf2c79b),
  x: 20, z: 268, angle: Math.PI, walkPhase: 0, car: null, speedNow: 0,
};
player.mesh.position.set(player.x, 0, player.z);
scene.add(player.mesh);
const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42),
  new THREE.MeshLambertMaterial({ color: 0x111114 }));
gunMesh.position.set(0.42, 1.18, 0.3);
gunMesh.visible = false;
player.mesh.add(gunMesh);

// Sal, the contact at the beach bar
const sal = { mesh: makePerson(0xff9f43, 0xffffff, 0xc68863), x: world.salPos.x, z: world.salPos.z + 1.5, walkPhase: 0 };
sal.mesh.position.set(sal.x, 0, sal.z);
sal.mesh.rotation.y = Math.PI;
scene.add(sal.mesh);

// objective beacon
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(2.3, 2.3, 34, 18, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.33, side: THREE.DoubleSide, depthWrite: false })
);
beacon.visible = false;
scene.add(beacon);

// muzzle flash light
const flash = new THREE.PointLight(0xffc266, 0, 18);
scene.add(flash);

// ---------------- traffic + parked cars + peds ----------------
const cars = [];       // all civilian cars
const cops = [];       // police cars
const peds = [];
const L = GRID.lines;

function lanePoint(lineIdx, along, axis, dirSign) {
  // point on the correct lane of a street; axis 'x' = street runs along x
  const line = L[lineIdx];
  if (axis === 'x') return { x: along, z: line + (dirSign > 0 ? 4.5 : -4.5) };
  return { x: line + (dirSign > 0 ? -4.5 : 4.5), z: along };
}
function nextWaypoint(car) {
  // choose the next intersection ahead and an exit from it
  const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  const alongX = Math.abs(fx) > Math.abs(fz);
  const pos = alongX ? car.x : car.z;
  const dirS = alongX ? Math.sign(fx) : Math.sign(fz);
  const perpLine = alongX ? car.z : car.x;
  // current street line index (closest line to perpendicular coord, ignoring lane offset)
  let li = 0, best = 1e9;
  L.forEach((v, i) => { const d = Math.abs(v - perpLine); if (d < best) { best = d; li = i; } });
  // next intersection index along travel
  let ni = -1;
  for (let i = 0; i < L.length; i++) {
    if ((L[i] - pos) * dirS > 6 && (ni === -1 || Math.abs(L[i] - pos) < Math.abs(L[ni] - pos))) ni = i;
  }
  if (ni === -1) ni = dirS > 0 ? L.length - 1 : 0;
  const inter = L[ni];
  const roll = rng();
  let wp;
  if (roll < 0.55 || (ni === 0 || ni === L.length - 1) && roll < 0.8) {
    // straight: waypoint just past the intersection on the same lane
    wp = alongX ? lanePoint(li, inter + dirS * 26, 'x', dirS) : lanePoint(li, inter + dirS * 26, 'z', dirS);
    wp.axis = alongX ? 'x' : 'z'; wp.dirS = dirS; wp.lineIdx = li;
  } else {
    // turn: exit along the crossing street
    const turnS = roll < 0.78 ? 1 : -1; // right or left relative to travel
    const ndirS = alongX ? (fx > 0 ? turnS : -turnS) : (fz > 0 ? -turnS : turnS);
    wp = alongX ? lanePoint(ni, inter + ndirS * 26, 'z', ndirS) : lanePoint(ni, inter + ndirS * 26, 'x', ndirS);
    wp.axis = alongX ? 'z' : 'x'; wp.dirS = ndirS; wp.lineIdx = ni;
  }
  if (wp.z > GRID.beachZ - 14) { // never route into the beach: bounce back
    wp = alongX ? lanePoint(li, inter - dirS * 26, 'x', -dirS) : lanePoint(li, inter - dirS * 26, 'z', -dirS);
    wp.axis = alongX ? 'x' : 'z'; wp.dirS = -dirS; wp.lineIdx = li;
  }
  car.wp = wp;
}

function spawnTraffic(n) {
  for (let i = 0; i < n; i++) {
    const li = 1 + Math.floor(rng() * 5);
    const axis = rng() < 0.5 ? 'x' : 'z';
    const dirS = rng() < 0.5 ? 1 : -1;
    const along = -200 + rng() * 400;
    const p = lanePoint(li, along, axis, dirS);
    if (p.z > GRID.beachZ - 16) { i--; continue; }
    const angle = axis === 'x' ? (dirS > 0 ? Math.PI / 2 : -Math.PI / 2) : (dirS > 0 ? 0 : Math.PI);
    const car = spawnCar(p.x, p.z, angle, { traffic: true });
    car.speed = car.cruise;
    nextWaypoint(car);
    // a driver inside
    const d = { mesh: makePerson(shirtColors[Math.floor(rng() * shirtColors.length)], 0x37474f, skinTones[Math.floor(rng() * 4)]) };
    d.mesh.visible = false;
    scene.add(d.mesh);
    car.driver = d;
    cars.push(car);
  }
}
function spawnParked(n) {
  const spots = [...world.parkSpots];
  for (let i = 0; i < n && spots.length; i++) {
    const s = spots.splice(Math.floor(rng() * spots.length), 1)[0];
    const c = collideCircle(s.x, s.z, 2.4);
    const car = spawnCar(c.x, c.z, s.angle + (rng() - 0.5) * 0.14, { parked: true });
    cars.push(car);
  }
}
function spawnPeds(n) {
  for (let i = 0; i < n; i++) {
    const mesh = makePerson(shirtColors[Math.floor(rng() * shirtColors.length)], 0x37474f, skinTones[Math.floor(rng() * 4)]);
    // walk the promenade and sidewalks
    let x, z;
    if (rng() < 0.3) { x = -240 + rng() * 480; z = GRID.beachZ + 3 + rng() * 5; }
    else {
      const line = L[Math.floor(rng() * L.length)];
      if (rng() < 0.5) { x = line + (rng() < 0.5 ? 11.3 : -11.3); z = -230 + rng() * 440; }
      else { z = line + (rng() < 0.5 ? 11.3 : -11.3); x = -230 + rng() * 440; }
      if (z > GRID.beachZ - 6) z = GRID.beachZ - 8;
    }
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({ mesh, x, z, angle: rng() * 6.28, tx: x, tz: z, health: 100, dead: false, deadT: 0, fleeT: 0, fleeX: 0, fleeZ: 0, walkPhase: rng() * 6 });
  }
}
spawnTraffic(11);
spawnParked(13);
spawnPeds(26);

// ---------------- input ----------------
const keys = {};
let camYaw = Math.PI, camPitch = 0.32, pointerLocked = false;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyP' && (G.mode === 'play' || G.mode === 'pause')) togglePause();
  if (e.code === 'KeyN') { sound.setMuted(!sound.muted); toast(sound.muted ? 'SOUND OFF' : 'SOUND ON', 900); }
  if (e.code === 'KeyE') interact();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => {
  if (G.mode === 'play' && !SHOT) canvas.requestPointerLock();
});
addEventListener('mousemove', e => {
  if (!pointerLocked || G.mode !== 'play') return;
  camYaw -= e.movementX * 0.0026;
  camPitch = clamp(camPitch + e.movementY * 0.0022, -0.12, 1.1);
});
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
addEventListener('mousedown', e => {
  if (G.mode !== 'play' || e.button !== 0) return;
  if (player.car) return;
  if (dialogue.active) { advanceDialogue(); return; }
  if (G.hasPistol) shoot();
  else punch();
});

// ---------------- wanted / crime ----------------
function crime(amount, x = player.x, z = player.z) {
  // crimes only register if someone could plausibly see them
  G.wanted = clamp(G.wanted + amount, 0, 5);
  G.lastCrime = G.time;
}
const stars = () => (G.wanted <= 0.02 ? 0 : Math.ceil(G.wanted));

function damagePlayer(amount) {
  if (G.mode !== 'play') return;
  G.health -= amount;
  G.lastDamage = G.time;
  document.getElementById('vignette').style.opacity = 0.85;
  if (G.health <= 0) { G.health = 0; gameOver(false); }
}

// ---------------- police ----------------
let copSpawnT = 0;
function spawnCop() {
  // spawn on a street 85-130m away, out of immediate view
  for (let tries = 0; tries < 12; tries++) {
    const a = rng() * Math.PI * 2, d = 85 + rng() * 45;
    let x = clamp(player.x + Math.sin(a) * d, -250, 250);
    let z = clamp(player.z + Math.cos(a) * d, -250, 225);
    // snap to nearest street line on one axis
    const snap = v => L.reduce((p, c) => Math.abs(c - v) < Math.abs(p - v) ? c : p, L[0]);
    if (rng() < 0.5) z = snap(z) + (rng() < 0.5 ? 4.5 : -4.5); else x = snap(x) + (rng() < 0.5 ? 4.5 : -4.5);
    const cop = spawnCar(x, z, Math.atan2(player.x - x, player.z - z), { police: true, color: 0xffffff });
    cop.cruise = 15;
    cops.push(cop);
    return;
  }
}
function updateCops(dt) {
  const want = stars();
  const target = want === 0 ? 0 : Math.min(2 + want * 2, 9);
  copSpawnT -= dt;
  if (cops.length < target && copSpawnT <= 0) { spawnCop(); copSpawnT = 1.6; }
  let anyNear = false;
  for (let i = cops.length - 1; i >= 0; i--) {
    const cop = cops[i];
    if (cop === player.car) continue; // a stolen cruiser is driven by the player
    const d = dist2(cop.x, cop.z, player.x, player.z);
    if (want === 0 && d > 130) { scene.remove(cop.mesh); cops.splice(i, 1); continue; }
    if (d < 60) anyNear = true;
    // pursuit steering
    const desired = Math.atan2(player.x - cop.x, player.z - cop.z);
    cop.angle = angleLerp(cop.angle, desired, dt * 1.5);
    const topSpeed = player.car ? 33 : 21;
    let sp = topSpeed;
    if (d < 7) sp = topSpeed * 0.35;             // box-in: don't overshoot
    if (want === 0) sp = 10;                      // cooling off: fall back
    cop.speed = lerp(cop.speed, sp, dt * (cop.speed < sp ? 0.55 : 1.6));
    cop.x += Math.sin(cop.angle) * cop.speed * dt;
    cop.z += Math.cos(cop.angle) * cop.speed * dt;
    const before = { x: cop.x, z: cop.z };
    const res = collideCircle(cop.x, cop.z, 2.1);
    cop.x = res.x; cop.z = res.z;
    if (res.hit) cop.speed *= 0.55;
    // ram the player's car / run at the player
    if (player.car && dist2(cop.x, cop.z, player.car.x, player.car.z) < 3.4) {
      const impact = Math.abs(cop.speed - player.car.speed);
      if (impact > 6) { sound.crash(true); damagePlayer(impact * 0.55); player.car.speed *= 0.5; }
      cop.speed *= 0.4;
    } else if (!player.car && d < 2.6 && cop.speed > 7) {
      damagePlayer(cop.speed * 1.1); sound.crash(true); cop.speed *= 0.3;
    }
    cop.mesh.position.set(cop.x, 0, cop.z);
    cop.mesh.rotation.y = cop.angle;
    spinWheels(cop, dt);
    // light bar strobing
    const ph = Math.floor(G.time * 6 + cop.sirenPhase) % 2 === 0;
    if (cop.mesh.userData.barR) {
      cop.mesh.userData.barR.visible = ph;
      cop.mesh.userData.barB.visible = !ph;
    }
    void before;
  }
  sound.siren(anyNear && want > 0);
  // wanted decay when unseen
  const seen = cops.some(c => c !== player.car && dist2(c.x, c.z, player.x, player.z) < 55);
  if (!seen && G.time - G.lastCrime > 6 && G.wanted > 0) {
    G.wanted = Math.max(0, G.wanted - dt * 0.09);
  }
  // busted logic
  if (want > 0 && G.mode === 'play') {
    let threat = false;
    if (!player.car) {
      threat = cops.some(c => dist2(c.x, c.z, player.x, player.z) < 4.6) && player.speedNow < 1.2;
    } else {
      const near = cops.filter(c => c !== player.car && dist2(c.x, c.z, player.car.x, player.car.z) < 8).length;
      threat = near >= 2 && Math.abs(player.car.speed) < 3;
    }
    G.bustedMeter = threat ? G.bustedMeter + dt : Math.max(0, G.bustedMeter - dt * 1.5);
    if (G.bustedMeter > 3) gameOver(true);
  } else G.bustedMeter = Math.max(0, G.bustedMeter - dt);
}

// ---------------- combat ----------------
const raycaster = new THREE.Raycaster();
function shoot() {
  if (G.time < G.shotCooldown || dialogue.active) return;
  G.shotCooldown = G.time + 0.24;
  sound.gunshot();
  flash.position.copy(player.mesh.position).add(new THREE.Vector3(0, 1.5, 0));
  flash.intensity = 26;
  crime(0.35);
  // hitscan along camera centre
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const ray = raycaster.ray;
  let bestT = 90, hitPed = null, hitCar = null;
  const testSphere = (x, y, z, r) => {
    const oc = new THREE.Vector3(x - ray.origin.x, y - ray.origin.y, z - ray.origin.z);
    const t = oc.dot(ray.direction);
    if (t < 0 || t > bestT) return undefined;
    const d2v = oc.lengthSq() - t * t;
    if (d2v >= r * r) return undefined;
    bestT = t;
    return t;
  };
  for (const p of peds) {
    if (p.dead) continue;
    if (testSphere(p.x, 1.1, p.z, 0.85) !== undefined) hitPed = p;
  }
  for (const c of [...cars, ...cops]) {
    if (testSphere(c.x, 0.8, c.z, 2.3) !== undefined) { hitCar = c; hitPed = null; }
  }
  if (hitPed) hurtPed(hitPed, 34, true);
  else if (hitCar) {
    hitCar.health -= 12;
    if (hitCar.police) crime(0.8);
    sound.crash(false);
  }
  // nearby peds panic
  for (const p of peds) if (!p.dead && dist2(p.x, p.z, player.x, player.z) < 26) flee(p, player.x, player.z);
}
function punch() {
  if (G.time < G.punchCooldown) return;
  G.punchCooldown = G.time + 0.38;
  sound.punch();
  player.mesh.userData.parts.armR.rotation.x = -2.2;
  setTimeout(() => { player.mesh.userData.parts.armR.rotation.x = 0; }, 130);
  const fx = Math.sin(player.angle), fz = Math.cos(player.angle);
  for (const p of peds) {
    if (p.dead) continue;
    const dx = p.x - player.x, dz = p.z - player.z;
    if (Math.hypot(dx, dz) < 2.3 && dx * fx + dz * fz > 0.4) {
      hurtPed(p, 40, false);
      p.x += dx * 0.4; p.z += dz * 0.4;
      return;
    }
  }
}
function flee(p, fromX, fromZ) { p.fleeT = 2.6; p.fleeX = fromX; p.fleeZ = fromZ; }
function hurtPed(p, dmg, byShot) {
  p.health -= dmg;
  flee(p, player.x, player.z);
  if (p.health <= 0 && !p.dead) {
    p.dead = true; p.deadT = 0;
    crime(byShot ? 1.5 : 1.1);
    p.mesh.rotation.x = -Math.PI / 2;
    p.mesh.position.y = 0.25;
  } else crime(0.4);
}

// ---------------- cars: enter / exit / drive ----------------
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of [...cars, ...cops]) {
    if (c.police && c.dead) continue;
    const d = dist2(c.x, c.z, player.x, player.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function interact() {
  if (G.mode !== 'play') return;
  if (dialogue.active) { advanceDialogue(); return; }
  if (player.car) { exitCar(); return; }
  const car = nearestCar(3.6);
  if (car) enterCar(car);
}
function enterCar(car) {
  sound.door();
  if (car.driver) {
    // pull the driver out — a robbery
    const d = car.driver;
    car.driver = null;
    d.mesh.visible = true;
    d.mesh.position.set(car.x + 2, 0, car.z);
    const p = { mesh: d.mesh, x: car.x + 2, z: car.z, angle: 0, tx: car.x, tz: car.z, health: 100, dead: false, deadT: 0, fleeT: 3, fleeX: player.x, fleeZ: player.z, walkPhase: 0 };
    peds.push(p);
    crime(1.1);
    toast('CAR JACKED!', 1100);
  } else if (car.parked) {
    crime(0.9);
    toast('STOLEN', 900);
  }
  car.parked = false; car.traffic = false;
  player.car = car;
  player.mesh.visible = false;
  sound.engine(true, 0);
}
function exitCar() {
  const car = player.car;
  if (!car) return;
  sound.door();
  sound.engine(false);
  const side = { x: car.x + Math.cos(car.angle) * 2.2, z: car.z - Math.sin(car.angle) * 2.2 };
  const res = collideCircle(side.x, side.z, 0.5);
  player.x = res.x; player.z = res.z;
  player.car = null;
  player.mesh.visible = true;
  car.parked = true;
  car.speed = 0;
}
function spinWheels(car, dt) {
  const w = car.mesh.userData.wheels;
  if (!w) return;
  const r = car.speed * dt / 0.36;
  for (const wheel of w) wheel.rotation.x += r;
}
function updatePlayerCar(dt) {
  const car = player.car;
  if (!car) return;
  const fwdIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const steerIn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const hb = keys.Space;
  if (fwdIn > 0) car.speed += 15 * dt * (1 - Math.max(0, car.speed) / 40);
  else if (fwdIn < 0) car.speed -= (car.speed > 0.5 ? 22 : 7) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 3.2 * dt);
  if (hb) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
  car.speed = clamp(car.speed, -11, 39);
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 5.5);
  car.angle += steerIn * 1.65 * steerAuthority * dt * (car.speed >= 0 ? 1 : -1) * (hb ? 1.45 : 1);
  const ox = car.x, oz = car.z;
  car.x += Math.sin(car.angle) * car.speed * dt;
  car.z += Math.cos(car.angle) * car.speed * dt;
  const res = collideCircle(car.x, car.z, 2.15);
  if (res.hit) {
    const impact = Math.abs(car.speed);
    if (impact > 9) { sound.crash(true); damagePlayer((impact - 8) * 0.7); }
    else if (impact > 3.5) sound.crash(false);
    car.speed *= -0.18;
  }
  car.x = res.x; car.z = res.z;
  // car vs car
  for (const o of [...cars, ...cops]) {
    if (o === car) continue;
    const d = dist2(car.x, car.z, o.x, o.z);
    if (d < 3.6 && d > 0.001) {
      const push = (3.6 - d) / 2;
      const nx = (o.x - car.x) / d, nz = (o.z - car.z) / d;
      o.x += nx * push; o.z += nz * push;
      car.x -= nx * push; car.z -= nz * push;
      if (Math.abs(car.speed) > 6) { sound.crash(false); o.health -= 8; crime(0.35); }
      car.speed *= 0.72;
      o.speed = (o.speed || 0) * 0.5;
    }
  }
  // running over pedestrians
  for (const p of peds) {
    if (p.dead) continue;
    if (Math.abs(car.speed) > 3 && dist2(car.x, car.z, p.x, p.z) < 2.2) {
      hurtPed(p, 100, false);
      sound.crash(false);
      car.speed *= 0.82;
    }
  }
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
  spinWheels(car, dt);
  player.x = car.x; player.z = car.z; player.angle = car.angle;
  sound.engine(true, Math.abs(car.speed) / 39);
  void ox; void oz;
}

// ---------------- traffic + peds update ----------------
function obstacleAhead(car, range) {
  const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  const test = (x, z, otherSpeed) => {
    const dx = x - car.x, dz = z - car.z;
    const ahead = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    if (ahead > 0.5 && ahead < range && Math.abs(side) < 2.1) return { ahead, otherSpeed };
    return null;
  };
  for (const o of cars) {
    if (o === car || o.parked) continue;
    const r = test(o.x, o.z, o.speed);
    if (r) return r;
  }
  if (player.car && player.car !== car) { const r = test(player.car.x, player.car.z, player.car.speed); if (r) return r; }
  if (!player.car) { const r = test(player.x, player.z, 0); if (r) return r; }
  for (const p of peds) {
    if (p.dead) continue;
    const r = test(p.x, p.z, 0);
    if (r) return r;
  }
  return null;
}
function updateTraffic(dt) {
  for (const car of cars) {
    if (!car.traffic || car === player.car) continue;
    const obs = obstacleAhead(car, 11);
    let target = car.cruise;
    if (obs) target = Math.min(target, obs.otherSpeed * clamp((obs.ahead - 3) / 7, 0, 1));
    car.speed = lerp(car.speed, target, dt * (target < car.speed ? 3.2 : 0.8));
    if (car.wp) {
      const desired = Math.atan2(car.wp.x - car.x, car.wp.z - car.z);
      car.angle = angleLerp(car.angle, desired, dt * 1.35);
      if (dist2(car.x, car.z, car.wp.x, car.wp.z) < 6) nextWaypoint(car);
    }
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += Math.cos(car.angle) * car.speed * dt;
    const res = collideCircle(car.x, car.z, 2.1);
    car.x = res.x; car.z = res.z;
    if (res.hit) car.speed *= 0.5;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.angle;
    spinWheels(car, dt);
  }
}
function updatePeds(dt) {
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i];
    if (p.dead) {
      p.deadT += dt;
      if (p.deadT > 7) { scene.remove(p.mesh); peds.splice(i, 1); }
      continue;
    }
    let speed = 0, mx = 0, mz = 0;
    if (p.fleeT > 0) {
      p.fleeT -= dt;
      const dx = p.x - p.fleeX, dz = p.z - p.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d; speed = 5.4;
    } else {
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        // new stroll target along the sidewalks / promenade
        if (rng() < 0.35) { p.tx = clamp(p.x + (rng() - 0.5) * 160, -250, 250); p.tz = GRID.beachZ + 3 + rng() * 5; }
        else {
          const line = L[Math.floor(rng() * L.length)];
          if (rng() < 0.5) { p.tx = line + (rng() < 0.5 ? 11.3 : -11.3); p.tz = clamp(p.z + (rng() - 0.5) * 170, -235, GRID.beachZ - 8); }
          else { p.tz = line + (rng() < 0.5 ? 11.3 : -11.3); p.tx = clamp(p.x + (rng() - 0.5) * 170, -250, 250); if (p.tz > GRID.beachZ - 6) p.tz = GRID.beachZ - 8; }
        }
      } else { mx = dx / d; mz = dz / d; speed = 1.7; }
    }
    // flee from cars mounting the sidewalk
    if (speed > 0) {
      p.x += mx * speed * dt; p.z += mz * speed * dt;
      const res = collideCircle(p.x, p.z, 0.45);
      p.x = res.x; p.z = res.z;
      p.angle = angleLerp(p.angle, Math.atan2(mx, mz), dt * 8);
      p.walkPhase += dt * speed * 2.4;
      animPerson(p.mesh, p.walkPhase, speed > 3 ? 0.75 : 0.5);
    }
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.angle;
  }
  // Sal idles at the bar
  sal.mesh.rotation.y = Math.PI + Math.sin(G.time * 0.6) * 0.3;
}

// ---------------- dialogue ----------------
const dialogue = { active: false, name: '', lines: [], idx: 0, timer: 0, onDone: null };
function showDialogue(name, lines, onDone = null) {
  dialogue.active = true; dialogue.name = name; dialogue.lines = lines;
  dialogue.idx = 0; dialogue.timer = 5; dialogue.onDone = onDone;
  renderDialogue();
}
function renderDialogue() {
  const box = document.getElementById('dialogue');
  box.classList.remove('hidden');
  document.getElementById('dlgname').textContent = dialogue.name;
  document.getElementById('dlgtext').textContent = dialogue.lines[dialogue.idx];
}
function advanceDialogue() {
  if (!dialogue.active) return;
  sound.click();
  dialogue.idx++;
  dialogue.timer = 5;
  if (dialogue.idx >= dialogue.lines.length) {
    dialogue.active = false;
    document.getElementById('dialogue').classList.add('hidden');
    const f = dialogue.onDone; dialogue.onDone = null;
    if (f) f();
  } else renderDialogue();
}
function updateDialogue(dt) {
  if (!dialogue.active) return;
  dialogue.timer -= dt;
  if (dialogue.timer <= 0) advanceDialogue();
}

// ---------------- missions ----------------
const PICKUP = { x: -158, z: 80.5 };
const DROP = { x: 80, z: -84 };
function missionTarget() {
  if (G.missionIdx === 0 || G.missionIdx === 3) return { x: world.salPos.x, z: world.salPos.z + 2 };
  if (G.missionIdx === 1) return PICKUP;
  if (G.missionIdx === 2) return DROP;
  return null;
}
function startSalDialogue() {
  showDialogue('SAL', [
    'You must be the new wheel I ordered. Name\'s Sal. I run this bar, and half the favours in Coral City.',
    'City eats couriers alive, kid. Take this pistol — the PD here shoot paperwork first, questions later.',
    'First job: a package is waiting across town, north-west docks side. Grab it before my buyer walks. Move!',
  ], () => {
    G.hasPistol = true;
    gunMesh.visible = true;
    G.cash += 50;
    G.missionIdx = 1;
    G.timer = 150;
    toast('THE PACKAGE — $50 up front', 2200);
    sound.pickup();
    saveGame();
  });
}
function updateMissions(dt) {
  const t = missionTarget();
  beacon.visible = !!t;
  if (t) {
    beacon.position.set(t.x, 16, t.z);
    beacon.material.opacity = 0.24 + 0.13 * Math.sin(G.time * 3);
    beacon.rotation.y += dt * 0.5;
  }
  if (!t || dialogue.active) return;
  const d = dist2(player.x, player.z, t.x, t.z);
  if (G.missionIdx === 0 && d < 4.4 && !player.car) startSalDialogue();
  else if (G.missionIdx === 3 && d < 4.4 && !player.car) {
    G.missionIdx = 0;
    toast('Sal waves you over again…', 1500);
  } else if (G.missionIdx === 1) {
    G.timer -= dt;
    if (G.timer <= 0) {
      sound.fail();
      toast('TOO SLOW — buyer nearly walked. Clock reset!', 2200);
      G.timer = 150;
    }
    if (d < 6.5) {
      crime(1.2);
      showDialogue('RADIO', [
        'You got it? Good. Now it\'s hot — every badge in the city just woke up.',
        'Drop it at the garage on the east side. And kid — do NOT roll up with stars lit. Lose the heat first.',
      ], () => { toast('HOT DELIVERY', 1800); });
      G.missionIdx = 2;
      saveGame();
    }
  } else if (G.missionIdx === 2 && d < 7.5) {
    if (G.wanted <= 0.02) {
      G.cash += 1500;
      G.chainDone = true;
      G.missionIdx = 3;
      sound.cashReward();
      toast('STORY COMPLETE — +$1,500', 3200);
      showDialogue('SAL (RADIO)', [
        'Clean drop, clean getaway. That\'s the whole job, kid.',
        'Coral City is yours now. Come by the bar any time — there\'s always another package.',
      ]);
      saveGame();
    }
  }
}

// ---------------- player on foot + camera ----------------
function updatePlayer(dt) {
  if (player.car) { player.speedNow = Math.abs(player.car.speed); return; }
  let mx = 0, mz = 0;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  if (keys.KeyW) { mx += fx; mz += fz; }
  if (keys.KeyS) { mx -= fx; mz -= fz; }
  if (keys.KeyD) { mx += rx; mz += rz; }
  if (keys.KeyA) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = sprint ? 9.6 : 5.6;
  if (len > 0.01) {
    mx /= len; mz /= len;
    player.x += mx * speed * dt;
    player.z += mz * speed * dt;
    const res = collideCircle(player.x, player.z, 0.5);
    player.x = res.x; player.z = res.z;
    player.angle = angleLerp(player.angle, Math.atan2(mx, mz), dt * 11);
    player.walkPhase += dt * speed * 2.1;
    animPerson(player.mesh, player.walkPhase, sprint ? 0.85 : 0.6);
    player.speedNow = speed;
  } else player.speedNow = 0;
  player.mesh.position.set(player.x, 0, player.z);
  player.mesh.rotation.y = player.angle;
  if (G.time - G.lastDamage > 8 && G.health > 0) G.health = Math.min(100, G.health + dt * 2.5);
}
function updateCamera(dt) {
  if (SHOT === 'vista') {
    camera.position.set(128, 44, 332);
    camera.lookAt(-30, 6, 40);
    return;
  }
  if (player.car) {
    const car = player.car;
    const bx = car.x - Math.sin(car.angle) * 10.5;
    const bz = car.z - Math.cos(car.angle) * 10.5;
    const k = 1 - Math.pow(0.0015, dt);
    camera.position.x = lerp(camera.position.x, bx, k);
    camera.position.y = lerp(camera.position.y, 4.3, k);
    camera.position.z = lerp(camera.position.z, bz, k);
    camera.lookAt(car.x + Math.sin(car.angle) * 9, 1.1, car.z + Math.cos(car.angle) * 9);
  } else {
    const cx = player.x + Math.sin(camYaw) * Math.cos(camPitch) * 8.2;
    const cz = player.z + Math.cos(camYaw) * Math.cos(camPitch) * 8.2;
    const cy = 1.7 + Math.sin(camPitch) * 8.2;
    camera.position.set(cx, Math.max(0.7, cy), cz);
    camera.lookAt(player.x, 1.5, player.z);
  }
}

// ---------------- HUD ----------------
const el = id => document.getElementById(id);
let toastUntil = 0;
function toast(text, ms = 1500) {
  el('toast').textContent = text;
  el('toast').classList.remove('hidden');
  toastUntil = performance.now() + ms;
}
const mmCtx = el('minimap').getContext('2d');
function drawMinimap() {
  const s = 188 / 560, cx = 94, cy = 94;
  mmCtx.fillStyle = '#23272e';
  mmCtx.fillRect(0, 0, 188, 188);
  const X = x => cx + (x - player.x) * s;
  const Y = z => cy + (z - player.z) * s;
  // sand + water
  mmCtx.fillStyle = '#c9ae74';
  mmCtx.fillRect(0, Y(GRID.beachZ), 188, 188 - Y(GRID.beachZ));
  mmCtx.fillStyle = '#14606e';
  mmCtx.fillRect(0, Y(GRID.waterZ), 188, 188 - Y(GRID.waterZ));
  // roads
  mmCtx.fillStyle = '#4a5058';
  for (const v of L) {
    mmCtx.fillRect(X(v - GRID.roadHalf), 0, GRID.roadHalf * 2 * s, 188);
    mmCtx.fillRect(0, Y(v - GRID.roadHalf), 188, GRID.roadHalf * 2 * s);
  }
  // objective
  const t = missionTarget();
  if (t) {
    mmCtx.fillStyle = '#ffd23e';
    mmCtx.beginPath();
    mmCtx.arc(clamp(X(t.x), 8, 180), clamp(Y(t.z), 8, 180), 5 + Math.sin(G.time * 5) * 1.2, 0, 7);
    mmCtx.fill();
  }
  // cars + cops + peds
  mmCtx.fillStyle = '#e8e8e8';
  for (const c of cars) { if (Math.abs(c.x - player.x) < 270 && Math.abs(c.z - player.z) < 270) mmCtx.fillRect(X(c.x) - 2, Y(c.z) - 2, 4, 4); }
  for (const c of cops) {
    mmCtx.fillStyle = Math.floor(G.time * 5) % 2 ? '#ff4040' : '#4e9bff';
    mmCtx.fillRect(X(c.x) - 2.5, Y(c.z) - 2.5, 5, 5);
  }
  mmCtx.fillStyle = 'rgba(200,200,200,0.6)';
  for (const p of peds) { if (!p.dead && Math.abs(p.x - player.x) < 270 && Math.abs(p.z - player.z) < 270) mmCtx.fillRect(X(p.x) - 1, Y(p.z) - 1, 2, 2); }
  // player arrow
  const a = player.car ? player.car.angle : player.angle;
  mmCtx.save();
  mmCtx.translate(cx, cy);
  mmCtx.rotate(Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI);
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -7); mmCtx.lineTo(4.6, 5); mmCtx.lineTo(-4.6, 5); mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();
}
function updateHUD() {
  el('cash').textContent = '$' + G.cash.toLocaleString('en-US');
  el('healthbar').style.width = G.health + '%';
  const st = stars();
  el('stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= st ? 'lit' : ''}">★</span>`).join('');
  const t = missionTarget();
  const d = t ? Math.round(dist2(player.x, player.z, t.x, t.z)) : 0;
  let obj = '';
  if (G.missionIdx === 0) obj = `Meet <b>Sal</b> at the beach bar — ${d}m`;
  else if (G.missionIdx === 1) obj = `Pick up the <b>package</b> across town — <span id="timer">${Math.max(0, Math.ceil(G.timer))}s</span> — ${d}m`;
  else if (G.missionIdx === 2) obj = G.wanted > 0.02
    ? `Deliver the package — <b>lose the heat first!</b> — ${d}m`
    : `Deliver the package to the east garage — ${d}m`;
  else obj = `Free roam — Sal at the beach bar has more work — ${d}m`;
  if (G.objectiveOverride) obj = G.objectiveOverride;
  el('objective').innerHTML = obj;
  if (player.car) {
    el('speedo').classList.remove('hidden');
    el('speed').textContent = Math.round(Math.abs(player.car.speed) * 3.6);
  } else el('speedo').classList.add('hidden');
  el('crosshair').classList.toggle('hidden', !(G.hasPistol && !player.car));
  const near = !player.car && nearestCar(3.6);
  el('prompt').classList.toggle('hidden', !near);
  if (near) el('prompt').textContent = 'E — Get in the car';
  const hh = String(Math.floor(G.clockMin / 60) % 24).padStart(2, '0');
  const mmin = String(Math.floor(G.clockMin % 60)).padStart(2, '0');
  el('clock').textContent = `Coral City — ${hh}:${mmin}`;
  if (performance.now() > toastUntil) el('toast').classList.add('hidden');
  drawMinimap();
}

// ---------------- save / load ----------------
const SAVE_KEY = 'coralCityHeatSaveV1';
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, missionIdx: G.missionIdx, chainDone: G.chainDone,
      hasPistol: G.hasPistol, x: player.x, z: player.z,
    }));
  } catch (e) { /* private mode */ }
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s) return false;
    G.cash = s.cash | 0; G.missionIdx = s.missionIdx | 0; G.chainDone = !!s.chainDone;
    G.hasPistol = !!s.hasPistol;
    gunMesh.visible = G.hasPistol;
    player.x = +s.x || 20; player.z = +s.z || 268;
    player.mesh.position.set(player.x, 0, player.z);
    return true;
  } catch (e) { return false; }
}

// ---------------- flow: start / pause / over ----------------
function startGame(fromSave) {
  sound.init();
  sound.click();
  if (!fromSave) {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    G.cash = 120; G.missionIdx = 0; G.chainDone = false; G.hasPistol = false;
    gunMesh.visible = false;
    player.x = 20; player.z = 268;
    player.mesh.position.set(player.x, 0, player.z);
  }
  G.health = 100; G.wanted = 0; G.bustedMeter = 0;
  el('startscreen').classList.add('hidden');
  el('statescreen').classList.add('hidden');
  el('hud').classList.remove('hidden');
  G.mode = 'play';
}
function togglePause() {
  if (G.mode === 'play') {
    G.mode = 'pause';
    el('pausescreen').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    saveGame();
  } else if (G.mode === 'pause') {
    G.mode = 'play';
    el('pausescreen').classList.add('hidden');
  }
}
function gameOver(busted) {
  G.mode = 'over';
  sound.engine(false); sound.siren(false); sound.fail();
  if (document.pointerLockElement) document.exitPointerLock();
  el('bigstate').textContent = busted ? 'BUSTED' : 'WASTED';
  el('bigstate').className = busted ? 'busted' : 'wasted';
  el('statesub').textContent = busted
    ? 'Coral City PD slaps the cuffs on. Bail and "fees" will cost you $150.'
    : 'You wake up outside Coral General with a headache and a bill.';
  el('statescreen').classList.remove('hidden');
}
function respawn() {
  sound.click();
  if (player.car) { player.car = null; player.mesh.visible = true; }
  const wasBusted = el('bigstate').textContent === 'BUSTED';
  if (wasBusted) {
    G.cash = Math.max(0, G.cash - 150);
    player.x = 84; player.z = 84;
  } else {
    G.cash = Math.max(0, Math.floor(G.cash * 0.9));
    player.x = world.hospitalPos.x; player.z = world.hospitalPos.z;
  }
  player.mesh.position.set(player.x, 0, player.z);
  G.health = 100; G.wanted = 0; G.bustedMeter = 0;
  for (const c of cops) scene.remove(c.mesh);
  cops.length = 0;
  el('statescreen').classList.add('hidden');
  G.mode = 'play';
  saveGame();
}
el('btnnew').addEventListener('click', () => startGame(false));
el('btncontinue').addEventListener('click', () => { loadSave(); startGame(true); });
el('btnresume').addEventListener('click', togglePause);
el('btnrestart').addEventListener('click', () => location.reload());
el('btnrespawn').addEventListener('click', respawn);
if (loadSave()) el('btncontinue').classList.remove('hidden');

// ---------------- screenshot staging ----------------
function stageShot() {
  el('startscreen').classList.add('hidden');
  el('hud').classList.remove('hidden');
  G.mode = 'play';
  if (SHOT === 'vista') {
    player.x = 52; player.z = 247; player.angle = 2.6;
    player.mesh.position.set(player.x, 0, player.z);
    el('objective').style.display = 'none';
  } else if (SHOT === 'drive' || SHOT === 'chase') {
    const chase = SHOT === 'chase';
    const car = spawnCar(chase ? -26 : 8, 80.5, Math.PI / 2, { color: 0xd64545 });
    cars.push(car);
    player.car = car;
    player.mesh.visible = false;
    car.speed = chase ? 23 : 15;
    player.x = car.x; player.z = car.z; player.angle = car.angle;
    camera.position.set(car.x - 10.5, 4.3, car.z);
    const ahead = spawnCar(car.x + 34, 80.5, Math.PI / 2, { color: 0x457ad6, traffic: true });
    ahead.speed = 9; cars.push(ahead);
    const oncoming = spawnCar(car.x + 55, 71.5, -Math.PI / 2, { color: 0xf5a623, traffic: true });
    oncoming.speed = 9; cars.push(oncoming);
    if (chase) {
      G.wanted = 3.2;
      // interceptors ahead facing the player + one cruiser pulling alongside
      const copA = spawnCar(car.x + 34, 71.5, -Math.PI / 2, { police: true, color: 0xffffff });
      const copB = spawnCar(car.x + 52, 80.5, -Math.PI / 2, { police: true, color: 0xffffff });
      const copC = spawnCar(car.x + 5, 72.3, Math.PI / 2, { police: true, color: 0xffffff });
      copA.speed = copB.speed = 12; copC.speed = 22;
      cops.push(copA, copB, copC);
      G.objectiveOverride = 'The heat is on — <b>lose the cops!</b>';
    } else {
      G.objectiveOverride = 'Cruise the strip — dinner at <b>Sal\'s</b> by sundown';
    }
  } else if (SHOT === 'mission') {
    player.x = 24.5; player.z = 258.5; player.angle = 0.5;
    player.mesh.position.set(player.x, 0, player.z);
    camYaw = Math.PI + 0.5;
    showDialogue('SAL', ['First job: a package is waiting across town. Grab it before my buyer walks — and take the pistol. You\'ll need it.']);
  }
}

// ---------------- main loop ----------------
const clk = new THREE.Clock();
let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clk.getDelta(), 0.05);
  const t = clk.elapsedTime;
  world.ocean.position.y = -0.5 + Math.sin(t * 0.7) * 0.09;
  if (G.mode === 'play') {
    G.time += dt;
    G.clockMin += dt * 0.5;
    updatePlayer(dt);
    if (!SHOT) updatePlayerCar(dt);
    updateTraffic(dt);
    updatePeds(dt);
    if (!SHOT) updateCops(dt);
    else { // staged cops just strobe
      for (const cop of cops) {
        const ph = Math.floor(G.time * 6 + cop.sirenPhase) % 2 === 0;
        if (cop.mesh.userData.barR) { cop.mesh.userData.barR.visible = ph; cop.mesh.userData.barB.visible = !ph; }
        cop.mesh.position.set(cop.x, 0, cop.z);
        cop.mesh.rotation.y = cop.angle;
      }
    }
    updateMissions(dt);
    updateDialogue(dt);
    flash.intensity = Math.max(0, flash.intensity - dt * 340);
    const vg = el('vignette');
    if (G.time - G.lastDamage > 0.5) vg.style.opacity = G.health < 30 ? 0.4 + 0.2 * Math.sin(G.time * 5) : 0;
    G.saveTick += dt;
    if (G.saveTick > 5) { G.saveTick = 0; saveGame(); }
    updateHUD();
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  if (SHOT && ++frames === 90) window.__shotReady = true;
}
if (SHOT) stageShot();
animate();
