export const STANDALONE_DARK_THEME_MARKER = "pass5-standalone-dark";

const TOKENS = ":root{color-scheme:dark;--cs-ground:#07100d;--cs-ground-raised:#0c1815;--cs-surface:#101d18;--cs-surface-float:#15251f;--cs-text:#f2f8f4;--cs-muted:#a7bfb5;--cs-line:rgba(233,247,241,.13);--cs-line-strong:rgba(233,247,241,.24);--cs-mint:#3fd9a4;--cs-cyan:#6fd8ff;--cs-warning:#f0b23f;--cs-focus:#7fe3ff}";
const CANVAS = "html{background:var(--cs-ground)}body{margin:0;background:radial-gradient(circle at 12% 0,rgba(23,168,126,.16),transparent 34rem),radial-gradient(circle at 90% 14%,rgba(111,198,238,.1),transparent 30rem),var(--cs-ground);color:var(--cs-text);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;-webkit-font-smoothing:antialiased}";
const BASE = "*{box-sizing:border-box}h1,h2,h3{color:var(--cs-text);line-height:1.12;text-wrap:balance}p,li,dd,dt,blockquote,code,h1,h2,h3{overflow-wrap:anywhere}.eyebrow{color:var(--cs-mint);font-size:.78rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}small,.muted{color:var(--cs-muted)}code{color:#d9e8e0}a{color:var(--cs-cyan);text-underline-offset:.16em}:focus-visible{outline:3px solid var(--cs-focus);outline-offset:2px}.table-wrap{width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}.table-wrap:focus-visible{border-radius:8px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}";

const STYLES = Object.freeze({
  "original-data": `/* ${STANDALONE_DARK_THEME_MARKER}:original-data */${TOKENS}${CANVAS}${BASE}main{width:min(1100px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}h1{max-width:19ch;font-size:clamp(2.2rem,6vw,4.5rem);letter-spacing:-.04em}section,aside{background:linear-gradient(145deg,rgba(63,217,164,.045),transparent 45%),var(--cs-surface);border:1px solid var(--cs-line);border-radius:18px;padding:24px;margin:20px 0;box-shadow:0 22px 48px -36px rgba(0,0,0,.9)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.summary div{background:var(--cs-ground-raised);border:1px solid var(--cs-line);border-radius:12px;padding:18px}.summary strong{display:block;font-size:1.45rem}table{width:100%;min-width:880px;border-collapse:collapse;color:var(--cs-text)}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--cs-line);padding:12px}li{margin:0 0 28px}blockquote{white-space:pre-line;border-left:4px solid var(--cs-mint);margin:10px 0;padding:8px 16px;background:var(--cs-ground-raised)}@media(max-width:760px){main{width:min(100% - 20px,1100px);padding-top:32px}section,aside{padding:18px;border-radius:16px}}`,
  "public-funnel-evidence": `/* ${STANDALONE_DARK_THEME_MARKER}:public-funnel-evidence */${TOKENS}${CANVAS}${BASE}main{width:min(980px,calc(100% - 32px));margin:auto;padding:48px 0 80px}h1{font-size:clamp(2.25rem,6vw,4.5rem);max-width:16ch;letter-spacing:-.04em}.notice,.observation{margin:24px 0;padding:24px;border:1px solid var(--cs-line);border-radius:18px;background:linear-gradient(145deg,rgba(63,217,164,.045),transparent 45%),var(--cs-surface);box-shadow:0 22px 48px -36px rgba(0,0,0,.9)}.observations{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:18px}.observations .observation{margin:0}blockquote{margin:18px 0;white-space:normal}.evidence-status{padding:10px 12px;border-left:3px solid var(--cs-mint);background:var(--cs-ground-raised);color:var(--cs-text)}dl div{padding:10px 0;border-top:1px solid var(--cs-line)}dt{font-weight:750}dd{margin:4px 0 0}code{font:12px/1.5 ui-monospace,monospace}@media(max-width:760px){main{width:min(100% - 20px,980px);padding-top:32px}.notice,.observation{padding:18px;border-radius:16px}}`,
  "price-tracker": `/* ${STANDALONE_DARK_THEME_MARKER}:price-tracker */${TOKENS}${CANVAS}${BASE}main{width:min(1120px,calc(100% - 32px));margin:auto;padding:48px 0 80px}h1{max-width:18ch;font-size:clamp(2.3rem,6vw,5rem);letter-spacing:-.04em}section,aside{margin:28px 0;padding:24px;border:1px solid var(--cs-line);border-radius:18px;background:linear-gradient(145deg,rgba(63,217,164,.045),transparent 45%),var(--cs-surface);box-shadow:0 22px 48px -36px rgba(0,0,0,.9)}table{width:100%;min-width:920px;border-collapse:collapse;color:var(--cs-text)}th,td{padding:14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--cs-line)}thead{background:rgba(233,247,241,.045)}blockquote{margin:12px 0 0;padding-left:14px;border-left:3px solid var(--cs-mint);background:var(--cs-ground-raised)}details{color:var(--cs-muted)}details summary{min-height:44px;display:flex;align-items:center;color:var(--cs-text);cursor:pointer}footer{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:0 0 48px;color:var(--cs-muted)}@media(max-width:760px){main{width:min(100% - 20px,1120px);padding-top:32px}section,aside{padding:18px;border-radius:16px}}`,
  "savings-monitor": `/* ${STANDALONE_DARK_THEME_MARKER}:savings-monitor */${TOKENS}${CANVAS}${BASE}main{width:min(1040px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}h1{max-width:20ch;font-size:clamp(2.2rem,6vw,4.5rem);letter-spacing:-.04em}.page-band,.notice,.panel,main>section:last-of-type{margin:24px 0;padding:24px;border:1px solid var(--cs-line);border-radius:18px;background:linear-gradient(145deg,rgba(63,217,164,.045),transparent 45%),var(--cs-surface);box-shadow:0 22px 48px -36px rgba(0,0,0,.9)}main>section[aria-label]{display:grid;gap:18px}.panel{margin:0}.panel ul{padding-left:1.25rem}.panel strong{color:var(--cs-text)}details{color:var(--cs-muted)}details summary{min-height:44px;display:flex;align-items:center;color:var(--cs-text);cursor:pointer;font-weight:750}blockquote{margin:12px 0;padding:14px;border-left:3px solid var(--cs-warning);background:var(--cs-ground-raised)}footer{width:min(1040px,calc(100% - 32px));margin:0 auto;padding:0 0 48px;color:var(--cs-muted)}@media(max-width:760px){main{width:min(100% - 20px,1040px);padding-top:32px}.page-band,.notice,.panel,main>section:last-of-type{padding:18px;border-radius:16px}}`,
});

const replaceInlineStyle = (html, css) => {
  const stylePattern = /<style(?:\s[^>]*)?>[\s\S]*?<\/style>/i;
  return stylePattern.test(html)
    ? html.replace(stylePattern, `<style>${css}</style>`)
    : html.replace("</head>", `<style>${css}</style></head>`);
};

const containRouteTable = (html, variant) => {
  if (variant === "original-data") {
    return html.replace('<div style="overflow:auto"><table>', '<div class="table-wrap" role="region" aria-label="Captured disclosure rows" tabindex="0"><table>');
  }
  if (variant === "price-tracker") {
    return html
      .replace("<section><h2>Source-dated observations</h2><table>", '<section><h2>Source-dated observations</h2><div class="table-wrap" role="region" aria-label="Source-dated price observations" tabindex="0"><table>')
      .replace("</tbody></table></section><section><h2>Alert status", "</tbody></table></div></section><section><h2>Alert status");
  }
  return html;
};

export function standaloneDarkCssFor(variant) {
  const css = STYLES[variant];
  if (!css) throw new Error(`standalone_theme_variant_invalid:${variant}`);
  return css;
}

export function applyStandaloneDarkTheme(html, variant) {
  if (typeof html !== "string" || !html.includes("</head>")) throw new Error("standalone_theme_document_invalid");
  const css = standaloneDarkCssFor(variant);
  if (html.includes(`/* ${STANDALONE_DARK_THEME_MARKER}:${variant} */`)) return html;
  return containRouteTable(replaceInlineStyle(html, css), variant);
}
