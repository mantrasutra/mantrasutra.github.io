// SPDX-License-Identifier: AGPL-3.0-only
// History sidebar (DOM). Local only: no network. Storage access is guarded; a page whose storage throws keeps a session-only list.
import { History } from './history.mjs';

const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (/^(data-|aria-)/.test(k)) e.setAttribute(k, v); else e[k] = v; } e.append(...kids); return e; };
const WHY = { empty: 'nothing to add: the input is empty', toolarge: 'too large to keep', quota: 'browser storage is full', storage: 'storage is unavailable', unwritable: 'this text cannot be stored in the .isas format', missing: 'no such run' };
export const storageOrNull = () => { try { return window.localStorage; } catch { return null; } };
const fmtTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
const download = (name, text) => {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const stamp = (iso) => iso.slice(0, 19).replace(/[-:T]/g, '');

/** mountHistory(root, {page, storage?, onOpen(entry), onRerun(entry)}) -> {add(run), history, refresh()}. */
export function mountHistory(root, { page, storage = storageOrNull(), onOpen = () => {}, onRerun = () => {} }) {
  const history = new History(storage, page);
  let openId = null;
  const count = el('span'), list = el('ol', { 'aria-label': 'saved runs' }), msg = el('p', { className: 'msg', role: 'status' });
  const saved = el('div', { className: 'saved', hidden: true });
  const file = el('input', { type: 'file', accept: '.isas,text/plain', 'aria-label': 'import .isas file' });
  const say = (t, bad = false) => { msg.textContent = t; msg.className = bad ? 'msg bad' : 'msg'; };
  const btn = (text, fn, extra = {}) => el('button', { type: 'button', textContent: text, onclick: fn, ...extra });
  const note = el('p', { className: 'note' });

  const show = (e) => {
    openId = e.id; saved.hidden = false;
    saved.replaceChildren(el('h2', { textContent: 'Saved result' }), el('pre', { textContent: e.result || '(no result stored)' }));
    onOpen(e); render();
  };
  function render() {
    const es = history.list();
    count.textContent = ` (${es.length})`;
    note.textContent = history.persistent ? 'Kept in this browser only.' : 'Browser storage is unavailable: this list lasts until you close the page.';
    list.replaceChildren(...es.map((e) => el('li', { className: e.id === openId ? 'on' : '', 'data-id': e.id },
      el('button', { type: 'button', className: 'open', title: 'Open this run', onclick: () => show(e) },
        el('span', { className: 'in', textContent: e.input.split('\n')[0] }), el('span', { className: 'res', textContent: e.result.split('\n')[0] }), el('span', { className: 'when', textContent: `${e.kind} · ${fmtTime(e.at)}` })),
      el('div', { className: 'acts' },
        btn('Re-run', () => onRerun(e), { 'data-act': 'rerun', title: 'Run this input again' }),
        btn('Save', async () => { download(`${page}-${stamp(e.at)}.isas`, await history.exportOne(e.id)); }, { 'data-act': 'save', title: 'Save as .isas (opens in Brihaspati too)' }),
        btn('Delete', () => { history.remove(e.id); if (openId === e.id) { openId = null; saved.hidden = true; } render(); }, { 'data-act': 'del' })))));
    if (!es.length) list.replaceChildren(el('li', { textContent: 'No runs yet.' }));
  }
  file.onchange = async () => {
    const f = file.files && file.files[0]; if (!f) return;
    let text; try { text = await f.text(); } catch { say('could not read that file', true); return; }
    file.value = '';
    const r = await history.importText(text);
    if (!r.ok) { say(`not imported: ${r.name}: ${r.why}`, true); return; }
    render(); say(`imported ${r.added} run(s)${r.other ? `, ${r.other} from the other page` : ''}${r.skipped ? `, ${r.skipped} skipped${r.why ? ` (${WHY[r.why] || r.why})` : ''}` : ''}`, !!r.skipped);
  };
  const aside = el('aside', { className: 'hx', 'aria-label': 'history', id: 'history' },
    el('h2', {}, 'History', count), note,
    el('div', { className: 'hx-tools' },
      btn('Export all', async () => { if (!history.count()) { say('nothing to export', true); return; } download(`${page}-history.isas`, await history.exportAll()); }, { 'data-act': 'export' }),
      el('label', { className: 'hx-btn' }, 'Import ', file),
      btn('Clear', () => { if (!history.count() || confirm('Delete all saved runs on this page?')) { history.clear(); openId = null; saved.hidden = true; render(); } }, { 'data-act': 'clear' })),
    msg, list, saved);
  root.replaceChildren(aside);
  render();
  return {
    history, refresh: render,
    async add(run) { const r = await history.add(run); if (r.ok) { openId = r.id; saved.hidden = true; say(''); } else say(`not added: ${WHY[r.why] || r.why}`, true); render(); return r; },
  };
}
