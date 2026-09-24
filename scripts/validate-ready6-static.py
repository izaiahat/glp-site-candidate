#!/usr/bin/env python3
import hashlib, json, re, os, subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]; PUBLIC=ROOT/'public'
CONTRACT=json.loads((ROOT/'data/ready6-editorial-contract.json').read_text()); APPROVED=json.loads((ROOT/'data/approved-program-registry.json').read_text())
REGISTRY=json.loads((ROOT/'data/program-registry.json').read_text())
GO=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {loadGoSelection} from './src/go-runtime-selection.mjs';import {GO_RUNTIME_MANIFEST} from './functions/go/program-manifest.js';console.log(JSON.stringify({selection:loadGoSelection(),manifest:GO_RUNTIME_MANIFEST}));"],cwd=ROOT,text=True))
PHASE3=json.loads((ROOT/'data/phase3-page-graph.json').read_text())
EXPECTED_REL={'sponsored','nofollow','noopener','noreferrer'}
FORBIDDEN_VISITOR=['offline candidate','bridge pending','bridge review','not deployed','noindex','review-only','candidate-only']
LEGACY_REDIRECTS={
 '/reviews/awin-128761/':'/reviews/coivas/',
 '/reviews/katalys-1286/':'/reviews/sprout-health/',
 '/reviews/katalys-647/':'/reviews/mangorx/',
 '/reviews/katalys-1304/':'/reviews/direct-meds/',
 '/reviews/katalys-1516/':'/reviews/shed/',
 '/reviews/katalys-1518/':'/reviews/breezemeds/',
}
# 2026-08-17 network pause: routes whose affiliate program Katalys paused are no
# longer built, so they 301 to the live comparison. Kept in the same order the
# build emits them (scripts/build-staging.mjs RETIRED_PROGRAM_ROUTES) and used to
# resolve any legacy redirect whose old target is now itself retired, so no
# redirect ever chains.
RETIRED_PROGRAM_ROUTES={
 '/reviews/synergy-rx/':'/providers/',
 '/reviews/care-bare-rx-glp1/':'/providers/',
 '/reviews/breezemeds/':'/providers/',
 '/compare/synergy-rx-vs-carebarerx/':'/providers/',
 # 2026-08-18 niche-fit removal (operator ruling): the three non-GLP programs'
 # review routes 301 instead of 404, so Cloudflare Always Online cannot serve an
 # archived copy of a page we deliberately removed.
 '/reviews/paternity-lab/':'/providers/',
 '/reviews/advanced-trichology/':'/providers/',
 '/reviews/lyfefuel-us/':'/providers/',
}
def fail(route,code): raise SystemExit(f'{route}:{code}')
def candidate_inline_allowed(scripts):
 if len(scripts)!=4: return False
 policy,config,guard,upgrade=scripts
 stage=os.environ.get('GCS_RELEASE_STAGE','candidate')
 if stage not in ('candidate','production-seal'): return False
 enabled=stage=='production-seal'
 policy_object={'schema':'glp-release-export-policy-v2','stage':stage,'third_party_exports':enabled,'reason':'explicit-consent-production-seal' if enabled else 'local-candidate-export-hold'}
 policy_body='window.GCS_EXPORT_POLICY=Object.freeze('+json.dumps(policy_object,separators=(',',':'))+');'
 if set(policy['attrs'])!={'data-candidate-export-policy'} or ''.join(policy['parts'])!=policy_body: return False
 body=''.join(config['parts'])
 flag='true' if enabled else 'false'
 if not body.startswith("window.GCS_ANALYTICS={enabled:"+flag+",consent:'unknown',") or 'window.GCS_POSTHOG={"enabled":'+flag+',' not in body: return False
 if 'window.GCS_CLARITY={enabled:false,project_id:null,' not in body: return False
 guard_src=''.join(guard['parts'])
 if "ga-disable-G-2WQ42JY0WK" not in guard_src or 'HeadlessChrome' not in guard_src: return False
 if any('googletagmanager.com/gtm.js' in ''.join(s['parts']) for s in scripts): return False
 return set(upgrade['attrs'])=={'data-p1-content-upgrade'}
# SHED-301 (2026-08-06): an alias merchant's review route 301s to its canonical
# record, derived from the registry's canonical_identity declarations so the next
# alias is enforced without editing this file. The alias page stays built and
# byte-asserted; only its ROUTE and sitemap presence change.
def _profile(row): return (row.get('profiles') or {}).get('glp-clinic-scout') or {}
ALIAS_TARGET={}
for _row in REGISTRY['programs']:
 _decl=_profile(_row).get('canonical_identity') or {}
 if _decl.get('role')!='alias': continue
 _canonical=next((r for r in REGISTRY['programs'] if r['program_id']==_decl.get('canonical_program_id')),None)
 if not _canonical or not _canonical.get('review_path'): fail(_row['program_id'],'alias_canonical_unresolved')
 ALIAS_TARGET[_row.get('review_path') or ('/reviews/%s/'%_row['program_id'])]=_canonical['review_path']
class Document(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True); self.events=[]; self.links=[]; self.metas=[]; self.canonicals=[]; self.h1=0; self.title=[]; self.text=[]; self.scripts=[]; self.stack=[]; self.in_title=False; self.script=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs); self.stack.append((tag,a.get('id'))); self.events.append((tag,a))
  if tag=='a': self.links.append((a,tuple(self.stack)))
  elif tag=='meta': self.metas.append(a)
  elif tag=='link' and a.get('rel')=='canonical': self.canonicals.append(a)
  elif tag=='h1': self.h1+=1
  elif tag=='title': self.in_title=True
  elif tag=='script': self.script={'attrs':a,'parts':[]}
 def handle_endtag(self,tag):
  if tag=='title': self.in_title=False
  if tag=='script' and self.script is not None: self.scripts.append(self.script); self.script=None
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==tag: del self.stack[i:]; break
 def handle_data(self,data):
  self.text.append(data)
  if self.in_title: self.title.append(data)
  if self.script is not None: self.script['parts'].append(data)
def inside(stack,identifier): return any(i==identifier for _,i in stack)
def target(href):
 clean=href.split('#',1)[0].split('?',1)[0]
 if not clean or clean=='/': return PUBLIC/'index.html'
 p=PUBLIC/clean.lstrip('/'); return p if p.suffix else p/'index.html'

approved={p['program_key']:p for p in APPROVED['programs']}; sitemap=(PUBLIC/'sitemap.xml').read_text(); hashes={}
redirect_lines=(PUBLIC/'_redirects').read_text().strip().splitlines()
def _resolve_redirect_target(new):
 aliased=ALIAS_TARGET.get(new,new); return RETIRED_PROGRAM_ROUTES.get(aliased,aliased)
expected_redirect_lines=[f'{old} {_resolve_redirect_target(new)} 301' for old,new in LEGACY_REDIRECTS.items()]
expected_redirect_lines+=[f'{old} {new} 301' for old,new in RETIRED_PROGRAM_ROUTES.items() if old not in LEGACY_REDIRECTS]
# Consolidation 2026-08-15 (strategy rule R1): duplicate-intent guide URLs 301
# to their single canonical; part of the frozen redirect contract.
CONSOLIDATION_REDIRECTS={
 '/guides/healthrx-vs-agelessrx/':'/compare/healthrx-vs-agelessrx/',
 '/guides/wellorithm-vs-enhance-md/':'/compare/wellorithm-vs-enhance-md/',
 '/guides/cheapest-glp1/':'/cost/online-glp-1-programs/',
 '/guides/compare-online-glp-1-provider-fees/':'/cost/online-glp-1-programs/',
 '/guides/glp-1-program-total-cost-comparison/':'/cost/online-glp-1-programs/',
}
expected_redirect_lines+=[f'{old} {new} 301' for old,new in CONSOLIDATION_REDIRECTS.items()]
expected_redirect_lines+=[f'{old} {new} 301' for old,new in ALIAS_TARGET.items()]
# Design pass 2026-08-20 (Fable edit 1): additive short nav aliases. The memorable
# route a reader types or a partner links ('/quiz/') now 301s to the canonical
# route instead of hitting the 404. Declared separately so the frozen READY6
# contract above is exactly what it was; mirrors SHORT_NAV_ALIASES in
# scripts/build-staging.mjs and scripts/validate-g9-retirement.mjs, same order.
SHORT_NAV_ALIASES={'/quiz/':'/quiz/provider-fit/'}
expected_redirect_lines+=[f'{old} {new} 301' for old,new in SHORT_NAV_ALIASES.items()]
# W11 extends the frozen READY6 preserve list without weakening it. Mirror the
# build's ordered Map semantics, then resolve every target transitively so the
# exact contract rejects redirect chains as well as omissions and extra routes.
_redirect_map={}
for line in expected_redirect_lines:
 old,new,status=line.split(); _redirect_map[old]=(new,status)
for old,new in [*PHASE3['retired_evidence_wall_redirects'],*PHASE3['legacy_redirects']]:
 _redirect_map[old]=(new,'301')
# PASS2 §1b plus packs-cost route hygiene: exact aliases added after the Phase 3
# preserve map. Keep this in lockstep with src/phase3-page-graph.mjs.
PASS2_ROUTE_ALIASES={
 '/cost/':'/providers/',
}
for old,new in PASS2_ROUTE_ALIASES.items():
 _redirect_map[old]=(new,'301')
# MUSTFIX: linked provider-detail aliases must resolve directly to the standing
# review routes. They are separate from the Phase 3 graph so they do not inflate
# the sitemap denominator or create static shadow pages.
MUSTFIX_PROVIDER_DETAIL_REDIRECTS={
 '/providers/coivas/':'/reviews/coivas/',
 '/providers/sprout-health/':'/reviews/sprout-health/',
 '/providers/direct-meds/':'/reviews/direct-meds/',
 '/providers/mangorx/':'/reviews/mangorx/',
}
for old,new in MUSTFIX_PROVIDER_DETAIL_REDIRECTS.items():
 _redirect_map[old]=(new,'301')
# PASS 5: the frozen Google OAuth support document links the public /support/
# route. Preserve those bytes and make the linked route resolve directly to the
# canonical support/privacy boundary instead of shipping a 404.
PASS5_SUPPORT_REDIRECTS={'/support/':'/privacy/lead-capture/'}
for old,new in PASS5_SUPPORT_REDIRECTS.items():
 _redirect_map[old]=(new,'301')
# MUSTFIX: this retired route is handled by a query-aware Pages Function so
# medication intent survives. A static redirect would shadow that Function.
_redirect_map.pop('/best/online-glp-1-providers/',None)
def _final_redirect_target(source):
 seen={source}; target=_redirect_map[source][0]
 while target in _redirect_map:
  if target in seen: fail('/_redirects','redirect_cycle')
  seen.add(target); target=_redirect_map[target][0]
 return target
expected_redirect_lines=[f'{old} {_final_redirect_target(old)} {status}' for old,(_,status) in _redirect_map.items()]
if redirect_lines!=expected_redirect_lines:
 fail('/_redirects','ready6_permanent_redirect_contract_invalid')
# G08a/S14 retires exactly the two medication aliases into substantive organic
# owners. Preserve the rest of the exact redirect map and verify the replacement.
for medication in ('semaglutide','tirzepatide'):
 route=f'/{medication}/'; page=PUBLIC/medication/'index.html'
 if not page.is_file(): fail(route,'organic_category_missing')
 document=Document(); document.feed(page.read_text())
 canonical=f'https://glpclinicscout.com{route}'
 if document.h1!=1 or document.canonicals!=[{'rel':'canonical','href':canonical}]: fail(route,'organic_category_identity_invalid')
 robots=[a.get('content') for a in document.metas if a.get('name')=='robots']
 if robots!=['index,follow,max-image-preview:large']: fail(route,'organic_category_robots_invalid')
 if sitemap.count(f'<loc>{canonical}</loc>')!=1: fail(route,'organic_category_sitemap_invalid')
 if not any(a.get('data-g08-medication')==medication for _,a in document.events): fail(route,'organic_category_body_missing')
all_html='\n'.join(path.read_text(errors='strict') for path in PUBLIC.rglob('*.html'))
for old,new in LEGACY_REDIRECTS.items():
 if (PUBLIC/old.lstrip('/')/'index.html').exists(): fail(old,'legacy_duplicate_html_present')
 if sitemap.count(f'<loc>https://glpclinicscout.com{old}</loc>')!=0: fail(old,'legacy_route_in_sitemap')
 if f'href="{old}"' in all_html or f'https://glpclinicscout.com{old}' in all_html: fail(old,'legacy_route_internal_or_canonical_reference')
suppressed_routes=[]
for program in CONTRACT['programs']:
 route=program['review_path']; page=PUBLIC/route.lstrip('/')/'index.html'
 if route in LEGACY_REDIRECTS or route not in LEGACY_REDIRECTS.values(): fail(route,'brand_route_bijection_invalid')
 # 2026-08-17: the sealed contract still carries all six adjudicated programs. A
 # program the affiliate network paused is out of the site registry, so its page
 # is deliberately NOT built - and the checks below prove it is really gone:
 # no HTML, a permanent redirect, out of the sitemap, and unlinked anywhere.
 if route in RETIRED_PROGRAM_ROUTES:
  if any(r.get('review_path')==route for r in REGISTRY['programs']): fail(route,'suppressed_route_still_registered')
  if page.is_file(): fail(route,'suppressed_route_still_built')
  if f'{route} {_final_redirect_target(route)} 301' not in redirect_lines: fail(route,'suppressed_route_redirect_missing')
  if sitemap.count(f'<loc>https://glpclinicscout.com{route}</loc>')!=0: fail(route,'suppressed_route_in_sitemap')
  if f'href="{route}"' in all_html or f'https://glpclinicscout.com{route}' in all_html: fail(route,'suppressed_route_internal_reference')
  suppressed_routes.append(route); continue
 # A canonical-identity alias is represented exclusively by a straight 301.
 # No index file may exist because Cloudflare Pages serves static bytes before
 # consulting redirects, which would silently defeat alias canonicalization.
 if route in ALIAS_TARGET:
  if page.is_file(): fail(route,'alias_shadow_page_present')
  if f'{route} {_final_redirect_target(route)} 301' not in redirect_lines: fail(route,'alias_redirect_missing')
  if sitemap.count(f'<loc>https://glpclinicscout.com{route}</loc>')!=0: fail(route,'alias_route_in_sitemap')
  if f'href="{route}"' in all_html or f'https://glpclinicscout.com{route}' in all_html: fail(route,'alias_route_internal_reference')
  hashes[route]='REDIRECT_ONLY_NO_SHADOW_FILE'; continue
 if not page.is_file(): fail(route,'missing_built_page')
 payload=page.read_bytes(); hashes[route]=hashlib.sha256(payload).hexdigest(); parser=Document(); parser.feed(payload.decode())
 text=' '.join(' '.join(parser.text).split()); lower=text.lower()
 if parser.h1!=1 or not ''.join(parser.title).strip(): fail(route,'seo_title_or_h1_invalid')
 descriptions=[m.get('content','') for m in parser.metas if m.get('name')=='description']; robots=[m.get('content','') for m in parser.metas if m.get('name')=='robots']
 if len(descriptions)!=1 or len(descriptions[0])<100: fail(route,'meta_description_invalid')
 if robots!=['index,follow,max-image-preview:large']: fail(route,'indexability_invalid')
 canonical=f'https://glpclinicscout.com{route}'
 if len(parser.canonicals)!=1 or parser.canonicals[0].get('href')!=canonical: fail(route,'canonical_invalid')
 # SHED-301: an alias route leaves the sitemap and no shipped page may link to it
 # internally — every reader path lands on the canonical review, never on a hop.
 if sitemap.count(f'<loc>{canonical}</loc>')!=(0 if route in ALIAS_TARGET else 1): fail(route,'sitemap_bijection_invalid')
 if route in ALIAS_TARGET and f'href="{route}"' in all_html: fail(route,'alias_route_internally_linked')
 if any(phrase in payload.decode().lower() for phrase in FORBIDDEN_VISITOR): fail(route,'visitor_governance_semantics_leaked')
 affiliate=[(a,s) for a,s in parser.links if a.get('data-affiliate-state')=='active']
 if len(affiliate)!=1: fail(route,'affiliate_cta_count_invalid')
 cta,stack=affiliate[0]; expected=approved[program['program_key']]['tracking']['provider_issued_url']
 selected=((GO.get('selection') or {}).get('programs') or {}).get(program['registry_id'])
 promoted=selected and selected.get('status')=='VERIFIED'
 if promoted:
  entry=GO['manifest']['programs'].get(selected['render_id']) or {}
  if entry.get('status')!='live_operator_approved' or entry.get('link_mode')!='server_redirect' or entry.get('operator_selection_receipt_sha256')!=GO['selection']['selection_sha256'] or (entry.get('tracking') or {}).get('base_url')!=selected['issued_link']: fail(route,'go_receipt_not_verified')
  expected=selected['route']+'?s=reviews.rv2&v=a'
 if cta.get('href')!=expected: fail(route,'affiliate_cta_not_exact_provider_url')
 if cta.get('data-link-mode')!=('server-redirect' if promoted else 'transparent-direct') or cta.get('target') is not None or set(cta.get('rel','').split())!=EXPECTED_REL or not inside(stack,'partner-action'): fail(route,'affiliate_cta_contract_invalid')
 disclosure=next((i for i,(_,a) in enumerate(parser.events) if a.get('id')=='affiliate-disclosure'),-1); cta_i=next((i for i,(_,a) in enumerate(parser.events) if a.get('data-affiliate-state')=='active'),-1)
 required=['pricing','clinician-boundary','regulatory-status','score-rubric','evidence-gaps','price-warning']
 if disclosure<0 or cta_i<0 or disclosure>=cta_i: fail(route,'disclosure_order_invalid')
 if any(next((i for i,(_,a) in enumerate(parser.events) if a.get('id')==identifier),-1) not in range(cta_i) for identifier in required): fail(route,'required_section_order_invalid')
 source_links=[a.get('href') for a,s in parser.links if inside(s,'sources') and urlsplit(a.get('href','')).scheme]
 if source_links!=[s['url'] for s in program['official_sources']]: fail(route,'official_sources_not_exact')
 for href in source_links:
  u=urlsplit(href)
  if u.scheme!='https' or u.query or u.fragment or u.username or u.password: fail(route,'official_source_not_clean')
 for a,s in parser.links:
  href=a.get('href',''); u=urlsplit(href)
  if u.scheme in {'http','https'}:
   if a is cta or inside(s,'sources'): continue
   fail(route,'unapproved_external_anchor')
  if promoted and a is cta and href==expected: continue
  if href.startswith('/') and not target(href).is_file(): fail(route,'broken_internal_link')
 schema_scripts=[script for script in parser.scripts if script['attrs'].get('type')=='application/ld+json']
 runtime_srcs=[script['attrs'].get('src') for script in parser.scripts if script['attrs'].get('src')]
 # Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #8): SplitText/Flip
 # dropped from the shared shell (unused on every page). Pass 5 conditionally
 # loads GSAP, ScrollTrigger, Lenis, and motion.js through one first-party loader
 # on fine-pointer desktop only; mobile/reduced-motion stays native. The local,
 # fail-closed capture resilience runtime remains last.
 exact_runtime_srcs=[
  '/assets/motion-loader.js', '/assets/site.js', '/assets/consent.js',
 ]
 if len(runtime_srcs)!=5: fail(route,'remote_or_unapproved_script')
 if any(not re.fullmatch(rf'{re.escape(src)}\?v=[a-f0-9]{{16}}',actual) for src,actual in zip(exact_runtime_srcs,runtime_srcs[:3])): fail(route,'remote_or_unapproved_script')
 if not re.fullmatch(r'/assets/analytics\.[a-f0-9]{16}\.js',runtime_srcs[3]): fail(route,'remote_or_unapproved_script')
 if runtime_srcs[4]!='/assets/content-capture-resilient.js': fail(route,'remote_or_unapproved_script')
 inline_runtime=[script for script in parser.scripts if not script['attrs'].get('src') and script['attrs'].get('type')!='application/ld+json']
 # 2026-08-27 launch step 4 (BRAIN-BUILD-20260825): the GTM-PWR49VVK container
 # loader ships as an approved inline script on every shell page. GTM only —
 # no direct gtag.js. Same day, GTM cutover: a synthetic-suppression guard must
 # precede the loader (sets ga-disable before the container's Google tag can
 # fire — the deferred consent.js runs too late to suppress GTM's first event),
 # W5 replaces that exact loader with a pinned export hold, not a new SDK.
 # Exact-inline pin stays four: policy, disabled config, guard, content-upgrade.
 if len(schema_scripts)!=1 or not candidate_inline_allowed(inline_runtime): fail(route,'remote_or_unapproved_script')
 try: schema=json.loads(''.join(schema_scripts[0]['parts']))
 except json.JSONDecodeError: fail(route,'invalid_json_ld')
 # 2026-08-19 (AEO P0-C): the page ships ONE @graph carrying the Review, the
 # editorial-team byline entity and the canonical publisher Organization, so the
 # publisher resolves by @id instead of being re-invented per page. The
 # prohibitions are unchanged and now apply to every node in the graph, not just
 # the top-level object: no rating markup anywhere, ever (CR-4).
 nodes=schema.get('@graph') if isinstance(schema.get('@graph'),list) else [schema]
 reviews=[n for n in nodes if isinstance(n,dict) and n.get('@type')=='Review']
 if len(reviews)!=1 or reviews[0].get('url')!=canonical: fail(route,'structured_data_overclaim')
 if any(k in json.dumps(nodes) for k in ('reviewRating','aggregateRating','AggregateRating')): fail(route,'structured_data_overclaim')
 if not any(isinstance(n,dict) and n.get('@id')=='https://glpclinicscout.com/#organization' and n.get('name')=='GLP Clinic Scout' and n.get('legalName')=='Tilton Group LLC' for n in nodes): fail(route,'publisher_entity_not_canonical')
 if reviews[0].get('publisher',{}).get('@id')!='https://glpclinicscout.com/#organization': fail(route,'publisher_entity_not_canonical')
 for phrase in ['Affiliate disclosure:','Prices and program terms can change.','Compounded drugs are not FDA approved, and FDA does not premarket-review them for safety, effectiveness, or quality.','licensed clinician']:
  if phrase not in text: fail(route,'required_safety_copy_missing')
 # 2026-08-06 cluster 1: this used to require the literal strings "Not scored —
 # evidence gaps remain" and "Pending evidence" on every READY6 page. That froze
 # an unscored state that had stopped being true: the merit derivation scores
 # these providers off the content ledger and the comparison table publishes the
 # number. The page must now state one of three HONEST states - the derived
 # score, a named unscored state, or a pointer to the canonical record for an
 # aliased merchant - and may never ship a bare pending placeholder.
 score_states = [
   re.search(r'\d{1,2}\.\d/10 on our published evidence rubric', text),
   'Not scored — evidence gaps remain' in text,
   'Scored on our main' in text,
 ]
 if not any(score_states): fail(route,'score_state_missing_or_unnamed')
 if re.search(r'score pending|pending score|Pending evidence', text, re.I): fail(route,'score_placeholder_shipped')
 checks={
 'awin-128761':['$119/mo for new GLP-1 users, billed $357 for the first 3 months','Monthly equivalents are not monthly billing.','no separate membership or per-visit fees'],
 'katalys-1286':['as-low-as $110/month rate on a six-month plan','not proof of a $110 first payment or a confirmed total upfront charge'],
 'katalys-647':['MangoRx weight-loss pricing is unknown'],
 'katalys-1304':['$147 starting amount','does not bind that figure to one medication, delivery form, or complete first-payment schedule'],
 'katalys-1516':['as low as $199','cadence and inclusions remain unverified'],
 'katalys-1518':['starting prices of $199','$299 for oral semaglutide','existence of a privacy policy is not proof of compliance']}
 for phrase in checks[program['registry_id']]:
  if phrase not in text: fail(route,'merchant_specific_boundary_missing')
 forbidden_claims={'katalys-1304':['1.5%','weekly loss','buy direct'],'katalys-1516':['lose up to 15%','lose up to 20%'],'katalys-1518':['1-2lbs','1–2 lb','proven way','proven solution','before/after']}
 for phrase in forbidden_claims.get(program['registry_id'],[]):
  if phrase in lower: fail(route,'forbidden_merchant_claim_republished')
print(json.dumps({'status':'PASS_PROVIDER_FREE_STATIC_LINK_SEO_READY6','routes_checked':len(hashes),'suppressed_network_paused_routes':suppressed_routes,'affiliate_ctas_checked_without_navigation':len(hashes),'remote_scripts':0,'sitemap_occurrences_per_route':1,'route_byte_hashes':hashes},sort_keys=True))
