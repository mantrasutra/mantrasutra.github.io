// SPDX-License-Identifier: AGPL-3.0-only
// Explorer tests: sample() replay of the "explorer" vectors (sha256+len), pole NaN+mask, manifest lengths, headless renderers.
// Run in the assembled tree via test/run-all.mjs explorer, or standalone: node test/explorer.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as X from '../js/explorer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (u8) => crypto.createHash('sha256').update(u8).digest('hex');
const bytes = (f) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
const fileFetch = (base) => async (url) => { const b = fs.readFileSync(path.join(base, url)); return { json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };

async function findSutra() {
  for (const p of ['../js/sutra.mjs', '../../core/js/sutra.mjs']) {
    const f = path.resolve(root, 'test', p);
    if (fs.existsSync(f)) return { S: await import(pathToFileURL(f).href), base: path.resolve(path.dirname(f), '..') };
  }
  return null;
}

export async function run({ loadVectors, eq } = {}) {
  let pass = 0, fail = 0; const msgs = [], skipped = [];
  const check = (n, ok, x) => { if (ok) pass++; else { fail++; msgs.push(n + (x ? ' ' + x : '')); } };
  const vecs = loadVectors ? loadVectors('explorer') : JSON.parse(fs.readFileSync(path.join(root, 'test/ms3-vectors.json'), 'utf8')).cases.filter((c) => c.feature === 'explorer');

  // 1. manifest files: every series file length = axes product * 8 (mask: axes product)
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'data/index.json')));
  for (const id of ['bessel-heat', 'lambert-w', 'polylog-reim', 'zeta-critical', ...idx.map((e) => e.id)]) {
    const m = await X.loadManifest('data', id, fileFetch(root));
    const bad = X.checkManifestLengths(m);
    check('manifest ' + id, bad.length === 0, bad.join('; '));
    for (const s of m.series) {
      const fnd = s.re.every((v, k) => (s.mask[k] === 1) === !Number.isFinite(v) || s.mask[k] === 0);
      check('mask/NaN ' + id, fnd);
      if (s.sha256) check('sha256 ' + id + '/' + s.file, sha(bytes(s.re)) === s.sha256);
    }
  }
  // 2. headless renderers on example data
  const stub = () => { const calls = []; return new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: () => true }); };
  const lw = await X.loadManifest('data', 'lambert-w', fileFetch(root));
  const g = stub(); X.renderCurve(g, lw.series, { w: 400, h: 300, labels: ['a', 'b'] });
  check('curve strokes', g.calls.filter((c) => c[0] === 'stroke').length >= 2);
  const gaps = lw.series[0].mask.reduce((a, b) => a + b, 0);
  const hm = await X.loadManifest('data', 'bessel-heat', fileFetch(root));
  let put = null; const mk = (w, h) => ({ getContext: () => ({ putImageData: (img) => { put = img; } }) });
  globalThis.ImageData ??= class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
  X.renderHeat(stub(), hm.series[0], { w: 300, h: 300, makeCanvas: mk });
  check('heat pixels', put && put.data.length === 121 * 121 * 4 && put.data[3] === 255);
  const pl = await X.loadManifest('data', 'polylog-reim', fileFetch(root));
  X.renderDomain(stub(), { ...pl.series[0], shape: [61, 61] }, { w: 300, h: 300, makeCanvas: mk });
  check('domain pixels', put.data.length === 61 * 61 * 4);
  // mesh: a masked vertex removes exactly its (up to four) quads
  const n = 5, pos = new Float32Array(n * n * 3).map((_, i) => ((i / 3) | 0) % n * (i % 3 === 0) + 0), col = new Float32Array(n * n * 3);
  const full = X.buildMesh(n, n, pos, col, () => false), hole = X.buildMesh(n, n, pos, col, (k) => k === 12);
  check('mesh quads', full.count === 16 * 6 && hole.count === 12 * 6, `${full.count}/${hole.count}`);
  const zc = X.zerosCheck(lw.series[0], []);
  check('zerosCheck', zc.total === 0);
  const zl = await X.loadManifest('data', 'zeta-critical', fileFetch(root));
  const z = X.zerosCheck(zl.series[0], zl.zeros);
  check('zeta zeros on sign changes', z.matched === z.total && z.total > 0, JSON.stringify(z));
  check('axisVals', X.axisVals({ lo: '-9/2', hi: '5', n: 39 })[0] === -4.5);

  // 3. live replay through sample()
  const sut = await findSutra();
  if (!sut) skipped.push('js/sutra.mjs not found: sample() replay skipped');
  else {
    await sut.S.init({ base: sut.base });
    for (const c of vecs) {
      const r = c.req, got = await sut.S.sample(r.text, r.env, r.axes, { fixed: r.fixed, complex: !!r.complex });
      const w = c.want;
      if (!w.ok) { check(c.id, JSON.stringify({ ok: got.ok, code: got.code, name: got.name, why: got.why }) === JSON.stringify(w)); continue; }
      const ok = got.ok && JSON.stringify(got.shape) === JSON.stringify(w.shape)
        && sha(bytes(got.re)) === w.re.sha256 && got.re.length * 8 === w.re.len
        && (w.im === null ? got.im === null : got.im && sha(bytes(got.im)) === w.im.sha256 && got.im.length * 8 === w.im.len)
        && sha(got.mask) === w.mask.sha256 && got.mask.length === w.mask.len;
      check(c.id, ok, JSON.stringify(got).slice(0, 100));
      if (got.ok) for (let k = 0; k < got.re.length; k++) if (got.mask[k] === 1 && !Number.isNaN(got.re[k])) { check(c.id + ' pole NaN', false); break; }
    }
    const pole = await sut.S.sample('ळपकः क्षे', { 'क्ष': ['var', 0, 'm'] }, [{ name: 'क्ष', lo: '-1', hi: '1', n: 3 }]);
    check('pole NaN+mask', pole.ok && Number.isNaN(pole.re[1]) && pole.mask[1] === 1);
    check('gaps counted', gaps >= 0);
  }
  return { pass, fail, msgs, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await run();
  console.log(`explorer: ${r.pass} pass, ${r.fail} fail${r.skipped.length ? ', skipped: ' + r.skipped.join('; ') : ''}`);
  for (const m of r.msgs) console.log('  FAIL', m);
  process.exit(r.fail ? 1 : r.skipped.length ? 77 : 0);
}
