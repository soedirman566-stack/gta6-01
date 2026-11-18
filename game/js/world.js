// world.js — procedural generation of Coral City: a sunset coastal grid
// of tower blocks, roads, palms, a beach and the open sea. All geometry
// is merged into a handful of static meshes; textures are painted onto
// canvases at boot, so the game ships zero asset files.

import { GeoBuilder, mulberry32, m4ComposeEuler } from './engine.js';

export const LAYOUT = {
  vRoads: [-168, -84, 0, 84, 168],       // x centres of N-S roads
  hRoads: [-168, -84, 0, 84],            // z centres of E-W roads
  roadW: 18,
  blockHalf: 33,                          // half-size of a city block
  beachZ: 118,                            // sand starts here
  oceanZ: 166,                            // water starts here
  cityMin: -215, cityMax: 215,
  barPos: { x: 150, z: 128 },             // Pier Bar (mission contact)
  depotPos: { x: -126, z: -158 },         // north depot (package pickup)
  dropPos: { x: 196, z: -42 },            // old warehouse (delivery)
  hospitalPos: { x: -196, z: 84 },        // respawn point
};

function facadeTexture(rng, base, trim, litRatio) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  // subtle vertical shading
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.18)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  // cornice
  g.fillStyle = trim; g.fillRect(0, 0, 128, 10);
  // windows
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 10 + col * 23, y = 22 + row * 20;
      const lit = rng() < litRatio;
      g.fillStyle = lit ? (rng() < 0.5 ? '#ffd98a' : '#fff3c4') : '#22303e';
      g.fillRect(x, y, 14, 12);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + 10, 14, 2);
    }
  }
  // roof strip painted along the bottom rows (sampled by roof faces)
  g.fillStyle = '#4a423c'; g.fillRect(0, 250, 128, 6);
  return cv;
}

const ROOF_UV = [0.02, 0.005, 0.2, 0.02];
function buildingUV(face) {
  if (face === 'top') return ROOF_UV;
  if (face === 'bot') return ROOF_UV;
  return [0, 0.03, 1, 1];
}

export function buildWorld(renderer, seed) {
  const rng = mulberry32(seed);
  const L = LAYOUT;
  const colliders = [];
  const draws = [];

  // ---- facade textures & building meshes (one merged mesh per texture)
  const palettes = [
    ['#c96f4a', '#8a4630', 0.55], ['#e0cfa8', '#a68d5f', 0.45],
    ['#5f8a8b', '#38585a', 0.6], ['#d9d3c8', '#9a948a', 0.4],
  ];
  const facadeBuilders = palettes.map(() => new GeoBuilder());
  const facadeTexes = palettes.map(([base, trim, lit]) =>
    renderer.canvasTexture(facadeTexture(rng, base, trim, lit)));

  const blockCenters = [];
  for (let i = 0; i < L.vRoads.length - 1; i++) {
    for (let j = 0; j < L.hRoads.length - 1; j++) {
      blockCenters.push({
        cx: (L.vRoads[i] + L.vRoads[i + 1]) / 2,
        cz: (L.hRoads[j] + L.hRoads[j + 1]) / 2,
      });
    }
  }
  // Extra row of blocks south of the last E-W road, before the beach.
  for (let i = 0; i < L.vRoads.length - 1; i++) {
    blockCenters.push({ cx: (L.vRoads[i] + L.vRoads[i + 1]) / 2, cz: 126 - 33 });
  }

  // Keep-clear zones: mission sites and the player start stay open so
  // buildings never swallow Marina, the depot door or the spawn point.
  const CLEAR = [
    { x0: 124, z0: 94, x1: 176, z1: 142 },   // Pier Bar + promenade start
    { x0: -148, z0: -164, x1: -104, z1: -136 }, // North Depot frontage
    { x0: 168, z0: -56, x1: 190, z1: -28 },  // Old Warehouse approach
    { x0: -186, z0: 68, x1: -164, z1: 100 }, // hospital frontage
  ];
  const inClear = (x0, z0, x1, z1) =>
    CLEAR.some((c) => x0 < c.x1 && x1 > c.x0 && z0 < c.z1 && z1 > c.z0);

  const plazaBlocks = new Set([3, 10]); // two blocks stay open as parking/plaza
  blockCenters.forEach((blk, bi) => {
    if (plazaBlocks.has(bi)) return;
    const sub = 3;
    const cell = (L.blockHalf * 2) / sub;
    for (let sx = 0; sx < sub; sx++) {
      for (let sz = 0; sz < sub; sz++) {
        if (rng() < 0.14) continue; // gap: courtyard / alley
        const cx = blk.cx - L.blockHalf + cell * (sx + 0.5) + (rng() - 0.5) * 2;
        const cz = blk.cz - L.blockHalf + cell * (sz + 0.5) + (rng() - 0.5) * 2;
        const w = cell * (0.62 + rng() * 0.24);
        const d = cell * (0.62 + rng() * 0.24);
        const downtown = Math.hypot(blk.cx, blk.cz) < 130;
        const h = downtown ? 22 + rng() * 38 : 10 + rng() * 22;
        const fb = facadeBuilders[(rng() * facadeBuilders.length) | 0];
        if (inClear(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2)) continue;
        fb.box(cx, h / 2, cz, w, h, d, [1, 1, 1], buildingUV);
        colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });
      }
    }
  });
  facadeBuilders.forEach((fb, i) => {
    draws.push({ mesh: renderer.buildMesh(fb), tex: facadeTexes[i] });
  });

  // ---- plain-colour merged geometry: ground, roads, walks, palms, lamps
  const gb = new GeoBuilder();
  const ASPHALT = [0.16, 0.15, 0.17];
  const WALK = [0.62, 0.58, 0.52];
  const GROUND = [0.42, 0.44, 0.36];
  const SAND = [0.93, 0.8, 0.55];
  const DASH = [0.95, 0.8, 0.4];

  // base ground
  gb.groundQuad(-700, -700, 700, L.beachZ, -0.08, GROUND);
  // sand strip and the seabed under the water
  gb.groundQuad(-700, L.beachZ, 700, L.oceanZ, -0.04, SAND);
  gb.groundQuad(-700, L.oceanZ, 700, 720, -1.6, SAND);
  // roads: N-S
  for (const x of L.vRoads) gb.groundQuad(x - 9, -215, x + 9, 116, 0.0, ASPHALT);
  // roads: E-W
  for (const z of L.hRoads) gb.groundQuad(-215, z - 9, 215, z + 9, 0.0, ASPHALT);
  // beachfront promenade road
  gb.groundQuad(-215, 106, 215, 118, 0.0, ASPHALT);
  // lane dashes
  for (const x of L.vRoads) {
    for (let z = -210; z < 110; z += 12) gb.groundQuad(x - 0.35, z, x + 0.35, z + 6, 0.02, DASH);
  }
  for (const z of L.hRoads) {
    for (let x = -210; x < 210; x += 12) gb.groundQuad(x, z - 0.35, x + 6, z + 0.35, 0.02, DASH);
  }
  // sidewalks around each block + promenade walk
  for (const blk of blockCenters) {
    gb.groundQuad(blk.cx - L.blockHalf - 3, blk.cz - L.blockHalf - 3,
      blk.cx + L.blockHalf + 3, blk.cz + L.blockHalf + 3, 0.015, WALK);
  }
  gb.groundQuad(-215, 116, 215, 122, 0.015, WALK);

  // distant headland silhouettes to the north
  const HILL = [0.3, 0.24, 0.36];
  gb.box(-260, 18, -420, 320, 36, 120, HILL);
  gb.box(180, 26, -460, 420, 52, 140, HILL);
  gb.box(-40, 12, -380, 200, 24, 90, HILL);

  // streetlights along the roads
  const POLE = [0.2, 0.2, 0.24];
  const LAMP = [1.3, 1.15, 0.75];
  const lampAt = (x, z) => {
    gb.cylinder(x, 0, z, x, 5.6, z, 0.12, POLE);
    gb.sphere(x, 5.8, z, 0.42, LAMP, 6, 5);
  };
  for (const x of L.vRoads) for (let z = -200; z < 110; z += 42) { lampAt(x - 10.5, z); lampAt(x + 10.5, z + 21); }
  for (const z of L.hRoads) for (let x = -200; x < 210; x += 42) { lampAt(x, z - 10.5); lampAt(x + 21, z + 10.5); }

  // palm trees: promenade rows + scattered in blocks
  const TRUNK = [0.45, 0.33, 0.2];
  const LEAF = [0.16, 0.5, 0.24];
  const palmAt = (x, z, s) => {
    const lean = (rng() - 0.5) * 0.16;
    const topX = x + lean * 8, topZ = z + (rng() - 0.5) * 1.2;
    gb.cylinder(x, 0, z, topX, 6.4 * s, topZ, 0.22 * s, TRUNK, 5);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng() * 0.4;
      const m = m4ComposeEuler(
        topX + Math.cos(a) * 1.4 * s, 6.4 * s - 0.5, topZ + Math.sin(a) * 1.4 * s,
        Math.sin(a) * 0.7, -a, Math.cos(a) * 0.7, 1);
      gb.boxT(m, 3.4 * s, 0.14, 0.8 * s, LEAF);
    }
    gb.sphere(topX, 6.3 * s, topZ, 0.4 * s, TRUNK, 6, 5);
  };
  for (let x = -205; x < 210; x += 17) palmAt(x + (rng() - 0.5) * 4, 124 + (rng() - 0.5) * 3, 0.9 + rng() * 0.35);
  for (let i = 0; i < 26; i++) {
    const blk = blockCenters[(rng() * blockCenters.length) | 0];
    const px2 = blk.cx + (rng() - 0.5) * 56, pz2 = blk.cz + (rng() - 0.5) * 56;
    if (inClear(px2 - 2, pz2 - 2, px2 + 2, pz2 + 2)) continue;
    palmAt(px2, pz2, 0.75 + rng() * 0.3);
  }

  // The Pier Bar: mission contact's place on the promenade.
  const bar = L.barPos;
  gb.box(bar.x, 3, bar.z + 6, 22, 6, 12, [0.55, 0.25, 0.3]);
  gb.box(bar.x, 6.6, bar.z + 6, 24, 1.2, 14, [0.3, 0.16, 0.2]);
  gb.box(bar.x, 4.6, bar.z - 0.6, 16, 1.6, 0.5, [1.25, 0.55, 0.75]); // neon sign slab
  colliders.push({ x0: bar.x - 11, z0: bar.z, x1: bar.x + 11, z1: bar.z + 12 });
  // North depot: a squat warehouse with a roller door.
  const dep = L.depotPos;
  gb.box(dep.x, 4.5, dep.z - 8, 30, 9, 14, [0.5, 0.48, 0.45]);
  gb.box(dep.x, 2.2, dep.z - 0.7, 10, 4.4, 0.6, [0.25, 0.26, 0.3]);
  colliders.push({ x0: dep.x - 15, z0: dep.z - 15, x1: dep.x + 15, z1: dep.z - 1 });
  // Old warehouse: delivery point on the east edge.
  const drop = L.dropPos;
  gb.box(drop.x, 5, drop.z, 14, 10, 26, [0.48, 0.4, 0.34]);
  gb.box(drop.x - 7.4, 2.4, drop.z, 0.6, 4.8, 10, [0.25, 0.26, 0.3]);
  colliders.push({ x0: drop.x - 7, z0: drop.z - 13, x1: drop.x + 7, z1: drop.z + 13 });
  // Hospital block (respawn flavour).
  const hos = L.hospitalPos;
  gb.box(hos.x, 7, hos.z, 20, 14, 20, [0.9, 0.88, 0.85]);
  gb.box(hos.x, 10.5, hos.z - 10.4, 6, 5, 0.6, [0.95, 0.25, 0.25]);
  gb.box(hos.x, 12.2, hos.z - 10.4, 2, 1.6, 0.6, [0.95, 0.25, 0.25]);
  colliders.push({ x0: hos.x - 10, z0: hos.z - 10, x1: hos.x + 10, z1: hos.z + 10 });

  draws.push({ mesh: renderer.buildMesh(gb) });

  // ---- ocean: segmented plane, displaced in the vertex shader
  const og = new GeoBuilder();
  og.groundGrid(0, L.oceanZ + 260, 1400, 540, 56, 20, -0.55, [0.06, 0.36, 0.46]);
  const ocean = renderer.buildMesh(og);

  // ---- golden mission beacon (drawn dynamically, pulses in game.js)
  const bb = new GeoBuilder();
  bb.cylinder(0, 0, 0, 0, 26, 0, 1.1, [1.2, 0.9, 0.25], 10);
  const beacon = renderer.buildMesh(bb);

  return { draws, ocean, beacon, colliders, blockCenters };
}

// Point-in-collider test with a radius (circle vs AABB), returns push-out.
export function collideCircle(colliders, x, z, radius) {
  let px = x, pz = z;
  for (const c of colliders) {
    const nx = Math.max(c.x0, Math.min(px, c.x1));
    const nz = Math.max(c.z0, Math.min(pz, c.z1));
    const dx = px - nx, dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        px = nx + (dx / d) * radius;
        pz = nz + (dz / d) * radius;
      } else {
        // centre inside the box: push out along the smallest penetration
        const left = px - c.x0, right = c.x1 - px;
        const top = pz - c.z0, bot = c.z1 - pz;
        const m = Math.min(left, right, top, bot);
        if (m === left) px = c.x0 - radius;
        else if (m === right) px = c.x1 + radius;
        else if (m === top) pz = c.z0 - radius;
        else pz = c.z1 + radius;
      }
    }
  }
  return [px, pz];
}

export function pointInColliders(colliders, x, z, pad = 0) {
  for (const c of colliders) {
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return true;
  }
  return false;
}
