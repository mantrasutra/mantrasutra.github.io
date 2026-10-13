// SPDX-License-Identifier: AGPL-3.0-only
// Core API (ms3 SPEC section 2). Wraps vendored Pyodide + oracle.zip (viewer/engine.mjs design).
// Browser: relative base (default: parent of js/). Node: file path base. Zero network beyond same-origin files.
let _base = null, _eng = null;

function normBase(b) {
  if (b == null) return new URL('../', import.meta.url).href;
  if (b instanceof URL) b = b.href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(b) === false && typeof document === 'undefined') {
    // node file path
    return 'file://' + (b.startsWith('/') ? '' : process.cwd() + '/') + (b.endsWith('/') ? b : b + '/');
  }
  if (typeof document !== 'undefined' && !/^[a-z][a-z0-9+.-]*:/i.test(b)) b = new URL(b, document.baseURI).href;
  return b.endsWith('/') ? b : b + '/';
}

async function readBuf(href) {
  if (href.startsWith('file:')) {
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const b = await fs.readFile(fileURLToPath(href));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const r = await fetch(href);
  if (!r.ok) throw new Error('fetch ' + href + ' ' + r.status);
  return r.arrayBuffer();
}

async function load(base) {
  const root = base + 'vendor/pyodide/';
  const { loadPyodide } = await import(root + 'pyodide.mjs');
  let indexURL = root;
  if (root.startsWith('file:')) indexURL = (await import('node:url')).fileURLToPath(root);
  const py = await loadPyodide({ indexURL });
  py.unpackArchive(await readBuf(base + 'vendor/oracle.zip'), 'zip', { extractDir: '/home/pyodide/oracle' });
  py.runPython(`
import sys, json; sys.path.insert(0, '/home/pyodide/oracle')
import sutra
from sutra.engine import request as _request
def _call(js):
    r = _request(json.loads(js))
    out = {k: (v if not isinstance(v, (bytes, bytearray)) else None) for k, v in r.items()}
    blobs = {k: v for k, v in r.items() if isinstance(v, (bytes, bytearray))}
    return json.dumps(out, ensure_ascii=False), blobs
`);
  const call = py.globals.get('_call');
  const version = py.runPython('import mpmath, sys; f"mpmath {mpmath.__version__} {mpmath.libmp.BACKEND}; Python {sys.version.split()[0]}"');
  return {
    version,
    request(obj) {
      const res = call(JSON.stringify(obj));
      const [js, blobs] = res.toJs({ dict_converter: Object.fromEntries }); res.destroy();
      const out = JSON.parse(js);
      for (const [k, v] of Object.entries(blobs)) out[k] = v instanceof Uint8Array ? v : new Uint8Array(v);
      return out;
    },
  };
}

export function init(opts = {}) {
  if (!_eng) {
    _base = normBase(opts.base);
    _eng = load(_base).catch(e => { _eng = null; throw e; });
  }
  return _eng.then(e => ({ version: e.version }));
}

export async function request(obj) {
  if (!_eng) await init();
  const e = await _eng;
  try { return e.request(obj); }
  catch (err) { return { ok: false, code: 0x3A7, name: 'Unsupported', why: String(err && err.message || err) }; }
}

export const isRefusal = x => !!x && x.ok === false;

const f64 = u8 => { if (!u8) return null; const c = new Uint8Array(u8.length); c.set(u8); return new Float64Array(c.buffer); };

export function fromInput(text, { kind = 'plain', env } = {}) {
  const r = { op: 'from_input', input: text, kind }; if (env) r.env = env; return request(r);
}
export function fromSutra(text, { env } = {}) {
  const r = { op: 'from_sutra', text }; if (env) r.env = env; return request(r);
}
export function parse(text, { env } = {}) {
  const r = { op: 'parse', text }; if (env) r.env = env; return request(r);
}
export const parseDoc = text => request({ op: 'parse', text });

export function value(text, env, vals, { digits = 30, complex = false } = {}) {
  const v = {}; for (const [k, x] of Object.entries(vals || {})) v[k] = String(x);
  return request({ op: 'value', text, env: env || {}, vals: v, digits, complex });
}

// The engine has no 'nearly' op; this is a client-side numeric check of two decimal strings/numbers.
// nearly(a, b, {rel=1e-12, abs=0}) -> {ok, rel_err}; a/b may be {re,im} results or numbers/strings.
export async function nearly(a, b, { rel = 1e-12, abs = 0 } = {}) {
  const c = x => (x && typeof x === 'object') ? [Number(x.re), Number(x.im || 0)] : [Number(x), 0];
  const [ar, ai] = c(a), [br, bi] = c(b);
  const d = Math.hypot(ar - br, ai - bi), m = Math.max(Math.hypot(ar, ai), Math.hypot(br, bi));
  const rel_err = m === 0 ? 0 : d / m;
  return { ok: d <= abs || rel_err <= rel, rel_err };
}

export async function sample(text, env, axes, { fixed, complex = false, sphere } = {}) {
  const r = { op: 'sample', text, env: env || {}, axes, fixed: fixed || {}, complex };
  if (sphere) r.sphere = sphere;
  const g = await request(r);
  if (isRefusal(g)) return g;
  return { ok: true, shape: g.shape, re: f64(g.re), im: f64(g.im), mask: g.mask };
}

export async function compile(text, env, { fixed = {}, complex = false } = {}) {
  // validate once: parse through a value probe is not possible without vals, so check via from_sutra
  const p = await fromSutra(text, { env });
  if (isRefusal(p)) return p;
  const fn = async vals => {
    const r = await value(text, env, { ...fixed, ...vals }, { complex });
    if (isRefusal(r)) return r;
    return { re: r.re, im: r.im };
  };
  fn.sample = (axes, opts = {}) => sample(text, env, axes, { fixed, complex, ...opts });
  return fn;
}

export const verse = (text, { script } = {}) => request({ op: 'verse', text, cite: '', ...(script ? { script } : {}) });
export const textInfo = (text, { script = 'dev' } = {}) => request({ op: 'text', text, script });
export const structure = (text, { script } = {}) => request({ op: 'structure', text, ...(script ? { script } : {}) });
export const words = () => request({ op: 'words' });
