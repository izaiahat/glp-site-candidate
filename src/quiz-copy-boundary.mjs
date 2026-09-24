import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const QUIZ_DATA_IDS = Object.freeze(["phase4-quiz-data", "candidate-data", "quiz-ranking", "pass2-quiz-data"]);
const sha = value => createHash("sha256").update(value).digest("hex");

export function readQuizFragmentHashes(publicRoot) {
  const launcher = readFileSync(path.join(publicRoot, "lp/quiz/index.html"), "utf8");
  const encoded = launcher.match(/data-quiz-fragment-hashes="([^"]+)"/)?.[1];
  // W7's explicit parent-selected link-through entrance has no duplicate quiz
  // fragments. This is not a generic missing-contract exception: stale islands
  // or mounts still fail, and their old routes still require exact digests.
  if (!encoded && /data-paid-funnel="route-quiz-entrance"/.test(launcher)
      && /<a\b[^>]*href="\/quiz\/provider-fit\/"[^>]*data-lp-quiz-start/.test(launcher)
      && !/data-phase4-quiz|data-quiz-fragments|id="(?:phase4-quiz-data|candidate-data|quiz-ranking|pass2-quiz-data)"/.test(launcher)) return {};
  if (!encoded) throw new Error("quiz_copy_missing_digest_contract");
  const hashes = JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  if (Object.keys(hashes).sort().join() !== [...QUIZ_DATA_IDS].sort().join() || Object.values(hashes).some(x => !/^[a-f0-9]{64}$/.test(x))) throw new Error("quiz_copy_invalid_digest_contract");
  return hashes;
}

// Only these four exact producer routes can expose data separately from prose.
// Every other JSON/script and every non-data byte remains in the copy scan.
// Full fragment digests are checked before removing the one canonical data tag.
export function quizCopySurface(html, relative, hashes) {
  const id = QUIZ_DATA_IDS.find(id => relative === `lp/quiz/data/${id}/index.html`);
  if (!id) return html;
  if (!hashes?.[id] || sha(html) !== hashes[id]) throw new Error(`quiz_copy_fragment_digest:${id}`);
  const pattern = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`, "g");
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`quiz_copy_fragment_shape:${id}`);
  const data = JSON.parse(matches[0][1]);
  if (!data || typeof data !== "object") throw new Error(`quiz_copy_fragment_json:${id}`);
  return html.replace(matches[0][0], "");
}

export function quizVisibleCopyViolations(text) {
  return String(text).match(/\b(?:was )?checked (?:through )?2026-\d{2}-\d{2}(?!\d)|\bRelated coverage\b|\bthe fine print\b|Q<\d+|\bPosition\s*7[’']s/gi) || [];
}
