import test from 'node:test';
import assert from 'node:assert/strict';
import { addP1ContentUpgradeSurface } from '../src/wave2-p1-surfaces.mjs';
import { assertGuideResourceCapture } from './helpers/guide-resource-capture.mjs';

const routes = ['/guides/mounjaro-coupon/', '/guides/wegovy-pills-oral-semaglutide-cost/'];
const render = route => addP1ContentUpgradeSurface(`<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com${route}"></head><body><main><h1>Guide</h1><section><h2>Sources</h2><p>Unchanged evidence.</p></section></main></body></html>`);

test('GLP361 guide capture oracle accepts actual resource-only rendering and rejects commercial or incomplete substitutions', () => {
  for (const route of routes) {
    const html = render(route);
    assertGuideResourceCapture(html, route);
    const mutations = [
      ['legacy commercial consent', s => s.replace('glp-guide-resource-v1-20261007', 'glp-content-upgrade-v2-20260801')],
      ['health-route attribution', s => s.replace('value="guide-link"', `value="${route.slice(1, -1).replaceAll('/', '-')}"`)],
      ['terms-checklist magnet', s => s.replace('guide-link-resource', 'guide-link-terms-checklist')],
      ['wrong delivered route', s => s.replace(`name="guide_path" value="${route}"`, 'name="guide_path" value="/guides/wrong-guide/"')],
      ['missing delivery path', s => s.replace(/<input[^>]+name="guide_path"[^>]*>/, '')],
      ['missing request id', s => s.replace(/<input[^>]+name="request_id"[^>]*>/, '')],
      ['prepopulated request id', s => s.replace('name="request_id" value=""', 'name="request_id" value="2bdf2923-c42d-4b1c-8fea-2461ae3edb8d"')],
      ['duplicate version', s => s.replace('</form>', '<input type="hidden" name="consent_version" value="glp-guide-resource-v1-20261007"></form>')],
      ['marketing enrollment', s => s.replace('</form>', '<input type="hidden" name="marketing_consent" value="true"></form>')],
      ['visible consent gate', s => s.replace('</form>', '<input type="checkbox" name="email_consent" required></form>')],
      ['missing privacy copy', s => s.replace('href="/privacy/"', 'href="/terms/"')],
      ['missing no-subscription promise', s => s.replace('This does not subscribe you to follow-up emails.', '')],
      ['promotional purpose', s => s.replace('you request one email containing a link to this guide.', 'you agree to receive this resource and occasional provider-comparison research.')],
      ['missing email', s => s.replace(/<input[^>]+name="email"[^>]*>/, '')],
      ['missing honeypot', s => s.replace(/<input[^>]+name="company"[^>]*>/, '')],
      ['duplicate resource form', s => s.replace('</main>', `${s.match(/<form\b[\s\S]*?<\/form>/)[0]}</main>`) ],
    ];
    for (const [name, mutate] of mutations) {
      const changed = mutate(html);
      assert.notEqual(changed, html, `${route}: ${name} mutation must change actual renderer bytes`);
      assert.throws(() => assertGuideResourceCapture(changed, route), assert.AssertionError, `${route}: ${name}`);
    }
    assert.match(html, /referrerPolicy:'no-referrer'/);
    assert.equal(addP1ContentUpgradeSurface(html), html);
  }
});
