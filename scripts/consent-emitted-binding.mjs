#!/usr/bin/env node
// Read-only provenance check in the registered builder's Node engine. Never
// serialize a producer imported by Playwright: its function transform changes
// Function.toString() bytes. This command does not build or replace an artifact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SOURCES=['scripts/build-staging.mjs','scripts/consent-emitted-binding.mjs','src/consent-runtime.mjs','src/ga4-runtime.mjs'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceRows=root=>SOURCES.map(file=>({file,sha256:sha(readFileSync(path.join(root,file)))}));
export function verifyConsentBinding(receipt,root,emitted) {
 assert.equal(receipt.schema,'glp-node-consent-emission-binding-v1','consent binding schema');
 assert.equal(receipt.engine.name,'node','consent binding engine');
 assert.equal(receipt.engine.version,process.version,'consent binding Node version');
 assert.equal(receipt.engine.executable_sha256,sha(readFileSync(process.execPath)),'consent binding Node executable');
 assert.deepEqual(receipt.sources,sourceRows(root),'consent binding source hashes');
 assert.equal(receipt.producer,'scripts/build-staging.mjs:consentRuntimeSource','consent binding registered producer');
 assert.equal(receipt.exact_producer_equality,true,'consent binding producer equality');
 assert.deepEqual(receipt.emitted,{file:'assets/consent.js',sha256:sha(emitted)},'consent binding emitted hash');
 return receipt;
}
export function bindEmittedConsent(root,publicRoot,emitted) {
 const env={...process.env};delete env.NODE_OPTIONS;
 // No inherited loader/preload may transform the Node producer either.
 const receipt=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/consent-emitted-binding.mjs'),'--public',path.resolve(publicRoot)],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 return verifyConsentBinding(receipt,root,emitted);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 assert.equal(process.argv.length,4,'usage: node scripts/consent-emitted-binding.mjs --public <emitted root>');
 assert.equal(process.argv[2],'--public');
 const sources=sourceRows(ROOT);
 const {consentRuntimeSource}=await import('../src/consent-runtime.mjs');
 const emitted=readFileSync(path.join(path.resolve(process.argv[3]),'assets/consent.js'));
 assert.ok(emitted.equals(Buffer.from(consentRuntimeSource)),'consent binding: emitted bytes differ from registered Node producer');
 const receipt={schema:'glp-node-consent-emission-binding-v1',engine:{name:'node',version:process.version,executable_sha256:sha(readFileSync(process.execPath))},producer:'scripts/build-staging.mjs:consentRuntimeSource',sources,exact_producer_equality:true,emitted:{file:'assets/consent.js',sha256:sha(emitted)}};
 verifyConsentBinding(receipt,ROOT,emitted);
 console.log(JSON.stringify(receipt));
}
