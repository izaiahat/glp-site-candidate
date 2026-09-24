// Stage is build input, not stored consent or deployment approval. A plain build
// remains held. The governed fresh-seal runner explicitly selects production.
export function releaseExportPolicy(stage = process.env.GCS_RELEASE_STAGE || "candidate") {
  if (!["candidate", "production-seal"].includes(stage)) throw new Error(`invalid release stage: ${stage}`);
  return Object.freeze({schema:"glp-release-export-policy-v2",stage,third_party_exports:stage === "production-seal",reason:stage === "production-seal" ? "explicit-consent-production-seal" : "local-candidate-export-hold"});
}
export const CANDIDATE_EXPORT_POLICY = releaseExportPolicy("candidate");
export const policyMarkup = (policy) => `<script data-candidate-export-policy>window.GCS_EXPORT_POLICY=Object.freeze(${JSON.stringify(policy)});</script>`;
export const candidateExportPolicyMarkup = policyMarkup(releaseExportPolicy());
const legacyGtm = "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-PWR49VVK');";

export function stageCandidateExportPolicy(html, {stage} = {}) {
  const policy = releaseExportPolicy(stage);
  const source = String(html);
  const container = source.match(/['"](GTM-[A-Z0-9]+)['"]/)?.[1];
  if (policy.third_party_exports && source.includes('window.GCS_ANALYTICS=') && !container) throw new Error("production GTM identity missing");
  // Strip only eager GTM bootstrap scripts. The consent runtime requests the
  // same bound container after a v3 analytics grant, never in the page head.
  return source.replaceAll(`<script>${legacyGtm}</script>`, "")
    .replaceAll(`<script>if(!window.GCS_ANALYTICS_SUPPRESSED)${legacyGtm}</script>`, "")
    .replace(/window\.GCS_(ANALYTICS|POSTHOG|CLARITY)=\{([^<]*?)\};/g, (whole, name, body) => {
      if (!/(?:["']?enabled["']?):(?:true|false)/.test(body)) throw new Error(`export configuration shape: ${name}`);
      // Replay remains unconfigured/disabled; stage cannot invent a binding.
      const enabled = name !== "CLARITY" && policy.third_party_exports;
      let next = body.replace(/(["']?enabled["']?):(?:true|false)/, `$1:${enabled}`);
      next = next.replace(/(["']?operator_gate["']?):(['"])[^'"]*\2/, '$1:"explicit-consent-v3"');
      if (name === "ANALYTICS") {
        next = next.replace(/consent:'[^']*'/, "consent:'unknown'").replace(/operator_gate:'[^']*'/, "operator_gate:'explicit-consent-v3'");
        if (container && !next.includes("gtm_container_id:")) next += `,gtm_container_id:'${container}'`;
      }
      return `window.GCS_${name}={${next}};`;
    });
}

export function candidateSharedRuntime(html, {stage} = {}) {
  if (String(html).includes("data-candidate-export-policy")) throw new Error("candidate_export_policy_duplicate");
  return policyMarkup(releaseExportPolicy(stage)) + stageCandidateExportPolicy(html, {stage});
}

export function candidateExportShellFindings(html, {stage} = {}) {
  const policy = releaseExportPolicy(stage);
  const findings = [];
  if (html.split(policyMarkup(policy)).length !== 2) findings.push("explicit_policy_missing_or_duplicate_or_wrong_stage");
  for (const name of ["ANALYTICS", "POSTHOG", "CLARITY"]) {
    const body = html.match(new RegExp(`window\\.GCS_${name}=\\{([^<]*?)\\};`))?.[1] || "";
    const enabled = name !== "CLARITY" && policy.third_party_exports;
    if (!new RegExp(`["']?enabled["']?:${enabled}(?:,|$)`).test(body)) findings.push(`${name.toLowerCase()}_wrong_stage`);
  }
  if (!html.includes("consent:'unknown'")) findings.push("consent_not_unknown");
  if (/googletagmanager\.com\/gtm\.js|<script\b[^>]*src=["']https?:\/\//i.test(html)) findings.push("eager_remote_loader_present");
  return findings;
}
