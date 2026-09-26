// GLP-44: adapted from PR #3 (a04ce84) private-layer transport, not a second loader.
// Authority: ops/linear/approvals/OPERATOR-DECISION-20260926-ga4-on.md.
// Native enhanced measurement is blocked: its DOM-derived link/form fields are
// unsafe here. Emit only the three approved enhanced-measurement event names
// ourselves, with constant/minimized fields; never read form values or link text.
export function ga4Transport(allowed) {
  const ID='G-2WQ42JY0WK',ORIGIN='https://glpclinicscout.com';
  let script=null,epoch=0,sent=false,stopped=false,scrolled=false;
  const denied={analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'};
  const command=function(){window.gcsGa4Layer.push(arguments)};
  // Engineering allowlist, NOT legal/vendor clearance. Later eligibility advisory
  // excludes individualized flows outright; unclassified editorial routes wait
  // for exact-context review, not because public reading is automatically PHI.
  // reports/ops/pro-consent-eligibility-20260926/NON-STATE-ASSESSMENT.md
  const ordinaryPaths=['/','/about/','/privacy/','/privacy/cookies/','/terms/'];
  const pagePath=()=>ordinaryPaths.includes(location.pathname)?location.pathname:null;
  const fields=()=>({page_location:ORIGIN+pagePath(),page_title:'Clinic Scout',page_referrer:'',ignore_referrer:true,
    allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false,
    ads_data_redaction:true,url_passthrough:false,
    // These per-page SDK controls are covered by the hash-pinned actual SDK test.
    ae_block_form:true,ae_block_history:true,ae_block_video:true,
    ae_block_scroll:true,ae_block_outbound_click:true,ae_block_downloads:true});
  function priorContext(){if(!document.referrer)return true;try{const u=new URL(document.referrer);return u.origin!==ORIGIN||ordinaryPaths.includes(u.pathname)}catch{return false}}
  function context(){const c=window.GCS_ANALYTICS||{};return allowed()&&c.enabled===true&&c.measurement_id===ID&&location.origin===ORIGIN&&pagePath()!==null&&priorContext()}
  function clearCookies(){
    for(const name of ['_ga','_ga_'+ID.slice(2).replace(/-/g,'_')])
      for(const domain of ['', '; Domain=glpclinicscout.com', '; Domain=.glpclinicscout.com'])
        document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax; Secure'+domain;
  }
  function stop(){
    const hadLane=!!(script||sent||window.gcsGa4Layer);
    window['ga-disable-'+ID]=true;epoch++;
    if(script){script.remove?.();script=null;stopped=true}
    if(window.gcsGa4Layer){window.gcsGa4Layer.length=0;command('consent','update',denied)}
    // A cold held/candidate document must not attempt unrelated cookie writes.
    // Still remove residual GA cookies on a returning GPC/opted-out visit.
    if(hadLane||/(?:^|;\s*)_ga(?:_[^=;]+)?=/.test(document.cookie||''))clearCookies();
  }
  function emit(name,extra={}){
    if(!context()){stop();return false}
    if(!sent||stopped||window['ga-disable-'+ID]||!pagePath())return false;
    command('event',name,{...fields(),...extra,send_to:ID});return true;
  }
  // Preserve PR3's before-mutation history barrier. No automatic history views or
  // health-derived events; the next full document uses a new minimized page_view.
  for(const method of ['pushState','replaceState']){
    const original=window.history?.[method];if(typeof original!=='function')continue;
    window.history[method]=function(...args){if(script&&args.length>2&&args[2]!=null)stop();return original.apply(this,args)};
  }
  window.addEventListener?.('popstate',()=>{if(script)stop()});
  window.addEventListener?.('hashchange',()=>{if(script)stop()});
  window.addEventListener?.('scroll',()=>{
    if(scrolled||!pagePath())return;
    const height=document.documentElement.scrollHeight;
    if(height>window.innerHeight&&(window.scrollY+window.innerHeight)/height>=0.9)
      scrolled=emit('scroll',{percent_scrolled:90});
  },{passive:true});
  // Do not carry ordinary-page analytics into an individualized embedded flow.
  // Capture-phase shutdown runs before any SDK DOM listener can observe inputs.
  for(const event of ['input','change','submit'])document.addEventListener(event,()=>stop(),true);
  document.addEventListener('click',event=>{
    if(!pagePath())return;
    const anchor=event.target.closest?.('a[href]');if(!anchor||anchor.closest?.('form'))return;
    // Unclassified affiliate, provider, lead and download components are NOT
    // ordinary merely because they sit on an allowlisted route. Only a reviewed
    // component's exact static classification may activate these two counters.
    const kind=anchor.getAttribute('data-ga4-ordinary');
    if(!['outbound','download'].includes(kind))return;
    let url;try{url=new URL(anchor.href,location.href)}catch{return}
    if(!['http:','https:'].includes(url.protocol))return;
    // Do not export href/domain/filename/anchor text: all can contain PII or
    // personalized treatment selections, including affiliate sub-IDs.
    if(kind==='download'&&(/\.(?:pdf|csv|txt|docx?|xlsx?|pptx?|zip)$/i.test(url.pathname)||anchor.hasAttribute('download')))emit('file_download');
    else if(kind==='outbound'&&url.origin!==location.origin)emit('click',{outbound:true});
  });
  function load(){
    window.GCS_GTM_HELD='A11 containment unbound';
    if(!context()){stop();return}
    if(script||sent||stopped)return;
    const ticket=++epoch;
    window['ga-disable-'+ID]=true;
    window.gcsGa4Layer=[];
    command('consent','default',denied);
    command('set',{...fields(),user_data:null});
    command('config',ID,{...fields(),send_page_view:false});
    command('js',new Date());
    command('consent','update',{...denied,analytics_storage:'granted'});
    script=document.createElement('script');script.async=true;script.referrerPolicy='no-referrer';
    script.src='https://www.googletagmanager.com/gtag/js?id='+ID+'&l=gcsGa4Layer';
    script.addEventListener('load',()=>{
      if(ticket!==epoch||!context()||sent||stopped)return;
      window['ga-disable-'+ID]=false;sent=true;
      command('event','page_view',{...fields(),send_to:ID});
    });
    script.addEventListener('error',()=>{if(ticket===epoch)stop()});
    document.head.appendChild(script);
  }
  return {load,stop};
}
