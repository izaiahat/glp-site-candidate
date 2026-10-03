import test from 'node:test';
import assert from 'node:assert/strict';
import { relationshipDenials, publicAffiliateTerms, renderAffiliateTerms } from '../src/affiliate-relationship-sync.mjs';

test('F03 cancellation and pause deny only the exact selected relationship; unknown terms remain unknown', () => {
  const registry={programs:[{program_id:'alpha',display_name:'Alpha',affiliate_relationship_snapshot:{network:'awin',network_program_id:'1',relationship_status:'cancelled_by_network',promotion_denied:true,lifecycle:'withdrawn'}},{program_id:'beta',display_name:'Beta',affiliate_relationship_snapshot:{network:'awin',network_program_id:'2',promotion_denied:false,terms:{commission_terms:'Default: 0%; GLP-1: 155 USD',source_checked_at:'2026-10-03',capture_sha256:'a'.repeat(64),writer_receipt_sha256:'b'.repeat(64),source_kind:'authenticated_network_api_via_sole_sheet_writer'}}}]};
  assert.deepEqual(relationshipDenials(registry).map(x=>x.program_id),['alpha']);
  const terms=publicAffiliateTerms(registry);
  assert.equal(terms.length,1);assert.equal(terms[0].commission_terms,'Default: 0%; GLP-1: 155 USD');
  assert.equal(terms[0].cookie_window,null);
  const html=renderAffiliateTerms(registry);
  assert.match(html,/Reported affiliate terms/);assert.match(html,/155 USD/);assert.doesNotMatch(html,/\/home\/ubuntu/);
  registry.programs[1].display_name='<script>alert(1)</script>';
  assert.doesNotMatch(renderAffiliateTerms(registry),/<script>/);
});
