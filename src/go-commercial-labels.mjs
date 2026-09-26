// Runtime /go labels follow the retained commercial record, not consumer identity.
// These rows are labels only: historical activation flags never grant route authority.
export function goCommercialLabels(heldLinkManifest) {
  const rows = (heldLinkManifest?.programs || []).filter(row => row.content_program_id === 'try-ageless');
  if (rows.length !== 1 || rows[0].network !== 'Katalys'
      || rows[0].immutable_network_program_id !== '1538'
      || rows[0].display_name !== 'AgelessRx') {
    throw new Error('go_commercial_identity_invalid:try-ageless:Katalys:1538');
  }
  return {'try-ageless': rows[0].display_name};
}
