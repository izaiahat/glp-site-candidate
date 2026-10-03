#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {renderPromo,renderRateCard,renderDirectoryMock} from '../src/paid-promo.mjs';
const args=process.argv.slice(2);
const get=k=>args[args.indexOf(k)+1];
const out=path.resolve(get('--out')||'reports/sponsor-preview');
fs.mkdirSync(out,{recursive:true});
if(args.includes('--activate')){
 if(!args.includes('--order'))throw Error('--order is required');
 const order=JSON.parse(fs.readFileSync(get('--order'),'utf8'));
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(order.slug))throw Error('Invalid provider slug');
 const html=renderPromo(order,{preview:false});
 const dir=path.join(out,'sponsors',order.slug);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),html);
 console.log(JSON.stringify({route:`/sponsors/${order.slug}/`,output:path.join(dir,'index.html'),deployed:false}));
}else{
 fs.writeFileSync(path.join(out,'rate-card.html'),renderRateCard());
 fs.writeFileSync(path.join(out,'placement-template.html'),renderDirectoryMock());
 fs.writeFileSync(path.join(out,'promo-page-preview.html'),renderPromo());
 fs.writeFileSync(path.join(out,'nuimage-promo-preview.html'),renderPromo({provider:'Nu Image Medical'}));
 console.log(JSON.stringify({preview:true,out,deployed:false}));
}
