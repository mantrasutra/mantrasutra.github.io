// node test/links.test.mjs : every local href/src resolves; no fetch of http(s) resources.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = readdirSync(root).filter(f => f.endsWith(".html"));
let bad = 0; const fail = m => { bad++; console.log("FAIL " + m); };
for (const must of ["index.html", "about.html", "editor.html", "functions.html", "explorer.html", "mantra.html", "css/site.css", "js/nav.mjs", "js/sutra.mjs", "vendor/oracle.zip", "vendor/pyodide/pyodide.mjs"])
  if (!existsSync(join(root, must))) fail("missing " + must);
const nav = readFileSync(join(root, "js/nav.mjs"), "utf8");
for (const m of nav.matchAll(/\["([\w.\-]+\.html)"/g)) if (!pages.includes(m[1]) && !existsSync(join(root, m[1]))) fail("nav " + m[1]);
// sibling-module pages (built by other builders) may be absent in the shell-only tree
function EXPECTED(h) { return ["editor.html","functions.html","explorer.html","mantra.html"].includes(h); }
for (const p of pages) {
  const t = readFileSync(join(root, p), "utf8");
  for (const m of t.matchAll(/<(a|link)\b[^>]*\bhref="([^"]+)"|<script\b[^>]*\bsrc="([^"]+)"|<(?:img|source)\b[^>]*\bsrc="([^"]+)"/g)) {
    const tag = m[1], u = m[2] || m[3] || m[4];
    if (/^(https?:)?\/\//.test(u)) { if (tag !== "a") fail(`${p}: network resource ${u}`); continue; }
    if (/^(mailto:|#)/.test(u)) continue;
    const f = u.split("#")[0]; if (!f) continue;
    if (!existsSync(join(root, f))) fail(`${p}: unresolved ${u}`);
    const h = u.split("#")[1];
    if (h && f.endsWith(".html") && existsSync(join(root, f)) && !readFileSync(join(root, f), "utf8").includes(`id="${h}"`)) fail(`${p}: missing anchor ${u}`);
  }
  if (/\b(fetch|XMLHttpRequest|importScripts)\s*\(|@import\s+url|url\(\s*["']?https?:/.test(t)) fail(`${p}: fetch-like code`);
}
for (const f of ["css/site.css", "js/nav.mjs"]) {
  const t = readFileSync(join(root, f), "utf8");
  if (/https?:\/\//.test(t) || /\bfetch\s*\(/.test(t)) fail(`${f}: network reference`);
}
console.log(bad ? `links FAIL ${bad}` : `links PASS ${pages.length} pages`);
process.exit(bad ? 1 : 0);
