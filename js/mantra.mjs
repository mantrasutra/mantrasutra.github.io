// SPDX-License-Identifier: AGPL-3.0-only
// Module D: verse analysis (L1 text, L2 prosody, L6 structure). Codes only against the sutra.mjs section-2 API.
// Segmentation into akshara and G/L weights are computed by the engine (op verse); nothing is re-derived here.
import * as S from './sutra.mjs';

export const EXAMPLES = [
  { id: 'gita-1-1', title: 'Bhagavadgita 1.1', script: 'dev', cite: 'Bhagavadgita 1.1 (traditional text, public domain)', text: 'धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः । मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय ॥' },
  { id: 'gayatri', title: 'Gayatri (Rigveda 3.62.10, one pada line)', script: 'dev', cite: 'Rigveda 3.62.10 (traditional text, public domain)', text: 'तत्सवितुर्वरेण्यं भर्गो देवस्य धीमहि' },
  { id: 'brahmasutra', title: 'Brahmasutra 1.1.1', script: 'dev', cite: 'Brahmasutra 1.1.1 (traditional text, public domain)', text: 'अथातो ब्रह्मजिज्ञासा' },
  { id: 'purnam', title: 'Isha shanti (purnam)', script: 'dev', cite: 'Ishavasya shanti (traditional text, public domain)', text: 'ॐ पूर्णमदः पूर्णमिदं पूर्णात्पूर्णमुदच्यते' },
  { id: 'kirata', title: 'Kiratarjuniya (IAST)', script: 'iast', cite: 'DCS, Kiratarjuniya, sentence 357720 (CC BY 4.0)', text: "nāsuro 'yaṃ na vā nāgo dharasaṃstho na rākṣasaḥ" },
  { id: 'amaru', title: 'Amarushataka (IAST)', script: 'iast', cite: 'DCS, Amarushataka, sentence 101420 (CC BY 4.0)', text: 'tacchūnye punarāsthitāsmi bhavane prāṇāsta ete dṛḍhāḥ sakhyastiṣṭhata jīvitavyasaninī dambhādahaṃ rodimi' },
];

const refusal = (r) => !!r && r.ok === false;

/** Three engine requests. Returns {verse,text,structure} or the first Refusal (verbatim). */
export async function analyseVerse(text, { script = 'dev' } = {}) {
  const [verse, t, structure] = await Promise.all([
    S.verse(text, { script }), S.textInfo(text, { script }), S.structure(text, { script }),
  ]);
  for (const r of [verse, t, structure]) if (refusal(r)) return r;
  return { verse, text: t, structure };
}

/** G/L per syllable, all padas concatenated, from padas[].syllables[].weight. */
export function weightString(verse) {
  return verse.padas.flatMap((p) => p.syllables.map((s) => s.weight)).join('');
}

/** Per-pada G/L strings. */
export function padaWeights(verse) {
  return verse.padas.map((p) => p.syllables.map((s) => s.weight).join(''));
}

/** Verse curve: G = 1, L = 0, one point per syllable (x = syllable index). */
export function curvePoints(verse) {
  return weightString(verse).split('').map((w, i) => [i, w === 'G' ? 1 : 0]);
}

/** Link to the explorer. Contract (query string): view=curve, series=<G/L string>, label=<text>. */
export function explorerLink(verse, { base = 'explorer.html', label = '' } = {}) {
  const q = new URLSearchParams({ view: 'curve', series: weightString(verse) });
  if (label) q.set('label', label);
  return `${base}?${q}`;
}

/** Parse the same query string (for the explorer builder to reuse). */
export function parseCurveQuery(search) {
  const q = new URLSearchParams(search);
  const s = q.get('series');
  if (!s || !/^[GL]+$/.test(s)) return null;
  return { view: q.get('view') || 'curve', series: s, label: q.get('label') || '', values: [...s].map((c) => (c === 'G' ? 1 : 0)) };
}

// ---------- DOM (browser only) ----------
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';

function curveSvg(verse) {
  const pts = curvePoints(verse), n = pts.length, W = Math.max(240, n * 14), H = 80, pad = 8;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'weight curve, G high and L low');
  const X = (i) => pad + (i / Math.max(1, n)) * (W - 2 * pad), Y = (v) => H - pad - v * (H - 2 * pad);
  let d = '';
  pts.forEach(([i, v], k) => { d += `${k ? 'L' : 'M'}${X(i)} ${Y(v)}L${X(i + 1)} ${Y(v)}`; });
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2');
  svg.append(path);
  return svg;
}

function renderResult(root, res, ctx) {
  const out = root.querySelector('[data-out]');
  out.replaceChildren();
  if (refusal(res)) {
    out.append(el('div', { className: 'refusal', role: 'alert', textContent: `${res.name} (0x${Number(res.code).toString(16).toUpperCase()}): ${res.why}` }));
    return;
  }
  const { verse, text, structure } = res;
  const m = verse.metre || {};
  const dev = new Set((m.deviations || []).map(([p, s]) => `${p}.${s}`));
  out.append(el('h2', { textContent: 'Metre' }), el('div', { className: 'metre', textContent: m.metre || 'not identified' }), el('div', { className: 'note', textContent: m.note || '' }));
  out.append(el('h2', { textContent: 'Padas: laghu (L) and guru (G)' }));
  for (const p of verse.padas) {
    const row = el('div', { className: 'pada' });
    for (const [j, s] of p.syllables.entries()) {
      row.append(el('span', { className: `sy ${s.weight}${dev.has(`${p.n}.${j + 1}`) ? ' dev' : ''}`, title: `${s.why}${s.anceps ? '; pada end (anceps)' : ''}` },
        s.aksara, el('b', { textContent: s.weight + (s.anceps ? '·' : '') }), el('small', { textContent: s.why })));
    }
    row.append(el('span', { className: 'meta', textContent: `  ${p.ganas.join(' ')} · ${p.matra} matra · index ${p.uddishta} of ${2 ** p.length}` }));
    out.append(row);
  }
  out.append(el('h2', { textContent: 'Weight curve' }), curveSvg(verse));
  out.append(el('p', {}, el('a', { href: explorerLink(verse, { label: ctx.label }), textContent: 'Plot this curve in the explorer' })));
  out.append(el('h2', { textContent: 'Explanation' }), el('ol', {}, ...(verse.explanation || []).map((x) => el('li', { textContent: x }))));
  // L1
  out.append(el('h2', { textContent: 'Words (L1 text)' }));
  const wrow = el('div', { className: 'pada' });
  (text.words || []).forEach((w, i) => {
    const r0 = (w.readings || [])[0];
    const c = el('span', { className: 'sy', title: (w.readings || []).map((r) => `${r.lemma} ${r.upos} ${r.case} ${r.number} ${r.gender}`).join('\n') },
      w.form, el('b', { textContent: r0 ? `${r0.lemma} ${r0.vibhakti || r0.upos} ${r0.number}` : 'no reading' }));
    wrow.append(c);
    const ln = (text.links || []).find((l) => l.from === i);
    if (ln) wrow.append(el('span', { className: 'meta', textContent: ln.kind === 'samasa' || ln.kind === 'samāsa' ? ' ⁀ ' : ' ~ ' }));
  });
  out.append(wrow, el('p', { className: 'note', textContent: 'Readings are the attested analyses of each form from the engine vocabulary. This is not a complete word list and not a parse.' }));
  // L6
  out.append(el('h2', { textContent: 'Figures (L6 structure)' }));
  const figs = structure.figures || [];
  out.append(...(figs.length
    ? figs.map((f) => el('div', { className: 'fig' }, el('b', { textContent: `${f.figure} — ${f.label} ` }), el('span', { className: `status ${f.status || ''}`, textContent: `[${f.status || 'status not reported'}] ` }), f.evidence || ''))
    : [el('div', { className: 'meta', textContent: 'no figure found' })]));
  out.append(el('p', { className: 'note', textContent: structure.note || '' }));
  out.append(el('p', { className: 'note', textContent: 'L3 sound, L4 numbers and L5 analytic layers: not in v1 UI.' }));
}

export function mountMantra(root) {
  root.innerHTML = '';
  const sel = el('select', { 'aria-label': 'example' }, el('option', { value: '', textContent: 'Examples (spec-supplied inputs, not a corpus)' }),
    ...EXAMPLES.map((e) => el('option', { value: e.id, textContent: e.title })));
  const ta = el('textarea', { spellcheck: false, rows: 4, 'aria-label': 'verse' });
  const radios = ['dev', 'iast'].map((v) => el('label', {}, el('input', { type: 'radio', name: 'script', value: v, checked: v === 'dev' }), v === 'dev' ? ' Devanagari ' : ' IAST '));
  const go = el('button', { type: 'button', textContent: 'Analyse' });
  const status = el('span', { className: 'note', textContent: 'Loading the engine (about 25 MB, one time)...' });
  const out = el('div', { 'data-out': '' });
  root.append(el('div', { className: 'row' }, sel, status), ta, el('div', { className: 'row' }, ...radios, go), out);
  const script = () => root.querySelector('input[name="script"]:checked').value;
  let label = '';
  sel.onchange = () => {
    const e = EXAMPLES.find((x) => x.id === sel.value); if (!e) return;
    ta.value = e.text; label = e.title; root.querySelector(`input[value="${e.script}"]`).checked = true;
    out.replaceChildren(el('div', { className: 'note', textContent: `Source: ${e.cite}` }));
  };
  const run = async () => {
    go.disabled = true; status.textContent = 'Analysing...';
    try { renderResult(root, await analyseVerse(ta.value, { script: script() }), { label }); status.textContent = 'Done.'; }
    catch (err) { out.replaceChildren(el('div', { className: 'refusal', textContent: String(err) })); status.textContent = ''; }
    go.disabled = false;
  };
  go.onclick = run;
  S.init().then((v) => { status.textContent = `Engine ready${v && v.version ? ` (${v.version})` : ''}.`; go.disabled = false; }, (e) => { status.textContent = `Engine failed: ${e}`; });
  go.disabled = true;
  const q = new URLSearchParams(location.search);
  if (q.get('text')) { ta.value = q.get('text'); if (q.get('script') === 'iast') root.querySelector('input[value="iast"]').checked = true; go.addEventListener('click', () => {}); }
  return { analyse: run };
}
