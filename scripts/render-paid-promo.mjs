#!/usr/bin/env node
// GLP-327: render sponsor pages through the site's own document renderer and
// shared shell (header, footer, fonts, site-p3.css). Output is local only;
// nothing is deployed. Preview: rate card + example promo. --activate renders
// one gated /sponsors/{slug}/ page from a reviewed order.
import fs from 'node:fs';
import path from 'node:path';
import { renderPromo, renderRateCard, SPONSOR_ROBOTS } from '../src/paid-promo.mjs';
import { addSharedRuntime } from './build-staging.mjs';
const args = process.argv.slice(2);
const get = k => args.includes(k) ? args[args.indexOf(k) + 1] : undefined;
const out = path.resolve(get('--out') || 'reports/sponsor-preview');
const page = html => addSharedRuntime(html).replace(/<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${SPONSOR_ROBOTS}">`);
const write = (route, html) => { const dir = path.join(out, route); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'index.html'), page(html)); return path.join(dir, 'index.html'); };
if (args.includes('--activate')) {
  if (!args.includes('--order')) throw Error('--order is required');
  const order = JSON.parse(fs.readFileSync(get('--order'), 'utf8'));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(order.slug || '')) throw Error('Invalid provider slug');
  const output = write(`sponsors/${order.slug}`, renderPromo(order, { preview: false }));
  console.log(JSON.stringify({ route: `/sponsors/${order.slug}/`, output, deployed: false }));
} else {
  const outputs = [write('sponsors/rates', renderRateCard()), write('sponsors/example-provider', renderPromo())];
  console.log(JSON.stringify({ preview: true, outputs, deployed: false }));
}
