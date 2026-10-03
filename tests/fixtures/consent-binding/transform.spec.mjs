// Browser-free Playwright regression: this deliberately enters its transform.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {consentRuntimeSource} from '../../../src/consent-runtime.mjs';
import {bindEmittedConsent,verifyConsentBinding} from '../../../scripts/consent-emitted-binding.mjs';
import {assertEmittedLoaderSemantics} from '../../helpers/ga4-semantic-contract.mjs';
test('registered Node output binds despite Playwright function transformation',()=>{
 const emitted=readFileSync(path.join(process.env.GLP_BINDING_FIXTURE_PUBLIC,'assets/consent.js'),'utf8');
 expect(emitted).not.toBe(consentRuntimeSource); // Reproduces the original wrong seam.
 const root=path.resolve('.'),receipt=bindEmittedConsent(root,process.env.GLP_BINDING_FIXTURE_PUBLIC,emitted);
 expect(receipt.exact_producer_equality).toBe(true);
 assertEmittedLoaderSemantics(emitted); // Executes Node bytes, not transformed bytes.
 expect(()=>verifyConsentBinding(receipt,root,emitted+'\n')).toThrow(/emitted hash/);
 const stale=structuredClone(receipt);stale.sources.find(r=>r.file==='src/ga4-runtime.mjs').sha256='wrong';
 expect(()=>verifyConsentBinding(stale,root,emitted)).toThrow(/source hashes/);
});
