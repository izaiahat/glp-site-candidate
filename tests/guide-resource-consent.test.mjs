import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { addP1ContentUpgradeSurface } from '../src/wave2-p1-surfaces.mjs';
import { handleContentUpgradeRequest, resolveContentUpgradeTemplate } from '../src/content-upgrade.mjs';

const route = '/guides/how-to-order-at-restaurants-on-a-glp-1-a-practical-guide/';
const frame = `<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com${route}"></head><body><main><h1>Restaurant guide</h1><section><h2>Menu sources</h2><p>Retained article prose.</p></section><section><h2>Questions</h2><p>Retained questions.</p></section></main></body></html>`;
function rendered() {
  const html = addP1ContentUpgradeSurface(frame);
  const form = html.match(/<form\b[\s\S]*?<\/form>/)[0];
  const payload = Object.fromEntries([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(m => [m[1], m[2]]));
  if ('request_id' in payload) payload.request_id = '2bdf2923-c42d-4b1c-8fea-2461ae3edb8d';
  return { html, form, payload: { ...payload, email: 'reader@example.test', email_consent: 'true', company: '' } };
}
async function exercise(payload, extraEnv = {}, renderedHtml = null) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['002_email_machine.sql', '005_canonical_contact_capture.sql', '010_resource_delivery_purpose.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { calls: [], prepare(sql) { return { bind(...args) { return { async run() { sqlite.prepare(sql).run(...args); db.calls.push({ sql, args }); return { success: true }; } }; } }; } };
  const sent = [];
  const request = new Request('https://glpclinicscout.com/api/content-upgrade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const handle = request => handleContentUpgradeRequest(request, { CONTENT_UPGRADE_CAPTURE_MODE: 'local_test', GLP_DB: db, RESEND_ENABLED: 'true', RESEND_API_KEY: 'synthetic-test-only', ...extraEnv }, async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({ id: 'synthetic-provider-receipt' }), { status: 200 });
  });
  let response;
  if (renderedHtml) {
    const controls = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, { value }]));
    controls.request_id.value = '';
    const status = { textContent: '' }, button = {}, analytics = [];
    const surface = { dataset: { capturePlacement: 'guide-resource' } };
    const form = { action: 'https://glpclinicscout.com/api/content-upgrade', dataset: {},
      elements: { namedItem: key => controls[key] }, closest: () => surface,
      querySelector: selector => selector === '.capture-status' ? status : button, reset() {} };
    let submit;
    vm.runInNewContext(readFileSync(new URL('../assets/content-capture-resilient.js', import.meta.url), 'utf8'), {
      document: { addEventListener: (_event, handler) => { submit = handler; } },
      window: { GCSAnalytics: { event: (...args) => analytics.push(args) } }, crypto,
      FormData: class { entries() { return Object.entries(controls).map(([key, input]) => [key, input.value]); } },
      setTimeout, fetch: async (url, init) => {
        assert.equal(init.referrerPolicy, 'no-referrer');
        response = await handle(new Request(url, init));
        return response.clone();
      },
    });
    await submit({ target: { closest: () => form }, preventDefault() {}, stopImmediatePropagation() {} });
    assert.match(status.textContent, /guide link was emailed/);
    assert.doesNotMatch(JSON.stringify(analytics), /how-to-order-at-restaurants/);
    assert.notEqual(controls.request_id.value, '');
  } else response = await handle(request);
  const rows = sqlite.prepare('SELECT * FROM contact_capture_events').all();
  const subscribers = sqlite.prepare('SELECT * FROM subscribers').all();
  sqlite.close();
  return { db, sent, rows, subscribers, response, result: await response.json() };
}

test('C03 actual guide renderer and email resolver deliver the promised guide link without promotion', async () => {
  const { html, payload } = rendered();
  const { sent, result } = await exercise(payload, {}, html);
  assert.equal(result.status, 'CAPTURED');
  assert.match(html, /Email me a link to this guide/);
  assert.equal(resolveContentUpgradeTemplate(payload.lead_magnet_key).templateKey, 'guide-link');
  assert.equal(sent[0].body.subject, 'Your requested guide link');
  assert.ok(sent[0].body.html.includes(`href="https://glpclinicscout.com${route}"`));
  assert.doesNotMatch(sent[0].body.html, /provider terms checklist|Compare current|\/go\//);
  assert.equal(addP1ContentUpgradeSurface(html), html);
});

test('B02 guide resource request stores neutral purpose, never enrolls or syncs contacts, and rejects legacy health attribution', async () => {
  const { html, form, payload } = rendered();
  const { db, sent, response, rows, subscribers } = await exercise(payload);
  assert.equal(response.status, 202);
  assert.equal(db.calls.some(c => /INTO subscribers/.test(c.sql)), false);
  assert.equal(subscribers.length, 0);
  assert.equal(rows[0].purpose, 'resource-delivery');
  assert.equal(rows[0].marketing_consent, 0);
  assert.deepEqual(sent.map(c => c.url), ['https://api.resend.com/emails']);
  assert.doesNotMatch(JSON.stringify(db.calls), /how-to-order-at-restaurants|guides-how-to/);
  assert.ok(db.calls.some(c => c.args.includes('resource-delivery')));
  assert.ok(db.calls.some(c => c.args.includes('resource-only')));
  assert.match(form, /does not subscribe you to follow-up emails/);
  assert.match(form, /email service receives your email address and the guide link/);
  assert.doesNotMatch(form, /occasional provider-comparison|name="marketing_consent"/);
  assert.match(html, /referrerPolicy:'no-referrer'/);
  const held = await exercise(payload, { RESEND_ENABLED: 'false' });
  assert.equal(held.result.status, 'CAPTURED_SENDS_HELD');
  assert.equal(held.sent.length, 0);
  const legacy = { email: payload.email, email_consent: 'true', source_page: 'guides-how-to-order-at-restaurants-on-a-glp-1-a-practical-guide', lead_magnet_key: 'guides-how-to-order-at-restaurants-on-a-glp-1-a-practical-guide-terms-checklist', consent_version: 'glp-content-upgrade-v2-20260801', company: '' };
  const rejected = await exercise(legacy);
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.db.calls.length, 0);
  assert.equal(rejected.sent.length, 0);
  assert.equal(resolveContentUpgradeTemplate(legacy.lead_magnet_key), null);
  const tampered = await exercise({ ...payload, marketing_consent: 'true' });
  assert.equal(tampered.response.status, 400);
  assert.equal(tampered.db.calls.length, 0);
});
