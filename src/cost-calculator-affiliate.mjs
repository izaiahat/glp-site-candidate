import { buildAffiliateLinkMap, loadAffiliateAuthorities } from "./affiliate-link-map.mjs";
import { costCalculatorDropdownProviders } from "./cost-calculator.mjs";
import { selectedGoOutbound } from './go-render-selection.mjs';

const PANEL_MARKER = '<div class="gcs-actions cost-actions">';
const STYLE_MARKER = "</style>";
const BODY_MARKER = "</body>";

export function costCalculatorAffiliateLinks(data, moneyPages, registry, selection, profileId = "glp-clinic-scout", extraAuthorities = null) {
  const eligibleIds = new Set(costCalculatorDropdownProviders(data).eligible.map((provider) => provider.program_id));
  const linkMap = buildAffiliateLinkMap(
    moneyPages,
    registry,
    selection,
    "calculator",
    profileId,
    extraAuthorities || loadAffiliateAuthorities(),
  );
  return Object.values(linkMap)
    .filter((link) => eligibleIds.has(link.program_id) && link.live === true && link.affiliate_href)
    .sort((left, right) => left.program_id.localeCompare(right.program_id));
}

// Link permission is independent of price attestation; this stores no amounts.
export function governedEmailAffiliateLinks(moneyPages,registry,selection,profileId='glp-clinic-scout',extraAuthorities=null) {
  return Object.values(buildAffiliateLinkMap(moneyPages,registry,selection,'calculator',profileId,extraAuthorities || loadAffiliateAuthorities()))
    .filter(link=>link.live===true && link.affiliate_href).sort((a,b)=>a.program_id.localeCompare(b.program_id));
}

export function costAffiliateEmailManifest(links) {
  return {
    schema: "glp-cost-affiliate-email-manifest-v1",
    programs: links.map(({ program_id, merchant, affiliate_href, review_path, network }) => ({
      program_id,
      merchant,
      affiliate_href,
      tracking_host: new URL(affiliate_href).hostname,
      review_path,
      network: network || null,
    })),
  };
}

export function assertCurrentHoldManifestSuccessor(before, after, heldRenderIds) {
  const expected = {...before, programs:before.programs.filter(row => !heldRenderIds.has(row.program_id))};
  if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error('cost_email_non_hold_manifest_drift');
}

export function renderCostAffiliateEmailManifestModule(links) {
  return `// Generated from the fail-closed calculator affiliate resolver. Do not edit by hand.\nexport const COST_AFFILIATE_EMAIL_MANIFEST = Object.freeze(${JSON.stringify(costAffiliateEmailManifest(links), null, 2)});\n`;
}

export function decorateCostCalculatorAffiliateSurface(html, data, moneyPages, registry, selection, profileId = "glp-clinic-scout", extraAuthorities = null) {
  if (typeof html !== "string" || !/^\d{6}$/.test(data?.attribution_month || "")) throw new Error("cost_calculator_affiliate_contract_invalid");
  if ([PANEL_MARKER, STYLE_MARKER, BODY_MARKER].some((marker) => html.split(marker).length !== 2)) throw new Error("cost_calculator_affiliate_injection_marker_invalid");

  const liveLinks = costCalculatorAffiliateLinks(data, moneyPages, registry, selection, profileId, extraAuthorities);
  const liveJson = JSON.stringify(liveLinks.map(link => {
    const selected = selectedGoOutbound(link, 'calculator.pc1');
    return selected && !selected.held ? {...link, go_href:selected.href} : link;
  })).replaceAll("<", "\\u003c");
  const monthJson = JSON.stringify(data.attribution_month);

  const styles = `.cost-affiliate-offer{display:grid;gap:10px;margin:18px 0;padding:16px;border:1px solid var(--gcs-line);border-radius:12px;background:#f5faf7}.cost-affiliate-offer[hidden]{display:none}.cost-affiliate-offer .gcs-button{width:100%;min-height:48px;text-align:center}.cost-affiliate-disclosure{margin:0;font-size:.82rem;line-height:1.45;color:var(--text-secondary)}.cost-affiliate-disclosure a{color:inherit;font-weight:700}@media(max-width:480px){.cost-affiliate-offer{padding:14px}.cost-affiliate-offer .gcs-button{white-space:normal}}`;
  const panel = `<section id="cost-affiliate-offer" class="cost-affiliate-offer" aria-label="Provider enrollment option" aria-live="polite" hidden></section>`;
  const script = `<script data-cost-affiliate-runtime>(()=>{const links=new Map(${liveJson}.map(link=>[link.program_id,link]));const month=${monthJson};const form=document.getElementById('cost-form'),provider=document.getElementById('provider'),result=document.getElementById('cost-result'),panel=document.getElementById('cost-affiliate-offer');function clear(){panel.replaceChildren();panel.hidden=true}function renderOffer(){clear();if(result.hidden)return;const link=links.get(provider.value);if(!link)return;const cta=document.createElement('a');cta.className='gcs-button';cta.href=link.affiliate_href;cta.rel='sponsored nofollow noopener';cta.setAttribute('data-analytics-event','affiliate_click');cta.setAttribute('data-program',link.program_id);cta.setAttribute('data-merchant',link.merchant);cta.setAttribute('data-page-slug','tools-glp-1-cost-calculator');cta.setAttribute('data-link-position','result');cta.setAttribute('data-variant','a');cta.setAttribute('data-link-mode','transparent-direct');cta.setAttribute('data-subid','calculator-'+link.program_id+'-result-'+month);cta.setAttribute('data-network',link.network||'direct');cta.setAttribute('data-provider-slug',link.program_id);cta.setAttribute('data-element-code','K');cta.setAttribute('data-rank-position','1');cta.setAttribute('data-page-type','calculator');cta.setAttribute('data-sub1','1K');cta.setAttribute('data-sub2','tools-glp-1-cost-calculator');cta.textContent='Start with '+link.merchant+' \\u2192';const disclosure=document.createElement('p');disclosure.className='cost-affiliate-disclosure';disclosure.append('Affiliate disclosure: Clinic Scout may earn a commission if you enroll through this link, at no extra cost to you. This does not change your estimate or our editorial conclusions. ');const policy=document.createElement('a');policy.href='/how-we-make-money/';policy.textContent='How we make money';disclosure.append(policy,'.');panel.append(cta,disclosure);panel.hidden=false}provider.addEventListener('change',clear);form.addEventListener('submit',()=>queueMicrotask(renderOffer));if(!result.hidden&&provider.value)renderOffer()})();</script>`;

  // The on-site CTA mints through GO; the separately generated email manifest
  // retains its issued external URLs and exact tracking-host contract.
  const routedScript = script
    .replace('cta.href=link.affiliate_href;', 'cta.href=link.go_href||link.affiliate_href;')
    .replace("cta.setAttribute('data-link-mode','transparent-direct');", "cta.setAttribute('data-link-mode',link.go_href?'server-redirect':'transparent-direct');if(link.go_href)cta.setAttribute('data-funnel-v2-go','');")
    .replace("'calculator-'+link.program_id+'-result-'+month", "link.go_href?'calculator.pc1':'calculator-'+link.program_id+'-result-'+month");
  return html
    .replace(STYLE_MARKER, `${styles}${STYLE_MARKER}`)
    .replace(PANEL_MARKER, `${panel}${PANEL_MARKER}`)
    .replace(BODY_MARKER, `${routedScript}${BODY_MARKER}`);
}
