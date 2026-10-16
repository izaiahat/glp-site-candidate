import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Test input only: exact Git 9add923 artifact before the five inherited dirties.
// Never read the mutable build output as the historical 59-identity oracle.
const EXPECTED='40b7dbe12e6a6153f3e6ec257ae0c296d1460494e9b7820b8062d95d94c53d33';
export function historicalPriceDisclosureInput(packed=readFileSync(new URL('../fixtures/provider-append-disclosure-9add923.html.gz',import.meta.url))) {
 const bytes=gunzipSync(packed);
 if(createHash('sha256').update(bytes).digest('hex')!==EXPECTED) throw Error('historical_price_disclosure_input_drift');
 return bytes.toString('utf8');
}
