import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Test-only authentic pre-relationship generation; never current authority.
export const MONEY_HISTORICAL_REF = '9cd63e73d743d69104fa0a281ce42113743faf4a';
export const MONEY_HISTORICAL_PINS = {
  'tests/affiliate-expansion-13.test.mjs':'80f8af45c6a0f72acb2d486b48beb778e1fcacfc4a339841df9effdad2bbefb8',
  'src/money-page.mjs':'829504ebcaca4e5cb99cd6f0ab409b6986ecde30340849587d23a842fa74086d',
  'src/go-render-selection.mjs':'8f0fd88e0939eeab952a9a5f97a3280b16a82591b9e22cd7b7305021ddb191cc',
  'src/go-runtime-selection.mjs':'076e767ba3bf50f444615ad45266f3db1a4c30d099651f5f1effc99c2a6f7cca',
  'src/affiliate-link-map.mjs':'3bb817c4a29504af087e1c06a4e8a25adeac0696e8cee371158530f659b86c45',
  'src/provider-cta-contract.mjs':'351dbba3db12fa4cdbe3dca2adf58214444fec12a22cec7d8daee69b4909ec32',
  'data/money-page-specs.json':'0b67ae04770fa7d8c96164383877881a88334a59b1a98b6c166991acd9c37638',
  'data/program-registry.json':'385a0f30f0ca6f72d9d83d8e0cab173f9c66191d4ea7b2fb6bd51c0a34d35ce5',
  'data/affiliate-activation-selection.json':'63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6',
  'data/identity-registry.json':'b9c03c9b0db71bb2fec89fa435ba2f5eb8ab4a1f704d261c60981adbc49de92a',
  'data/affiliate-wire-in-approvals.json':'9c9bfc31f4921bb6faf62a93d685e67b737b72ce81ca2f198154a8cbf399187e',
  'data/approved-program-registry.json':'f20a9f5639d189230f15227dead2d9ec54bb6dc916107e9f745cb1c07be8b404',
  'data/provider-page-contracts.json':'edcbabb72522b0884f6d6ac97a813b6bf7afc2bb63bf4302c42162a0d03ffef6',
  'data/provider-fastpath-contract.json':'03b9146d2c0da7d5207a8e3f492c0aaa997b6a121be472fa9fa38fcd5f739027',
  'data/go-runtime-promotion-authority.json':'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2',
  'data/go-selection-receipt.json':'712a058818ee5c5c9fd9f030da286fe8979069c7e2dc21a37416ed612c543e7e',
  'data/go-terms-review-ledger.json':'d38d452c71155b33779527944b0b6ba7b156c56a31bba6b212bf4b2cc9d274da',
  'data/OPERATOR-DECISION-20261001-all-pipelines-live.md':'147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad',
  'data/provider-cta-identity-v2.json':'1ef8b5f1c1fb294c98e06f66bb7b76ed673054ff389981bda088c8146fb55257',
};
export async function historicalMoneyContext(read = file => execFileSync('git', ['show', `${MONEY_HISTORICAL_REF}:${file}`], {cwd:fileURLToPath(new URL('../../', import.meta.url)), env:{...process.env,GIT_NO_LAZY_FETCH:'1'}, maxBuffer:32*1024*1024})) {
  const blobs = Object.fromEntries(Object.entries(MONEY_HISTORICAL_PINS).map(([file, pin]) => {
    const bytes = read(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin, `${file}: historical money input custody`);
    return [file, Buffer.from(bytes).toString('utf8')];
  }));
  const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
  // Relocate only resolution: historical modules read ONLY historical bytes.
  // No frozen provider permissions, selection or prices enter current modules.
  const memoryKey = 'glp.historical-money.9cd63e7';
  globalThis[Symbol.for(memoryKey)] = Object.freeze(Object.fromEntries(Object.entries(blobs).filter(([file]) => file.startsWith('data/'))));
  const memoryFs = dataUrl(`const files=globalThis[Symbol.for(${JSON.stringify(memoryKey)})];
    const key=p=>String(p).slice(String(p).lastIndexOf('/data/')+1);
    export const existsSync=p=>Object.hasOwn(files,key(p));
    export function readFileSync(p,encoding){if(!existsSync(p))throw Object.assign(new Error('historical closure missing:'+key(p)),{code:'ENOENT'});return encoding?files[key(p)]:Buffer.from(files[key(p)]);}`);
  const urls = new Map();
  function moduleUrl(file) {
    if (urls.has(file)) return urls.get(file);
    const origin = new URL('../../' + file, import.meta.url);
    const source = blobs[file].replace(/from\s*(["'])([^"']+)\1/g, (_all, _quote, specifier) => {
      if (specifier === 'node:fs') return `from ${JSON.stringify(memoryFs)}`;
      if (!specifier.startsWith('.')) return _all;
      const target = new URL(specifier, origin), relative = fileURLToPath(target).slice(fileURLToPath(new URL('../../', import.meta.url)).length);
      return `from ${JSON.stringify(blobs[relative] ? moduleUrl(relative) : target.href)}`;
    }).replaceAll('import.meta.url', JSON.stringify(origin.href));
    const url = dataUrl(source); urls.set(file, url); return url;
  }
  const moneyModule = await import(moduleUrl('src/money-page.mjs'));
  const runtime = await import(moduleUrl('src/go-runtime-selection.mjs'));
  const json = name => JSON.parse(blobs['data/' + name + '.json']);
  return {source:blobs['tests/affiliate-expansion-13.test.mjs'], renderMoneyPage:moneyModule.renderMoneyPage,
    money:json('money-page-specs'), registry:json('program-registry'), identity:json('identity-registry'),
    selection:json('affiliate-activation-selection'), wireApprovals:json('affiliate-wire-in-approvals'),
    promotion:runtime.loadGoPromotionAuthority().programs, selectedGo:new Map(Object.values(runtime.loadGoSelection().programs).map(p => [p.render_id,p]))};
}
