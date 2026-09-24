import assert from 'node:assert/strict';
// Validate both no-JS bodies and their JS placeholders before projecting either population.
export function javascriptProviderMarkup(html) {
 const twins=[...html.matchAll(/<noscript>\s*(<article\b[^>]*\bdata-provider-noscript-card[^>]*>[\s\S]*?<\/article>)\s*<\/noscript>\s*(<article\b[^>]*>)/g)];
 const raw=(html.match(/\bdata-provider-noscript-card(?=[\s>])/g)||[]).length;
 assert.equal(twins.length,raw,'every no-JS twin must immediately precede its own deferred shell');
 const ids=[];
 for(const [,twin,shell]of twins){
  const open=twin.match(/^<article\b[^>]*>/)[0];
  const id=open.match(/data-program="([^"]+)"/)?.[1];
  assert.ok(id);assert.equal(shell.match(/data-program="([^"]+)"/)?.[1],id);
  assert.match(shell,/data-provider-lazy-index="\d+"/);
  assert.doesNotMatch(open,/\shidden(?=[\s>])/);assert.match(twin,/data-provider-card-contract="option-c"/);ids.push(id);
  assert.doesNotMatch(twin,/data-provider-lazy-placeholder/,'no-JS twin must contain the full body');
 }
 assert.equal(new Set(ids).size,ids.length,'no duplicated no-JS provider');
 const projected=html.replace(/<noscript>\s*<article\b[^>]*\bdata-provider-noscript-card[^>]*>[\s\S]*?<\/article>\s*<\/noscript>/g,'');
 const deferred=[...projected.matchAll(/<article\b[^>]*data-provider-lazy-index="\d+"[^>]*>/g)];
 assert.equal(deferred.length,twins.length,'every deferred provider has exactly one no-JS twin, hidden or visible');
 return projected;
}
