// Coral City — procedural coastal city: street grid, lit buildings, palms,
// streetlights, beach + ocean, all generated from a seed (deterministic).
import * as THREE from 'three';

export const GRID = {
  lines: [-228, -152, -76, 0, 76, 152, 228], // street center lines (x and z)
  roadHalf: 9,                                // half road width
  extent: 266,                                // city ground half-size
  beachZ: 240,                                // sand starts here (south edge)
  waterZ: 294,                                // ocean starts here
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W2P = 2048 / 680; // world metres -> ground texture pixels
const wx = (x) => (x + 340) * W2P;
const wz = (z) => (z + 340) * W2P;

function groundTexture(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d');
  const L = GRID.lines, rh = GRID.roadHalf;
  g.fillStyle = '#33373d'; g.fillRect(0, 0, 2048, 2048); // asphalt everywhere
  // city blocks: sidewalk slab + inner lot
  for (let i = 0; i < L.length - 1; i++) {
    for (let j = 0; j < L.length - 1; j++) {
      const x0 = L[i] + rh, x1 = L[i + 1] - rh, z0 = L[j] + rh, z1 = L[j + 1] - rh;
      g.fillStyle = '#878d94';
      g.fillRect(wx(x0 - 2.5), wz(z0 - 2.5), (x1 - x0 + 5) * W2P, (z1 - z0 + 5) * W2P);
      g.fillStyle = '#494e55';
      g.fillRect(wx(x0), wz(z0), (x1 - x0) * W2P, (z1 - z0) * W2P);
    }
  }
  // beach sand + promenade
  g.fillStyle = '#e3c88f';
  g.fillRect(0, wz(GRID.beachZ), 2048, (340 - GRID.beachZ) * W2P);
  g.fillStyle = '#cbb27f';
  for (let i = 0; i < 2600; i++) g.fillRect(Math.random() * 2048, wz(GRID.beachZ) + Math.random() * 300, 3, 3);
  g.fillStyle = '#d8d3c3';
  g.fillRect(0, wz(GRID.beachZ), 2048, 9 * W2P);
  // lane dashes
  g.fillStyle = '#e8c95a';
  for (const v of L) {
    for (let t = -GRID.extent + 6; t < GRID.extent - 6; t += 12) {
      if (L.some(o => Math.abs(t - o) < 13)) continue;
      g.fillRect(wx(v) - 1.5, wz(t), 3, 6 * W2P);
      if (v < GRID.beachZ - 20) g.fillRect(wx(t), wz(v) - 1.5, 6 * W2P, 3);
    }
  }
  // crosswalks at intersections
  g.fillStyle = 'rgba(240,240,240,0.85)';
  for (const a of L) for (const b of L) {
    if (b > GRID.beachZ - 30) continue;
    for (let s = -7; s <= 7; s += 3.5) {
      g.fillRect(wx(a + s) - 1, wz(b - rh - 2), 2, 4);
      g.fillRect(wx(a + s) - 1, wz(b + rh - 2), 2, 4);
      g.fillRect(wx(a - rh - 2), wz(b + s) - 1, 4, 2);
      g.fillRect(wx(a + rh - 2), wz(b + s) - 1, 4, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function facadeTexture(rng, base, litProb) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      const lit = rng() < litProb;
      g.fillStyle = lit ? (rng() < 0.75 ? '#ffd9a0' : '#bfe3ff') : '#1d2126';
      g.fillRect(8 + x * 14, 10 + y * 15, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(scene, seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const colliders = [];
  const parkSpots = [];

  // ---- sky dome: sunset gradient ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(0.13,0.07,0.27);
          vec3 mid = vec3(0.85,0.32,0.42);
          vec3 hor = vec3(1.0,0.62,0.32);
          vec3 c = h > 0.22 ? mix(mid, top, smoothstep(0.22,0.75,h)) : mix(hor, mid, smoothstep(-0.02,0.22,h));
          gl_FragColor = vec4(c,1.0);
        }`,
    })
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(0xdd7f57, 200, 900);

  const sun = new THREE.DirectionalLight(0xffb37a, 2.4);
  sun.position.set(-260, 150, 190);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffc4a3, 0x3a2b33, 1.05));
  scene.add(new THREE.AmbientLight(0x60455a, 0.7));

  // ---- ground + ocean ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(680, 680),
    new THREE.MeshLambertMaterial({ map: groundTexture(rng) })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 700),
    new THREE.MeshPhongMaterial({ color: 0x14606e, shininess: 120, specular: 0xffca9a })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.5, GRID.waterZ + 348);
  scene.add(ocean);
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 5),
    new THREE.MeshBasicMaterial({ color: 0xfdf3d8, transparent: true, opacity: 0.65 })
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(0, -0.15, GRID.waterZ + 1);
  scene.add(surf);

  // ---- buildings ----
  const facades = [
    facadeTexture(rng, '#6e5a4e', 0.5),
    facadeTexture(rng, '#3d5a66', 0.62),
    facadeTexture(rng, '#74504a', 0.42),
    facadeTexture(rng, '#5d5a70', 0.55),
  ];
  const mats = facades.map(t => new THREE.MeshLambertMaterial({ map: t, emissive: 0xffbe78, emissiveMap: t, emissiveIntensity: 0.55 }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2e2a30 });
  const L = GRID.lines, rh = GRID.roadHalf;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < L.length - 1; i++) {
    for (let j = 0; j < L.length - 1; j++) {
      const x0 = L[i] + rh + 4, x1 = L[i + 1] - rh - 4;
      const z0 = L[j] + rh + 4, z1 = L[j + 1] - rh - 4;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const centerBoost = Math.max(0, 1 - Math.hypot(cx, cz) / 320);
      const split = rng() < 0.5;
      const cells = split
        ? [[x0, z0, cx, cz], [cx, z0, x1, cz], [x0, cz, cx, z1], [cx, cz, x1, z1]]
        : [[x0, z0, x1, z1]];
      for (const [ax, az, bx, bz] of cells) {
        if (rng() < 0.1) continue; // occasional empty lot
        const w = (bx - ax) * (0.78 + rng() * 0.18);
        const d = (bz - az) * (0.78 + rng() * 0.18);
        const h = 11 + rng() * 26 + centerBoost * (rng() * 34);
        const px = (ax + bx) / 2 + (rng() - 0.5) * 2;
        const pz = (az + bz) / 2 + (rng() - 0.5) * 2;
        const mat = mats[Math.floor(rng() * mats.length)];
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(w, h, d);
        b.position.set(px, h / 2, pz);
        b.material = mat;
        scene.add(b);
        const roof = new THREE.Mesh(boxGeo, roofMat);
        roof.scale.set(w * 1.01, 0.7, d * 1.01);
        roof.position.set(px, h + 0.35, pz);
        scene.add(roof);
        colliders.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - d / 2, maxZ: pz + d / 2 });
        // some street-edge parking spots per block
        if (rng() < 0.75) {
          parkSpots.push({ x: px + (rng() < 0.5 ? -1 : 1) * (w / 2 + 7.5), z: pz, angle: Math.PI / 2 });
        }
      }
    }
  }

  // ---- palm trees (instanced) ----
  const palmPos = [];
  for (let x = -250; x <= 250; x += 25) palmPos.push([x + rng() * 6, GRID.beachZ + 14 + rng() * 22]);
  for (const v of L) for (let t = -220; t <= 220; t += 55) {
    if (rng() < 0.6) palmPos.push([v + 11.5, t + rng() * 8]);
    if (rng() < 0.6) palmPos.push([t + rng() * 8, v + 11.5]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6);
  trunkGeo.translate(0, 2.8, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6844 });
  const frondGeo = new THREE.BoxGeometry(0.5, 0.06, 3.4);
  frondGeo.translate(0, 0, 1.6);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPos.length);
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmPos.length * 6);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1);
  palmPos.forEach(([x, z], i) => {
    const lean = (rng() - 0.5) * 0.16;
    e.set(lean, rng() * Math.PI * 2, lean);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0, z), q, s1);
    trunks.setMatrixAt(i, m4);
    for (let f = 0; f < 6; f++) {
      e.set(-0.5 - rng() * 0.25, (f / 6) * Math.PI * 2 + rng() * 0.4, 0);
      q.setFromEuler(e);
      const top = new THREE.Matrix4().makeTranslation(x + lean * -8, 5.6, z + lean * 8);
      top.multiply(m4.clone().makeRotationFromQuaternion(q));
      fronds.setMatrixAt(i * 6 + f, top);
    }
  });
  scene.add(trunks); scene.add(fronds);

  // ---- streetlights (instanced) ----
  const lightPos = [];
  for (const a of L) for (const b of L) {
    if (b > GRID.beachZ - 20) continue;
    lightPos.push([a + 10.5, b + 10.5], [a - 10.5, b - 10.5]);
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 6, 5);
  poleGeo.translate(0, 3, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3c4148 }), lightPos.length);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lightPos.length);
  lightPos.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0, z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, 6.1, z);
    heads.setMatrixAt(i, m4);
  });
  scene.add(poles); scene.add(heads);

  // ---- Sal's beach bar (mission hub) ----
  const bar = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x9a6b42 });
  const roofM = new THREE.MeshLambertMaterial({ color: 0xd9552c });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 10), wood);
  deck.position.y = 0.25; bar.add(deck);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.4, 11), roofM);
  roof.position.y = 4.6; roof.rotation.z = 0.05; bar.add(roof);
  for (const [px, pz] of [[-7.5, -4.5], [7.5, -4.5], [-7.5, 4.5], [7.5, 4.5]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.4, 6), wood);
    post.position.set(px, 2.4, pz); bar.add(post);
  }
  const counter = new THREE.Mesh(new THREE.BoxGeometry(9, 1.1, 1.2), new THREE.MeshLambertMaterial({ color: 0x5d4030 }));
  counter.position.set(0, 1.05, -2.5); bar.add(counter);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(10, 1.4, 0.3), new THREE.MeshBasicMaterial({ color: 0xff9f43 }));
  sign.position.set(0, 3.7, 5.2); bar.add(sign);
  bar.position.set(28, 0, 256);
  scene.add(bar);
  colliders.push({ minX: 28 - 8, maxX: 28 + 8, minZ: 256 - 5, maxZ: 256 - 1.6 });
  const salPos = { x: 28, z: 262 };

  // ---- hospital (respawn) marker building ----
  const hosp = new THREE.Mesh(new THREE.BoxGeometry(20, 16, 18),
    new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
  hosp.position.set(-190, 8, -196);
  scene.add(hosp);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 0.4), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  cross.position.set(-190, 12, -186.8); scene.add(cross);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 0.4), cross.material);
  cross2.position.set(-190, 12, -186.8); scene.add(cross2);
  colliders.push({ minX: -200, maxX: -180, minZ: -205, maxZ: -187 });
  const hospitalPos = { x: -190, z: -178 };

  // ---- beach umbrellas ----
  const umbMat = [0xff5470, 0xffd23e, 0x4ecdc4].map(c => new THREE.MeshLambertMaterial({ color: c }));
  for (let i = 0; i < 14; i++) {
    const ux = -230 + rng() * 460, uz = GRID.beachZ + 18 + rng() * 26;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), wood);
    pole.position.set(ux, 1.3, uz); scene.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 0.8, 8), umbMat[i % 3]);
    top.position.set(ux, 2.8, uz); scene.add(top);
  }

  return { colliders, parkSpots, salPos, hospitalPos, ocean };
}
