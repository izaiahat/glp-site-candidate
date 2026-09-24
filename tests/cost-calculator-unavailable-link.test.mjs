import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {buildCostCalculatorData,costCalculatorDropdownProviders,renderCostCalculator} from '../src/cost-calculator.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));

test('an unavailable saved medication cannot fall back to another row or restore its amounts',()=>{
  const data=buildCostCalculatorData(read('cost-calculator.json'),read('money-page-specs.json').pages,read('provider-page-contracts.json'),read('provider-fastpath-contract.json'),read('program-registry.json'),'glp-clinic-scout',new Set(),read('provider-pricing-matrix.json'));
  const provider=costCalculatorDropdownProviders(data).eligible[0];
  assert.ok(provider?.medications.length,'a real selectable provider is required');
  const html=renderCostCalculator(data);
  for(const medication of [provider.medications[0].entry_key,provider.medications[0].medication_id,'__TEST_UNAVAILABLE_ENTRY__']){
    const unavailable=medication==='__TEST_UNAVAILABLE_ENTRY__';
    const query=new URLSearchParams({provider:provider.program_id,medication,first:'17',recurring:'19'});
    const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://glpclinicscout.com/tools/glp-1-cost-calculator/?'+query,beforeParse(window){window.HTMLElement.prototype.scrollIntoView=()=>{};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});}});
    try{
      const document=dom.window.document;
      assert.equal(document.querySelector('#provider').value,unavailable?'':provider.program_id);
      if(unavailable){
        assert.equal(document.querySelector('#medication').value,'');
        assert.equal(document.querySelector('#first-base').value,'');
        assert.equal(document.querySelector('#recurring-base').value,'');
        assert.equal(document.querySelector('#cost-result').hidden,true);
        assert.match(document.querySelector('#copy-status').textContent,/saved medication option is unavailable/);
      }else{
        assert.equal(document.querySelector('#medication').value,provider.medications[0].entry_key);
      }
    }finally{dom.window.close();}
  }
});
