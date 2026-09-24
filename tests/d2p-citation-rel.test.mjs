import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCitationAnchor,CITATION_REASONS} from '../src/citation-attribution.mjs';
import {remediatePage,newState} from '../scripts/codemod-aeo-citation-schema.mjs';
const reason=CITATION_REASONS.INLINE_FACT_SOURCE;
test('D2p citations have evidence-only domain-specific rel even when caller requests weaker rel',()=>{
 for(const [url,rel]of [['https://provider.example/terms','nofollow noopener'],['https://www.fda.gov/drugs','noopener'],['https://fda.gov.evil.example/','nofollow noopener']]){
  for(const input of [undefined,'noopener','sponsored nofollow noopener'])assert.match(renderCitationAnchor({url,label:'Dated evidence',reason,rel:input}),new RegExp('rel="'+rel+'"'));
 }
 assert.doesNotMatch(renderCitationAnchor({url:'https://app.katalys.com/private',label:'Offer terms',reason}),/<a\b/);
});
test('D2p finalizer repairs manual citation callers without altering scripts or ordinary links',()=>{
 const ordinary='<a href="https://provider.example/" rel="sponsored">Visit</a>';
 const script='<script>const specimen=\'<a href="https://provider.example/" data-citation="inline_fact_source" rel="noopener">\';</script>';
 const html='<html><head></head><body><a href="https://provider.example/terms" data-citation="inline_fact_source" rel="noopener">Source</a><a data-citation="inline_fact_source" href="https://www.fda.gov/" rel="nofollow noopener">FDA</a>'+ordinary+script+'</body></html>';
 const output=remediatePage(html,newState());
 assert.match(output,/<a href="https:\/\/provider\.example\/terms" data-citation="inline_fact_source" rel="nofollow noopener">/);
 assert.match(output,/<a data-citation="inline_fact_source" href="https:\/\/www\.fda\.gov\/" rel="noopener">/);
 assert.ok(output.includes(ordinary));assert.ok(output.includes(script));assert.equal(remediatePage(output,newState()),output);
});
