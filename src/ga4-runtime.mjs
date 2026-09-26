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
  function sensitive(){return /^\/(?:lp\/quiz|quiz|matches|results|intake|scorecard|tools|search)(?:\/|$)/.test(location.pathname)}
  function pagePath(){
    const p=location.pathname;
    if(sensitive())return '/private/';
    // Only the publisher's static canonical route may become a dimension. A
    // guessed/404 path can contain a visitor's identity even without ? or #.
    // Forms/quiz routes are neutralized above regardless of their canonical.
    if(p==='/')return '/';
    let canonical;try{canonical=new URL(document.querySelector('link[rel="canonical"]')?.href)}catch{return '/page/'}
    return canonical.origin===ORIGIN&&canonical.pathname===p&&!canonical.search&&!canonical.hash&&/^\/(?:[a-z0-9-]+\/)*$/.test(p)?p:'/page/';
  }
  const fields=()=>({page_location:ORIGIN+pagePath(),page_title:'Clinic Scout',page_referrer:'',ignore_referrer:true,
    allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false,
    ads_data_redaction:true,url_passthrough:false,
    // These per-page SDK controls are covered by the hash-pinned actual SDK test.
    ae_block_form:true,ae_block_history:true,ae_block_video:true,
    ae_block_scroll:true,ae_block_outbound_click:true,ae_block_downloads:true});
  function context(){const c=window.GCS_ANALYTICS||{};return allowed()&&c.enabled===true&&c.measurement_id===ID&&location.origin===ORIGIN}
  function clearCookies(){
    for(const name of ['_ga','_ga_'+ID.slice(2).replace(/-/g,'_')])
      for(const domain of ['', '; Domain=glpclinicscout.com', '; Domain=.glpclinicscout.com'])
        document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax; Secure'+domain;
  }
  function stop(){
    window['ga-disable-'+ID]=true;epoch++;
    if(script){script.remove?.();script=null;stopped=true}
    if(window.gcsGa4Layer){window.gcsGa4Layer.length=0;command('consent','update',denied)}
    clearCookies();
  }
  function emit(name,extra={}){
    if(!context()){stop();return false}
    if(!sent||stopped||window['ga-disable-'+ID]||sensitive())return false;
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
    if(scrolled||sensitive())return;
    const height=document.documentElement.scrollHeight;
    if(height>window.innerHeight&&(window.scrollY+window.innerHeight)/height>=0.9)
      scrolled=emit('scroll',{percent_scrolled:90});
  },{passive:true});
  document.addEventListener('click',event=>{
    if(sensitive())return;
    const anchor=event.target.closest?.('a[href]');if(!anchor||anchor.closest?.('form'))return;
    let url;try{url=new URL(anchor.href,location.href)}catch{return}
    if(!['http:','https:'].includes(url.protocol))return;
    // Do not export href/domain/filename/anchor text: all can contain PII or
    // personalized treatment selections, including affiliate sub-IDs.
    if(/\.(?:pdf|csv|txt|docx?|xlsx?|pptx?|zip)$/i.test(url.pathname)||anchor.hasAttribute('download'))emit('file_download');
    else if(url.origin!==location.origin)emit('click',{outbound:true});
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
