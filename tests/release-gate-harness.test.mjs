import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { startDenyProxy } from '../artifacts/ultracode/tools/qa-common.mjs';
import {assertServedGoIdentity} from '../src/served-affiliate-identity.mjs';
import { noEgress, publishedSecrets, checkAnchorMarkup, checkBrowser, requiredAffiliateAnchors } from '../scripts/ci-release-gate.mjs';

const authority = { approved: { status: 'VERIFIED', promotion_authorized: true }, held: { status: 'WITHHELD', promotion_authorized: false } };
const runtime = { approved: { live_link_allowed: true, promotion_authorized: true }, held: { live_link_allowed: false, promotion_authorized: false } };
const healthy = '<a href="/go/approved" data-program="approved" rel="sponsored nofollow">Visit</a>';
const audit = text => checkAnchorMarkup([{ file: 'index.html', text }], authority, {}, runtime, ['approved']);

test('negative: a denied vendor request makes the actual egress gate fail', async () => {
  const proxy = await startDenyProxy();
  let browser;
  try {
    browser = await chromium.launch({ proxy: { server: proxy.url } });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    noEgress(proxy.attempts);
    // Deliberate synthetic negative; the proxy never connects to the vendor.
    await page.evaluate(async () => { try { await fetch('https://www.google-analytics.com/g/collect?d1_negative=1'); } catch {} });
    assert.ok(proxy.attempts.length > 0, 'real browser request reached default-deny proxy');
    assert.throws(() => noEgress(proxy.attempts), /D1_egress_attempt/);
  } finally { await browser?.close(); await proxy.close(); }
});
test('negative: approved same-network program crosswires fail HTML and lazy JSON gates', () => {
  const authority = {a:{status:'VERIFIED',promotion_authorized:true}, b:{status:'VERIFIED',promotion_authorized:true}};
  const runtime = {a:{live_link_allowed:true,promotion_authorized:true}, b:{live_link_allowed:true,promotion_authorized:true}, aliasA:{live_link_allowed:true,promotion_authorized:true}};
  const programs = {a:{network:'Katalys',program_id:'a'}, b:{network:'Katalys',program_id:'b'}, aliasA:{network:'Katalys',program_id:'a'}};
  const healthy = '<a href="/go/aliasA" data-program="a" data-network="Katalys" rel="sponsored nofollow">Visit A</a>';
  const crosswire = healthy.replace('/go/aliasA', '/go/b');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'glp41-crosswire-'));
  try {
    for (const file of ['index.html','cards.json']) {
      const serialize = text => file.endsWith('.json') ? JSON.stringify([text]) : text;
      const check = text => checkAnchorMarkup([{file,text:serialize(text)}], authority, {aliasA:'a'}, runtime, ['a']);
      check(healthy);
      assert.throws(() => check(crosswire), /crosswired_go:b:a/);
      writeFileSync(path.join(dir,file), serialize(healthy));
      assertServedGoIdentity(dir, programs, {aliasA:'a'});
      writeFileSync(path.join(dir,file), serialize(crosswire));
      assert.throws(() => assertServedGoIdentity(dir,programs,{aliasA:'a'}), /crosswired_go/);
      rmSync(path.join(dir,file));
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('negative: held /go is rejected even without sponsored metadata', () => {
  audit(healthy);
  assert.throws(() => audit(healthy + '<a href="/go/held">bad</a>'), /held_go:held/);
});
test('negative: missing authorized anchor fails nonempty artifact', () => {
  audit(healthy);
  assert.throws(() => audit('<h1>No provider action</h1>'), /missing_authorized_anchor:approved/);
  // Historical ADOPT is not current permission. Explicit current denials are
  // excluded from the positive denominator, but still fail the anchor census.
  const selection = {programs:{approved:{program_id:'approved',render_id:'approved',status:'VERIFIED'},
    held:{program_id:'held',render_id:'held',status:'VERIFIED'}}};
  const required = requiredAffiliateAnchors(selection, authority);
  assert.deepEqual(required, ['approved']);
  for (const file of ['index.html','cards.json']) {
    const check = text => checkAnchorMarkup([{file,text:file.endsWith('.json')?JSON.stringify([text]):text}], authority, {}, runtime, required);
    check(healthy);
    assert.throws(() => check('<h1>No provider action</h1>'), /missing_authorized_anchor:approved/);
    assert.throws(() => check(healthy+'<a href="/go/held" data-program="held" rel="sponsored nofollow">bad</a>'), /held_go:held/);
    assert.throws(() => check(healthy+'<a href="https://fixture.invalid/" data-program="held" rel="sponsored nofollow">bad</a>'), /unauthorized_anchor:held/);
  }
  // Missing, unknown or contradictory authority cannot silently shrink coverage.
  for (const row of [undefined, {}, {status:'UNKNOWN'}, {status:'VERIFIED',promotion_authorized:false}, {status:'WITHHELD',promotion_authorized:true}])
    assert.throws(() => requiredAffiliateAnchors(selection, {...authority,held:row}), /D1_selected_authority_invalid:held/);
});
test('negative: planted synthetic secret is rejected by real published scanner', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd1-secret-negative-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), '<h1>Clean</h1>');
    publishedSecrets(dir);
    // Random detector fixture, not a credential; never emit its bytes.
    writeFileSync(path.join(dir, 'accidental-config.txt'), 'github_token = "' + ['ghp', randomBytes(18).toString('hex')].join('_') + '"');
    assert.throws(() => publishedSecrets(dir), /D1_published_secret_scan_failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
const selection = { cases: [{ file: 'tests/browser/required.spec.mjs', title: 'required' }], projects: ['chromium'] };
const report = status => ({ config: { updateSnapshots: 'none' }, errors: [], suites: [{ specs: [{ file: 'required.spec.mjs', title: 'required', tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: status === 'passed' ? 'expected' : 'unexpected', results: [{ status }] }] }] }] });
test('negative: empty required selection fails', () => {
  assert.throws(() => checkBrowser(report('passed'), { cases: [], projects: ['chromium'] }), /selection_empty/);
});
test('negative: required failure, skip and retry cannot become green', () => {
  checkBrowser(report('passed'), selection);
  for (const state of ['failed', 'skipped', 'timedOut']) assert.throws(() => checkBrowser(report(state), selection), /required_browser_failure_or_skip/);
  const retried = report('passed'); retried.suites[0].specs[0].tests[0].results.unshift({ status: 'failed' });
  assert.throws(() => checkBrowser(retried, selection), /required_browser_failure_or_skip/);
});
test('negative: partial browser selection cannot satisfy the gate', () => {
  assert.throws(() => checkBrowser({ ...report('passed'), suites: [] }, selection), /denominator_mismatch/);
});
test('negative: lazy-card held anchors are included in the same census', () => {
  assert.throws(() => checkAnchorMarkup([{ file: 'cards.json', text: JSON.stringify([healthy, '<a href="/go/held">bad</a>']) }], authority, {}, runtime, ['approved']), /held_go:held/);
});
