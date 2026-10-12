import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedDirectCard} from '../src/card-outbound.mjs';
const href='https://network.example/tracking?publisher=803003';
const affiliate={live:true,affiliate_href:href};
const outbound={mode:'transparent_direct',href};
const approved={status:'VERIFIED',promotion_authorized:true};
test('approved transparent-direct card is publishable without GO permission',()=>assert.equal(approvedDirectCard(outbound,affiliate,approved),true));
test('held, missing or mismatched grant cannot supply comparison CTA',()=>{
 for(const grant of [null,{status:'WITHHELD',promotion_authorized:false},{...approved,issued_link:'https://other.example/'}]) assert.equal(approvedDirectCard(outbound,affiliate,grant),false);
 assert.equal(approvedDirectCard({...outbound,mode:'held'},affiliate,approved),false);
 assert.equal(approvedDirectCard(outbound,{...affiliate,live:false},approved),false);
 assert.equal(approvedDirectCard({...outbound,href:'https://other.example/'},affiliate,approved),false);
});
