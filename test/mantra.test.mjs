// SPDX-License-Identifier: AGPL-3.0-only
// Replays the 18 'mantra' vectors through mantra.mjs. Run: node test/mantra.test.mjs
// VECTORS=<path to ms3-vectors.json> overrides the default lookup.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as S from '../js/sutra.mjs';
import { analyseVerse, weightString, padaWeights, explorerLink, parseCurveQuery, EXAMPLES } from '../js/mantra.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cands = [process.env.VECTORS, path.join(here, 'ms3-vectors.json'), path.join(here, '../ms3-vectors.json'), path.join(here, '../../../ms3-vectors.json')].filter(Boolean);
const vpath = cands.find((p) => fs.existsSync(p));
if (!vpath) throw new Error('ms3-vectors.json not found');
const cases = JSON.parse(fs.readFileSync(vpath, 'utf8')).cases.filter((c) => c.feature === 'mantra');
assert.equal(cases.length, 18);

await S.init();
let pass = 0, fail = 0;
const ok = (id, f) => { try { f(); pass++; } catch (e) { fail++; console.log(`FAIL ${id}: ${e.message.split('\n')[0]}`); } };
const norm = (x) => JSON.parse(JSON.stringify(x));
const fn = { verse: S.verse, text: S.textInfo, structure: S.structure };

for (const c of cases) {
  const r = await fn[c.req.op](c.req.text, { script: c.req.script || 'dev' });
  ok(c.id, () => assert.deepEqual(norm(r), c.want));
}
// weightString on verse-dev-0 equals join of vector weights
const v0 = cases.find((c) => c.id === 'verse-dev-0');
const full = await analyseVerse(v0.req.text, { script: 'dev' });
ok('weightString', () => {
  assert.ok(full.verse);
  const want = v0.want.padas.flatMap((p) => p.syllables.map((s) => s.weight)).join('');
  assert.equal(weightString(full.verse), want);
  assert.equal(padaWeights(full.verse).join(''), want);
  assert.equal(padaWeights(full.verse)[0], v0.want.padas[0].pattern);
});
ok('explorerLink', () => {
  const q = parseCurveQuery(explorerLink(full.verse, { label: 'x' }).split('?')[1]);
  assert.equal(q.series, weightString(full.verse)); assert.equal(q.values.length, q.series.length);
});
ok('examples', () => { for (const e of EXAMPLES) assert.ok(e.cite && e.text); });
const bad = await analyseVerse('', { script: 'dev' });
ok('refusal-verbatim', () => assert.ok(bad.ok === false ? typeof bad.why === 'string' : true));
console.log(`mantra: ${fail ? 'FAIL' : 'PASS'} ${pass} ok ${fail} fail`);
process.exit(fail ? 1 : 0);
