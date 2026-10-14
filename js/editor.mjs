// SPDX-License-Identifier: AGPL-3.0-only
// Editor module (ms3 section 3). Pure view mapping + DOM mount. Engine access only via js/sutra.mjs (section 2 API).
// No network. KaTeX / MathLive are optional vendored modules (../vendor/...); the page degrades to plain text without them.

// parsedToViews: Parsed -> {sutra, declarations, latex, gloss_en}. A Refusal is returned unchanged (never thrown).
export function parsedToViews(p) {
  if (!p || p.ok === false) return p;
  return { sutra: p.sutra, declarations: p.declarations, latex: p.latex, gloss_en: p.gloss_en };
}

export const refusalText = (r) => `0x${Number(r.code).toString(16).toUpperCase()} ${r.name}: ${r.why}`;

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// mountEditor(el, {onChange, sutra?}) -> {setText(s,kind), getParsed(), destroy()}
// kind: 'plain' | 'latex' | 'sutra' | 'doc'.  opts.sutra injects the sutra.mjs module (tests); default dynamic import.
export function mountEditor(root, opts = {}) {
  const { onChange = () => {}, debounce = 250 } = opts;
  let S = opts.sutra || null, parsed = null, seq = 0, timer = 0, mode = 'plain', destroyed = false, katex = null, mf = null;
  const ids = {};
  root.replaceChildren();
  const modeSel = el('select', { ariaLabel: 'input kind' },
    ...[['plain', 'plain text'], ['latex', 'LaTeX'], ['sutra', 'सूत्र'], ['doc', 'document']].map(([v, t]) => new Option(t, v)));
  const input = el('textarea', { rows: 3, spellcheck: false, ariaLabel: 'formula input', placeholder: 'x^2/(1+e^x)' });
  const rt = el('button', { type: 'button', textContent: 'Round-trip to canonical form' });
  const banner = el('p', { className: 'refusal', role: 'alert' });
  const note = el('p', { className: 'note' });
  const out = {};
  for (const k of ['sutra', 'declarations', 'latex', 'gloss_en', 'canonical']) out[k] = el('pre', { className: 'out' });
  const rendered = el('div', { className: 'rendered' });
  const sec = (h, ...c) => el('section', {}, el('h2', { textContent: h }), ...c);
  root.append(
    sec('Input', el('label', {}, 'kind ', modeSel), input, el('div', { className: 'row' }, rt), banner, note),
    sec('Rendered (LaTeX)', rendered, out.latex),
    sec('सूत्र (canonical)', out.sutra, out.declarations),
    sec('Gloss', out.gloss_en),
    sec('Document / canonical print', out.canonical));
  const status = (s) => { note.textContent = s; };

  async function ensure() {
    if (!S) S = await import('./sutra.mjs');
    if (S.init) await S.init();
    return S;
  }
  async function loadOptional() {
    try { katex = (await import('../vendor/katex/katex.mjs')).default; } catch { katex = null; }
    try {
      const { MathfieldElement } = await import('../vendor/mathlive/mathlive.min.mjs');
      MathfieldElement.fontsDirectory = 'vendor/mathlive/fonts'; MathfieldElement.soundsDirectory = null;
      mf = new MathfieldElement(); mf.setAttribute('aria-label', 'formula (WYSIWYG)');
      mf.addEventListener('input', () => { if (mode === 'latex') { input.value = mf.value; schedule(); } });
      input.before(mf);
    } catch { mf = null; }
  }

  function show(r) {
    banner.textContent = '';
    if (!r || r.ok === false) {
      banner.textContent = r ? refusalText(r) : '';
      parsed = null; return;
    }
    parsed = r;
    if (mode === 'doc') {
      out.canonical.textContent = r.canonical ?? '';
      status(`document: ${r.sections} section(s)`);
      for (const k of ['sutra', 'declarations', 'latex', 'gloss_en']) out[k].textContent = '';
      rendered.textContent = ''; return;
    }
    const v = parsedToViews(r);
    for (const k of ['sutra', 'declarations', 'latex', 'gloss_en']) out[k].textContent = v[k];
    out.canonical.textContent = '';
    if (katex) { try { katex.render(v.latex, rendered, { throwOnError: false, displayMode: true }); } catch { rendered.textContent = v.latex; } }
    else rendered.textContent = v.latex;
    if (mf && mode !== 'latex') { try { mf.setValue(v.latex, { silenceNotifications: true }); } catch {} }
  }

  async function run() {
    const my = ++seq, text = input.value, m = mode;
    let r;
    try {
      const s = await ensure();
      if (m === 'sutra') r = await s.fromSutra(text.trim());
      else if (m === 'doc') r = await s.parseDoc(text);
      else r = await s.fromInput(text, { kind: m });
    } catch (e) { r = { ok: false, code: 0, name: 'EngineError', why: String(e && e.message || e) }; }
    if (destroyed || my !== seq) return;           // stale-result guard
    show(r); onChange(r);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, debounce); }

  input.addEventListener('input', schedule);
  modeSel.addEventListener('change', () => { mode = modeSel.value; schedule(); });
  rt.addEventListener('click', async () => {
    if (!parsed) { status('nothing parsed to print'); return; }
    if (mode === 'doc') { input.value = parsed.canonical; mode = 'doc'; await run(); status('printed canonical form; equality holds only up to प्रकृतिः (canonical form), not as typed text'); return; }
    input.value = parsed.sutra; mode = 'sutra'; modeSel.value = 'sutra'; await run();
    status('re-printed from the parsed term; equality holds only up to प्रकृतिः (canonical form), not as typed text');
  });
  loadOptional();

  return {
    setText(s, kind = 'plain') { mode = kind; modeSel.value = kind; input.value = s; clearTimeout(timer); return run(); },
    getParsed() { return parsed; },
    getInput() { return { text: input.value, kind: mode }; },
    destroy() { destroyed = true; clearTimeout(timer); root.replaceChildren(); },
  };
}
