import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as gate from '../scripts/postbuild-aeo-surface.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/d2j-material-lastmod.json',import.meta.url),'utf8'));
const catalogs=new Map(['content-batch.json','content-national-wow-additions.json'].flatMap(file=>JSON.parse(readFileSync(new URL('../data/blog/'+file,import.meta.url),'utf8')).articles).map(a=>[a.canonical_path,a]));
for(const row of fixture.rows)test('D2j source-witnessed material lastmod: '+row.route,()=>{
 const article=catalogs.get(row.route);
 const base=gate.resolveRouteLastmod({route:row.route,hash:'changed',recorded:{lastmod:row.old_date,content_sha256:'prior'},declared:true,releaseDate:'2026-09-09',frozenDate:article?null:row.old_date});
 const owned=gate.resolveCatalogDate(row.route,article,article?.updated_at||row.old_date,base);
 const date=row.route==='/glp-1-price-index/'?undefined:'2026-09-09';
 assert.equal(gate.resolveMaterialDate(row.route,date,owned,'2026-09-09').lastmod,row.required_date);
});
test('D2j material dates require an explicitly declared valid route/date; no future or backdating',async()=>{
 const read=material_dates=>gate.readDeclaredRoutes({GLP_LASTMOD_DECLARED_ROUTES_FILE:'fixture'},async()=>JSON.stringify({schema:'glp.lastmod_declared_routes.v1',routes:['/x/'],material_dates}));
 for(const value of [[],null,{'/unknown/':'2026-09-09'},{'/x/':'2026-99-99'}])await assert.rejects(()=>read(value));
 assert.equal((await read({'/x/':'2026-09-09'})).materialDates.size,1);
 assert.throws(()=>gate.resolveMaterialDate('/x/','2026-09-10',{lastmod:'2026-09-08'},'2026-09-09'));
 assert.equal(gate.resolveMaterialDate('/x/','2026-09-09',{lastmod:'2026-09-10'},'2026-09-10').lastmod,'2026-09-10');
 assert.equal(gate.resolveMaterialDate('/x/',undefined,{lastmod:'2026-09-03'},'2026-09-09').lastmod,'2026-09-03');
});
