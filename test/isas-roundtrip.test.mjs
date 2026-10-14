// SPDX-License-Identifier: AGPL-3.0-only
// A file exported here imports in Brihaspati's isas parser and vice versa. The other side is Brihaspati's own kernel
// (BRIH_KERNEL, default /Users/pkpro/sansos/scratch-brih-ux/kernel, brihaspati main 9d8e9ab); when it is absent only the
// byte-identical copy in js/isas/ is used and the run says so. Run: node test/isas-roundtrip.test.mjs
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import * as ours from '../js/isas/isas.mjs';
import { History } from '../js/history.mjs';

const dir = process.env.BRIH_KERNEL || '/Users/pkpro/sansos/scratch-brih-ux/kernel';
const have = fs.existsSync(path.join(dir, 'isas.mjs'));
const theirs = have ? await import(pathToFileURL(path.join(dir, 'isas.mjs')).href) : ours;
const lib = have ? await import(pathToFileURL(path.join(dir, 'library.mjs')).href) : await import('../js/isas/library.mjs');
console.log(have ? `other side: ${dir}` : 'other side: NOT FOUND, using the copy');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; } catch (e) { fail++; console.log(`FAIL ${n}: ${String(e.message).split('\n')[0]}`); } };
const fake = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const shape = (nb) => nb.cells.map((c) => [c.kind, c.body, c.output && c.output.map((o) => [o.type, o.data])]);

const st = fake(), h = new History(st, 'mantra');
await h.add({ input: 'धर्मक्षेत्रे कुरुक्षेत्रे\nसमवेता युयुत्सवः', kind: 'dev', result: 'anushtubh | GGLGGLLG' });
await h.add({ input: "nāsuro 'yaṃ na vā nāgo", kind: 'iast', result: 'r' });
const all = await h.exportAll(), one = await h.exportOne(h.list()[0].id);

await t('our export parses in Brihaspati parser, same cells as ours', () => { for (const x of [all, one]) assert.deepEqual(shape(theirs.parse(x)), shape(ours.parse(x))); });
await t('Brihaspati parser reads every run back (2 notes + 2 code cells)', () => { const nb = theirs.parse(all); assert.deepEqual(nb.cells.map((c) => c.kind), ['note', 'code', 'note', 'code']); assert.equal(nb.cells[3].body, "nāsuro 'yaṃ na vā nāgo"); });
await t('Brihaspati write -> our parse is lossless, and its text equals our write', async () => {
  const nb = ours.parse(all); const a = (await theirs.write(nb)).text, b = (await ours.write(nb)).text; assert.equal(a, b); assert.deepEqual(shape(ours.parse(a)), shape(nb));
});
await t('a notebook made and saved by Brihaspati Library imports here', async () => {
  const L = new lib.Library(fake()); const text = (await theirs.write({ header: [['title', 'from brihaspati']], cells: [{ kind: 'code', body: 'x^2 + 1', output: [{ type: 'text/plain', data: '2' }] }, { kind: 'note', body: 'prose', output: null }, { kind: 'code', body: 'second', output: null }] })).text;
  const r = L.create('from brihaspati', text); assert.ok(r.ok);
  const g = new History(fake(), 'editor'); const imp = await g.importText(L.get(r.id).text);
  assert.deepEqual([imp.ok, imp.added], [true, 2]); const l = g.list(); assert.equal(l.map((e) => e.input).sort().join('|'), 'second|x^2 + 1'); assert.equal(l.find((e) => e.input === 'x^2 + 1').result, '2');
});
await t('our export imports into a fresh History and equals the original runs', async () => {
  const g = new History(fake(), 'mantra'); const r = await g.importText(all); assert.equal(r.added, 2);
  assert.deepEqual(g.list().map(({ id, ...e }) => e), h.list().map(({ id, ...e }) => e));
});
await t('our export is stored in Brihaspati Library unchanged (it opens there as a notebook)', () => {
  const L = new lib.Library(fake()); const r = L.create('mantrasutra history', all); assert.ok(r.ok); assert.equal(L.get(r.id).text, all);
});
await t('the Brihaspati parser refuses what ours refuses (non-isas text)', () => { assert.throws(() => theirs.parse('hello'), (e) => /NotAnIsas/.test(e.name)); assert.throws(() => ours.parse('hello'), (e) => /NotAnIsas/.test(e.name)); });
console.log(`isas-roundtrip: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
