import assert from 'node:assert/strict';
import { checkoutAttemptKey, guardedCheckout, CheckoutGuardError } from '../lib/store/checkout-guard.js';
const cart = {id:'cart_example',updated_at:'2026-01-01T00:00:00Z'};
const fingerprint='a'.repeat(64);
const key=checkoutAttemptKey(cart,fingerprint);
assert.equal(key,checkoutAttemptKey(cart,fingerprint));
assert.notEqual(key,checkoutAttemptKey({...cart,updated_at:'2026-01-01T00:00:01Z'},fingerprint));
assert.notEqual(key,checkoutAttemptKey(cart,'b'.repeat(64)));
assert.throws(()=>checkoutAttemptKey(cart,'bad'));
const now=Date.now();
let row={created_at:new Date(now).toISOString(),stripe_session_id:null};
let creates=0,retrieves=0,session={id:'cs_once',status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/example'};
const sessionsByKey=new Map();
const stripe={checkout:{sessions:{
  create:async (params,options)=>{creates++; assert.equal(options.idempotencyKey,`store-checkout-${key}`); if(!sessionsByKey.has(options.idempotencyKey)) sessionsByKey.set(options.idempotencyKey,session.id); return {id:sessionsByKey.get(options.idempotencyKey)};},
  retrieve:async id=>{retrieves++; assert.equal(id,session.id); return {...session};},
}}};
const reserve=async()=>({...row});
const save=async(k,id)=>{assert.equal(k,key); if(row.stripe_session_id && row.stripe_session_id!==id) throw Error('changed');row.stripe_session_id=id;};
const run=(overrides={})=>guardedCheckout({stripe,key,params:{mode:'payment'},reserve,save,now,...overrides});
assert.equal((await run()).id,'cs_once');
assert.equal((await run()).id,'cs_once');
assert.equal(creates,1,'stored session reused without another Stripe creation');
session={...session,status:'complete',payment_status:'paid',url:null};
await assert.rejects(run(),e=>e instanceof CheckoutGuardError && e.code==='completed');
assert.equal(creates,1);
session={...session,status:'expired',payment_status:'unpaid'};
await assert.rejects(run(),e=>e.code==='expired');
session={...session,status:'open',url:'https://checkout.stripe.com/example'};
// If Stripe created a session but the database write failed, a retry uses the
// same idempotency key and adopts the same session, not a second session.
row={created_at:new Date(now).toISOString(),stripe_session_id:null};
await assert.rejects(run({save:async()=>{throw new Error('database offline')}}),/database offline/);
assert.equal((await run()).id,'cs_once');
assert.equal(sessionsByKey.size,1);
// Unknown older attempts never invoke create, even after Stripe's key retention.
row={created_at:new Date(now-24*60*60*1000).toISOString(),stripe_session_id:null};
const before=creates;
await assert.rejects(run(),e=>e.code==='unknown'); assert.equal(creates,before);
// Never contact Stripe if the durable reservation cannot be obtained.
await assert.rejects(run({reserve:async()=>{throw new Error('database offline')}}),/database offline/); assert.equal(creates,before);
// Concurrent requests share the same key even if they race before persistence.
row={created_at:new Date(now).toISOString(),stripe_session_id:null};
const pair=await Promise.all([run(),run()]); assert.deepEqual(pair.map(x=>x.id),['cs_once','cs_once']);
assert.equal(sessionsByKey.size,1);
assert.ok(retrieves>=4);
console.log('Checkout duplicate protection checks passed');
