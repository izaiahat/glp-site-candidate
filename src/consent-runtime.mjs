// Pure preference reducer: eligibility is an input, NOT server authority.
// The default served runtime has no adapter; isolated TEST adapters exercise
// the real readiness/receipt branch without creating a browser authority lane.
export function consentPreference(choice, {advertisingEligible=false,gpc=false}={}) {
  if(typeof choice==='string')choice={analytics:choice,advertising:'denied'};
  if(!choice||!['granted','denied'].includes(choice.analytics)||!['granted','denied'].includes(choice.advertising)||Object.keys(choice).some(k=>!['analytics','advertising'].includes(k)))throw new Error('invalid_consent_choice');
  return {analytics:gpc?'denied':choice.analytics,advertising:!gpc&&advertisingEligible===true?choice.advertising:'denied'};
}
// Build-time dependency injection only. Default generated browser code binds null;
// window/config/storage cannot install an adapter. Tests inject in-memory server
// projections into the same runtime. No live endpoint or issuer is implemented.
export function createConsentRuntimeSource(adapterExpression='null',modelExpression='null') { return `((start,model)=>{
  // Only the existing first-party country detector selects the served model.
  // A missing/failed/unknown response keeps prior opt-in; never infer US from UA.
  function regionalModel(){
    let timer;
    const lookup=Promise.resolve().then(()=>fetch('/api/geo-state?purpose=consent',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'})).then(response=>response.ok===true?response.json():null).then(value=>value?.schema==='glp-consent-region-v1'&&value.model==='us-default-on'?'us-default-on':'prior-opt-in');
    // Bound notice availability; expiry is prior opt-in and a late US reply cannot upgrade it.
    const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve('prior-opt-in'),1500)});
    return Promise.race([lookup,deadline]).catch(()=>'prior-opt-in').finally(()=>clearTimeout(timer));
  }
  window.GCSConsentReady=model===null?regionalModel().then(start):Promise.resolve(start(model==='us-default-on'?'us-default-on':'prior-opt-in'));
})((consentModel)=>((advertisingAdapter)=>{
  const consentPreference=${consentPreference.toString()};
  const COOKIE='gcs_analytics_consent';
  const STORAGE='gcs_tracking_consent_v1';
  let persistence='unknown',blocked=false,gpcLatched=navigator.globalPrivacyControl===true;
  function read(){try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved?.version==='gcs-cookie-v3-explicit-opt-in'&&validChoice(saved.analytics))return {analytics:saved.analytics,advertising:'denied',version:VERSION,record_type:'preference_only',migrated_from:saved.version};return saved}catch{return null}}
  // Consent and export authority are separate: neither a grant nor a UI repair
  // clears the W5 candidate hold. Legacy default-on grants are not opt-in proof.
  const VERSION='gcs-cookie-v4-distinct-purposes';
  const validChoice=v=>['granted','denied'].includes(v);
  function valid(saved){return saved?.version===VERSION&&saved.record_type==='preference_only'&&validChoice(saved.analytics)&&validChoice(saved.advertising)&&(saved.analytics_basis===undefined||['us_default','explicit','unset'].includes(saved.analytics_basis))}
  function initializePreference(){
    try{
      const raw=localStorage.getItem(STORAGE),saved=read();
      // Absent is not malformed, unreadable, withdrawn or a legacy default grant.
      // Run once at bootstrap, NEVER in a storage/focus/pageshow refresh.
      if(raw!==null&&!gpcLatched)return;
      const selected=consentPreference({analytics:consentModel==='us-default-on'?'granted':'denied',advertising:'denied'},{gpc:gpcLatched});
      const record=valid(saved)?{...saved,analytics:'denied',advertising:'denied'}:{...selected,version:VERSION,record_type:'preference_only',analytics_basis:consentModel==='us-default-on'?'us_default':'unset',notice_acknowledged:false,saved_at:new Date().toISOString()};
      blocked=true;localStorage.setItem(STORAGE,JSON.stringify(record));persistence='saved';blocked=false;
    }catch{blocked=true;persistence='failed'}
  }
  // This is a client readiness projection, NEVER a server permission record.
  // The future adapter must authenticate scope/session, fully validate A12b,
  // read back issuance, and enforce coherent revocation/expiry on the server.
  let adsBlocked=false,sequence=0,settled=Promise.resolve(),serverRevocation=advertisingAdapter?'not_requested':'not_implemented';
  function advertisingView(){
    try {
      if(!advertisingAdapter||typeof advertisingAdapter.readCurrent!=='function'||typeof advertisingAdapter.choose!=='function'||typeof advertisingAdapter.revoke!=='function')return null;
      const view=advertisingAdapter.readCurrent(),s=view?.scope;
      if(!s||s.eligible!==true||s.containment!==true||s.notice_approved!==true||s.retention_approved!==true||s.purpose!=='ad_measurement'||!['google','meta','microsoft'].includes(s.platform)||typeof s.id!=='string'||!s.id||!Number.isInteger(s.revision)||s.revision<1||typeof s.notice!=='string'||!s.notice||typeof s.notice_version!=='string'||!s.notice_version||!Number.isSafeInteger(s.expires_at_ms)||s.expires_at_ms<=Date.now())return null;
      return view;
    }catch{return null}
  }
  function advertisingStatus(){const view=advertisingView(),gpc=gpcLatched||navigator.globalPrivacyControl===true,uncertain=['pending','reconcile'].includes(serverRevocation);return {available:!!view&&!gpc&&!uncertain,purpose:'ad_measurement',reason:gpc?"Your browser's Global Privacy Control is on, so advertising measurement stays off.":serverRevocation==='pending'?'Confirming your advertising choice…':serverRevocation==='reconcile'?"We couldn't confirm that choice, so advertising measurement stays off.":'',server_revocation:serverRevocation}}
  function advertisingGranted(saved){
    if(adsBlocked||saved?.advertising!=='granted')return false;
    const view=advertisingView(),s=view?.scope,r=view?.receipt;
    return !!s&&!!r&&r.scope_id===s.id&&r.scope_revision===s.revision&&r.notice_version===s.notice_version&&r.choice==='explicit_opt_in'&&r.ad_storage==='granted'&&r.ad_user_data==='granted'&&r.ad_personalization==='denied'&&r.gpc===false&&r.withdrawn===false&&Number.isSafeInteger(r.expires_at_ms)&&r.expires_at_ms>Date.now();
  }
  function purposes(){const saved=read(),ok=!blocked&&!gpcLatched&&navigator.globalPrivacyControl!==true&&valid(saved);return {analytics:ok&&saved.analytics==='granted'&&(consentModel==='us-default-on'||saved.analytics_basis!=='us_default')?'granted':'denied',advertising:ok&&advertisingGranted(saved)?'granted':'denied'}}
  function effective(){return purposes().analytics}
  // Only reviewed UI surfaces may run manual telemetry. Query, fragment and
  // referrer are never export properties and do not change this route decision.
  function eligibleRoute(){const p=location.pathname;if(/^\\/(?:intake|matches|results)(?:\\/|$)/.test(p))return false;if(/^\\/(?:quiz|scorecard|tools)(?:\\/|$)/.test(p))return ['/quiz/provider-fit/','/scorecard/','/tools/glp-1-cost-calculator/'].includes(p);return true}
  // Single runtime permission gate, replacing the historical operator prefix.
  function exportsAllowed(purpose='analytics'){if(navigator.globalPrivacyControl===true&&!gpcLatched){gpcLatched=true;refresh()}if(purpose!=='analytics')return false;const p=window.GCS_EXPORT_POLICY;return effective()==='granted'&&p?.schema==='glp-release-export-policy-v2'&&p.stage==='production-seal'&&p.third_party_exports===true&&!synthetic()&&eligibleRoute()}
  initializePreference();
  window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
  window.gtag('consent','default',{analytics_storage:exportsAllowed()?'granted':'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  function cookie(value){document.cookie=COOKIE+'='+encodeURIComponent(value)+'; Path=/; Max-Age=31536000; SameSite=Lax; Secure'}
  function localHost(){const h=(location.hostname||'').toLowerCase();return ['','localhost','127.0.0.1','0.0.0.0','::1','[::1]'].includes(h)||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.test')||h.endsWith('.internal')||location.protocol==='file:'}
  function synthetic(){return localHost()||navigator.webdriver===true||/HeadlessChrome|Headless|Playwright|Puppeteer|Lighthouse|Google-InspectionTool|synthetic|bot|crawler|spider/i.test(navigator.userAgent||'')}
  function activeId(c){return localHost()?(c.debug_measurement_id||null):c.measurement_id}
  /* A11: never load the unreviewed GTM container or forward UI events. This
     independent GA4 page_view is intentionally root-only, not site-wide. No
     sensitive pathname, title, query, referrer or shared dataLayer history may
     reach Google. Native SDK/property behavior still needs privacy review. */
  const GA4_ID='G-2WQ42JY0WK',GA4_ROOT='https://glpclinicscout.com/';
  let ga4Script=null,ga4Epoch=0,ga4Sent=false;
  function ga4Context(){
    const c=window.GCS_ANALYTICS||{};
    return exportsAllowed()&&window.GCSConsent?.read?.()?.analytics_basis==='explicit'&&
      c.enabled===true&&c.measurement_id===GA4_ID&&activeId(c)===GA4_ID&&
      c.gtm_container_id==='GTM-PWR49VVK'&&location.origin==='https://glpclinicscout.com'&&
      location.pathname==='/'&&!location.search&&!location.hash&&
      (!document.referrer||document.referrer===GA4_ROOT);
  }
  function ga4Command(){window.gcsGa4Layer.push(arguments)}
  function loadAnalytics(){
    const c=window.GCS_ANALYTICS||{},id=activeId(c);
    if(!ga4Context()){
      c.consent=exportsAllowed()?'granted':'denied';if(id)window['ga-disable-'+id]=true;
      window.GCS_GTM_HELD='A11 containment unbound';return;
    }
    c.consent='granted';c.active_measurement_id=GA4_ID;
    if(ga4Script||ga4Sent)return;
    const epoch=++ga4Epoch;
    window['ga-disable-'+GA4_ID]=true;
    // Private command layer: neither legacy gtag nor GTM can replay into it.
    window.gcsGa4Layer=[];
    ga4Command('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    ga4Command('js',new Date());
    ga4Command('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    const script=document.createElement('script');ga4Script=script;
    script.async=true;script.referrerPolicy='no-referrer';
    script.src='https://www.googletagmanager.com/gtag/js?id='+GA4_ID+'&l=gcsGa4Layer';
    script.addEventListener('load',()=>{
      if(epoch!==ga4Epoch||!ga4Context()||ga4Sent)return;
      window['ga-disable-'+GA4_ID]=false;
      const fields={page_location:GA4_ROOT,page_title:'Clinic Scout',page_referrer:'',ignore_referrer:true,
        anonymize_ip:true,allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false};
      ga4Command('config',GA4_ID,{...fields,send_page_view:false});
      if(!ga4Context()){stopAnalytics();return}
      ga4Sent=true;ga4Command('event','page_view',{...fields,send_to:GA4_ID});
    });
    script.addEventListener('error',()=>{if(epoch===ga4Epoch){window['ga-disable-'+GA4_ID]=true;ga4Script=null;window.gcsGa4Layer.length=0}});
    document.head.appendChild(script);
  }
  // Clarity is unbound; replay is not authorized by a generic UI-event grant.
  function loadClarity(){return;}
  function stopAnalytics(){const c=window.GCS_ANALYTICS||{};c.consent='denied';ga4Epoch++;if(ga4Script){ga4Script.remove?.();ga4Script=null;ga4Sent=true}for(const id of [c.measurement_id,c.debug_measurement_id].filter(Boolean))window['ga-disable-'+id]=true;if(window.gcsGa4Layer){window.gcsGa4Layer.length=0;ga4Command('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'})}window.posthog?.opt_out_capturing?.();}
  function consentUpdate(){const p=purposes();window.gtag('consent','update',{analytics_storage:exportsAllowed()?'granted':'denied',ad_storage:p.advertising,ad_user_data:p.advertising,ad_personalization:'denied'})}
  function sync(){const analytics=effective();cookie(analytics);consentUpdate();if(exportsAllowed()){loadAnalytics();loadClarity()}else{stopAnalytics()}return analytics}
  function notify(){window.dispatchEvent(new CustomEvent('gcs:consent',{detail:{...purposes(),record_type:'preference_only',persistence,server_revocation:serverRevocation}}))}
  function revokeAdvertising(){adsBlocked=true;serverRevocation=advertisingAdapter?'pending':'not_implemented';if(!advertisingAdapter)return Promise.resolve();return Promise.resolve().then(()=>advertisingAdapter.revoke()).then(r=>{if(serverRevocation!=='reconcile')serverRevocation=r?.acknowledged===true?'acknowledged':'reconcile'},()=>{serverRevocation='reconcile'})}
  let cleanupBanner=()=>{},returnFocus=null;
  function closeBanner(){cleanupBanner();document.querySelector('#gcs-consent')?.remove();document.documentElement.style.removeProperty('--consent-clearance');if(returnFocus?.isConnected!==false)returnFocus?.focus?.();returnFocus=null}
  function open(){const trigger=document.activeElement;closeBanner();returnFocus=trigger?.isConnected?trigger:document.querySelector('footer a[href^="/privacy/cookies/"]');banner(true);document.querySelector('#gcs-consent')?.querySelector('[data-consent="denied"]')?.focus?.()}
  function bannerStatus(text){const root=document.querySelector('#gcs-consent'),status=root?.querySelector('#gcs-consent-status');if(status)status.textContent=text;}
  function apply(choice){return commit(choice,'explicit')}
  function acknowledge(){const saved=read();return commit({analytics:effective(),advertising:'denied'},valid(saved)?saved.analytics_basis||'explicit':'unset')}
  function commit(choice,analyticsBasis,noticeAcknowledged=true){
    const selected=consentPreference(choice,{advertisingEligible:advertisingStatus().available,gpc:navigator.globalPrivacyControl===true});
    const previous=read(),ticket=++sequence,record={...selected,record_type:'preference_only',version:VERSION,analytics_basis:analyticsBasis,notice_acknowledged:noticeAcknowledged,saved_at:new Date().toISOString()};
    blocked=true;adsBlocked=true;
    try{localStorage.setItem(STORAGE,JSON.stringify(record));persistence='saved';blocked=false}catch{persistence='failed'}
    gpcLatched=navigator.globalPrivacyControl===true;
    // Synchronous deny/update/queue cancellation always precedes async issuance.
    sync();notify();
    if(selected.advertising==='granted'&&!blocked){
      const scope=advertisingView()?.scope;
      settled=Promise.resolve().then(()=>ticket===sequence?advertisingAdapter.choose({scope_id:scope.id,choice:'explicit_opt_in'}):null).then(()=>{
        if(ticket!==sequence){serverRevocation='reconcile';adsBlocked=true;sync();notify();return;}
        adsBlocked=false;
        if(!advertisingGranted(read())){adsBlocked=true;serverRevocation='reconcile'}
        sync();notify();
        if(purposes().advertising==='granted')closeBanner();else {updateControls(document.querySelector('#gcs-consent'));bannerStatus("We couldn't confirm that choice, so advertising measurement stays off.");}
      },()=>{if(ticket===sequence){adsBlocked=true;serverRevocation='reconcile';sync();notify();updateControls(document.querySelector('#gcs-consent'));bannerStatus("We couldn't confirm that choice, so advertising measurement stays off.")}});
    }else if(previous?.advertising==='granted'||serverRevocation==='pending'){
      settled=revokeAdvertising().then(()=>{sync();notify()});
    }else settled=Promise.resolve();
    if(persistence==='saved'&&noticeAcknowledged){if(selected.advertising==='granted')bannerStatus('Confirming your advertising choice…');else closeBanner()}
    return {...record,persistence};
  }
  function updateControls(root){if(!root)return;const gpc=gpcLatched||navigator.globalPrivacyControl===true,grant=root.querySelector('[data-consent="granted"]'),copy=root.querySelector('#gcs-consent-copy');if(grant)grant.disabled=gpc;if(copy)copy.textContent=gpc?'Global Privacy Control keeps analytics and advertising off. Health quiz answers are never sent to analytics.':effective()==='granted'?'Analytics is on to improve comparisons. Health quiz answers are never sent to analytics; advertising stays off.':'Optional analytics helps improve comparisons. It stays off until you turn it on; health quiz answers are never sent to analytics and advertising stays off.';}
  function refresh(){if(navigator.globalPrivacyControl===true){const saved=read();gpcLatched=true;commit('denied',valid(saved)?saved.analytics_basis||'explicit':'unset',valid(saved)&&saved.notice_acknowledged===true)}else{sync();notify()}updateControls(document.querySelector('#gcs-consent'));}

  function banner(force=false){const saved=read(),needsOptIn=consentModel==='prior-opt-in'&&saved?.analytics==='granted'&&saved.analytics_basis==='us_default';if(document.querySelector('#gcs-consent')||(!force&&valid(saved)&&saved.notice_acknowledged!==false&&!needsOptIn))return;const choices=force||consentModel==='prior-opt-in',root=document.createElement('section');root.id='gcs-consent';root.setAttribute('aria-label','Cookie notice');root.innerHTML='<div class="gcs-consent-copy"><p><span id="gcs-consent-copy"></span> <a href="/privacy/cookies/" data-consent-open>Opt out / manage</a></p><p id="gcs-consent-status" role="status"></p></div><div class="gcs-consent-actions">'+(choices?'<button type="button" data-consent="denied">Turn off analytics</button><button type="button" data-consent="granted">Turn on analytics</button>':'<button type="button" data-consent="acknowledge">Got it</button>')+'</div>';const style=document.querySelector('#gcs-consent-style')||document.createElement('style');style.id='gcs-consent-style';/* P27 changes preference semantics and controls; the following notes describe historical placement only.
     Consent semantics are defined above; the --consent-clearance contract
     and fixed placement behavior below remain unchanged.
     What changed is where and how it arrives: a bottom-CENTRE toast capped at
     720px in a single row (copy left, the two buttons right) instead of a
     bottom-right stacked card that parked itself on whatever CTA was under it,
     and it rises in gently after 800ms rather than snapping in over the hero
     before the reader has read a word. The rise is transform+opacity with a
     fill-mode of both, so the toast is simply not painted until its moment.
     REPAIR B-1 (2026-08-21): color/border/shadow/font-size/line-height used to
     be hardcoded pre-redesign values (navy #10233b card, system-ui type) that
     shadowed css-src/02-shell.css's #gcs-consent rule outright - same selector,
     same specificity, this <style> lands in <head> after site.css so it always
     won. Those properties are now the SAME custom-property tokens 02-shell.css
     already declares (--color-surface-float/--text-primary/--color-line-strong/
     --shadow-float/--font-display), so the two rules agree instead of one
     silently killing the other, and the toast now reads as the same dark
     aurora "glass" surface as the rest of the redesign instead of a leftover
     navy card. Only position/layout/animation stay hardcoded here - 02-shell's
     comment already assigns css-src the "small and clearly secondary" sizing
     and this file the placement/collision behavior; this just stops stepping
     on the half that isn't its job. */
  style.textContent='#gcs-consent{position:fixed;z-index:1000;left:50%;right:auto;bottom:calc(20px + var(--sticky-clearance,0px));translate:-50% 0;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 22px;width:min(720px,calc(100% - 40px));padding:14px 20px;background:color-mix(in srgb, var(--color-surface-float) 94%, transparent);color:var(--text-primary);border:1px solid var(--color-line-strong);box-shadow:var(--shadow-float);backdrop-filter:blur(16px);font-size:.85rem;line-height:1.45;animation:gcs-consent-rise .5s cubic-bezier(.16,1,.3,1) .8s both}@keyframes gcs-consent-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}#gcs-consent p{margin:0}#gcs-consent .gcs-consent-fine{margin-top:3px;font-size:.78rem;color:var(--text-secondary)}#gcs-consent a{color:var(--color-interactive);text-decoration:underline;min-height:36px;display:inline-flex;align-items:center}.gcs-consent-actions{display:flex;gap:10px;flex-wrap:nowrap;justify-content:flex-end}.gcs-consent-actions button{min-height:44px;padding:9px 18px;border:1px solid var(--color-line-strong);border-radius:12px;font-family:var(--font-display);font-weight:800;font-size:.82rem;line-height:1.2;white-space:nowrap;cursor:pointer}.gcs-consent-actions button[data-consent="denied"]{background:transparent;color:var(--text-primary)}.gcs-consent-actions button[data-consent="granted"]{background:var(--action-primary);color:var(--text-on-accent);border-color:transparent}#gcs-consent{pointer-events:auto}@media(max-width:768px){#gcs-consent{grid-template-columns:minmax(0,1fr) auto;align-items:center;left:8px;right:8px;translate:none;bottom:calc(8px + var(--sticky-clearance,0px));width:auto;max-width:none;gap:8px 10px;padding:10px 12px;border-radius:14px;font-size:.76rem;line-height:1.35}#gcs-consent .gcs-consent-fine{display:none}#gcs-consent a{min-height:0;display:inline;text-underline-offset:2px}.gcs-consent-actions{flex-wrap:nowrap;gap:8px}.gcs-consent-actions button{min-height:44px;min-width:44px;padding:8px 12px;font-size:.74rem;white-space:nowrap}}';/* Final styles and measured clearance are attached below. *//* PLACEMENT — Phase-4 gate remediation, Fable design pass 2026-08-27
     (GATES-PRELIM-20260827 issue #1). The old P0-1 collision-avoidance chain
     re-ran place() on EVERY scroll event (plus resize/load/ResizeObserver) and
     cascaded bottom -> is-alt-left -> is-alt-top -> an in-flow body.prepend()
     bar. Because the collision targets were by design the highest-intent CTAs,
     the banner oscillated between fixed and in-flow exactly on money pages
     while the reader scrolled: each hop is a counted layout shift (fixed
     elements moving via class swap are NOT exempt; the in-flow flip shifts the
     whole document). Measured 0.296 CLS/hop mobile, 0.237-0.592 window CLS on
     /ozempic/ and the cost calculator - POOR range, on every not-yet-consented
     visit. The remediation places the toast ONCE as a fixed corner toast and
     never moves it again: desktop bottom-right via the shipped 02-shell.css
     section#gcs-consent override, mobile bottom full-width-minus-margins via
     the media block above. It never re-enters document flow, never repositions
     on scroll, and pointer-events stay confined to the card itself. CONSENT
     SEMANTICS ARE UNTOUCHED: same record, same show condition, same opt-out,
     same analytics gating, same --consent-clearance contract, same removal on
     choice. tests/browser/consent-no-overlap.spec.mjs still gates overlap at
     load; a scroll-stability assertion now rides next to it. */
  // The restored grant action must not inherit a dark surface with dark text.
  style.textContent+='section#gcs-consent{display:flex!important;flex-direction:column!important;align-items:stretch!important;box-sizing:border-box;max-height:calc(100dvh - 32px - var(--sticky-clearance,0px));overflow:auto}section#gcs-consent .gcs-consent-purpose{display:flex;align-items:center;gap:10px;min-height:44px}section#gcs-consent input{width:20px;height:20px;flex:0 0 20px;accent-color:var(--action-primary)}section#gcs-consent label{font-size:.85rem;line-height:1.4;display:flex;align-items:center;flex:1 1 auto;min-height:44px}section#gcs-consent .gcs-consent-actions{display:flex;width:100%;flex-wrap:wrap}section#gcs-consent button[data-consent]{flex:1;min-height:44px;white-space:normal;background:var(--color-surface-float)!important;color:var(--text-primary)!important;border:1px solid var(--color-line-strong)}section#gcs-consent :focus-visible{outline:2px solid var(--color-interactive);outline-offset:3px}section#gcs-consent #gcs-advertising-reason{font-size:.78rem;color:var(--text-secondary)}@media(max-width:768px){section#gcs-consent{left:8px!important;right:8px!important;width:auto!important;max-width:none!important;translate:none!important}.gcs-consent-copy{min-width:0}}';
  style.textContent+='section#gcs-consent [hidden]{display:none!important}section#gcs-consent .gcs-consent-fine{display:block}section#gcs-consent [data-consent-open]{display:inline-flex!important;align-items:center;min-height:44px!important}';
  // The one-button US notice is a compact row, not the manage-choices stack.
  style.textContent+='section#gcs-consent:has([data-consent="acknowledge"]){display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center!important}section#gcs-consent:has([data-consent="acknowledge"]) .gcs-consent-actions{width:auto;flex-wrap:nowrap}';
  if(!document.querySelector('#gcs-consent-style'))document.head.appendChild(style);
  document.body.appendChild(root);
  // Reserve clearance without a synchronous geometry read; ResizeObserver
  // replaces the initial allowance with the actual border-box measurement.
  // Quiz controls need an unobscured scroll target on desktop as well as mobile.
  updateControls(root,true);
  let height=null,clearanceFrame=null;
  const clearance=()=>{if(root.isConnected){const sticky=Number.parseFloat(document.documentElement.style.getPropertyValue?.('--sticky-clearance'))||0;const bottom=window.innerWidth<=768?8+sticky:20;const reserved=height===null?320:Math.ceil(height+bottom+8);const value=(window.innerWidth<=920||document.body?.dataset?.page==='quiz-provider-fit')?reserved+'px':'0px';if(document.documentElement.style.getPropertyValue?.('--consent-clearance')!==value)document.documentElement.style.setProperty('--consent-clearance',value)}};
  clearance();
  // An ancestor CSS variable changes quiz geometry. Writing it during observer
  // delivery can resize the observed notice again in WebKit's same layout pass.
  // Measure here; coalesce the write into the next frame (never suppress errors).
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{const entry=entries.find(e=>e.target===root),box=entry?.borderBoxSize;if(box){const size=Array.isArray(box)?box[0]:box;if(Number.isFinite(size?.blockSize)){const next=Math.ceil(size.blockSize);if(next===height)return;height=next;if(clearanceFrame===null)clearanceFrame=window.requestAnimationFrame(()=>{clearanceFrame=null;clearance()})}}}):null;observer?.observe(root,{box:'border-box'});
  // Native WebKit focus scrolling can leave the field edge behind the notice.
  // Correct only real user focus on the affected listing/matcher surfaces;
  // keep the notice and consent defaults intact, with no bootstrap layout read.
  let focusFrame=null;
  const focusClearance=e=>{
    const node=e.target;
    if(!node?.closest?.('.qm-shell,main.listing[data-listing-archetype="C"]')||typeof window.requestAnimationFrame!=='function')return;
    if(focusFrame!==null)window.cancelAnimationFrame(focusFrame);
    focusFrame=window.requestAnimationFrame(()=>{
      focusFrame=null;if(!root.isConnected||document.activeElement!==node)return;
      const target=node.getBoundingClientRect(),notice=root.getBoundingClientRect();
      if(target.right>notice.left&&target.left<notice.right&&target.top<notice.bottom&&target.bottom+8>notice.top)window.scrollBy({top:target.bottom+8-notice.top,behavior:'instant'});
    });
  };
  document.addEventListener('focusin',focusClearance);
  window.addEventListener('resize',clearance,{passive:true});cleanupBanner=()=>{observer?.disconnect();if(clearanceFrame!==null)window.cancelAnimationFrame(clearanceFrame);window.removeEventListener?.('resize',clearance);document.removeEventListener?.('focusin',focusClearance);if(focusFrame!==null)window.cancelAnimationFrame(focusFrame)};
  root.addEventListener('click',e=>{const b=e.target.closest('[data-consent]');if(!b||b.disabled)return;const result=b.dataset.consent==='acknowledge'?acknowledge():apply(b.dataset.consent==='granted'?'granted':'denied');if(result.persistence==='failed'){updateControls(root);const status=root.querySelector('#gcs-consent-status');if(status)status.textContent='Tracking is off for this page. Your browser could not save the choice; it may not persist on another visit.'}})}
  window.GCSConsent={apply,acknowledge,read,effective,purposes,model:()=>consentModel,advertisingStatus,whenSettled:()=>settled,allowsExports:exportsAllowed,refresh,open,persistenceStatus:()=>persistence};
  window.addEventListener?.('storage',e=>{if(e.key===STORAGE||e.key===null){sequence++;adsBlocked=true;refresh()}});
  window.addEventListener?.('focus',refresh);window.addEventListener?.('pageshow',refresh);document.addEventListener('visibilitychange',refresh);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-consent-open], footer a[href^="/privacy/cookies/"]')){e.preventDefault();open()}});
  sync();notify();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>banner(),{once:true});else banner();
  return window.GCSConsent;
})(${adapterExpression}),${modelExpression});\n`; }
export const consentRuntimeSource=createConsentRuntimeSource();
