# mantrasutra.github.io

Static site, no build step. Serve the root with any static server, for example `python3 -m http.server --bind 127.0.0.1`.

## Pages
- `index.html`, `about.html`: overview, scope, licence.
- `editor.html`: type a formula (plain, LaTeX or sutra); see the parsed, rendered and canonical forms and a gloss.
- `functions.html`: formula or sutra to function; evaluate, plot, and open the plot in the explorer. Includes illustrative physics, chemistry and biology packs (`packs/`), labelled as not engine-verified.
- `explorer.html`: curve, heat-map, surface, domain-colouring and sphere views. Accepts `?view=curve&series=..&label=..` from the mantra page.
- `mantra.html`: syllable weights (guru/laghu) of Devanagari or IAST verse, linked to the explorer as a curve.

## Engine
`js/sutra.mjs` is the only engine module. It runs a vendored Pyodide 0.26.4 and `vendor/oracle.zip` (Python, mpmath) in the browser. First load is about 25 MB. Scope: countable term algebra only. Nothing is fetched from external hosts.

## Tests
`node test/run-all.mjs` runs the core, editor, packs, explorer, mantra and links tests against the real engine (about 30 s).

## Licence
AGPL-3.0-only (`LICENSE`). A commercial licence is available: see `COMMERCIAL-LICENSE.md`.
