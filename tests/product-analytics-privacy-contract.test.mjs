import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertCurrentProductAnalyticsPrivacy } from './helpers/product-analytics-privacy.mjs';

const runtime = readFileSync(new URL('../assets/analytics.js', import.meta.url), 'utf8');

test('current product-ready analytics privacy accepts actual GLP44 consent-gated coarse progression', () => {
  assertCurrentProductAnalyticsPrivacy(runtime);
});

test('current product-ready privacy oracle refuses gate, property, listener and event-allowlist regressions', () => {
  const mutations = [
    ['implicit emit', " || !progressionAllowed(name)", ''],
    ['implicit last-mile', ' || !progressionAllowed(event.event)', ''],
    ['caller fields', 'for (const key of allowed[name]) if (params[key] !== undefined) clean[key] = params[key];', 'return params;'],
    ['last-mile fields', 'properties: {\n        token: properties.token,', 'properties: {\n        ...properties,\n        token: properties.token,'],
    ['quiz relabel', 'if (PROGRESSION_EVENTS.has(name)) emit(name);', 'emit(name);'],
    ['forbidden completion', 'cost_calculator_used: [], calculator_submit: [],', 'cost_calculator_complete: [], cost_calculator_used: [], calculator_submit: [],'],
    ['missing coarse event', 'quiz_start: [], quiz_step_complete: [], quiz_complete: [], results_view: [],', 'quiz_start: [], quiz_step_complete: [], results_view: [],'],
    ['revoked emit', 'if (!consented() || !config.enabled || config.consent !== "granted" || !reviewed(name) || !progressionAllowed(name)) return false;', 'if (!reviewed(name) || !progressionAllowed(name)) return false;'],
  ];
  for (const [label, before, after] of mutations) {
    assert.equal(runtime.split(before).length, 2, `${label}: unique maintained source mutation`);
    const changed = runtime.replace(before, after);
    assert.notEqual(changed, runtime, label);
    assert.throws(() => assertCurrentProductAnalyticsPrivacy(changed), assert.AssertionError, label);
  }
});

test('historical product-ready completion-name prohibition remains exact on authenticated pre-GLP44 runtime', () => {
  const bytes = execFileSync('git', ['show', '8cc4a4d70199b6d2604b89ca59123d0b484bda18:assets/analytics.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), maxBuffer: 128 * 1024,
  });
  const authenticate = raw => {
    assert.equal(createHash('sha256').update(raw).digest('hex'), '0a0a7729cb628fc7afb694080bd07f82df28975409030ca7f19850f4dd2fb22a');
    return raw.toString();
  };
  const runtime = authenticate(bytes);
  // Original three-event assertion, unchanged; this generation predates GLP44.
  for (const event of ['cost_calculator_complete','quiz_complete','provider_finder_complete'])
    assert.ok(!runtime.includes(event), `${event}: must not re-enter the analytics export allowlist`);
  assert.throws(() => authenticate(Buffer.concat([bytes, Buffer.from('\n// tamper')])), assert.AssertionError);
  assert.throws(() => assertCurrentProductAnalyticsPrivacy(runtime), assert.AssertionError,
    'historical no-progression bytes cannot substitute for the current GLP44 contract');
});
