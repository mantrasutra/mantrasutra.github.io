// SPDX-License-Identifier: AGPL-3.0-only
// Headless page test (playwright-core + Chrome). The engine (js/sutra.mjs, 25 MB Pyodide) is replaced by a stub via a route,
// so this tests the history UI, not the engine. Run: node test/history-page.test.mjs
// Env: PW (playwright-core dir), CHROME (binary), SHOTS (dir for screenshots, optional), VERBOSE.
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const PW = process.env.PW || '/Users/pkpro/upperspace3/explainer-videos/node_modules/playwright-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(path.join(PW, 'index.mjs')).href);

const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const STUB = `
const syl = (a, w) => ({ aksara: a, weight: w, why: 'stub', anceps: false });
export const init = async () => ({ version: 'stub' });
export const verse = async (t) => ({ padas: [{ n: 1, syllables: [...t.replace(/\\s/g, '')].slice(0, 6).map((c, i) => syl(c, i % 2 ? 'L' : 'G')), ganas: ['ya'], matra: 6, uddishta: 1, length: 6 }], metre: { metre: 'stub-metre:' + t.length, note: '', deviations: [] }, explanation: ['e'] });
export const textInfo = async () => ({ words: [], links: [] });
export const structure = async () => ({ figures: [], note: '' });
export const fromInput = async (t, o) => ({ ok: true, sutra: 'S(' + t + ')', declarations: '', latex: t, gloss_en: 'g', canonical: 'S(' + t + ')' });
export const fromSutra = fromInput; export const parseDoc = async (t) => ({ ok: true, canonical: t, sections: 1 });
`;
const hosts = new Set(), bad = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0, fail = 0;
const t = async (name, f) => { try { await f(); pass++; if (process.env.VERBOSE) console.log('ok', name); } catch (e) { fail++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };

async function open(browserCtxOpts, url, { throwing = false } = {}) {
  const ctx = browserCtxOpts.ctx || await browser.newContext({ viewport: browserCtxOpts.viewport || { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1') { hosts.add(u.host); bad.push(route.request().url()); return route.abort(); }
    if (u.pathname === '/js/sutra.mjs') return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  if (throwing) await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  await page.goto(base + url); await page.waitForSelector('#history');
  return { ctx, page, errs };
}
const items = (page) => page.$$eval('#history li[data-id]', (l) => l.map((x) => x.textContent));
const analyse = async (page, text, script = 'dev') => {
  await page.fill('#app textarea', text); await page.check(`input[name=script][value=${script}]`);
  await page.waitForFunction(() => !document.querySelector('#app button').disabled); await page.click('#app button:has-text("Analyse")');
  await page.waitForFunction((n) => document.querySelectorAll('#history li[data-id]').length >= n || true, 0);
};
const waitCount = (page, n) => page.waitForFunction((n) => document.querySelectorAll('#history li[data-id]').length === n, n);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const A = 'तत्सवितुर्वरेण्यं', B = 'अथातो ब्रह्मजिज्ञासा';
const { ctx, page, errs } = await open({}, '/mantra.html');
await t('starts empty', async () => { assert.match(await page.textContent('#history'), /No runs yet/); assert.match(await page.textContent('#history h2'), /History \(0\)/); });
await t('add: an Analyse click adds a run with input, result and time', async () => {
  await analyse(page, A); await waitCount(page, 1); const s = (await items(page))[0];
  assert.ok(s.includes(A)); assert.ok(s.includes('stub-metre:')); assert.match(s, /dev · /); assert.match(await page.textContent('#history h2'), /\(1\)/);
});
await t('second run lands on top; list newest first', async () => { await analyse(page, B, 'iast'); await waitCount(page, 2); const s = await items(page); assert.ok(s[0].includes(B)); assert.ok(s[1].includes(A)); });
await t('click reopens input, script and saved result', async () => {
  await page.fill('#app textarea', 'changed'); await page.click(`#history li[data-id] >> nth=1 >> .open`);
  assert.equal(await page.inputValue('#app textarea'), A); assert.equal(await page.isChecked('input[value=dev]'), true);
  assert.match(await page.textContent('#history .saved'), /stub-metre:/);
});
await t('re-run: input comes back, analysis runs again, run moves to top (no duplicate)', async () => {
  await page.fill('#app textarea', 'x'); await page.click('#history li[data-id] >> nth=1 >> [data-act=rerun]');
  await page.waitForFunction((a) => document.querySelector('#history li[data-id] .in').textContent === a, A);
  assert.equal(await page.inputValue('#app textarea'), A); assert.equal((await items(page)).length, 2); assert.ok(await page.$('#app .metre'));
});
await t('reload persistence', async () => { await page.reload(); await page.waitForSelector('#history'); await waitCount(page, 2); const s = await items(page); assert.ok(s[0].includes(A)); assert.ok(s[1].includes(B)); });
let exported = '';
await t('export all downloads a .isas that parses', async () => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  assert.equal(d.suggestedFilename(), 'mantra-history.isas'); exported = fs.readFileSync(await d.path(), 'utf8');
  const isas = await import(pathToFileURL(path.join(root, 'js/isas/isas.mjs')).href); const nb = isas.parse(exported); assert.deepEqual(nb.cells.map((c) => c.kind), ['note', 'code', 'note', 'code']);
});
await t('per-run Save downloads a one-run .isas', async () => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#history li[data-id] >> nth=0 >> [data-act=save]')]);
  assert.match(d.suggestedFilename(), /^mantra-\d{14}\.isas$/); assert.ok(fs.readFileSync(await d.path(), 'utf8').includes(A));
});
await t('delete one, then import restores it', async () => {
  await page.click('#history li[data-id] >> nth=0 >> [data-act=del]'); await waitCount(page, 1);
  await page.setInputFiles('#history input[type=file]', { name: 'h.isas', mimeType: 'text/plain', buffer: Buffer.from(exported) });
  await page.waitForFunction(() => /imported/.test(document.querySelector('#history .msg').textContent)); await waitCount(page, 2);
});
await t('import of a non-isas file is refused with a message, list unchanged', async () => {
  await page.setInputFiles('#history input[type=file]', { name: 'x.isas', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForFunction(() => /not imported/.test(document.querySelector('#history .msg').textContent)); assert.equal((await items(page)).length, 2);
});
await t('clear empties the list (after confirm)', async () => { page.once('dialog', (d) => d.accept()); await page.click('[data-act=clear]'); await waitCount(page, 0); });
await t('no page errors on mantra', () => assert.deepEqual(errs, []));
await page.screenshot({ path: path.join(os.tmpdir(), 'unused.png') }).catch(() => {});
await analyse(page, A); await analyse(page, B, 'iast'); await waitCount(page, 2);
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'MANTRASUTRA-UX-built.png') });
await ctx.close();

// editor page
{
  const { ctx, page, errs } = await open({}, '/editor.html');
  await t('editor: add to history records input, kind and result', async () => {
    await page.fill('textarea[aria-label="formula input"]', 'a+b'); await page.waitForFunction(() => document.querySelector('#status').textContent === 'parsed'); await page.waitForTimeout(400);
    await page.click('#hx-add'); await waitCount(page, 1); const s = (await items(page))[0]; assert.ok(s.includes('a+b')); assert.ok(s.includes('S(a+b)')); assert.match(s, /plain · /);
  });
  await t('editor: reopen and re-run put the input back', async () => {
    await page.fill('textarea[aria-label="formula input"]', 'zzz'); await page.click('#history li[data-id] .open');
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="formula input"]').value === 'a+b');
    await page.fill('textarea[aria-label="formula input"]', 'qqq'); await page.click('[data-act=rerun]');
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="formula input"]').value === 'a+b');
  });
  await t('editor and mantra lists are separate in the same origin', async () => { const p2 = await ctx.newPage(); await p2.goto(base + '/mantra.html'); await p2.waitForSelector('#history'); assert.match(await p2.textContent('#history h2'), /\(0\)/); await p2.close(); });
  await t('no page errors on editor', () => assert.deepEqual(errs, []));
  await ctx.close();
}

// storage throwing
for (const url of ['/mantra.html', '/editor.html']) {
  const { ctx, page, errs } = await open({}, url, { throwing: true });
  await t(`storage throws (${url}): page loads, session list works, notice shown`, async () => {
    assert.match(await page.textContent('#history .note'), /unavailable/);
    if (url === '/mantra.html') await analyse(page, A); else { await page.waitForTimeout(400); await page.click('#hx-add'); }
    await waitCount(page, 1); assert.deepEqual(errs, []);
  });
  await ctx.close();
}
// quota
{
  const { ctx, page, errs } = await open({}, '/mantra.html');
  await t('quota error on write: message shown, no page error', async () => {
    await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith('brih.lib.v1.nb.') && !k.endsWith('probe')) throw Object.assign(new DOMException('full', 'QuotaExceededError'), {}); return o.call(this, k, v); }; });
    await analyse(page, A); await page.waitForFunction(() => /not added/.test(document.querySelector('#history .msg').textContent)); assert.deepEqual(errs, []);
  });
  await ctx.close();
}
// phone width
for (const url of ['/mantra.html', '/editor.html']) {
  const { ctx, page } = await open({ viewport: { width: 390, height: 800 } }, url);
  await t(`phone 390 (${url}): no horizontal scroll`, async () => {
    if (url === '/mantra.html') { await analyse(page, A); await analyse(page, 'तत्सवितुर्वरेण्यं भर्गो देवस्य धीमहि अथातो ब्रह्मजिज्ञासा', 'dev'); await waitCount(page, 2); }
    else { await page.waitForTimeout(500); await page.click('#hx-add'); await waitCount(page, 1); }
    assert.ok(await overflow(page) <= 0, `overflow ${await overflow(page)}`);
  });
  if (url === '/mantra.html' && process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'MANTRASUTRA-UX-built-390.png'), fullPage: true });
  await ctx.close();
}
await t('no request left the origin (hosts other than 127.0.0.1)', () => assert.deepEqual(bad, [], [...hosts].join(',')));
await browser.close(); server.close();
console.log(`history-page: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
