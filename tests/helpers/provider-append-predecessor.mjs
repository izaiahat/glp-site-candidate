import {readFileSync} from 'node:fs';
import {providerPricePredecessorBytes,providerPricePredecessorRegistry} from '../../src/provider-price-append.mjs';
// Historical-oracle tests keep their exact predecessor inputs and assertions.
// The new native append suite separately exercises today's complete inputs.
export function readHistoricalPriceFixture(file) {
 const bytes=readFileSync(file), name=String(file);
 if(name.endsWith('/program-content-ledger.json'))return providerPricePredecessorBytes(bytes,'ledger');
 if(name.endsWith('/program-registry.json'))return Buffer.from(JSON.stringify(providerPricePredecessorRegistry(JSON.parse(bytes))));
 return bytes;
}
