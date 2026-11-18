// engine.js — a tiny hand-written raw-WebGL engine for Coral City Heat.
// No libraries: matrix math, shaders, geometry building and texture
// synthesis are all written from scratch here.

// ---------------------------------------------------------------- matrices
export function m4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function m4LookAt(eye, center, up) {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const out = new Float32Array(16);
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2];
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}

export function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function m4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function m4Identity() {
  const out = new Float32Array(16);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

// Compose a model matrix from translation, Y-rotation and scale.
export function m4Compose(x, y, z, rotY, sx, sy, sz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const out = new Float32Array(16);
  out[0] = c * sx; out[1] = 0; out[2] = -s * sx;
  out[4] = 0; out[5] = sy; out[6] = 0;
  out[8] = s * sz; out[9] = 0; out[10] = c * sz;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

// Compose with full Euler rotation (for swaying palms, tumbling props).
export function m4ComposeEuler(x, y, z, rx, ry, rz, s) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const out = new Float32Array(16);
  // Rotation R = Ry * Rx * Rz, built from axis matrices:
  const Rx = m4Identity(); Rx[5] = cx; Rx[6] = sx; Rx[9] = -sx; Rx[10] = cx;
  const Ry = m4Identity(); Ry[0] = cy; Ry[2] = -sy; Ry[8] = sy; Ry[10] = cy;
  const Rz = m4Identity(); Rz[0] = cz; Rz[1] = sz; Rz[4] = -sz; Rz[5] = cz;
  const R = m4Multiply(m4Multiply(Ry, Rx), Rz);
  for (let i = 0; i < 16; i++) out[i] = R[i] * (i < 12 ? s : 1);
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

// ------------------------------------------------------------------- RNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- geometry
// Collects vertices: position(3), normal(3), color(3), uv(2).
export class GeoBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = [];
  }
  vert(x, y, z, nx, ny, nz, r, g, b, u, v) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
    this.col.push(r, g, b); this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // Axis-aligned box centred at (cx, cy, cz). opts: color [r,g,b],
  // uvRect: function(faceName) -> [u0,v0,u1,v1] for textured faces.
  box(cx, cy, cz, w, h, d, color, uvRect) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const [r, g, b] = color;
    const uv = (face) => (uvRect ? uvRect(face) : [0, 0, 1, 1]);
    let q;
    // +z face
    q = uv('pz');
    this.quad(
      this.vert(x0, y0, z1, 0, 0, 1, r, g, b, q[0], q[1]),
      this.vert(x1, y0, z1, 0, 0, 1, r, g, b, q[2], q[1]),
      this.vert(x1, y1, z1, 0, 0, 1, r, g, b, q[2], q[3]),
      this.vert(x0, y1, z1, 0, 0, 1, r, g, b, q[0], q[3]));
    // -z face
    q = uv('nz');
    this.quad(
      this.vert(x1, y0, z0, 0, 0, -1, r, g, b, q[0], q[1]),
      this.vert(x0, y0, z0, 0, 0, -1, r, g, b, q[2], q[1]),
      this.vert(x0, y1, z0, 0, 0, -1, r, g, b, q[2], q[3]),
      this.vert(x1, y1, z0, 0, 0, -1, r, g, b, q[0], q[3]));
    // +x face
    q = uv('px');
    this.quad(
      this.vert(x1, y0, z1, 1, 0, 0, r, g, b, q[0], q[1]),
      this.vert(x1, y0, z0, 1, 0, 0, r, g, b, q[2], q[1]),
      this.vert(x1, y1, z0, 1, 0, 0, r, g, b, q[2], q[3]),
      this.vert(x1, y1, z1, 1, 0, 0, r, g, b, q[0], q[3]));
    // -x face
    q = uv('nx');
    this.quad(
      this.vert(x1, y0, z0, -1, 0, 0, r, g, b, q[0], q[1]),
      this.vert(x1, y0, z1, -1, 0, 0, r, g, b, q[2], q[1]),
      this.vert(x1, y1, z1, -1, 0, 0, r, g, b, q[2], q[3]),
      this.vert(x1, y1, z0, -1, 0, 0, r, g, b, q[0], q[3]));
    // top
    q = uv('top');
    this.quad(
      this.vert(x0, y1, z0, 0, 1, 0, r, g, b, q[0], q[1]),
      this.vert(x1, y1, z0, 0, 1, 0, r, g, b, q[2], q[1]),
      this.vert(x1, y1, z1, 0, 1, 0, r, g, b, q[2], q[3]),
      this.vert(x0, y1, z1, 0, 1, 0, r, g, b, q[0], q[3]));
    // bottom
    q = uv('bot');
    this.quad(
      this.vert(x0, y0, z1, 0, -1, 0, r, g, b, q[0], q[1]),
      this.vert(x1, y0, z1, 0, -1, 0, r, g, b, q[2], q[1]),
      this.vert(x1, y0, z0, 0, -1, 0, r, g, b, q[2], q[3]),
      this.vert(x0, y0, z0, 0, -1, 0, r, g, b, q[0], q[3]));
  }
  // Flat quad on the ground (XZ plane) at height y.
  groundQuad(x0, z0, x1, z1, y, color, uvScale) {
    const [r, g, b] = color;
    const s = uvScale || 1;
    this.quad(
      this.vert(x0, y, z0, 0, 1, 0, r, g, b, x0 * s, z0 * s),
      this.vert(x1, y, z0, 0, 1, 0, r, g, b, x1 * s, z0 * s),
      this.vert(x1, y, z1, 0, 1, 0, r, g, b, x1 * s, z1 * s),
      this.vert(x0, y, z1, 0, 1, 0, r, g, b, x0 * s, z1 * s));
  }
  // Segmented ground plane (for the animated ocean).
  groundGrid(cx, cz, w, d, segX, segZ, y, color) {
    const [r, g, b] = color;
    const start = this.pos.length / 3;
    for (let iz = 0; iz <= segZ; iz++) {
      for (let ix = 0; ix <= segX; ix++) {
        const x = cx - w / 2 + (w * ix) / segX;
        const z = cz - d / 2 + (d * iz) / segZ;
        this.vert(x, y, z, 0, 1, 0, r, g, b, ix / segX * 8, iz / segZ * 8);
      }
    }
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = start + iz * (segX + 1) + ix;
        const b2 = a + 1, c = a + segX + 1, d2 = c + 1;
        this.quad(a, b2, d2, c);
      }
    }
  }
  // Box of size (w,h,d) centred on the origin, then transformed by matrix m.
  // Used for palm fronds, spoilers and other angled parts.
  boxT(m, w, h, d, color) {
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const faces = [
      { n: [0, 0, -1], v: [0, 1, 2, 3] }, { n: [0, 0, 1], v: [5, 4, 7, 6] },
      { n: [0, 1, 0], v: [3, 2, 6, 7] }, { n: [0, -1, 0], v: [4, 5, 1, 0] },
      { n: [1, 0, 0], v: [1, 5, 6, 2] }, { n: [-1, 0, 0], v: [4, 0, 3, 7] },
    ];
    const tp = (p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
    const tn = (n) => norm3([
      m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
      m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
      m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
    ]);
    const [r, g, b] = color;
    for (const f of faces) {
      const n = tn(f.n);
      const ids = f.v.map((ci) => {
        const p = tp(corners[ci]);
        return this.vert(p[0], p[1], p[2], n[0], n[1], n[2], r, g, b, 0, 0);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  // Low-segment cylinder between two points (palm trunks, lamp poles).
  cylinder(x0, y0, z0, x1, y1, z1, radius, color, seg = 6) {
    const [r, g, b] = color;
    const dir = norm3([x1 - x0, y1 - y0, z1 - z0]);
    const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const tx = norm3(cross3(up, dir));
    const ty = cross3(dir, tx);
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ox = (tx[0] * Math.cos(a) + ty[0] * Math.sin(a)) * radius;
      const oy = (tx[1] * Math.cos(a) + ty[1] * Math.sin(a)) * radius;
      const oz = (tx[2] * Math.cos(a) + ty[2] * Math.sin(a)) * radius;
      const n = norm3([ox, oy, oz]);
      ring.push([
        this.vert(x0 + ox, y0 + oy, z0 + oz, n[0], n[1], n[2], r, g, b, 0, 0),
        this.vert(x1 + ox, y1 + oy, z1 + oz, n[0], n[1], n[2], r, g, b, 0, 1),
      ]);
    }
    for (let i = 0; i < seg; i++) {
      const n = ring[(i + 1) % seg];
      this.quad(ring[i][0], n[0], n[1], ring[i][1]);
    }
  }
  // Simple UV sphere (heads, lamp globes, beach balls).
  sphere(cx, cy, cz, radius, color, seg = 8, rings = 6) {
    const [r, g, b] = color;
    const idx = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      idx.push([]);
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const x = cx + radius * Math.sin(phi) * Math.cos(th);
        const y = cy + radius * Math.cos(phi);
        const z = cz + radius * Math.sin(phi) * Math.sin(th);
        const n = norm3([x - cx, y - cy, z - cz]);
        idx[j].push(this.vert(x, y, z, n[0], n[1], n[2], r, g, b, i / seg, j / rings));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        this.quad(idx[j][i], idx[j][i + 1], idx[j + 1][i + 1], idx[j + 1][i]);
      }
    }
  }
}

// ------------------------------------------------------------- renderer
const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec3 aCol;
attribute vec2 aUv;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform float uTime;
uniform float uWave;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vNor;
varying float vDist;
void main() {
  vec3 p = aPos;
  if (uWave > 0.5) {
    p.y += sin(p.x * 0.22 + uTime * 1.6) * 0.35 + cos(p.z * 0.31 + uTime * 1.1) * 0.3;
  }
  vec4 world = uModel * vec4(p, 1.0);
  vNor = normalize(mat3(uModel) * aNor);
  vCol = aCol;
  vUv = aUv;
  vec4 clip = uMVP * vec4(p, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform float uUseTex;
uniform vec3 uTint;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uFogCol;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vNor;
varying float vDist;
void main() {
  vec3 base = vCol * uTint;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUv).rgb;
  float diff = max(dot(normalize(vNor), normalize(uSunDir)), 0.0);
  vec3 lit = base * (uAmb + uSunCol * diff);
  float f = smoothstep(uFogNear, uFogFar, vDist);
  gl_FragColor = vec4(mix(lit, uFogCol, f), 1.0);
}`;

const SKY_VERT = `
attribute vec3 aPos;
uniform mat4 uInvVP;
varying vec3 vDir;
void main() {
  vec4 w = uInvVP * vec4(aPos.xy, 1.0, 1.0);
  vDir = w.xyz / w.w;
  gl_Position = vec4(aPos.xy, 0.9999, 1.0);
}`;

const SKY_FRAG = `
precision mediump float;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir - uCamPos);
  float h = clamp(d.y, -0.05, 1.0);
  vec3 zen = vec3(0.16, 0.23, 0.48);
  vec3 mid = vec3(0.85, 0.45, 0.38);
  vec3 hor = vec3(1.0, 0.62, 0.34);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
  col = mix(col, zen, smoothstep(0.12, 0.65, h));
  float sun = pow(max(dot(d, normalize(uSunDir)), 0.0), 90.0);
  col += vec3(1.0, 0.55, 0.25) * sun * 1.4;
  float glow = pow(max(dot(d, normalize(uSunDir)), 0.0), 6.0);
  col += vec3(0.9, 0.35, 0.15) * glow * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

// 4x4 inverse (for the sky pass) by Gauss-Jordan elimination on rows.
// Element (row r, col c) of a column-major matrix m lives at m[c*4 + r].
export function m4Invert(m) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    rows.push([m[r], m[r + 4], m[r + 8], m[r + 12],
               r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  }
  for (let col = 0; col < 4; col++) {
    // partial pivot
    let piv = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[piv][col])) piv = r;
    }
    if (Math.abs(rows[piv][col]) < 1e-12) return m4Identity();
    if (piv !== col) { const t = rows[piv]; rows[piv] = rows[col]; rows[col] = t; }
    const inv = 1 / rows[col][col];
    for (let j = 0; j < 8; j++) rows[col][j] *= inv;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = rows[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 8; j++) rows[r][j] -= f * rows[col][j];
    }
  }
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[c * 4 + r] = rows[r][c + 4];
  }
  return out;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true }) ||
               canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.prog = program(gl, VERT_SRC, FRAG_SRC);
    this.skyProg = program(gl, SKY_VERT, SKY_FRAG);
    this.u = {};
    for (const name of ['uMVP', 'uModel', 'uTime', 'uWave', 'uTex', 'uUseTex', 'uTint',
      'uSunDir', 'uSunCol', 'uAmb', 'uFogCol', 'uFogNear', 'uFogFar']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }
    this.aPos = gl.getAttribLocation(this.prog, 'aPos');
    this.aNor = gl.getAttribLocation(this.prog, 'aNor');
    this.aCol = gl.getAttribLocation(this.prog, 'aCol');
    this.aUv = gl.getAttribLocation(this.prog, 'aUv');
    this.skyU = {
      invVP: gl.getUniformLocation(this.skyProg, 'uInvVP'),
      camPos: gl.getUniformLocation(this.skyProg, 'uCamPos'),
      sunDir: gl.getUniformLocation(this.skyProg, 'uSunDir'),
    };
    this.skyAPos = gl.getAttribLocation(this.skyProg, 'aPos');
    // Full-screen triangle for the sky.
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // 1x1 white texture used when a mesh has no texture.
    this.whiteTex = this.makeTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.sunDir = norm3([-0.55, 0.38, 0.74]);
    this.time = 0;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.98, 0.55, 0.32, 1);
  }

  makeTexture(pixels, w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  canvasTexture(canvas) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  buildMesh(builder) {
    const gl = this.gl;
    const interleaved = new Float32Array(builder.pos.length / 3 * 11);
    const n = builder.pos.length / 3;
    for (let i = 0; i < n; i++) {
      interleaved[i * 11 + 0] = builder.pos[i * 3];
      interleaved[i * 11 + 1] = builder.pos[i * 3 + 1];
      interleaved[i * 11 + 2] = builder.pos[i * 3 + 2];
      interleaved[i * 11 + 3] = builder.nor[i * 3];
      interleaved[i * 11 + 4] = builder.nor[i * 3 + 1];
      interleaved[i * 11 + 5] = builder.nor[i * 3 + 2];
      interleaved[i * 11 + 6] = builder.col[i * 3];
      interleaved[i * 11 + 7] = builder.col[i * 3 + 1];
      interleaved[i * 11 + 8] = builder.col[i * 3 + 2];
      interleaved[i * 11 + 9] = builder.uv[i * 2];
      interleaved[i * 11 + 10] = builder.uv[i * 2 + 1];
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const idx = n > 65535 ? new Uint32Array(builder.idx) : new Uint16Array(builder.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return { vbo, ibo, count: builder.idx.length, idxType: n > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  beginFrame(vp, camPos) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.vp = vp;
    // Sky pass.
    gl.useProgram(this.skyProg);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(this.skyAPos);
    gl.vertexAttribPointer(this.skyAPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(this.skyU.invVP, false, m4Invert(vp));
    gl.uniform3fv(this.skyU.camPos, camPos);
    gl.uniform3fv(this.skyU.sunDir, this.sunDir);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    // Main program state.
    gl.useProgram(this.prog);
    gl.uniform3fv(this.u.uSunDir, this.sunDir);
    gl.uniform3f(this.u.uSunCol, 1.05, 0.72, 0.5);
    gl.uniform3f(this.u.uAmb, 0.52, 0.44, 0.5);
    gl.uniform3f(this.u.uFogCol, 0.93, 0.55, 0.36);
    gl.uniform1f(this.u.uFogNear, 120);
    gl.uniform1f(this.u.uFogFar, 520);
    gl.uniform1f(this.u.uTime, this.time);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.uTex, 0);
  }

  draw(mesh, model, opts = {}) {
    const gl = this.gl;
    const mvp = m4Multiply(this.vp, model);
    gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform1f(this.u.uWave, opts.wave ? 1 : 0);
    gl.uniform1f(this.u.uUseTex, opts.tex ? 1 : 0);
    const tint = opts.tint || [1, 1, 1];
    gl.uniform3f(this.u.uTint, tint[0], tint[1], tint[2]);
    gl.bindTexture(gl.TEXTURE_2D, opts.tex || this.whiteTex);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aNor);
    gl.vertexAttribPointer(this.aNor, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(this.aCol);
    gl.vertexAttribPointer(this.aCol, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, stride, 9 * 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.idxType, 0);
  }
}
