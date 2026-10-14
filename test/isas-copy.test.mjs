// SPDX-License-Identifier: AGPL-3.0-only
// js/isas/*.mjs are byte-identical copies of Brihaspati kernel/*.mjs (brihaspati main 9d8e9ab). Run: node test/isas-copy.test.mjs
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const WANT = {
  'isas.mjs': '57400fe54425fcfe9ef2785ac867d21fc001b847901311174e214716fb01b5e7',
  'parts.mjs': '746861354787dc04c187d4789dbbc9ca2e3acc8c895ca9cabd3cb1f42043a783',
  'svg.mjs': '77cf98ab2aa6a464445a66e80d826e2b231d3770c9e1615c9ae6cc463df30802',
  'isas-names.mjs': '7dd2d391c33153937bbc5a9899cbf2469d88e8daac02e602f1d8ec7e332aa2b7',
  'refusals.mjs': 'ab0cc59f727810aeac3ac36f18d73a6e227f45dc7464d10ba2efe19c0a9927ed',
  'library.mjs': '3d2c648d304599e1fd7dd632be20f3b3dc662c9477fa9422b4f4dbddde8893eb',
};
let pass = 0, fail = 0;
for (const [f, h] of Object.entries(WANT)) {
  const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(here, '../js/isas', f))).digest('hex');
  if (got === h) pass++; else { fail++; console.log(`FAIL ${f}: ${got}`); }
}
console.log(`isas-copy: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
