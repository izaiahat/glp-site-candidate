// Every table on every page is contained, on every viewport. Template-level.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-18 (operator): "some of the text is truncated and falls off the side
// of the screen" on /reviews/dudemeds-review/. That page ships two tables - the
// dated pricing-evidence record and the "Other provider records reviewed under
// the same evidence rules" list - and NEITHER had any containment. Their prose
// cells ("Open the dated evidence record and compare the same pricing, terms,
// and unknown-field rules.") set a wide intrinsic width, the table pushed past
// the viewport, and the whole page scrolled sideways.
//
// The comparison pages had already solved this (`.table-wrap.responsive-table`,
// stacked labelled cards under 768px), but the fix lived at the CALL SITE: the
// money-page renderer emitted the wrapper by hand. Every other template - the
// provider review template, the READY6 clean-room review template, guides -
// emitted a bare <table>, so each new template re-inherited the bug, and every
// future provider review the deploy machine writes would have shipped broken.
//
// WHAT THIS DOES
// --------------
// Runs over the FINAL HTML of every page the build writes, so containment is a
// property of the site rather than of whoever wrote a template:
//
//   * wraps any table that is not already inside a `.table-wrap`
//   * copies each column's header onto its cells as `data-label`, which is what
//     the existing stacked-card CSS reads under 768px
//   * picks the treatment from the table's own content:
//       - PROSE tables (long sentences in cells) stack into labelled cards on
//         narrow viewports, so the sentence wraps inside the viewport instead
//         of forcing a two-screen-wide horizontal scroll
//       - NUMERIC/wide tables keep their columns and scroll inside their own
//         box, because stacking a grid of numbers destroys the comparison
//   * names the scroll container (`role="region"` + `aria-label` + `tabindex`)
//     so a keyboard user can reach a table that does scroll
//
// Pure string transform: same HTML in, same HTML out. Idempotent - running it
// twice wraps nothing twice, which matters because some pages are re-finalized.

/** Cell text this long reads as prose, not as a data point. */
const PROSE_CELL_CHARS = 55;
/** A table with at least this share of prose cells is a prose table. */
const PROSE_CELL_SHARE = 0.25;
/** Beyond this many columns, stacking is better than any horizontal scroll. */
const WIDE_COLUMN_COUNT = 6;

const TAGS = /<[^>]+>/g;

function textOf(html) {
  return html.replace(TAGS, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Split one row's cells, keeping their opening tags. */
function cellsOf(rowHtml, tag) {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
  return [...rowHtml.matchAll(pattern)].map((match) => ({
    attrs: match[1], inner: match[2], whole: match[0],
  }));
}

function headerLabels(tableHtml) {
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const scope = head ? head[1] : tableHtml;
  const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(scope);
  if (!firstRow) return [];
  return cellsOf(firstRow[1], "th").map((cell) => textOf(cell.inner));
}

function bodyRows(tableHtml) {
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  const scope = body ? body[1] : tableHtml;
  return [...scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

/**
 * Which containment a table needs, decided from the table itself.
 * @returns {"prose"|"data"}
 */
export function classifyTable(tableHtml) {
  const labels = headerLabels(tableHtml);
  const rows = bodyRows(tableHtml);
  let cells = 0;
  let prose = 0;
  for (const row of rows) {
    for (const cell of [...cellsOf(row, "td"), ...cellsOf(row, "th")]) {
      cells += 1;
      if (textOf(cell.inner).length >= PROSE_CELL_CHARS) prose += 1;
    }
  }
  if (labels.length >= WIDE_COLUMN_COUNT) return "prose";
  if (!cells) return "data";
  return prose / cells >= PROSE_CELL_SHARE ? "prose" : "data";
}

/** Copy header text onto each cell as `data-label` for the stacked layout. */
function labelCells(tableHtml) {
  const labels = headerLabels(tableHtml);
  if (!labels.length) return tableHtml;
  const body = /<tbody\b[^>]*>[\s\S]*?<\/tbody>/i.exec(tableHtml);
  const region = body ? body[0] : tableHtml;
  const labelled = region.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi, (whole, rowAttrs, rowInner) => {
    let column = -1;
    const next = rowInner.replace(/<(td|th)\b([^>]*)>/gi, (cellWhole, tag, attrs) => {
      column += 1;
      if (/\bdata-label=/i.test(attrs)) return cellWhole;
      const label = labels[column];
      if (!label) return cellWhole;
      return `<${tag}${attrs} data-label="${label.replaceAll('"', "&quot;")}">`;
    });
    return `<tr${rowAttrs}>${next}</tr>`;
  });
  return body ? tableHtml.replace(body[0], labelled) : labelled;
}

function accessibleName(tableHtml, fallback) {
  const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
  const name = caption ? textOf(caption[1]) : "";
  return (name || fallback).slice(0, 120);
}

/**
 * Contain every table in one page's HTML.
 *
 * @param {string} html final page HTML
 * @param {string} route the route being written, used only for the fallback name
 * @returns {{html: string, wrapped: number, prose: number, data: number, alreadyContained: number}}
 */
export function containTables(html, route = "") {
  if (typeof html !== "string" || !html.includes("<table")) {
    return { html, wrapped: 0, prose: 0, data: 0, alreadyContained: 0 };
  }
  let wrapped = 0;
  let prose = 0;
  let data = 0;
  let alreadyContained = 0;
  const out = html.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml, offset) => {
    // Already inside a containment wrapper: leave the hand-tuned one alone.
    // A wrapper counts whether it uses the shared `.table-wrap` class or an
    // inline `overflow` style (the clean-room dataset route does the latter,
    // and double-wrapping it would break its byte-parity contract for no gain).
    const before = html.slice(Math.max(0, offset - 400), offset);
    const wrapperTag = /<div [^>]*(?:class="[^"]*table-wrap[^"]*"|style="[^"]*overflow[^"]*")[^>]*>/g;
    const openWrappers = (before.match(wrapperTag) || []).length;
    const closed = (before.match(/<\/div>/g) || []).length;
    const lastWrapper = Math.max(before.lastIndexOf("table-wrap"), before.lastIndexOf("overflow"));
    if (openWrappers > 0 && lastWrapper > before.lastIndexOf("</div>")) {
      alreadyContained += 1;
      return tableHtml;
    }
    if (openWrappers > closed) {
      alreadyContained += 1;
      return tableHtml;
    }
    const kind = classifyTable(tableHtml);
    const labelled = kind === "prose" ? labelCells(tableHtml) : tableHtml;
    const name = accessibleName(tableHtml, `Table on ${route || "this page"}`);
    wrapped += 1;
    if (kind === "prose") prose += 1; else data += 1;
    const classes = `table-wrap auto-contained${kind === "prose" ? " responsive-table" : ""}`;
    return `<div class="${classes}" role="region" aria-label="${name.replaceAll('"', "&quot;")}" tabindex="0">${labelled}</div>`;
  });
  return { html: out, wrapped, prose, data, alreadyContained };
}

/** The stylesheet block the containment relies on. Appended to assets/site.css. */
export const TABLE_CONTAINMENT_CSS = [
  // The floor: a contained table never widens its page. `min-width:0` also
  // undoes the global `.table-wrap table{min-width:760px}`, which would
  // otherwise force a scroll onto tables that fit perfectly well.
  ".table-wrap.auto-contained{width:100%;max-width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}",
  ".table-wrap.auto-contained>table{width:100%;min-width:0;max-width:100%;table-layout:auto}",
  // Long unbroken tokens (URLs, ids) are the other way a cell blows out a row.
  ".table-wrap.auto-contained th,.table-wrap.auto-contained td{min-width:0;overflow-wrap:anywhere;word-break:normal;hyphens:auto}",
  ".table-wrap.auto-contained:focus-visible{outline:3px solid var(--color-focus,#1d64d8);outline-offset:2px}",
  // Prose tables stack instead of scrolling on narrow viewports: a sentence is
  // meant to wrap, and a two-screen-wide scroll to read one is the defect.
  "@media(max-width:768px){.table-wrap.auto-contained.responsive-table{overflow-x:visible}"
  + ".table-wrap.auto-contained.responsive-table>table{display:block}"
  + ".table-wrap.auto-contained.responsive-table caption{display:block;text-align:left}}",
  // Nothing else may push the page sideways either.
  "img,video,canvas,svg,iframe{max-width:100%}",
  "pre,code{max-width:100%;overflow-x:auto;overflow-wrap:anywhere}",
].join("");
