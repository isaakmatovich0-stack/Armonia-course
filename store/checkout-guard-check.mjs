import assert from 'node:assert/strict';
import { checkoutParamsHash, guardedCheckout } from '../lib/store/checkout-guard.js';
const cartId='cart_0123456789abcdef0123456789abcdef';
const p1={mode:'payment',metadata:{cart_version:'one'},line_items:[{price:100}]};
const p2={...p1,metadata:{cart_version:'two'}};
assert.equal(checkoutParamsHash(cartId,p1),checkoutParamsHash(cartId,p1));
assert.notEqual(checkoutParamsHash(cartId,p1),checkoutParamsHash(cartId,p2));
assert.throws(()=>checkoutParamsHash('bad',p1));
let row=null, calls=[], sessions=new Map(), byKey=new Map(), now=Date.now();
const clone=x=>structuredClone(x);
const reserve=async(cart,hash,key)=>{
 if(!row) row={cart_id:cart,params_hash:hash,attempt_key:key,stripe_session_id:null,legacy_checked:true,created_at:new Date(now).toISOString()};
 return clone(row);
};
const save=async(key,id)=>{
 if(row.attempt_key!==key || (row.stripe_session_id && row.stripe_session_id!==id)) throw Error('changed');
 row.stripe_session_id=id;
};
const replace=async(cart,key,id,hash,next,previousPaid=null)=>{
 if(row.cart_id===cart && row.attempt_key===key && row.stripe_session_id===id)
  row={cart_id:cart,attempt_key:next,params_hash:hash,stripe_session_id:null,previous_paid_session_id:previousPaid,legacy_checked:true,created_at:new Date(now).toISOString()};
 return clone(row);
};
const stripe={checkout:{sessions:{
 create:async(params,options)=>{
  calls.push(['create',options.idempotencyKey]);
  const serialized=JSON.stringify(params);
  if(byKey.has(options.idempotencyKey)) {
   const old=byKey.get(options.idempotencyKey);
   if(old.serialized!==serialized) throw Error('Stripe idempotency parameter mismatch');
   return clone(sessions.get(old.id));
  }
  const id=`cs_${byKey.size+1}`;
  const session={id,status:'open',payment_status:'unpaid',url:`https://checkout.stripe.com/${id}`};
  byKey.set(options.idempotencyKey,{id,serialized});sessions.set(id,session);return clone(session);
 },
 retrieve:async id=>{calls.push(['retrieve',id]);if(!sessions.has(id)) throw Error('not found');return clone(sessions.get(id));},
 expire:async id=>{calls.push(['expire',id]);let session=sessions.get(id);if(session.status!=='open') throw Error('not open');session.status='expired';session.url=null;return clone(session);}
}}};
const run=(params=p1,overrides={})=>guardedCheckout({stripe,cartId,params,reserve,save,replace,now,...overrides});
const first=await run();
assert.equal((await run()).id,first.id,'identical retry resumes existing session');
const second=await run(p2);
assert.notEqual(second.id,first.id,'changed checkout gets replacement only after expiration');
assert.equal(sessions.get(first.id).status,'expired');
assert.deepEqual(calls.filter(c=>c[0]==='expire'),[['expire',first.id]]);
assert.equal([...sessions.values()].filter(s=>s.status==='open').length,1);
// Concurrent replacement requests race on the expired slot but use the winner's key.
sessions.get(second.id).status='expired'; sessions.get(second.id).url=null;
const concurrent=await Promise.all([run(p2),run(p2)]);
assert.equal(concurrent[0].id,concurrent[1].id);
assert.equal([...sessions.values()].filter(s=>s.status==='open').length,1);
// A paid or processing session is never replaced, even after a change.
for (const payment of ['paid','unpaid']) {
 const latest=sessions.get(concurrent[0].id);latest.status='complete';latest.payment_status=payment;
 const count=byKey.size;
 await assert.rejects(run(p1),e=>e.code==='completed');assert.equal(byKey.size,count);
}
// An ambiguous or failed expire must never lead to a new session.
const latest=sessions.get(concurrent[0].id);latest.status='open';latest.payment_status='unpaid';latest.url='https://checkout.stripe.com/cs';
const failExpire={checkout:{sessions:{...stripe.checkout.sessions,expire:async()=>{throw Error('timeout')}}}};
const before=byKey.size;
await assert.rejects(run(p1,{stripe:failExpire}),e=>e.code==='unknown');assert.equal(byKey.size,before);
// An expiration may have succeeded despite a lost response. Only a later
// authoritative retrieval of the expired session permits a replacement.
const ambiguousExpiry={checkout:{sessions:{...stripe.checkout.sessions,expire:async(id)=>{await stripe.checkout.sessions.expire(id);throw Error('response lost');}}}};
await assert.rejects(run(p1,{stripe:ambiguousExpiry}),e=>e.code==='unknown');
assert.equal(byKey.size,before);
const afterLostExpire=await run(p1);
assert.notEqual(afterLostExpire.id,latest.id);
assert.equal(sessions.get(latest.id).status,'expired');
// If the old session completes during expiration, do not create a replacement.
sessions.get(afterLostExpire.id).status='open';
const paymentRace={checkout:{sessions:{...stripe.checkout.sessions,expire:async(id)=>{sessions.get(id).status='complete';sessions.get(id).payment_status='paid';throw Error('already complete');}}}};
const beforeRace=byKey.size;
await assert.rejects(run(p2,{stripe:paymentRace}),e=>e.code==='unknown');
await assert.rejects(run(p2),e=>e.code==='completed');
assert.equal(byKey.size,beforeRace);
// A distinct purchase is opt-in, requires Stripe paid AND an order record,
// and concurrent confirmations of the same previous order share one slot.
const paidId=afterLostExpire.id;
await assert.rejects(run(p2,{paidOrderRecorded:async()=>false,restartAfterPaid:paidId}),e=>e.code==='completed');
assert.equal(byKey.size,beforeRace);
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true}),e=>e.code==='paid' && e.sessionId===paidId);
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:'cs_not_previous'}),e=>e.code==='unknown');
assert.equal(byKey.size,beforeRace);
const newOrders=await Promise.all([
 run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:paidId}),
 run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:paidId}),
]);
assert.equal(newOrders[0].id,newOrders[1].id);
assert.notEqual(newOrders[0].id,paidId);
assert.equal(byKey.size,beforeRace+1);
assert.equal(row.previous_paid_session_id,paidId);
await assert.rejects(run(p1,{paidOrderRecorded:async()=>true,restartAfterPaid:paidId}),e=>e.code==='unknown');
assert.equal(byKey.size,beforeRace+1,'stale confirmation cannot replace a newer checkout');
// A restart token for an open or processing session is not authorization.
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:newOrders[0].id}),e=>e.code==='unknown');
const newSession=sessions.get(newOrders[0].id);newSession.status='complete';newSession.payment_status='unpaid';
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:newOrders[0].id}),e=>e.code==='unknown');
assert.equal(byKey.size,beforeRace+1);
// A stale confirmation cannot supersede a subsequent paid order.
newSession.payment_status='paid';
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:paidId}),e=>e.code==='paid' && e.sessionId===newSession.id);
assert.equal(byKey.size,beforeRace+1);
// A failed persistence during the explicitly authorized order is recovered
// by the same token and Stripe key, not by creating another paid session.
let lostSave=true;
const restartSave=async(...args)=>{if(lostSave){lostSave=false;throw Error('save lost');}return save(...args);};
await assert.rejects(run(p1,{paidOrderRecorded:async()=>true,restartAfterPaid:newSession.id,save:restartSave}),/save lost/);
const createdAfterRestart=byKey.size;
await assert.rejects(run(p2,{paidOrderRecorded:async()=>true,restartAfterPaid:newSession.id,save:restartSave}),e=>e.code==='unknown');
const recoveredRestart=await run(p1,{paidOrderRecorded:async()=>true,restartAfterPaid:newSession.id,save:restartSave});
assert.ok(recoveredRestart.id);assert.equal(byKey.size,createdAfterRestart);
// A create accepted by Stripe but timing out leaves an unknown reservation.
row=null;let timedOut=false;
const timeoutStripe={checkout:{sessions:{...stripe.checkout.sessions,create:async(...args)=>{const result=await stripe.checkout.sessions.create(...args);if(!timedOut){timedOut=true;throw Error('timeout');}return result;}}}};
await assert.rejects(run(p1,{stripe:timeoutStripe}),/timeout/);
const beforeChanged=byKey.size;
await assert.rejects(run(p2,{stripe:timeoutStripe}),e=>e.code==='unknown');
assert.equal(byKey.size,beforeChanged,'changed request cannot replace an unknown outcome');
const recovered=await run(p1,{stripe:timeoutStripe});
assert.ok(recovered.id);assert.equal(byKey.size,beforeChanged);
// Database failure after successful Stripe creation also recovers with same key.
row=null;let failSave=true;
const flakySave=async(...args)=>{if(failSave){failSave=false;throw Error('db offline');}return save(...args);};
await assert.rejects(run(p1,{save:flakySave}),/db offline/);
const afterAccepted=byKey.size;
await run(p1,{save:flakySave});assert.equal(byKey.size,afterAccepted);
// Past the safe idempotency window, unknown attempts require investigation.
row=null;await assert.rejects(run(p1,{save:async()=>{throw Error('db offline')}}),/db offline/);
const oldCount=byKey.size;now+=24*60*60*1000;
await assert.rejects(run(),e=>e.code==='unknown');assert.equal(byKey.size,oldCount);
await assert.rejects(run(p1,{reserve:async()=>{throw Error('db offline')}}),/db offline/);assert.equal(byKey.size,oldCount);
console.log('Cart-scoped checkout duplicate protection checks passed');
