// Comparison-guide consent is separate from historic quiz/resource/price-watch grants.
export const ONBOARDING_TEST_EMAIL = 'izaiah@glpclinicscout.com';
export const ONBOARDING_CONSENT_VERSION = 'glp47-comparison-guides-v1-20261013';
export const ONBOARDING_CONSENT_SOURCE = '/subscribe-bottom-sheet/';
export const ONBOARDING_CONSENT_TEXT = 'I want GLP Clinic Scout comparison guides and updates by email. Unsubscribe anytime.';
export const ONBOARDING_COPY_SHA256 = 'e600463c7f9c19da67dd38f6ea7b76b2f3a46db3bacfd2e761e38a87684d0580';
export const ONBOARDING_CONSENT_COPY_SHA256 = '24bda785717687daf3e54633ece08f65fd38e85cae1f852784295824075196d9';
export const ONBOARDING_SURFACE = 'sitewide-price-watch';
export const ONBOARDING_ELIGIBILITY_SQL = `s.vertical='glp-clinic-scout' AND s.funnel_stage='newsletter' AND s.status='active' AND s.consent_status='opted-in' AND s.consent_version='${ONBOARDING_CONSENT_VERSION}' AND s.consent_source='${ONBOARDING_CONSENT_SOURCE}' AND NOT EXISTS (SELECT 1 FROM suppression_log z WHERE z.email=s.email AND z.vertical=s.vertical) AND EXISTS (SELECT 1 FROM contact_capture_events c WHERE c.email=s.email AND c.vertical=s.vertical AND c.purpose='marketing' AND c.marketing_consent=1 AND c.source_surface='${ONBOARDING_SURFACE}' AND c.source_context IS NULL AND c.consent_copy_sha256='${ONBOARDING_CONSENT_COPY_SHA256}' AND c.consent_version=s.consent_version AND c.consent_source=s.consent_source)`;
export async function onboardingRuntimeGate(config, env) {
 const approval=config.welcome_sequence_approval;
 const eligible = env.ONBOARDING_ENABLED==='true' && env.ONBOARDING_B01_READY==='true'
  && env.ONBOARDING_COPY_SHA256===ONBOARDING_COPY_SHA256 && env.EMAIL_WARMUP_STATUS==='PASS' && Boolean(env.RESEND_API_KEY)
  && config.domain?.resend_domain_verified===true
  && approval?.approved_copy_sha256===ONBOARDING_COPY_SHA256
  && approval.sender==='GLP Clinic Scout <partners@glpclinicscout.com>' && approval.reply_to==='partners@glpclinicscout.com'
  && config.welcome_sequence?.length===2 && config.welcome_sequence.every((t,i)=>t.copy_format==='glp47-approved-20261009' && t.step===i+1 && t.day===[0,2][i]);
 if (!eligible) return false;
 // Digest the actual canonical message bytes, not their adjacent claim field.
 // This subset was independently received byte-equal to the approved packet.
 const bytes = JSON.stringify([config.welcome_sequence.map(t=>[t.subject,t.body_text]),config.welcome_footer,approval.sender,approval.reply_to]);
 const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes));
 const hash = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return hash === '9b5a59581344efeb72d61bf97108a96ee7524a87aac1f05fb7440e246c7625bc';
}
