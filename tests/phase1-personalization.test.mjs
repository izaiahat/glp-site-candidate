import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectRequestState, onRequestGet } from "../functions/api/geo-state.js";

const ROOT = new URL("../", import.meta.url);
const [runtime, shell, servedRuntime, servedHomeCss, servedMoneyCss] = await Promise.all([
  readFile(new URL("assets/site.js", ROOT), "utf8"),
  readFile(new URL("assets/css-src/02-shell.css", ROOT), "utf8"),
  readFile(new URL("public/assets/site.js", ROOT), "utf8"),
  readFile(new URL("public/assets/site-home.css", ROOT), "utf8"),
  readFile(new URL("public/assets/site-money.css", ROOT), "utf8"),
]);

test("W6 welcome-back appears only on a new browsing session with a prior visit", () => {
  assert.match(runtime, /gcs\.visit\.v1/);
  assert.match(runtime, /gcs\.visit\.session\.v1/);
  for (const source of [runtime, servedRuntime]) {
    assert.doesNotMatch(source, /quizCompleted|Your saved preferences are ready|Open your matches/);
    assert.match(source, /Pick up where you left off\./);
  }
  assert.match(runtime, /sessionSeen = sessionStorage\.getItem\(SESSION_KEY\) === 'active'/);
  assert.match(runtime, /sessionStorage\.setItem\(SESSION_KEY, 'active'\)/);
  assert.match(runtime, /window\.name[\s\S]*SESSION_MARKER/);
  assert.match(runtime, /sameOriginReferrer = Boolean\(document\.referrer\)/);
  assert.match(runtime, /const returningSession = !sessionSeen && !sameOriginReferrer && returnWindow/);
  assert.match(runtime, /if \(!returningSession \|\| location\.pathname === '\/quiz\/provider-fit\/'\) return/);
  assert.doesNotMatch(runtime, /if \(!returnWindow && !quizCompleted\) return/);
  assert.match(runtime, /lastPath: location\.pathname/);
  assert.match(runtime, /Welcome back\./);
  assert.match(shell, /\.cs-welcome-toast[\s\S]*transition: opacity 180ms ease, transform 240ms/);
  assert.match(servedRuntime, /gcs\.visit\.v1/);
  assert.match(servedRuntime, /Welcome back\./);
  assert.match(servedHomeCss, /\.cs-welcome-toast[\s\S]*transition:\s*opacity 180ms ease,transform 240ms/);
});

test("Pass 3 medication rail loops, pauses, and keeps every manual control active", () => {
  assert.match(runtime, /const motionPreference = window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(runtime, /index = \(index \+ delta \+ cards\.length\) % cards\.length/);
  assert.match(runtime, /window\.setInterval\(\(\) => move\(1\), 3000\)/);
  assert.match(runtime, /motionPreference\.matches \|\| document\.hidden \|\| pauseReasons\.size > 0/);
  assert.match(runtime, /pause\('interaction'\)/);
  assert.match(runtime, /pause\('hover'\)/);
  assert.match(runtime, /pause\('focus'\)/);
  assert.match(runtime, /prev\?\.addEventListener\('click',[\s\S]*move\(-1\)/);
  assert.match(runtime, /next\?\.addEventListener\('click',[\s\S]*move\(1\)/);
  assert.match(runtime, /dot\.addEventListener\('click',[\s\S]*choose\(cardIndex\)[\s\S]*pauseForInteraction\(\)/);
  assert.match(runtime, /track\.dataset\.medActiveIndex = String\(index\)/);
  assert.match(runtime, /aria-roledescription', 'carousel'/);
});

test("Pass 3 keeps tooltip, newsletter, review, and risk-card keyboard contracts", () => {
  assert.match(runtime, /document\.querySelectorAll\('\[data-price-info\]'\)/);
  assert.match(runtime, /trigger\.setAttribute\('aria-describedby', tooltip\.id\)/);
  assert.match(runtime, /trigger\.addEventListener\('focus', \(\) => setOpen\(true\)\)/);
  assert.match(runtime, /if \(event\.key !== 'Escape'\) return;[\s\S]*setOpen\(false\)/);
  assert.match(runtime, /layer\.addEventListener\('keydown',[\s\S]*event\.key === 'Escape'[\s\S]*close\(\)/);
  assert.match(runtime, /sheet\.addEventListener\('keydown',[\s\S]*event\.key === 'Escape'[\s\S]*close\(\)/);
  assert.match(runtime, /card\.addEventListener\('keydown',[\s\S]*event\.key === 'Escape'[\s\S]*aria-pressed/);
  assert.match(runtime, /lastFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(runtime, /const focusTarget = returnFocus/);
  assert.match(runtime, /sheet\.hidden = true;[\s\S]*focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
});

test("W7 extracts only a US two-letter Cloudflare region code", () => {
  const us = new Request("https://glpclinicscout.com/api/geo-state", { headers: { "cf-ipcountry": "US", "cf-region-code": "OR" } });
  assert.equal(detectRequestState(us), "OR");
  const foreign = new Request("https://glpclinicscout.com/api/geo-state", { headers: { "cf-ipcountry": "CA", "cf-region-code": "BC" } });
  assert.equal(detectRequestState(foreign), null);
  const invalid = new Request("https://glpclinicscout.com/api/geo-state", { headers: { "cf-ipcountry": "US", "cf-region-code": "Oregon" } });
  assert.equal(detectRequestState(invalid), null);
});

test("W7 endpoint returns private no-store state data with no IP", async () => {
  const request = new Request("https://glpclinicscout.com/api/geo-state", { headers: { "cf-ipcountry": "US", "cf-region-code": "CA" } });
  const response = await onRequestGet({ request });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.deepEqual(body, { schema: "glp-geo-state-v1", available: true, state: "CA" });
  assert.equal("ip" in body, false);
});

test("W7 client contract exposes manual fallback, state chip, and dynamic H1 template", () => {
  assert.match(runtime, /data-state-title-template/);
  assert.match(runtime, /template\.replaceAll\('\{state\}'/);
  assert.match(runtime, /data-state-select/);
  assert.match(runtime, /cloudflare-geo/);
  assert.match(runtime, /window\.CS_STATE/);
  assert.match(shell, /\.cs-state-chip/);
  assert.match(servedRuntime, /data-state-title-template/);
  assert.match(servedRuntime, /window\.CS_STATE/);
  assert.match(servedHomeCss, /\.cs-state-chip/);
});


test("quiz answers remain live and never decorate unrelated provider-card surfaces", async () => {
  const [quiz, runtime, css, matches] = await Promise.all([
    readFile(new URL("../assets/quiz-page.js", import.meta.url), "utf8"),
    readFile(new URL("../assets/site.js", import.meta.url), "utf8"),
    readFile(new URL("../assets/css-src/20-money.css", import.meta.url), "utf8"),
    readFile(new URL("../assets/matches-customized.js", import.meta.url), "utf8"),
  ]);
  assert.match(quiz, /gcs\.quiz\.provider-fit\.preferences\.v1/);
  assert.match(quiz, /gcs\.quiz\.provider-fit\.progress\.v1/);
  assert.match(quiz, /function saveProgress\(\) \{[\s\S]*?root\.phase4State = answers;/);
  assert.match(quiz, /function hydrateProgress\(\) \{\s*clearSavedQuiz\(\);\s*return 0;/);
  assert.match(quiz, /function saveCompletedPreferences\(\) \{[\s\S]*?clearSavedQuiz\(\);/);
  const preferenceMarkerStart = quiz.indexOf("function saveCompletedPreferences()");
  const preferenceMarkerEnd = quiz.indexOf("/* Design pass", preferenceMarkerStart);
  assert.ok(preferenceMarkerStart >= 0 && preferenceMarkerEnd > preferenceMarkerStart);
  assert.doesNotMatch(quiz.slice(preferenceMarkerStart, preferenceMarkerEnd), /answers\s*:|setItem|matches\s*:/);
  assert.doesNotMatch(quiz, /localStorage\.setItem/);
  for (const source of [runtime, servedRuntime]) {
    assert.match(source, /gcs\.quiz\.provider-fit\.preferences\.v1/);
    assert.match(source, /gcs\.quiz\.provider-fit\.progress\.v1/);
    assert.match(source, /for \(const storage of \['localStorage', 'sessionStorage'\]\)/);
    assert.match(source, /window\[storage\]\.removeItem\(key\)/);
    assert.doesNotMatch(source, /Matches your preferences|data-preference-popover|quizCompleted/);
  }
  // Styles may remain, but they must not imply an enabled saved-profile feature.
  assert.match(css, /\.cs-preference-popover/);
  assert.match(servedMoneyCss, /\.cs-preference-popover/);
  assert.match(matches, /data-result-card/);
  assert.match(matches, /qz-card-identity/);
  assert.match(matches, /qz-card-match/);
  assert.match(matches, /qz-card-review/);
});
