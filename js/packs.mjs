// SPDX-License-Identifier: AGPL-3.0-only
// Domain packs: named formulas <-> sutra terms, evaluated by the engine through js/sutra.mjs (section-2 API only).
// Honest scope: the map is an isomorphism with a countable term algebra (up to canonical form), not with all analytic functions.
import * as S from './sutra.mjs';

export const DOMAINS = ['physics', 'chemistry', 'biology'];

// parsedToViews STUB (section 3): the Editor builder owns the real one. Shape is fixed.
export function parsedToViews(p) {
  return { sutra: p.sutra, declarations: p.declarations, latex: p.latex, gloss_en: p.gloss_en };
}

async function readJson(rel) {
  const url = new URL(rel, import.meta.url);
  if (typeof process !== 'undefined' && process.versions && process.versions.node && url.protocol === 'file:') {
    const fs = 'node:fs/promises', u = 'node:url';
    const { readFile } = await import(fs); const { fileURLToPath } = await import(u);
    return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
  }
  const r = await fetch(url); // same-origin static file
  if (!r.ok) throw new Error('cannot load ' + rel);
  return r.json();
}

export async function loadPacks() {
  const out = [];
  for (const d of DOMAINS) out.push(...(await readJson('../packs/' + d + '.json')).items);
  return out;
}

// vals may be keyed by plain identifier (E, k, T) or by stem; values are rational text or numbers.
function stemVals(pack, vals) {
  const id2stem = Object.fromEntries(pack.resolved.map(r => [r.identifier, r.stem]));
  const o = {};
  for (const [k, x] of Object.entries(vals)) o[id2stem[k] || k] = String(x);
  return o;
}
const stemOf = (pack, name) => (pack.resolved.find(r => r.identifier === name) || { stem: name }).stem;

export function evalPack(pack, vals = {}, opts = {}) {
  return S.value(pack.sutra, pack.env, stemVals(pack, { ...pack.params, ...vals }), { digits: opts.digits || 30 });
}

// axis: {name, lo, hi, n} (name = identifier or stem); other parameters fixed from pack.params overlaid by vals.
export function samplePack(pack, axis = pack.axis, vals = {}) {
  const a = { name: stemOf(pack, axis.name), lo: String(axis.lo), hi: String(axis.hi), n: axis.n || 21 };
  const fixed = stemVals(pack, { ...pack.params, ...vals });
  delete fixed[a.name];
  return S.sample(pack.sutra, pack.env, [a], { fixed, complex: false });
}

// ---- UI (DOM + Canvas2D). Text is shown verbatim; refusals show name + why. ----
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === 'text' ? (e.textContent = v) : k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
}
export function drawCurve(canvas, grid, axis) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, n = grid.re.length;
  const css = getComputedStyle(canvas); ctx.clearRect(0, 0, W, H);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) if (!grid.mask[i] && isFinite(grid.re[i])) { lo = Math.min(lo, grid.re[i]); hi = Math.max(hi, grid.re[i]); }
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const x = i => 30 + (W - 40) * i / (n - 1), y = v => H - 20 - (H - 30) * (v - lo) / (hi - lo);
  ctx.strokeStyle = css.color; ctx.fillStyle = css.color; ctx.font = '11px sans-serif';
  ctx.globalAlpha = .4; ctx.strokeRect(30, 10, W - 40, H - 30); ctx.globalAlpha = 1;
  ctx.fillText(String(+hi.toPrecision(3)), 2, 18); ctx.fillText(String(+lo.toPrecision(3)), 2, H - 20);
  ctx.fillText(axis.lo + '  ' + axis.name + '  ' + axis.hi, 30, H - 4);
  ctx.beginPath(); let pen = false; // mask-1 points are gaps, never interpolated
  for (let i = 0; i < n; i++) {
    if (grid.mask[i] || !isFinite(grid.re[i])) { pen = false; continue; }
    pen ? ctx.lineTo(x(i), y(grid.re[i])) : ctx.moveTo(x(i), y(grid.re[i])); pen = true;
  }
  ctx.lineWidth = 2; ctx.stroke();
  for (let i = 0; i < n; i++) if (!grid.mask[i] && isFinite(grid.re[i])) ctx.fillRect(x(i) - 2, y(grid.re[i]) - 2, 4, 4);
}

export function mountPackBrowser(root, packs) {
  root.textContent = '';
  const tabs = el('div', { role: 'tablist' }), list = el('ul'), detail = el('div');
  root.append(tabs, list, detail);
  let dom = DOMAINS[0], sel = null, seq = 0;
  const showRef = (r) => el('p', { role: 'alert', text: r.name + ': ' + r.why });
  async function show(pack) {
    sel = pack; const my = ++seq; detail.textContent = '';
    const inputs = {};
    const form = el('div');
    for (const [k, v] of Object.entries(pack.params)) {
      const inp = el('input', { value: v, size: 6, 'aria-label': k + ' = ' + (pack.legend[k] || '') });
      inp.addEventListener('input', refresh); inputs[k] = inp;
      form.append(el('label', {}, k + ' (' + (pack.legend[k] || '') + ') ', inp), ' ');
    }
    const readout = el('p', { 'aria-live': 'polite' }), canvas = el('canvas', { width: 480, height: 220, 'aria-label': 'curve of ' + pack.title });
    detail.append(el('h3', { text: pack.title }),
      el('p', {}, 'plain: ', el('code', { text: pack.plain })),
      el('p', {}, 'LaTeX: ', el('code', { text: pack.latex })),
      el('p', {}, 'सूत्र: ', el('code', { text: pack.sutra })),
      el('p', { text: pack.gloss_en }), form, readout, canvas,
      el('p', { text: 'Units: ' + pack.units + '. ' + pack.meaning }),
      el('p', { text: 'Illustrative commentary, not engine-verified.' }));
    async function refresh() {
      const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
      const [r, g] = await Promise.all([evalPack(pack, v), samplePack(pack, pack.axis, v)]);
      if (my !== seq) return; // stale
      readout.textContent = S.isRefusal(r) ? r.name + ': ' + r.why : 'value = ' + r.re.slice(0, 14) + (r.im && !/^-?0\.?0*$/.test(r.im) ? ' + ' + r.im.slice(0, 14) + 'i' : '') + '  (30 digits available)';
      if (!S.isRefusal(g)) drawCurve(canvas, g, pack.axis); else readout.append(' ', showRef(g));
    }
    refresh();
  }
  function fill() {
    tabs.textContent = ''; list.textContent = '';
    for (const d of DOMAINS) tabs.append(el('button', { role: 'tab', 'aria-selected': String(d === dom), text: d, onclick: () => { dom = d; fill(); } }), ' ');
    for (const p of packs.filter(p => p.domain === dom)) list.append(el('li', {}, el('button', { text: p.title + '  ' + p.plain, onclick: () => show(p) })));
    show(packs.find(p => p.domain === dom));
  }
  fill();
  return { destroy() { root.textContent = ''; seq++; }, get selected() { return sel; } };
}
