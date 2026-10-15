import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Independent GLP73 resource-only oracle, not values imported from its producer.
// Commercial checklist forms keep their separate v2 consent assertions.
export function assertGuideResourceCapture(html, route) {
  assert.match(route, /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/);
  const fragment = JSDOM.fragment(html);
  const forms = [...fragment.querySelectorAll('form[action="/api/content-upgrade"]')];
  assert.equal(forms.length, 1, `${route}: exactly one resource-delivery form`);
  const form = forms[0];
  assert.equal(form.getAttribute('method'), 'post');
  const fields = [...form.querySelectorAll('[name]')];
  assert.deepEqual(fields.map(field => field.name).sort(),
    ['company', 'consent_version', 'email', 'guide_path', 'lead_magnet_key', 'request_id', 'source_page'],
    `${route}: exact resource-only fields, no duplicates or marketing attribution`);
  for (const [name, value] of Object.entries({
    source_page: 'guide-link',
    lead_magnet_key: 'guide-link-resource',
    consent_version: 'glp-guide-resource-v1-20261007',
    guide_path: route,
    request_id: '',
  })) {
    const field = form.querySelector(`[name="${name}"]`);
    assert.equal(field.getAttribute('type'), 'hidden', `${route}: ${name} stays hidden`);
    assert.equal(field.getAttribute('value'), value, `${route}: ${name}`);
  }
  const email = form.querySelector('[name="email"]');
  assert.equal(email.getAttribute('type'), 'email');
  assert.equal(email.required, true);
  const company = form.querySelector('[name="company"]');
  assert.equal(company.getAttribute('type'), 'text');
  assert.equal(company.getAttribute('tabindex'), '-1');
  assert.ok(company.closest('.capture-honeypot[aria-hidden="true"]'));
  const note = form.querySelector('.capture-consent-note');
  assert.ok(note, `${route}: passive purpose disclosure`);
  assert.equal(note.textContent.replace(/\s+/g, ' ').trim(),
    'By submitting your email, you request one email containing a link to this guide. The email service receives your email address and the guide link to deliver it. This does not subscribe you to follow-up emails. Privacy Policy.');
  assert.equal(note.querySelector('a')?.getAttribute('href'), '/privacy/');
  const submit = form.querySelector('button[type="submit"]');
  assert.equal(submit?.textContent, 'Email me a link to this guide');
  assert.ok([...form.querySelectorAll('*')].indexOf(note) < [...form.querySelectorAll('*')].indexOf(submit),
    `${route}: purpose disclosure precedes submission`);
  assert.doesNotMatch(form.outerHTML,
    /type=["']checkbox|terms-checklist|glp-content-upgrade-v2|occasional provider-comparison|Unsubscribe anytime/i);
}
