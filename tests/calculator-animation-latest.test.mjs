import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {buildCostCalculatorData, renderCostCalculator} from '../src/cost-calculator.mjs';
const read = name => JSON.parse(readFileSync(new URL('../data/'+name, import.meta.url)));
const html = renderCostCalculator(buildCostCalculatorData(read('cost-calculator.json'), read('money-page-specs.json').pages, read('provider-page-contracts.json'), read('provider-fastpath-contract.json'), read('program-registry.json')));

function fixture(enhanced) {
  const dom = new JSDOM(html, {runScripts:'outside-only', url:'http://localhost/'});
  const w = dom.window;
  let now = 0, serial = 0;
  const frames = new Map();
  w.matchMedia = () => ({matches:enhanced});
  w.performance.now = () => now;
  w.requestAnimationFrame = callback => {const id=++serial; frames.set(id, callback); return id;};
  w.cancelAnimationFrame = id => frames.delete(id);
  const script = [...w.document.scripts].find(s => s.textContent.includes("const ids=['result-first','result-recurring','result-period']"));
  assert.ok(script, 'execute the actual maintained decorator');
  w.eval(script.textContent);
  return {dom, w, frame(time) {now=time; const batch=[...frames.values()]; frames.clear(); for(const f of batch) f(time);}};
}

for (const enhanced of [true, false]) {
  test(`calculator repeated submissions retain latest amounts (enhanced=${enhanced})`, () => {
    const f=fixture(enhanced), {w}=f;
    const ids=['result-first','result-recurring','result-period'];
    const submit = amounts => {
      ids.forEach((id,i) => {w.document.getElementById(id).textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(amounts[i]);});
      w.document.getElementById('cost-form').dispatchEvent(new w.Event('submit'));
    };
    submit([75,75,450]);
    f.frame(0);
    submit([321,432,2481]);
    // Old 650ms callback fires before the new queued callback, as in the
    // retained native Chromium failure. The latest calculation must own DOM.
    f.frame(650);
    f.frame(1300);
    assert.deepEqual(ids.map(id => w.document.getElementById(id).textContent), ['$321','$432','$2,481']);
    f.dom.window.close();
  });
}
