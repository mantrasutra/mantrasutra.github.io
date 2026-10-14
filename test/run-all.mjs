// SPDX-License-Identifier: AGPL-3.0-only
// Common harness (ms3 SPEC section 10). Run: node test/run-all.mjs [module ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
let _vec = null;
export function vectors() { return _vec ??= JSON.parse(fs.readFileSync(path.join(here, 'ms3-vectors.json'), 'utf8')); }
export function loadVectors(feature) { return vectors().cases.filter(c => !feature || c.feature === feature); }

const sha = u8 => crypto.createHash('sha256').update(u8).digest('hex');
const isBytes = x => x instanceof Uint8Array;
// Normalise: bytes -> {sha256,len}; typed Float64Array -> its bytes.
export function norm(x) {
  if (x instanceof Float64Array) x = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (isBytes(x)) return { sha256: sha(x), len: x.length };
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)]));
  return x;
}
export function eq(got, want) { return JSON.stringify(canon(norm(got))) === JSON.stringify(canon(want)); }
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])]));
  return x;
}

export const MODULES = ['core', 'editor', 'packs', 'explorer', 'mantra', 'links', 'isas-copy', 'history', 'isas-roundtrip', 'history-page'];

async function main() {
  const want = process.argv.slice(2);
  const mods = want.length ? want : MODULES;
  let bad = 0;
  for (const m of mods) {
    const f = path.join(here, m + '.test.mjs');
    if (!fs.existsSync(f)) { console.log(`${m}: SKIP (no ${m}.test.mjs)`); continue; }
    try {
      if (!/export\s+(async\s+)?function\s+run\b/.test(fs.readFileSync(f, 'utf8'))) {
        // script-style test: run as a child process, report its own last line
        const p = spawnSync(process.execPath, [f], { encoding: 'utf8', cwd: path.dirname(here), maxBuffer: 1 << 26 });
        const lines = (p.stdout || '').trim().split('\n');
        console.log(`${m}: ${p.status === 0 ? 'PASS' : 'FAIL'} :: ${lines.at(-1) || p.stderr.slice(0, 300)}`);
        if (p.status !== 0) { bad++; for (const x of lines.slice(0, 8)) console.log('  ' + x); }
        continue;
      }
      const { run } = await import(pathToFileURL(f).href);
      const r = await run({ loadVectors, eq, norm });
      console.log(`${m}: ${r.fail ? 'FAIL' : 'PASS'} ${r.pass}/${r.pass + r.fail}`);
      for (const msg of (r.msgs || []).slice(0, 10)) console.log('  ' + msg);
      if (r.fail) bad++;
    } catch (e) { console.log(`${m}: FAIL (${e && e.stack || e})`); bad++; }
  }
  console.log(bad ? 'RESULT FAIL' : 'RESULT PASS');
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
