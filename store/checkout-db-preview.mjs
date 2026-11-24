// One-off preview build diagnostic: fake Stripe, isolated random cart IDs,
// real Supabase/PostgREST. Never creates a Stripe session or supplier order.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {supabase} from '../lib/supabase.js';
import {reserveCheckoutAttempt,saveCheckoutAttempt,replaceCheckoutAttempt} from '../lib/store/db.js';
import {guardedCheckout} from '../lib/store/checkout-guard.js';
if (process.env.VERCEL_ENV!=='preview' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Preview database credentials required');
const ids=Array.from({length:2},()=>`cart_${crypto.randomBytes(16).toString('hex')}`);
try {
 const [id,guardId]=ids;
 const attempts=await Promise.all(Array.from({length:12},(_,i)=>reserveCheckoutAttempt(id,'probe-hash',`probe-${id}-${i}`)));
 const winner=attempts[0].attempt_key;
 assert.ok(attempts.every(x=>x.attempt_key===winner && x.params_hash==='probe-hash'));
 const sessionId=`cs_probe_${crypto.randomBytes(12).toString('hex')}`;
 await Promise.all(Array.from({length:8},()=>saveCheckoutAttempt(winner,sessionId)));
 const swaps=await Promise.all(Array.from({length:12},(_,i)=>replaceCheckoutAttempt(id,winner,sessionId,'next-hash',`next-${id}-${i}`,sessionId)));
 assert.ok(swaps.every(x=>x.attempt_key===swaps[0].attempt_key && x.previous_paid_session_id===sessionId));
 await assert.rejects(saveCheckoutAttempt(winner,sessionId));
 const map=new Map(), cache=new Map();
 const stripe={checkout:{sessions:{
  create:async(params,{idempotencyKey})=>{if(!cache.has(idempotencyKey)){const s={id:`cs_probe_${crypto.randomBytes(12).toString('hex')}`,status:'open',payment_status:'unpaid',url:'https://example.invalid/checkout'};cache.set(idempotencyKey,s.id);map.set(s.id,s);} return {...map.get(cache.get(idempotencyKey))};},
  retrieve:async id=>({...map.get(id)}),
  expire:async id=>{const s=map.get(id);if(s.status!=='open') throw Error('not open');s.status='expired';return {...s};},
 }}};
 const args={stripe,cartId:guardId,params:{mode:'payment',items:'first'},reserve:reserveCheckoutAttempt,save:saveCheckoutAttempt,replace:replaceCheckoutAttempt};
 const same=await Promise.all(Array.from({length:8},()=>guardedCheckout(args)));
 assert.ok(same.every(x=>x.id===same[0].id));
 const next=await guardedCheckout({...args,params:{mode:'payment',items:'changed'}});
 assert.notEqual(next.id,same[0].id);assert.equal(map.get(same[0].id).status,'expired');
 assert.equal([...map.values()].filter(s=>s.status==='open').length,1);
 console.log('CHECKOUT_DB_PREVIEW',JSON.stringify({parallelReservations:12,parallelSaves:8,parallelSwaps:12,parallelGuardCalls:8,changedCartExpired:true,liveStripeUsed:false}));
} finally {
 const {error}=await supabase.from('store_checkout_attempts').delete().in('cart_id',ids);
 if(error) throw Error('Preview test cleanup failed');
}
