// Explicitly fictional, isolated renderer test data. Never inventory or payment evidence.
export function sponsorContentFixture() {
  const start = Date.now() - 3600000;
  const fact = text => ({text, source_url:'https://example.invalid/reported-program/', checked_at:new Date(start).toISOString().slice(0,10)});
  const order = {
    order_reference:'SYNTHETIC-NOT-A-PAYMENT', provider:'Synthetic Fixture Provider', slug:'synthetic-fixture-provider',
    operator_approval:true, partner_creative_approval:true, release_approved:true,
    eligibility_approved:true, inventory_reserved:true, inventory_slot:'providers-directory-panel',
    held:false, us_provider:true, affiliate:true, destination:'https://example.invalid/program/',
    starts_at:new Date(start).toISOString(), ends_at:new Date(start + 720*3600000).toISOString(),
    facts:{program_summary:fact('Synthetic summary <script>fixture</script>'),published_price:fact('Synthetic price: $123 monthly; medication excluded.'),eligibility_states:fact('Synthetic eligibility: adults in CA; clinician review required.'),current_offer:fact('Synthetic offer: none reported.')}
  };
  return {schema:'glp327_sponsor_inventory_v1',selection:{slot:order.inventory_slot,order_reference:order.order_reference},orders:[order]};
}
