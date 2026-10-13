// SPDX-License-Identifier: AGPL-3.0-only
// Headless: node test/packs.test.mjs   (env VECTORS=path to ms3-vectors.json; SUTRA=path to sutra.mjs to override)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = new URL('.', import.meta.url);
const S = await import(process.env.SUTRA ? pathToFileURL(process.env.SUTRA).href : new URL('../js/sutra.mjs', here).href);
const P = await import('../js/packs.mjs');
import { existsSync } from 'node:fs';
const vecPath = process.env.VECTORS || ['./', '../', '../../', '../../../', '../../../../'].map(d => fileURLToPath(new URL(d + 'ms3-vectors.json', here))).find(existsSync);
if (!vecPath) throw new Error('ms3-vectors.json not found; set VECTORS=');
const V = JSON.parse(readFileSync(vecPath, 'utf8')).cases.filter(c => ['physics', 'chemistry', 'biology'].includes(c.feature));
await S.init?.();

const sha = u => createHash('sha256').update(u).digest('hex');
const bytes = u => (u instanceof Uint8Array ? u : new Uint8Array(u.buffer, u.byteOffset, u.byteLength));
function eq(got, want, path = '') { // want byte fields are {sha256,len}
  if (want && typeof want === 'object' && 'sha256' in want) {
    if (!got) return path + ': missing bytes';
    const b = bytes(got); return sha(b) === want.sha256 && b.length === want.len ? null : path + ': bytes differ';
  }
  if (want === null || typeof want !== 'object') return got === want ? null : `${path}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`;
  if (Array.isArray(want)) { if (!Array.isArray(got) || got.length !== want.length) return path + ': array'; for (let i = 0; i < want.length; i++) { const e = eq(got[i], want[i], path + '[' + i + ']'); if (e) return e; } return null; }
  for (const k of Object.keys(want)) { const e = eq(got?.[k], want[k], path + '.' + k); if (e) return e; }
  return null;
}
// independent closed forms (JS Math), keyed by identifier
const F = {
  'ph-boltzmann': p => Math.exp(-p.E / (p.k * p.T)),
  'ph-planck': p => p.x ** 3 / (Math.exp(p.x) - 1),
  'ph-lorentz': p => 1 / Math.sqrt(1 - p.v ** 2),
  'ph-coulomb': p => p.k * p.q * p.Q / p.r ** 2,
  'ph-oscillator': p => p.A * Math.cos(p.w * p.t),
  'ph-gauss': p => Math.exp(-(p.x ** 2) / (2 * p.s ** 2)),
  'ch-arrhenius': p => p.A * Math.exp(-p.E / (p.R * p.T)),
  'ch-nernst': p => p.U - (p.R * p.T / (p.n * p.F)) * Math.log(p.Q),
  'ch-henderson': p => p.p + Math.log(p.b / p.a) / Math.log(10),
  'ch-firstorder': p => p.c * Math.exp(-p.k * p.t),
  'ch-idealgas': p => p.n * p.R * p.T / p.V,
  'ch-langmuir': p => p.K * p.p / (1 + p.K * p.p),
  'bi-logistic': p => p.K / (1 + (p.K / p.N - 1) * Math.exp(-p.r * p.t)),
  'bi-michaelis': p => p.V * p.S / (p.K + p.S),
  'bi-hill': p => p.S ** 2 / (p.K ** 2 + p.S ** 2),
  'bi-gompertz': p => p.K * Math.exp(-p.b * Math.exp(-p.c * p.t)),
  'bi-hardyweinberg': p => 2 * p.p * (1 - p.p),
  'bi-expgrowth': p => p.N * Math.exp(p.r * p.t),
};
const rat = s => { const [a, b] = String(s).split('/'); return b ? +a / +b : +a; };

let pass = 0, fail = 0;
const ok = (name, err) => { if (err) { fail++; console.log('FAIL', name, err); } else pass++; };

// 1. replay all 72 vector cases through request()
for (const c of V) {
  let got; try { got = await S.request(c.req); } catch (e) { ok(c.id, 'threw ' + e); continue; }
  ok(c.id, eq(got, c.want));
}
// 2. pack files: data-driven checks against the vectors and independent closed forms
const packs = await P.loadPacks();
ok('pack-count', packs.length === 18 ? null : 'expected 18, got ' + packs.length);
const byId = Object.fromEntries(V.map(c => [c.id, c]));
for (const pk of packs) {
  const inn = byId[pk.id + '-in'].want, val = byId[pk.id + '-val'];
  ok(pk.id + ':sutra-derived', pk.sutra === inn.sutra && pk.latex === inn.latex && pk.declarations === inn.declarations ? null : 'pack sutra differs from engine output');
  const r = await P.evalPack(pk, {});
  ok(pk.id + ':evalPack', eq(r, val.want));
  const g = await P.samplePack(pk);
  ok(pk.id + ':samplePack', eq(g, byId[pk.id + '-smp'].want));
  const x = F[pk.id](Object.fromEntries(Object.entries(pk.params).map(([k, v]) => [k, rat(v)])));
  const y = parseFloat(r.re), rel = Math.abs(y - x) / Math.max(Math.abs(x), 1e-300);
  ok(pk.id + ':closed-form', rel <= 1e-12 ? null : `rel ${rel} (engine ${y}, js ${x})`);
  ok(pk.id + ':honest-label', /not engine-verified/.test(pk.status) ? null : 'missing status label');
}
// 3. refusals are returned, never thrown
const bad = await P.evalPack(packs[0], { E: 'abc' }).catch(e => ({ thrown: e }));
ok('refusal-not-thrown', bad && !bad.thrown ? null : 'threw');
console.log(`packs: ${fail ? 'FAIL' : 'PASS'} ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
