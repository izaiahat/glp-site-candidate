import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {providerPricePredecessorBytes,providerPricePredecessorRegistry} from '../../src/provider-price-append.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
// Exact unchanged-main Git inputs, fixture-only. No production caller imports
// this archive, and no original historical assertion/digest is modified.
export function readBeforeProviderAppendFixture(file) {
 const packed=readFileSync(new URL('../fixtures/provider-append-predecessor.json.gz',import.meta.url));
 if(sha(packed)!=='e2ac16eabecadb369c3e703eb6d46334b46b9a5116eb7914450e5d9dcacec34e')throw Error('historical_fixture_archive_drift');
 const archive=JSON.parse(gunzipSync(packed));
 if(archive.git_commit!=='c5154618dae0f62e16db9543788f36c3bdbed7b7')throw Error('historical_fixture_commit_drift');
 const name=String(file).split('/').at(-1), row=archive.files[name];
 if(!row)throw Error('historical_fixture_scope');
 const bytes=Buffer.from(row.base64,'base64');
 if(sha(bytes)!==row.sha256)throw Error('historical_fixture_bytes_drift');
 return bytes;
}
// Historical-oracle tests keep their exact predecessor inputs and assertions.
// The native append suite separately exercises today's complete inputs.
export function readHistoricalPriceFixture(file) {
 const bytes=readFileSync(file), name=String(file);
 if(name.endsWith('/program-content-ledger.json'))return providerPricePredecessorBytes(bytes,'ledger');
 if(name.endsWith('/program-registry.json'))return Buffer.from(JSON.stringify(providerPricePredecessorRegistry(JSON.parse(bytes))));
 return bytes;
}
