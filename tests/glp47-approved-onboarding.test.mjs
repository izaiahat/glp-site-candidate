import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMessage, runDripScheduler } from '../src/resend-email-machine.mjs';
const config = JSON.parse(readFileSync(new URL('../data/resend-email-machine.json', import.meta.url)));

test('GLP47 approved onboarding is two messages at enrollment and two days', () => {
  assert.deepEqual(config.welcome_sequence.map(x => [x.day, x.subject]), [[0, 'Welcome to GLP Clinic Scout'], [2, 'Four questions to ask before you pay']]);
});

test('GLP47 renders the approved body and footer without generic additions', () => {
  const subscriber = { consent_status: 'opted-in', status: 'active', email: 'synthetic@example.invalid', unsubscribe_token: 'a'.repeat(32), subscriber_id: 'synthetic', vertical: 'glp-clinic-scout', funnel_stage: 'newsletter' };
  for (const template of config.welcome_sequence) {
    const msg = buildMessage({ config, subscriber, template, campaignId: 'synthetic-glp47' });
    const url = `https://glpclinicscout.com/unsubscribe?token=${subscriber.unsubscribe_token}`;
    assert.equal(msg.body.text, template.body_text + '\n\n' + config.welcome_footer.replace('{{unsubscribe_url}}', url));
    assert.equal(msg.body.from, 'GLP Clinic Scout <partners@glpclinicscout.com>');
    assert.equal(msg.body.reply_to, 'partners@glpclinicscout.com');
    assert.equal(msg.body.subject, template.subject);
    assert.equal(msg.body.text.includes('{{'), false);
    assert.equal(msg.body.text.includes('This issue gives you'), false);
  }
});

test('GLP47 copy approval cannot authorize an onboarding runtime effect', async () => {
  let touched = false;
  const receipt = config.operator_approval.receipt_sha256;
  const result = await runDripScheduler({ EMAIL_RUNTIME_MODE: 'production_operator_approved', EMAIL_OPERATOR_RECEIPT_SHA256: receipt, EMAIL_SEND_GATE: `operator-approved:${receipt}`, EMAIL_WARMUP_STATUS: 'PASS', RESEND_API_KEY: 'synthetic', EMAIL_DB: { prepare() { touched = true; throw new Error('must not touch database'); } } }, config);
  assert.deepEqual(result, { status: 'HELD', sent: 0, reason: 'glp47_onboarding_runtime_held_b01' });
  assert.equal(touched, false);
});
