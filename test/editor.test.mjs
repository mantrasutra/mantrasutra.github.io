// SPDX-License-Identifier: AGPL-3.0-only
// Replays the 36 `editor` vectors headless. Uses the real vendored Pyodide engine from the viewer tree (VIEWER=path to override).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { parsedToViews, refusalText } from '../js/editor.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const VEC = process.env.VECTORS || path.resolve(here, 'ms3-vectors.json');
const S = await import('../js/sutra.mjs'); await S.init();
const eng = { request: (o) => S.request(o) };
const cases = JSON.parse(fs.readFileSync(VEC, 'utf8')).cases.filter((c) => c.feature === 'editor');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let fail = 0;
const bad = (id, m) => { fail++; console.log('FAIL', id, m); };
if (cases.length !== 36) bad('count', cases.length);
for (const c of cases) {
  let got;
  try { got = await eng.request(c.req); } catch (e) { bad(c.id, 'threw ' + e.message); continue; }
  if (!eq(got, c.want)) { bad(c.id, 'request != want'); continue; }
  const v = parsedToViews(got);
  if (got.ok) {
    for (const k of ['sutra', 'declarations', 'latex', 'gloss_en']) if (v[k] !== c.want[k]) bad(c.id, 'view ' + k);
    if (Object.keys(v).length !== 4) bad(c.id, 'view keys');
  } else {
    if (v !== got) bad(c.id, 'refusal not passed through');
    if (!refusalText(got).includes(got.why) || !refusalText(got).includes(got.name)) bad(c.id, 'refusal text');
  }
  // round trip: re-parsing the canonical sutra reproduces the same canonical sutra (up to prakritih)
  if (got.ok && c.req.op === 'from_input') {
    const r2 = await eng.request({ op: 'from_sutra', text: got.sutra });
    if (!r2.ok || r2.sutra !== got.sutra) bad(c.id, 'canonical round trip');
  }
}
console.log(`editor: ${cases.length - fail > 0 && !fail ? 'PASS' : 'FAIL'} (${cases.length} cases, ${fail} failures)`);
process.exit(fail ? 1 : 0);
