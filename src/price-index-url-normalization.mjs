// Exact Build-4 shared-runtime resource roles and current reviewed route map.
// No DOM reserialization: only the original quoted attribute value spans change.
export const PRICE_INDEX_URL_CONTRACT = Object.freeze({
  origin: "https://glpclinicscout.com",
  scripts: ["/assets/site.js", "/assets/consent.js", "/assets/content-capture-resilient.js"],
  stylesheets: ["/assets/site.css"],
  migrations: {
    "/best/online-glp-1-providers/": "/providers/",
    "/guides/": "/insights/",
    "/guides/cheapest-glp1/": "/providers/",
    "/guides/healthrx-vs-agelessrx/": "/providers/",
    "/guides/wellorithm-vs-enhance-md/": "/providers/",
    "/guides/compare-online-glp-1-provider-fees/": "/providers/",
    "/guides/glp-1-program-total-cost-comparison/": "/providers/",
  },
});

function tags(html) {
  const tokens = [];
  const pattern = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[A-Za-z][A-Za-z0-9:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  let rawUntil = 0, inertDepth = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index < rawUntil || match[0].startsWith("<!")) continue;
    const raw = match[0], name = raw.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
    const closing = raw.startsWith("</");
    if (["template", "noscript"].includes(name)) {
      inertDepth += closing ? -1 : 1;
      if (inertDepth < 0) return [];
      continue;
    }
    if (closing) continue;
    if (!inertDepth) tokens.push({raw, name, index:match.index});
    if (["script", "style", "textarea", "title", "xmp", "iframe"].includes(name)) {
      const end = new RegExp(`</${name}\\s*>`, "gi");end.lastIndex=match.index+raw.length;
      const found=end.exec(html);rawUntil=found?found.index+found[0].length:html.length;
    }
  }
  return tokens;
}

function attributes(raw) {
  const begin = raw.match(/^<[\w:-]+/)[0].length;
  const attrs = new Map();
  const pattern = /\s+([^\s=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gy;
  let offset = begin;
  while (offset < raw.length) {
    if (/^\s*\/?\s*>$/.test(raw.slice(offset))) return attrs;
    pattern.lastIndex=offset;const match=pattern.exec(raw);
    if (!match) return null;
    const name=match[1].toLowerCase();if(attrs.has(name))return null;
    const value=match[2], quoted=value && /^["']/.test(value);
    attrs.set(name,{value:quoted?value.slice(1,-1):value,quoted,index:quoted?match.index+match[0].lastIndexOf(value)+1:null});
    offset=pattern.lastIndex;
  }
  return null;
}

function splitBoundUrl(value, hasBase) {
  if (/[\s\\<>]|%(?![a-fA-F0-9]{2})/.test(value)) return null;
  let origin="",rest=value;
  if(value.startsWith(PRICE_INDEX_URL_CONTRACT.origin+"/")){origin=PRICE_INDEX_URL_CONTRACT.origin;rest=value.slice(origin.length);}
  else if(!value.startsWith("/")||value.startsWith("//")||hasBase)return null;
  const match=rest.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);if(!match)return null;
  const [,pathname,query="",fragment=""]=match;
  if(pathname.includes("%")||pathname.split("/").some(part=>part==='.'||part==='..'))return null;
  return {origin,pathname,query,fragment};
}

function versionedUrl(parts, role) {
  const {origin,pathname,query,fragment}=parts;
  const analytics=role==='script' && /^\/assets\/analytics(?:\.[a-f0-9]{16})?\.js$/.test(pathname);
  if(!analytics && !(role==='script'?PRICE_INDEX_URL_CONTRACT.scripts:PRICE_INDEX_URL_CONTRACT.stylesheets).includes(pathname))return null;
  if(/&(?!amp;)[A-Za-z]+;/.test(query))return null;
  const segments=query?query.slice(1).split(/(&amp;|&)/):[];
  const params=segments.filter((_,i)=>i%2===0).map(s=>s.split('='));
  if(params.some(p=>p.length!==2||!/^[A-Za-z0-9_-]+$/.test(p[0])))return null;
  const versions=params.filter(([key])=>key.toLowerCase()==='v');
  if(versions.length && (versions.length!==1 || versions[0][0]!=='v' || !/^[a-f0-9]{16}$/.test(versions[0][1])))return null;
  if(analytics && (!query || (params.length===1&&versions.length===1)) && !fragment) return `${origin}/assets/analytics.js?v=ASSET_VERSION`;
  if(versions.length!==1)return null;
  // Extra-query analytics forms preserve the filename (no cross-form equivalence).
  const updated=segments.map((s,i)=>i%2===0&&s.startsWith('v=')?'v=ASSET_VERSION':s).join('');
  return `${origin}${pathname}?${updated}${fragment}`;
}

export function normalizePriceIndexUrls(html) {
  const tokens=tags(html),hasBase=tokens.some(t=>t.name==='base');
  let output="",cursor=0;
  for(const token of tokens){
    if(!['script','link','a'].includes(token.name))continue;
    const attrs=attributes(token.raw);if(!attrs)continue;
    const key=token.name==='script'?'src':'href',attribute=attrs.get(key);
    if(!attribute?.quoted)continue;
    const parts=splitBoundUrl(attribute.value,hasBase);if(!parts)continue;
    let value=null;
    if(token.name==='a'){
      const destination=PRICE_INDEX_URL_CONTRACT.migrations[parts.pathname];
      if(destination)value=parts.origin+destination+parts.query+parts.fragment;
    }else if(token.name==='script'){
      const type=attrs.get('type');
      if(!type||['text/javascript','application/javascript','module'].includes(type.value))value=versionedUrl(parts,'script');
    }else if(attrs.get('rel')?.value?.toLowerCase()==='stylesheet')value=versionedUrl(parts,'stylesheet');
    if(value===null||value===attribute.value)continue;
    const start=token.index+attribute.index;
    output+=html.slice(cursor,start)+value;cursor=start+attribute.value.length;
  }
  return output+html.slice(cursor);
}
