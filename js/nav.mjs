// Shared header/nav/footer. No network. Pages: <body data-page="index"> <div id="site-header"></div> ... <div id="site-footer"></div>
export const PAGES = [
  ["editor.html", "Editor"],
  ["functions.html", "Functions"],
  ["explorer.html", "Explorer"],
  ["mantra.html", "Mantra"],
  ["about.html", "About"],
];
export function renderHeader(current) {
  const links = PAGES.map(([h, t]) =>
    `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  return `<a class="skip" href="#main">Skip to content</a><header class="site"><div class="in">` +
    `<a class="brand" href="index.html">सूत्र</a><nav aria-label="Main">${links}</nav></div></header>`;
}
export function renderFooter(engineVersion) {
  const v = engineVersion ? ` Engine ${engineVersion}.` : "";
  return `<footer class="site">Site code: AGPL-3.0-only. A commercial licence is available from the copyright holder (<a href="about.html#licence">licence</a>).${v} No analytics, no web fonts.</footer>`;
}
export function mount(doc = document) {
  const cur = (doc.body.dataset.page || "") + ".html";
  const h = doc.getElementById("site-header"), f = doc.getElementById("site-footer");
  if (h) h.outerHTML = renderHeader(cur);
  if (f) f.outerHTML = renderFooter(doc.body.dataset.engine || "");
}
if (typeof document !== "undefined") mount();
