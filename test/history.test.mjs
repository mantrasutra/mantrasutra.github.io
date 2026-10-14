// SPDX-License-Identifier: AGPL-3.0-only
// Unit test: js/history.mjs over a fake Storage. Run: node test/history.test.mjs
import assert from 'node:assert/strict';
import { History, MAX_ENTRIES, MAX_INPUT } from '../js/history.mjs';
import { parse } from '../js/isas/isas.mjs';

let pass = 0, fail = 0;
const t = async (name, f) => { try { await f(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
const fake = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const quota = () => Object.assign(new Error('q'), { name: 'QuotaExceededError', code: 22 });
let tick = 0; const clock = () => () => new Date(Date.UTC(2026, 9, 14, 12, 0, tick++));
const mk = (page = 'mantra', st = fake()) => new History(st, page, { now: clock() });
const A = { input: 'तत्सवितुर्वरेण्यं', kind: 'dev', result: 'gayatri | GGLGG' };

await t('add then list newest first, fields intact', async () => {
  const h = mk(); assert.ok((await h.add(A)).ok); assert.ok((await h.add({ input: 'second', kind: 'iast', result: 'r2' })).ok);
  const l = h.list(); assert.equal(l.length, 2); assert.equal(l[0].input, 'second'); assert.equal(l[0].kind, 'iast'); assert.equal(l[1].result, A.result);
  assert.match(l[1].at, /^2026-10-14T12:00:0\d\.\d{3}Z$/); assert.equal(h.count(), 2);
});
await t('persists across instances on the same storage', async () => {
  const st = fake(); await mk('mantra', st).add(A);
  const l = mk('mantra', st).list(); assert.equal(l.length, 1); assert.equal(l[0].input, A.input);
});
await t('pages are separate lists', async () => {
  const st = fake(); await mk('mantra', st).add(A); const e = mk('editor', st); await e.add({ input: 'x^2', kind: 'plain', result: 'x**2' });
  assert.equal(mk('mantra', st).count(), 1); assert.equal(e.count(), 1); assert.equal(e.list()[0].input, 'x^2');
});
await t('same input and kind is moved to the top, not duplicated', async () => {
  const h = mk(); await h.add(A); await h.add({ ...A, input: 'other' }); await h.add({ ...A, result: 'newer' });
  const l = h.list(); assert.equal(l.length, 2); assert.equal(l[0].result, 'newer');
});
await t('empty and too large refused, nothing stored', async () => {
  const h = mk(); assert.equal((await h.add({ ...A, input: '  \n' })).why, 'empty'); assert.equal((await h.add({ ...A, input: 'a'.repeat(MAX_INPUT + 1) })).why, 'toolarge'); assert.equal(h.count(), 0);
});
await t('input that looks like an isas marker is refused, not corrupting', async () => {
  const h = mk(); const r = await h.add({ input: 'a\n॥ कोष्ठः 1 code ॥\nb', kind: 'dev', result: '' });
  assert.equal(r.ok, false); assert.equal(r.why, 'unwritable'); assert.equal(h.count(), 0);
});
await t('multi-line input and result roundtrip exactly (CRLF normalised)', async () => {
  const h = mk(); await h.add({ input: 'l1\r\nl2\n\nl4', kind: 'dev', result: 'a\nb' });
  const e = h.list()[0]; assert.equal(e.input, 'l1\nl2\n\nl4'); assert.equal(e.result, 'a\nb');
});
await t('cap of MAX_ENTRIES keeps the newest', async () => {
  const h = mk(); for (let i = 0; i < MAX_ENTRIES + 3; i++) await h.add({ input: `v${i}`, kind: 'dev', result: '' });
  const l = h.list(); assert.equal(l.length, MAX_ENTRIES); assert.equal(l[0].input, `v${MAX_ENTRIES + 2}`); assert.equal(l.at(-1).input, 'v3');
});
await t('remove and clear touch only this page', async () => {
  const st = fake(); const h = mk('mantra', st), e = mk('editor', st); await h.add(A); await h.add({ ...A, input: 'z' }); await e.add({ input: 'q', kind: 'plain', result: '' });
  h.remove(h.list()[0].id); assert.equal(h.count(), 1); h.clear(); assert.equal(h.count(), 0); assert.equal(e.count(), 1);
});
await t('storage that throws on construction: memory fallback, still works', async () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const h = mk('mantra', bad); assert.equal(h.persistent, false); assert.ok((await h.add(A)).ok); assert.equal(h.list().length, 1);
});
await t('null storage works the same', async () => { const h = mk('mantra', null); assert.equal(h.persistent, false); assert.ok((await h.add(A)).ok); });
await t('storage that dies after the probe: no throw, new runs kept in memory', async () => {
  const st = fake(); let dead = false; const s = { getItem: (k) => { if (dead) throw new Error('x'); return st.getItem(k); }, setItem: (k, v) => { if (dead) throw new Error('x'); st.setItem(k, v); }, removeItem: (k) => st.removeItem(k) };
  const h = mk('mantra', s); await h.add(A); dead = true; assert.ok((await h.add({ ...A, input: 'later' })).ok); assert.equal(h.persistent, false); assert.equal(h.list()[0].input, 'later');
});
await t('quota: add reports why=quota and keeps the list', async () => {
  const st = fake(); const h = mk('mantra', st); await h.add(A); const orig = st.setItem; st.setItem = () => { throw quota(); };
  const r = await h.add({ ...A, input: 'big' }); assert.equal(r.ok, false); assert.equal(r.why, 'quota'); assert.equal(h.list().length, 1); st.setItem = orig;
});
await t('corrupt index: starts empty, raw copy kept, no throw', async () => {
  const st = fake(); st.setItem('brih.lib.v1.index', '{not json'); const h = mk('mantra', st);
  assert.equal(h.count(), 0); assert.equal(st.getItem('brih.lib.v1.index.bad'), '{not json'); assert.ok((await h.add(A)).ok);
});
await t('exportOne is a valid isas notebook with note + code cell', async () => {
  const h = mk(); await h.add(A); const text = await h.exportOne(h.list()[0].id); const nb = parse(text);
  assert.equal(nb.cells.length, 2); assert.equal(nb.cells[0].kind, 'note'); assert.match(nb.cells[0].body, /^mantrasutra run: mantra, dev, 2026-10-14T/); assert.equal(nb.cells[1].kind, 'code'); assert.equal(nb.cells[1].body, A.input);
});
await t('exportAll then import into a fresh history restores all, oldest first order kept', async () => {
  const h = mk(); await h.add({ input: 'one', kind: 'dev', result: 'r1' }); await h.add({ input: 'two', kind: 'iast', result: 'r2' });
  const text = await h.exportAll(); const g = mk(); const r = await g.importText(text);
  assert.deepEqual([r.ok, r.added, r.skipped], [true, 2, 0]); const l = g.list(); assert.deepEqual(l.map((x) => x.input), ['two', 'one']); assert.deepEqual(l.map((x) => x.kind), ['iast', 'dev']); assert.equal(l[1].at, h.list()[1].at);
});
await t('import refuses a non-isas file and stores nothing', async () => {
  const h = mk(); const r = await h.importText('hello world'); assert.equal(r.ok, false); assert.match(r.name, /Isas/); assert.equal(h.count(), 0);
  const r2 = await h.importText(''); assert.equal(r2.ok, false);
});
await t('import of a plain Brihaspati notebook (no mantrasutra notes) maps each code cell to a run', async () => {
  const h = mk(); await h.add(A); const nb = parse(await h.exportAll());
  const text = (await h.exportAll()).replace(/mantrasutra run: [^\n]*/g, 'just a note');
  const g = mk('editor'); const r = await g.importText(text); assert.equal(r.added, 1); assert.equal(g.list()[0].kind, 'plain'); assert.ok(nb.cells.length >= 2);
});
await t('import tags from the other page count as other and are stored under their page', async () => {
  const st = fake(); const m = mk('mantra', st); await m.add(A); const text = await m.exportAll();
  const e = mk('editor', st); const r = await e.importText(text); assert.equal(r.other, 1); assert.equal(e.count(), 0); assert.equal(mk('mantra', st).count(), 1);
});
console.log(`history: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
