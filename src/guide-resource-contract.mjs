// Shared renderer/resolver contract. Guide paths are delivery inputs, never
// subscriber attribution, contact-sync properties or persistent consent context.
export const GUIDE_RESOURCE = Object.freeze({
  sourcePage: 'guide-link',
  leadMagnetKey: 'guide-link-resource',
  consentVersion: 'glp-guide-resource-v1-20261007',
  consentText: 'By submitting your email, you request one email containing a link to this guide. The email service receives your email address and the guide link to deliver it. This does not subscribe you to follow-up emails.',
});
export function validGuidePath(value) {
  return typeof value === 'string' && value.length <= 200 && /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(value);
}
