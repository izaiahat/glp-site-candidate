// Shared live readiness and reviewed factual content. No payment-authority implementation here.
import {paymentVerified} from './sponsor-pricing.mjs';
import {renderCitationAnchor,CITATION_REASONS} from './citation-attribution.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const SPONSOR_FACTS=Object.freeze([
 ['program_summary','Program summary'],['published_price','Published price'],
 ['eligibility_states','Eligibility and states'],['current_offer','Current offer']
]);
function https(value) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password) throw Error('Invalid approved source or destination');
 return url;
}
export function validateSponsorOrder(order) {
 if(!order.operator_approval||!order.partner_creative_approval||order.release_approved!==true||!paymentVerified(order)||!order.eligibility_approved||!order.inventory_reserved||!order.starts_at||!order.ends_at) throw Error('Sponsor activation gates missing; authenticated payment required; release approval required');
 if(typeof order.provider!=='string'||!order.provider.trim()||/fella/i.test(order.provider)||order.held!==false||order.us_provider!==true) throw Error('Excluded, held or unverified jurisdiction');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(order.slug||'')||['rates','example-provider'].includes(order.slug)) throw Error('Invalid or reserved provider slug');
 if(typeof order.order_reference!=='string'||!order.order_reference.trim()||order.inventory_slot!=='providers-directory-panel') throw Error('Exact reviewed order and inventory slot required');
 https(order.destination);
 const start=Date.parse(order.starts_at),end=Date.parse(order.ends_at),now=Date.now();
 if(!Number.isFinite(start)||!Number.isFinite(end)||end-start!==720*3600000||now<start||now>=end) throw Error('Outside paid term');
 for(const [key] of SPONSOR_FACTS) {
  const fact=order.facts?.[key];
  if(!fact||typeof fact.text!=='string'||!fact.text.trim()||fact.text.length>1500) throw Error(`Reviewed factual content required: ${key}`);
  https(fact.source_url);
  const checked=Date.parse(fact.checked_at);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fact.checked_at)||!Number.isFinite(checked)||new Date(checked).toISOString().slice(0,10)!==fact.checked_at||checked>now) throw Error(`Invalid factual checked date: ${key}`);
 }
 return order;
}
// Sources are approved factual citations, not tracking/affiliate CTAs. Rendering makes no network call.
export function renderSponsorFacts(order,{panel=false}={}) {
 return `<${panel?'div':'section'} class="${panel?'':'cs-card'}" data-sponsor-facts${panel?'':' aria-labelledby="sponsor-facts-title"'}>${panel?'':'<h2 id="sponsor-facts-title">Program at a glance</h2>'}<p class="p3-rail-note">Reported information</p><dl>${SPONSOR_FACTS.map(([key,label])=>{
  const fact=order.facts[key];
  return `<div data-sponsor-fact-slot><dt>${esc(label)}</dt><dd>${esc(fact.text)} ${renderCitationAnchor({url:fact.source_url,label:'Source',reason:CITATION_REASONS.INLINE_FACT_SOURCE})} <span>Checked ${esc(fact.checked_at)}</span></dd></div>`;
 }).join('')}</dl></${panel?'div':'section'}>`;
}
