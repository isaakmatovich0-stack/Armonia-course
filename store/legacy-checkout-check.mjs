import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findLegacyCheckout} from '../lib/store/legacy-checkout.js';
import {guardedCheckout} from '../lib/store/checkout-guard.js';
process.env.STORE_LOCAL_DB='1';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'armonia-legacy-check-'));
process.chdir(dir);
const {reserveCheckoutAttempt,saveCheckoutAttempt,replaceCheckoutAttempt,finishLegacyCheckout}=await import('../lib/store/db.js');
const created='2025-01-01T00:00:00Z';let rows=[], creates=0, expires=0, failList=false;
const stripe={checkout:{sessions:{
 list:async args=>{
  if(failList) throw Error('Stripe offline');
  const start=args.starting_after ? rows.findIndex(s=>s.id===args.starting_after)+1:0;
  const page=rows.slice(start,start+2);return {data:page.map(s=>({...s})),has_more:start+2<rows.length};
 },
 retrieve:async id=>{const s=rows.find(x=>x.id===id);if(!s) throw Error('missing');return {...s};},
 create:async(params)=>{creates++;const s={id:`cs_new_${creates}`,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/test',metadata:params.metadata};rows.unshift(s);return {...s};},
 expire:async id=>{const s=rows.find(x=>x.id===id);if(!s || s.status!=='open') throw Error('cannot expire');expires++;s.status='expired';return {...s};},
}}};
const cart=n=>`cart_${n.toString(16).padStart(32,'0')}`;
const old=(id,c,status,payment)=>({id,status,payment_status:payment,url:'https://checkout.stripe.com/old',metadata:{cart_id:c}});
const run=(c,options={})=>guardedCheckout({stripe,cartId:c,params:{mode:'payment',metadata:{cart_id:c}},reserve:reserveCheckoutAttempt,save:saveCheckoutAttempt,replace:replaceCheckoutAttempt,findLegacy:()=>findLegacyCheckout(stripe,c,created),finishLegacy:finishLegacyCheckout,...options});
try {
 const a=cart(1);rows=[old('cs_other',cart(9),'open','unpaid'),old('cs_expired',a,'expired','unpaid'),old('cs_open',a,'open','unpaid')];
 assert.equal(await findLegacyCheckout(stripe,a,created),'cs_open','scan follows pagination');
 const s=await run(a);assert.notEqual(s.id,'cs_open');assert.equal(rows.find(x=>x.id==='cs_open').status,'expired');assert.equal(expires,1);
 assert.equal((await run(a)).id,s.id);assert.equal(creates,1);
 const b=cart(2);rows=[old('cs_processing',b,'complete','unpaid')];
 await assert.rejects(run(b),e=>e.code==='completed');assert.equal(creates,1);
 const c=cart(3);rows=[old('cs_paid',c,'complete','paid')];
 await assert.rejects(run(c),e=>e.code==='completed');
 await assert.rejects(run(c,{paidOrderRecorded:async()=>true}),e=>e.code==='paid' && e.sessionId==='cs_paid');
 const newOrder=await run(c,{paidOrderRecorded:async()=>true,restartAfterPaid:'cs_paid'});
 assert.notEqual(newOrder.id,'cs_paid');assert.equal(creates,2);
 const d=cart(4);rows=[old('cs_one',d,'open','unpaid'),old('cs_two',d,'complete','paid')];
 await assert.rejects(run(d),e=>e.code==='unknown');assert.equal(creates,2);
 const e=cart(5);failList=true;await assert.rejects(run(e),/offline/);assert.equal(creates,2);failList=false;
 await assert.rejects(findLegacyCheckout(stripe,e,'invalid'),err=>err.code==='unknown');
 // Two scanners may race, but only the first CAS may decide the slot's state.
 const f=cart(6), attempt=await reserveCheckoutAttempt(f,'hash','key_f');
 const [one,two]=await Promise.all([finishLegacyCheckout(f,attempt.attempt_key,'cs_old_f'),finishLegacyCheckout(f,attempt.attempt_key,null)]);
 assert.equal(one.stripe_session_id,'cs_old_f');assert.equal(two.stripe_session_id,'cs_old_f');assert.equal(two.params_hash,'legacy');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log('Legacy checkout migration safety checks passed');
