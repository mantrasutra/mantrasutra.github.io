// SPDX-License-Identifier: AGPL-3.0-only
// Run history: one run = one .isas notebook kept in a Library (js/isas/library.mjs, copied from Brihaspati). Pure; node and browser.
// A run is {page, kind, input, result, at}: input = the text analysed, result = a one-line summary, kind = script (mantra) or
// input kind (editor), at = ISO time. The same text is the file saved or exported, so Brihaspati opens it.
import { Library } from './isas/library.mjs';
import { parse, write, IsasError } from './isas/isas.mjs';

export const KINDS = { mantra: ['dev', 'iast'], editor: ['plain', 'latex', 'sutra', 'doc'] };
export const MAX_ENTRIES = 100, MAX_INPUT = 20000, MAX_RESULT = 4000;
const NOTE_RE = /^mantrasutra run: (mantra|editor), ([A-Za-z0-9_-]+), (\d{4}-\d\d-\d\dT[\d:.]+Z)$/;
const prefix = (page) => `${page} · `;
const oneLine = (s, n) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

const noteBody = (e) => `mantrasutra run: ${e.page}, ${e.kind}, ${e.at}`;
const cellsOf = (e) => [{ kind: 'note', body: noteBody(e), output: null }, { kind: 'code', body: e.input, output: [{ type: 'text/plain', data: e.result }] }];
const notebook = (title, entries, now) => ({ header: [['title', oneLine(title, 80)], ['created', now.toISOString()], ['app', 'mantrasutra']], cells: entries.flatMap(cellsOf) });

// parsed notebook -> entries; a note `mantrasutra run: ...` before a code cell gives its page, kind and time
export function entriesOf(nb, page, now = new Date()) {
  const out = []; let meta = null;
  for (const c of nb.cells) {
    if (c.kind === 'note') { const m = NOTE_RE.exec(c.body.trim()); meta = m ? { page: m[1], kind: m[2], at: m[3] } : null; continue; }
    if (c.kind !== 'code') { meta = null; continue; }
    const p = meta ? meta.page : page, ks = KINDS[p];
    const at = meta && !Number.isNaN(Date.parse(meta.at)) ? meta.at : now.toISOString();
    const part = (c.output || []).find((x) => x.type === 'text/plain');
    out.push({ page: p, kind: meta && ks.includes(meta.kind) ? meta.kind : ks[0], input: clean(c.body), result: part ? part.data : '', at });
    meta = null;
  }
  return out;
}

export class History {
  constructor(storage, page, { now = () => new Date() } = {}) {
    if (!KINDS[page]) throw new Error(`unknown page ${page}`);
    this.page = page; this.now = now; this.lib = new Library(storage);
  }
  get persistent() { return this.lib.persistent; }
  #rows(page = this.page) { return this.lib.list().filter((r) => r.title.startsWith(prefix(page))); }
  #read(r) {
    const g = this.lib.get(r.id); if (!g) return null;
    try { const e = entriesOf(parse(g.text), this.page)[0]; return e ? { id: r.id, ...e } : null; } catch { return null; }
  }
  /** this page's runs, newest first */
  list() { return this.#rows().map((r) => this.#read(r)).filter(Boolean); }
  get(id) { const r = this.#rows().find((x) => x.id === id); return r ? this.#read(r) : null; }
  count() { return this.#rows().length; }
  async #put(e, when) {
    for (const page of Object.keys(KINDS)) if (page === e.page) for (const r of this.#rows(page)) { const x = this.#read2(r, page); if (x && x.input === e.input && x.kind === e.kind) this.lib.remove(r.id); }
    const text = (await write(notebook(e.input.split('\n')[0] || 'run', [e], when))).text;
    const res = this.lib.create(prefix(e.page) + oneLine(e.input, 40), text, when);
    if (!res.ok) return res;
    const rows = this.#rows(e.page); for (const r of rows.slice(MAX_ENTRIES)) this.lib.remove(r.id);
    return { ok: true, id: res.id };
  }
  #read2(r, page) { const g = this.lib.get(r.id); if (!g) return null; try { return entriesOf(parse(g.text), page)[0] ?? null; } catch { return null; } }
  /** record a run. Returns {ok,id} or {ok:false, why: 'empty'|'toolarge'|'quota'|'storage'|'unwritable'} */
  async add({ input, kind, result }) {
    input = clean(input); result = clean(result).slice(0, MAX_RESULT);
    if (!input.trim()) return { ok: false, why: 'empty' };
    if (input.length > MAX_INPUT) return { ok: false, why: 'toolarge' };
    const when = this.now(), e = { page: this.page, kind: KINDS[this.page].includes(kind) ? kind : KINDS[this.page][0], input, result, at: when.toISOString() };
    try { return await this.#put(e, when); } catch (err) { if (err instanceof IsasError) return { ok: false, why: 'unwritable' }; throw err; }
  }
  remove(id) { return this.get(id) ? this.lib.remove(id) : { ok: false, why: 'missing' }; }
  clear() { for (const r of this.#rows()) this.lib.remove(r.id); }
  /** .isas text of one run, or of all this page's runs (oldest first) */
  async exportOne(id) { const e = this.get(id); return e ? (await write(notebook(e.input.split('\n')[0] || 'run', [e], this.now()))).text : null; }
  async exportAll() {
    const es = this.list().reverse();
    return (await write(notebook(`mantrasutra ${this.page} history`, es, this.now()))).text;
  }
  /** import .isas text. {ok:true, added, other, skipped} or {ok:false, name, why}; nothing is stored on a refusal */
  async importText(text) {
    let nb;
    try { nb = parse(String(text)); } catch (err) { return { ok: false, name: err instanceof IsasError ? err.name : 'ImportError', why: String(err && err.message || err) }; }
    let added = 0, other = 0, skipped = 0, lastWhy = null;
    for (const e of entriesOf(nb, this.page, this.now())) {
      if (!e.input.trim() || e.input.length > MAX_INPUT) { skipped++; continue; }
      let when = new Date(e.at); if (Number.isNaN(when.getTime())) when = this.now();
      let r; try { r = await this.#put({ ...e, result: e.result.slice(0, MAX_RESULT) }, when); } catch { r = { ok: false, why: 'unwritable' }; }
      if (r.ok) { added++; if (e.page !== this.page) other++; } else { skipped++; lastWhy = r.why; }
    }
    return { ok: true, added, other, skipped, why: lastWhy };
  }
}
