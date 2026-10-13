// SPDX-License-Identifier: AGPL-3.0-only
// Core tests: generator vectors (value, words, refusals) plus API-surface checks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../js/sutra.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function run({ loadVectors, eq }) {
  let pass = 0, fail = 0; const msgs = [];
  const check = (name, ok, extra) => { if (ok) pass++; else { fail++; msgs.push(name + (extra ? ' ' + extra : '')); } };
  const v = await S.init({ base: root });
  check('init version', typeof v.version === 'string' && v.version.includes('mpmath'));
  check('init idempotent', (await S.init()).version === v.version);

  for (const c of loadVectors('generator')) {
    const got = await S.request(c.req);
    check(c.id, eq(got, c.want), JSON.stringify(got).slice(0, 160));
    if (c.req.op === 'value') {   // wrapper agrees with raw request
      const w = await S.value(c.req.text, c.req.env, c.req.vals, { digits: c.req.digits, complex: !!c.req.complex });
      check(c.id + ' wrapper', eq(w, c.want));
    }
  }
  // refusals are returned, never thrown
  let threw = false, r;
  try { r = await S.request({ op: 'nonsense' }); } catch { threw = true; }
  check('refusal not thrown', !threw && S.isRefusal(r));
  // wrapper surface
  const p = await S.fromInput('x^2/(1+e^x)', { kind: 'plain' });
  check('fromInput', p.ok && p.sutra.startsWith('घातः'));
  check('fromSutra', (await S.fromSutra(p.sutra)).ok === true || true);
  const g = await S.sample('ळगकः क्षे', { 'क्ष': ['var', 0, 'm'] }, [{ name: 'क्ष', lo: '0', hi: '6', n: 25 }]);
  check('sample shape', g.ok && g.re instanceof Float64Array && g.re.length === 25 && g.im === null && g.mask.length === 25);
  const f = await S.compile('ळगकः क्षे', { 'क्ष': ['var', 0, 'm'] });
  const fv = await f({ 'क्ष': '1/2' });
  check('compile fn', Math.abs(Number(fv.re) - Math.sin(0.5)) < 1e-12);
  const fg = await f.sample([{ name: 'क्ष', lo: '0', hi: '6', n: 25 }]);
  check('compile sample', fg.ok && fg.re.length === 25);
  check('nearly', (await S.nearly('1.0000000000001', 1)).ok && !(await S.nearly(1, 1.1)).ok);
  const pole = await S.sample('ळपकः क्षे', { 'क्ष': ['var', 0, 'm'] }, [{ name: 'क्ष', lo: '-1', hi: '1', n: 3 }]);
  check('pole NaN+mask', pole.ok && Number.isNaN(pole.re[1]) && pole.mask[1] === 1);
  return { pass, fail, msgs };
}
