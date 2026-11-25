import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const runtime=fs.readFileSync(new URL('../public/store/live.js',import.meta.url),'utf8');
async function check(payload, fail=false) {
 const dom=new JSDOM('<!doctype html><body><div id="collection"></div></body>',{url:'https://www.armoniaconnect.com/store/?checkout=success&session_id=cs_test',runScripts:'outside-only'});
 const w=dom.window;
 const realSetTimeout=w.setTimeout.bind(w);
 w.setTimeout=(fn,ms,...args)=>realSetTimeout(fn,ms===1500?0:ms,...args);
 w.fetch=async()=>{if(fail) throw Error('offline');return {ok:true,headers:{get:()=>null},json:async()=>payload};};
 w.eval(runtime+'\nwindow.__testConfirmation=showOrderConfirmation;');
 try {
  await w.__testConfirmation('cs_test');
  const text=w.document.body.textContent;
  if(fail) {assert.match(text,/do not pay again/i);return;}
  if(payload.pending) {
   assert.match(text,/still checking your order/i);
   assert.match(text,/do not pay again/i);
   assert.doesNotMatch(text,/payment is confirmed|order number|\$0\.00/i);
   assert.equal(w.document.querySelector('.success-symbol'),null);
  } else {
   assert.match(text,/your order is confirmed/i);
   assert.match(text,/AC-TEST/);
   assert.match(text,/do not receive a receipt/i);
  }
 } finally {w.close();}
}
await check({pending:true});
await check({pending:false,number:'AC-TEST',itemCount:1,totalCents:100,items:[]});
await check(null,true);
console.log('Order confirmation safety checks passed');
