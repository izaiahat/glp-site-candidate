import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { releaseExportPolicy } from '../src/candidate-export-policy.mjs';

const ROOT = path.resolve(process.env.GLP_EXPORT_ARTIFACT_ROOT || 'public');
const expected = releaseExportPolicy(process.env.GCS_RELEASE_STAGE || 'candidate');
const home = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const policySource = html => html.match(/<script data-candidate-export-policy>([\s\S]*?)<\/script>/)?.[1];
function htmlFiles(root) {
  return readdirSync(root, {withFileTypes:true}).flatMap(entry => {
    const file = path.join(root,entry.name);
    return entry.isDirectory() ? htmlFiles(file) : entry.isFile() && file.endsWith('.html') ? [file] : [];
  });
}

test('emitted policy census matches the explicitly selected build stage', () => {
  const files=htmlFiles(ROOT); let policies=0;
  for (const file of files) {
    const html=readFileSync(file,'utf8');
    if(!policySource(html)) {
      // Minimal error/service/standalone pages have no configured consumer.
      assert.doesNotMatch(html,/window\.GCS_(?:POSTHOG|ANALYTICS|CLARITY)\s*=/,file);
      continue;
    }
    policies++;
    assert.equal((html.match(/data-candidate-export-policy/g)||[]).length,1,file);
    const dom=new JSDOM('',{runScripts:'outside-only'});
    try { dom.window.eval(policySource(html)); assert.deepEqual(JSON.parse(JSON.stringify(dom.window.GCS_EXPORT_POLICY)),expected,file); }
    finally { dom.window.close(); }
  }
  assert.ok(policies > 300,'full configured-page census');
});

async function boot(gpc=false) {
  // Use emitted policy + emitted consent bytes, no replacement policy or test
  // runtime. Region is a local prior-opt-in fixture; no network is performed.
  const dom=new JSDOM('<!doctype html><body><footer><a href="/privacy/cookies/">Cookie choices</a></footer></body>', {url:'https://glpclinicscout.com/',runScripts:'outside-only'});
  const w=dom.window;
  Object.defineProperty(w.navigator,'globalPrivacyControl',{value:gpc});
  w.fetch=async () => ({ok:true,json:async()=>({schema:'glp-consent-region-v1',model:'prior-opt-in'})});
  w.eval(policySource(home));
  w.eval(readFileSync(path.join(ROOT,'assets/consent.js'),'utf8'));
  await w.GCSConsentReady;
  if(!w.document.querySelector('[data-consent]'))w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return dom;
}

test('emitted prior-opt-in runtime denies before choice and after denial, enables only after explicit grant in production', async () => {
  const dom=await boot();const w=dom.window;
  try {
    assert.equal(w.GCSConsent.allowsExports(),false,'before any grant');
    w.document.querySelector('[data-consent="denied"]').click();
    assert.equal(w.GCSConsent.allowsExports(),false,'explicit denial');
    w.document.querySelector('footer a').click();
    w.document.querySelector('[data-consent="granted"]').click();
    assert.equal(w.GCSConsent.read().analytics_basis,'explicit');
    assert.equal(w.GCSConsent.allowsExports(),expected.third_party_exports,'explicit grant');
    w.document.querySelector('footer a').click();
    w.document.querySelector('[data-consent="denied"]').click();
    assert.equal(w.GCSConsent.allowsExports(),false,'revocation');
  } finally {w.close();}
});

test('emitted GPC runtime remains denied despite a requested grant', async () => {
  const dom=await boot(true);const w=dom.window;
  try { assert.equal(w.GCSConsent.allowsExports(),false); w.GCSConsent.apply('granted'); assert.equal(w.GCSConsent.allowsExports(),false); }
  finally {w.close();}
});
