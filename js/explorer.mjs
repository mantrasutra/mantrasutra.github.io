// SPDX-License-Identifier: AGPL-3.0-only
// Surface and curve explorer. Pure Canvas2D + raw WebGL, no library, no network (same-origin static files only).
// Grid contract (js/sutra.mjs sample): {ok, shape:[n0(,n1)], re:Float64Array, im:Float64Array|null, mask:Uint8Array}.
// Layout: axis 0 varies fastest, flat index k = i1*n0 + i0 (as in viewer/data). Mask 1 or non-finite value = gap, never interpolated.
// Optional grid.axes = [{name,lo,hi,n}] gives the coordinates; without it indices are used.

export const PALETTE = ['#a63a21', '#2f6f8f', '#6a8d2f', '#8a4fa0', '#c08a1e', '#3c3c3c'];

export function frac(s) {
  const t = String(s).trim(), [p, q] = t.split('/');
  return Number(p) / (q === undefined ? 1 : Number(q));
}
export function axisVals(a) {
  const lo = frac(a.lo), hi = frac(a.hi), n = a.n;
  return Array.from({ length: n }, (_, i) => (n === 1 ? lo : lo + (hi - lo) * i / (n - 1)));
}
export const isGap = (g, k) => g.mask[k] === 1 || !Number.isFinite(g.re[k]) || (g.im != null && !Number.isFinite(g.im[k]));
const fmt = (x) => (Number.isNaN(x) ? 'refused (NaN)' : String(x));

// ---- data loading (same-origin files; fetchFn injectable for node) ----
export async function loadManifest(base, id, fetchFn = fetch) {
  const m = await (await fetchFn(`${base}/${id}/manifest.json`)).json();
  m.series = await Promise.all(m.series.map(async (s) => {
    const buf = async (f) => new Uint8Array(await (await fetchFn(`${base}/${id}/${f}`)).arrayBuffer());
    const f64 = async (f) => { const b = await buf(f); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
    const out = { ...s, re: await f64(s.file), mask: await buf(s.mask_file), im: s.im_file ? await f64(s.im_file) : null };
    out.ok = true; out.shape = s.shape || m.axes.map((a) => a.n); out.axes = m.axes;
    return out;
  }));
  return m;
}
export function checkManifestLengths(m) {
  const cells = m.axes.reduce((p, a) => p * a.n, 1), bad = [];
  for (const s of m.series) {
    if (s.re.length !== cells) bad.push(`${s.file}: ${s.re.length} != ${cells}`);
    if (s.im && s.im.length !== cells) bad.push(`${s.im_file}: ${s.im.length} != ${cells}`);
    if (s.mask.length !== cells) bad.push(`${s.mask_file}: ${s.mask.length} != ${cells}`);
  }
  return bad;
}
export function gridFromSample(r, axes) { return { ...r, axes: axes || r.axes }; }

// ---- colour ----
export function hsl(hh, ss, ll) {
  const a = ss * Math.min(ll, 1 - ll), f = (n) => { const k = (n + hh * 12) % 12; return ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
export function heatRGB(t) { return hsl(0.66 - 0.66 * t, 0.65, 0.25 + 0.5 * t); }
export function domainRGB(re, im) {
  const cyc = Math.log2(Math.hypot(re, im) || 1e-300);
  return hsl((Math.atan2(im, re) / (2 * Math.PI) + 1) % 1, 0.9, 0.35 + 0.25 * (cyc - Math.floor(cyc)));
}
function theme(opts) {
  const o = opts.theme || {};
  return { fg: o.fg || '#1d1b18', muted: o.muted || '#6b655c', line: o.line || '#d8d1c4', accent: o.accent || '#a63a21', panel: o.panel || '#fffdf8' };
}
export function readTheme(el) {
  const cs = getComputedStyle(el), v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return { fg: v('--fg', '#1d1b18'), muted: v('--muted', '#6b655c'), line: v('--line', '#d8d1c4'), accent: v('--accent', '#a63a21'), panel: v('--panel', '#fffdf8') };
}
const finiteRange = (g, sel = (k) => g.re[k]) => {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < g.re.length; k++) if (!isGap(g, k)) { const v = sel(k); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return lo > hi ? [0, 1] : [lo, hi];
};

// ---- 1-D curves ----
// grids: Grid | Grid[]; opts {w,h,labels,view:{x0,x1},zeros:[number],clip,theme}. Returns {X,Y,xs,pad,lo,hi} for probes.
export function renderCurve(ctx, grids, opts = {}) {
  const gs = Array.isArray(grids) ? grids : [grids], w = opts.w, h = opts.h, T = theme(opts), pad = 40;
  const ax = (gs[0].axes && gs[0].axes[0]) || { lo: '0', hi: String(gs[0].re.length - 1), n: gs[0].re.length };
  const xs = axisVals(ax), vx0 = opts.view ? opts.view.x0 : xs[0], vx1 = opts.view ? opts.view.x1 : xs[xs.length - 1];
  let lo = Infinity, hi = -Infinity, poles = false;
  for (const g of gs) for (let k = 0; k < g.re.length; k++) {
    if (g.mask[k]) poles = true;
    if (!isGap(g, k) && xs[k] >= vx0 && xs[k] <= vx1) { lo = Math.min(lo, g.re[k]); hi = Math.max(hi, g.re[k]); }
  }
  if (lo > hi) { lo = 0; hi = 1; }
  const clip = opts.clip !== undefined ? opts.clip : (poles && hi - lo > 50 ? 10 : null);   // only a series with refused points is clipped
  if (clip) { lo = Math.max(lo, -clip); hi = Math.min(hi, clip); }
  const X = (x) => pad + (x - vx0) / (vx1 - vx0 || 1) * (w - 2 * pad), Y = (y) => h - pad - (y - lo) / (hi - lo || 1) * (h - 2 * pad);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath();
  if (lo < 0 && hi > 0) { ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); }
  const x0 = Math.max(vx0, Math.min(0, vx1)); ctx.moveTo(X(x0), pad); ctx.lineTo(X(x0), h - pad); ctx.stroke();
  ctx.fillStyle = T.muted; ctx.font = '12px system-ui';
  ctx.fillText(`${+lo.toPrecision(4)}`, 4, h - pad); ctx.fillText(`${+hi.toPrecision(4)}`, 4, pad + 4);
  ctx.fillText(`${+vx0.toPrecision(4)}`, pad, h - 12); ctx.fillText(`${+vx1.toPrecision(4)}`, w - pad - 30, h - 12);
  ctx.save(); ctx.beginPath(); ctx.rect(pad, pad - 4, w - 2 * pad, h - 2 * pad + 8); ctx.clip();
  gs.forEach((g, s) => {
    const col = (opts.colors && opts.colors[s]) || PALETTE[s % PALETTE.length];
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); let pen = false;
    for (let i = 0; i < g.re.length; i++) {
      const y = g.re[i];
      if (isGap(g, i) || (clip && Math.abs(y) > clip)) { pen = false; continue; }   // gap: pen lifts, nothing is interpolated across
      pen ? ctx.lineTo(X(xs[i]), Y(y)) : ctx.moveTo(X(xs[i]), Y(y)); pen = true;
    }
    ctx.stroke();
  });
  if (opts.zeros) { ctx.strokeStyle = T.accent; ctx.setLineDash([3, 3]); for (const z of opts.zeros) { const x = X(Number(z)); ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); ctx.stroke(); } ctx.setLineDash([]); }
  ctx.restore();
  gs.forEach((g, s) => { if (opts.labels && opts.labels[s]) { ctx.fillStyle = (opts.colors && opts.colors[s]) || PALETTE[s % PALETTE.length]; ctx.fillText(opts.labels[s], w - pad - 60, pad + 16 * (s + 1)); } });
  return { X, Y, xs, pad, lo, hi, x0: vx0, x1: vx1 };
}
// zero check for the critical line: how many listed zeros sit on a sign change of the sampled series
export function zerosCheck(grid, zeros) {
  const xs = axisVals(grid.axes[0]), s = grid.re, ch = [];
  for (let i = 1; i < s.length; i++) if (!isGap(grid, i) && !isGap(grid, i - 1) && Math.sign(s[i - 1]) !== Math.sign(s[i]) && s[i - 1] !== 0) ch.push([xs[i - 1], xs[i]]);
  return { matched: zeros.filter((z) => ch.some(([a, b]) => a <= Number(z) && Number(z) <= b)).length, total: zeros.length, changes: ch.length };
}

// ---- 2-D: heat map and domain colouring (gaps stay transparent) ----
function renderImage(ctx, grid, opts, mode) {
  const w = opts.w, h = opts.h, T = theme(opts), pad = 40, [n0, n1] = grid.shape;
  const img = new ImageData(n0, n1), d = img.data;
  const [lo, hi] = mode === 'heat' ? finiteRange(grid) : [0, 1];
  for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) {
    const k = j * n0 + i, o = ((n1 - 1 - j) * n0 + i) * 4;
    if (isGap(grid, k)) { d[o + 3] = 0; continue; }
    const c = mode === 'heat' ? heatRGB((grid.re[k] - lo) / (hi - lo || 1)) : domainRGB(grid.re[k], grid.im[k]);
    d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; d[o + 3] = 255;
  }
  const off = opts.makeCanvas ? opts.makeCanvas(n0, n1) : new OffscreenCanvas(n0, n1);
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = false;
  const R = { x: pad, y: pad / 2, w: w - 1.5 * pad, h: h - 1.5 * pad };
  ctx.drawImage(off, R.x, R.y, R.w, R.h);
  ctx.strokeStyle = T.line; ctx.strokeRect(R.x, R.y, R.w, R.h);
  const ax = grid.axes || [{ lo: '0', hi: String(n0 - 1), n: n0 }, { lo: '0', hi: String(n1 - 1), n: n1 }];
  ctx.fillStyle = T.muted; ctx.font = '12px system-ui';
  const [a0, a1] = [axisVals(ax[0]), axisVals(ax[1])];
  ctx.fillText(`${+a0[0].toPrecision(4)}`, R.x, h - 12); ctx.fillText(`${+a0[n0 - 1].toPrecision(4)}`, R.x + R.w - 30, h - 12);
  ctx.fillText(`${+a1[0].toPrecision(4)}`, 4, R.y + R.h); ctx.fillText(`${+a1[n1 - 1].toPrecision(4)}`, 4, R.y + 10);
  return {
    rect: R, lo, hi, a0, a1,
    at(px, py) {   // pixel -> {i,j,k} or null
      if (px < R.x || py < R.y || px >= R.x + R.w || py >= R.y + R.h) return null;
      const i = Math.min(n0 - 1, Math.floor((px - R.x) / R.w * n0)), j = n1 - 1 - Math.min(n1 - 1, Math.floor((py - R.y) / R.h * n1));
      return { i, j, k: j * n0 + i };
    },
  };
}
export const renderHeat = (ctx, grid, opts = {}) => renderImage(ctx, grid, opts, 'heat');
export const renderDomain = (ctx, grid, opts = {}) => renderImage(ctx, grid, opts, 'domain');

// ---- WebGL (no library) ----
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; };
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const trans = (z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1]);
const VS = 'attribute vec3 p;attribute vec3 n;attribute vec3 c;uniform mat4 uMVP;uniform mat4 uR;varying vec3 vC;varying vec3 vN;void main(){vC=c;vN=(uR*vec4(n,0.)).xyz;gl_Position=uMVP*vec4(p,1.);}';
const FS = 'precision mediump float;varying vec3 vC;varying vec3 vN;void main(){vec3 L=normalize(vec3(.4,.7,.6));float d=abs(dot(normalize(vN),L));gl_FragColor=vec4(vC*(.45+.65*d),1.);}';

// Build a triangle soup from a vertex grid; quads with any gap vertex are omitted (holes, not interpolation).
export function buildMesh(n0, n1, pos, col, isHole) {
  const nrm = new Float32Array(n0 * n1 * 3), P = (i, j) => (j * n0 + i) * 3;
  for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) {
    const a = P(Math.max(0, i - 1), j), b = P(Math.min(n0 - 1, i + 1), j), c = P(i, Math.max(0, j - 1)), d = P(i, Math.min(n1 - 1, j + 1));
    const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[d] - pos[c], pos[d + 1] - pos[c + 1], pos[d + 2] - pos[c + 2]];
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0], l = Math.hypot(nx, ny, nz) || 1, o = P(i, j);
    nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
  }
  const quads = []; for (let j = 0; j + 1 < n1; j++) for (let i = 0; i + 1 < n0; i++) {
    const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    if (q.some(([a, b]) => isHole(b * n0 + a))) continue;
    quads.push(q);
  }
  const p = new Float32Array(quads.length * 18), n = new Float32Array(quads.length * 18), c = new Float32Array(quads.length * 18);
  quads.forEach((q, m) => [0, 1, 2, 0, 2, 3].forEach((t, s) => { const o = P(q[t][0], q[t][1]), w = m * 18 + s * 3; for (let e = 0; e < 3; e++) { p[w + e] = pos[o + e]; n[w + e] = nrm[o + e]; c[w + e] = col[o + e]; } }));
  return { p, n, c, count: quads.length * 6 };
}

function glScene(canvas, meshes, opts = {}) {
  const gl = canvas.getContext('webgl', { antialias: true });
  if (!gl) return null;
  const T = theme(opts);
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const bufs = meshes.map((m) => ['p', 'n', 'c'].map((k) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, m[k], gl.STATIC_DRAW); return b; }));
  const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c') };
  const uMVP = gl.getUniformLocation(prog, 'uMVP'), uR = gl.getUniformLocation(prog, 'uR');
  const view = { yaw: 0.7, pitch: 0.55, dist: opts.dist || 3.2 };
  const bg = (() => { const m = /^#([0-9a-f]{6})$/i.exec(T.panel); return m ? [0, 2, 4].map((o) => parseInt(m[1].substr(o, 2), 16) / 255) : [1, 1, 1]; })();
  let raf = 0, live = true;
  function draw() {
    raf = 0; if (!live) return;
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h); gl.enable(gl.DEPTH_TEST); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const R = mul(rotX(view.pitch), rotY(view.yaw)), MVP = mul(persp(0.8, w / h, 0.05, 50), mul(trans(-view.dist), R));
    gl.uniformMatrix4fv(uMVP, false, MVP); gl.uniformMatrix4fv(uR, false, R);
    meshes.forEach((m, i) => {
      [['p', 0], ['n', 1], ['c', 2]].forEach(([k, b]) => { gl.bindBuffer(gl.ARRAY_BUFFER, bufs[i][b]); gl.enableVertexAttribArray(loc[k]); gl.vertexAttribPointer(loc[k], 3, gl.FLOAT, false, 0, 0); });
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    });
  }
  const redraw = () => { if (!raf && live) raf = requestAnimationFrame(draw); };
  let drag = null;
  const on = (t, f, o) => { canvas.addEventListener(t, f, o); return () => canvas.removeEventListener(t, f); };
  const offs = [
    on('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); }),
    on('pointermove', (e) => { if (!drag) return; view.yaw += (e.clientX - drag.x) * 0.01; view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; redraw(); }),
    on('pointerup', () => { drag = null; }), on('pointercancel', () => { drag = null; }),
    on('wheel', (e) => { e.preventDefault(); view.dist = Math.max(1.3, Math.min(12, view.dist * Math.exp(e.deltaY * 0.001))); redraw(); }, { passive: false }),
    on('keydown', (e) => { const s = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key]; if (s) { view.yaw += s[0]; view.pitch += s[1]; redraw(); } else if (e.key === '+') { view.dist *= 0.9; redraw(); } else if (e.key === '-') { view.dist *= 1.1; redraw(); } }),
  ];
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'rotate: drag or arrow keys; zoom: wheel or plus/minus');
  redraw();
  return { view, redraw, destroy() { live = false; if (raf) cancelAnimationFrame(raf); offs.forEach((f) => f()); } };
}

// renderSurface(canvas, grids|grid, opts): real surface z = re over the (axis0, axis1) rectangle; holes where masked.
export function renderSurface(canvas, grids, opts = {}) {
  const gs = Array.isArray(grids) ? grids : [grids];
  const meshes = gs.map((g, s) => {
    const [n0, n1] = g.shape, vals = []; for (let k = 0; k < g.re.length; k++) if (!isGap(g, k)) vals.push(g.re[k]);
    vals.sort((a, b) => a - b);
    const cap = vals.length ? vals[Math.floor((vals.length - 1) * 0.97)] : 1, flo = vals.length ? vals[0] : 0, span = cap - flo || 1;   // clip tall poles at the 97th percentile
    const pos = new Float32Array(n0 * n1 * 3), col = new Float32Array(n0 * n1 * 3), base = parseColor(PALETTE[s % PALETTE.length]);
    for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) {
      const k = j * n0 + i, o = k * 3, t = isGap(g, k) ? 0 : (Math.min(g.re[k], cap) - flo) / span;
      pos[o] = (n0 > 1 ? i / (n0 - 1) : 0.5) * 2 - 1; pos[o + 1] = t - 0.5; pos[o + 2] = (n1 > 1 ? j / (n1 - 1) : 0.5) * 2 - 1;
      for (let e = 0; e < 3; e++) col[o + e] = base[e] * (0.55 + 0.6 * t);
    }
    return buildMesh(n0, n1, pos, col, (k) => isGap(g, k) || g.re[k] > cap);   // a point above the cap is a gap too, not a plateau
  });
  return glScene(canvas, meshes, opts);
}
// renderSphere(canvas, grid, opts): complex grid on the Riemann sphere; axis0 = latitude deg, axis1 = longitude deg.
export function renderSphere(canvas, grid, opts = {}) {
  const [n0, n1] = grid.shape, ax = grid.axes || [{ lo: '-90', hi: '90', n: n0 }, { lo: '-180', hi: '180', n: n1 }];
  const lat = axisVals(ax[0]), lon = axisVals(ax[1]), pos = new Float32Array(n0 * n1 * 3), col = new Float32Array(n0 * n1 * 3);
  for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) {
    const k = j * n0 + i, o = k * 3, a = lat[i] * Math.PI / 180, b = lon[j] * Math.PI / 180;
    pos[o] = Math.cos(a) * Math.sin(b); pos[o + 1] = Math.sin(a); pos[o + 2] = Math.cos(a) * Math.cos(b);
    const c = isGap(grid, k) ? [0.5, 0.5, 0.5] : domainRGB(grid.re[k], grid.im[k]); col.set(c, o);
  }
  return glScene(canvas, [buildMesh(n0, n1, pos, col, (k) => isGap(grid, k))], { ...opts, dist: 3 });
}
function parseColor(h) { const m = /^#([0-9a-f]{6})$/i.exec(h); return [0, 2, 4].map((o) => parseInt(m[1].substr(o, 2), 16) / 255); }

// ---- mount ----
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

// mountExplorer(root, {manifest?: {id}|object, base='data', sutra, env, axes, complex, sphere, view, api})
// api = module with sample() (js/sutra.mjs); imported lazily for live mode. Returns {setView(v), setParams(p), destroy()}.
export function mountExplorer(root, cfg = {}) {
  const base = cfg.base || 'data';
  const status = el('div', { className: 'note', role: 'status' }), probe = el('div', { className: 'probe' }), sut = el('div', { className: 'sutras' }), controls = el('div', { className: 'controls' });
  const stage = el('div', { className: 'stage' });
  root.replaceChildren(controls, stage, probe, sut, status);
  let m = null, view = cfg.view || 'curve', paramIdx = 0, cleanup = () => {}, destroyed = false;

  const size = () => { const r = stage.getBoundingClientRect(), d = window.devicePixelRatio || 1; return { w: Math.max(200, r.width), h: Math.max(160, r.height), d }; };
  function canvas2d() {
    const { w, h, d } = size(), c = el('canvas'); c.width = Math.round(w * d); c.height = Math.round(h * d); c.style.cssText = 'width:100%;height:100%;display:block';
    stage.replaceChildren(c); const g = c.getContext('2d'); g.scale(d, d); return { c, g, w, h };
  }
  function draw() {
    cleanup(); cleanup = () => {}; if (!m) return;
    const th = readTheme(root), series = m.series;
    if (view === 'curve' || view === 'zline') {
      const { c, g, w, h } = canvas2d();
      const shown = m.params ? series.filter((s) => s.param_index === paramIdx) : series;
      const vw = { x0: axisVals(m.axes[0])[0], x1: axisVals(m.axes[0]).at(-1) }; let info;
      const paint = () => { info = renderCurve(g, shown, { w, h, view: vw, labels: shown.map((s) => s.label), zeros: m.zeros, theme: th }); };
      paint();
      if (m.zeros) { const z = zerosCheck(shown[0], m.zeros); status.textContent = `Zeros check: ${z.matched} of ${z.total} listed zeros sit on a sign change of the sampled series; ${z.changes} sign changes in all.`; }
      c.onmousemove = (ev) => { const r = c.getBoundingClientRect(), x = info.x0 + ((ev.clientX - r.left) / r.width * w - info.pad) / (w - 2 * info.pad) * (info.x1 - info.x0), xs = info.xs;
        const i = Math.max(0, Math.min(xs.length - 1, Math.round((x - xs[0]) / ((xs[1] - xs[0]) || 1)))); probe.textContent = `x[${i}] = ${fmt(xs[i])}   ` + shown.map((s) => `${s.label}: ${fmt(s.re[i])}${s.mask[i] ? ' (gap)' : ''}`).join('   '); };
      c.onwheel = (ev) => { ev.preventDefault(); const r = c.getBoundingClientRect(), f = (ev.clientX - r.left) / r.width, k = Math.exp(ev.deltaY * 0.001), full = axisVals(m.axes[0]), a = vw.x0 + f * (vw.x1 - vw.x0);
        vw.x0 = Math.max(full[0], a - (a - vw.x0) * k); vw.x1 = Math.min(full.at(-1), a + (vw.x1 - a) * k); paint(); };
      let dr = null; c.onpointerdown = (e) => { dr = e.clientX; }; c.onpointerup = () => { dr = null; };
      c.onpointermove = (e) => { if (dr === null) return; const full = axisVals(m.axes[0]), dx = (e.clientX - dr) / c.getBoundingClientRect().width * (vw.x1 - vw.x0); dr = e.clientX;
        const sp = vw.x1 - vw.x0, x0 = Math.max(full[0], Math.min(full.at(-1) - sp, vw.x0 - dx)); vw.x0 = x0; vw.x1 = x0 + sp; paint(); };
    } else if (view === 'heat' || view === 'domain') {
      const { c, g, w, h } = canvas2d(), s = series[0];
      const info = (view === 'heat' ? renderHeat : renderDomain)(g, s, { w, h, theme: th });
      c.onmousemove = (ev) => { const r = c.getBoundingClientRect(), a = info.at((ev.clientX - r.left) / r.width * w, (ev.clientY - r.top) / r.height * h); if (!a) return;
        probe.textContent = `(${fmt(info.a0[a.i])}, ${fmt(info.a1[a.j])})   ` + (isGap(s, a.k) ? 'gap (refused)' : view === 'heat' ? `f = ${fmt(s.re[a.k])}` : `Re = ${fmt(s.re[a.k])}   Im = ${fmt(s.im[a.k])}`); };
    } else {
      const { w, h, d } = size(), c = el('canvas'); c.width = Math.round(w * d); c.height = Math.round(h * d); c.style.cssText = 'width:100%;height:100%;display:block'; stage.replaceChildren(c);
      const sc = view === 'sphere' ? renderSphere(c, series[0], { theme: th }) : renderSurface(c, series, { theme: th });
      if (!sc) { stage.replaceChildren(el('p', { className: 'note' }, 'WebGL is not available in this browser; the 2-D views still work.')); return; }
      cleanup = () => sc.destroy(); probe.textContent = 'Drag to rotate, wheel to zoom (arrow keys and +/- when focused). Gaps are holes: those points were refused.';
    }
  }
  function setManifest(mm) {
    m = mm; view = cfg.view || m.view || 'curve'; if (view === 'heat' && m.series[0].im) view = 'domain';
    sut.replaceChildren(...[...new Map(m.series.map((s) => [s.label, s])).values()].map((s) => { const b = el('b', {}, s.label); return el('div', { className: 'sutra' }, b, ' ', s.sutra || ''); }));
    controls.querySelector('.pctl')?.remove();
    if (m.params) {
      const r = el('input', { type: 'range', min: 0, max: m.params.values.length - 1, step: 1, value: 0 }); r.setAttribute('aria-label', m.params.label);
      const out = el('span'), upd = () => { paramIdx = Number(r.value); out.textContent = `${m.params.label} = ${m.params.values[paramIdx]}`; draw(); };
      r.oninput = upd; controls.append(el('label', { className: 'pctl' }, r, out)); out.textContent = `${m.params.label} = ${m.params.values[0]}`;
    }
    draw();
  }
  async function loadExample(id) { status.textContent = 'loading'; try { setManifest(await loadManifest(base, id)); status.textContent = ''; } catch (e) { status.textContent = `could not load ${id}: ${e.message}`; } }
  async function live(c) {
    const api = cfg.api || await import('./sutra.mjs');
    status.textContent = 'sampling';
    const r = await api.sample(c.sutra, c.env, c.axes, { complex: !!c.complex, sphere: c.sphere, fixed: c.fixed });
    if (r.ok === false) { status.textContent = `${r.name} (${r.code}): ${r.why}`; return; }   // refusal shown verbatim
    status.textContent = '';
    r.axes = c.axes; const v = c.sphere ? 'sphere' : c.complex ? 'domain' : c.axes.length === 2 ? 'heat' : 'curve';
    setManifest({ id: 'live', view: v, axes: c.axes, params: null, series: [{ label: c.sutra.slice(0, 40), sutra: c.sutra, ...r }] });
  }

  // controls: example picker + live entry
  const sel = el('select'); sel.setAttribute('aria-label', 'example');
  const viewSel = el('select'); viewSel.setAttribute('aria-label', 'view');
  for (const v of ['curve', 'heat', 'domain', 'surface', 'sphere', 'zline']) viewSel.append(el('option', { value: v, textContent: v }));
  viewSel.onchange = () => { cfg.view = view = viewSel.value; draw(); };
  const ta = el('textarea', { rows: 2, placeholder: 'सूत्र text', spellcheck: false }), axIn = el('input', { type: 'text', size: 34, value: 'क -5 5 101' }), cx = el('input', { type: 'checkbox' });
  axIn.setAttribute('aria-label', 'axes: name lo hi n [; name lo hi n]');
  const go = el('button', { type: 'button', textContent: 'plot' });
  go.onclick = async () => {
    const axes = axIn.value.split(';').map((p) => p.trim().split(/\s+/)).filter((p) => p.length === 4).map(([name, lo, hi, n], i, a) => ({ name, lo, hi, n: Number(n), ...(cx.checked && a.length === 2 ? { complex_part: i ? 'im' : 're' } : {}) }));
    const env = Object.fromEntries([...new Set(axes.map((a) => a.name))].map((n) => [n, ['var', 0, 'm']]));
    try { await live({ sutra: ta.value, env, axes, complex: cx.checked }); } catch (e) { status.textContent = String(e.message || e); }
  };
  controls.append(sel, viewSel, el('label', {}, cx, ' complex'), ta, axIn, go);
  const onResize = () => draw(); window.addEventListener('resize', onResize);
  (async () => {
    try {
      const idx = await (await fetch(`${base}/index.json`)).json();
      for (const e of idx) sel.append(el('option', { value: e.id, textContent: e.title }));
      sel.onchange = () => loadExample(sel.value);
      if (cfg.manifest && typeof cfg.manifest === 'object' && cfg.manifest.series) setManifest(cfg.manifest);
      else if (cfg.sutra) { ta.value = cfg.sutra; await live({ sutra: cfg.sutra, env: cfg.env, axes: cfg.axes, complex: cfg.complex, sphere: cfg.sphere }); }
      else await loadExample((cfg.manifest && cfg.manifest.id) || idx[0].id);
    } catch (e) { status.textContent = String(e.message || e); }
  })();
  return {
    setView(v) { cfg.view = view = v; viewSel.value = v; draw(); },
    setParams(p) { paramIdx = Number(p.index ?? p) || 0; draw(); },
    destroy() { destroyed = true; cleanup(); window.removeEventListener('resize', onResize); root.replaceChildren(); },
  };
}
