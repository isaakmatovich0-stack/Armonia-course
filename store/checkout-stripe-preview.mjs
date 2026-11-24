// One-off preview test. Creates private unpaid sessions only; never collects
// payment details and never sends a supplier order. All known sessions expire.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
import {reserveCheckoutAttempt,saveCheckoutAttempt,replaceCheckoutAttempt} from '../lib/store/db.js';
import {guardedCheckout} from '../lib/store/checkout-guard.js';
if(process.env.VERCEL_ENV!=='preview' || !process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Preview credentials required');
const cartId=`cart_${crypto.randomBytes(16).toString('hex')}`;
const api=new Stripe(process.env.STRIPE_SECRET_KEY);
const known=new Set();let simulateLoss=true, diagnosticError;
const stripe={checkout:{sessions:{
 create:async(params,options)=>{const s=await api.checkout.sessions.create(params,options);known.add(s.id);if(simulateLoss){simulateLoss=false;throw Error('simulated lost response');}return s;},
 retrieve:async(id)=>api.checkout.sessions.retrieve(id),
 expire:async(id)=>api.checkout.sessions.expire(id),
}}};
const base={mode:'payment',payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:100,product_data:{name:'Unpaid checkout safety diagnostic'}}}],success_url:'https://www.armoniaconnect.com/store/?diagnostic=success',cancel_url:'https://www.armoniaconnect.com/store/?diagnostic=cancel',metadata:{source:'diagnostic-unpaid'}};
const args={stripe,cartId,params:base,reserve:reserveCheckoutAttempt,save:saveCheckoutAttempt,replace:replaceCheckoutAttempt};
try {
 await assert.rejects(guardedCheckout(args),/simulated lost response/);
 const recovered=await guardedCheckout(args);
 assert.equal(known.size,1);assert.equal(recovered.status,'open');assert.equal(recovered.payment_status,'unpaid');
 const same=await Promise.all(Array.from({length:4},()=>guardedCheckout(args)));
 assert.ok(same.every(s=>s.id===recovered.id));
 const changed=await guardedCheckout({...args,params:{...base,metadata:{source:'diagnostic-unpaid-changed'}}});
 assert.notEqual(changed.id,recovered.id);
 const old=await api.checkout.sessions.retrieve(recovered.id);
 assert.equal(old.status,'expired');assert.equal(old.payment_status,'unpaid');
 assert.equal(changed.payment_status,'unpaid');assert.equal(known.size,2);
 console.log('CHECKOUT_STRIPE_PREVIEW',JSON.stringify({lostResponseRecovered:true,sameSessionRetries:4,changedCartExpiredOld:true,sessionCount:known.size,payment:'unpaid',livemode:changed.livemode}));
} catch(e) {diagnosticError=e;}
let cleanupError=false;
for(const id of known) {
 try {const s=await api.checkout.sessions.retrieve(id);if(s.status==='open' && s.payment_status==='unpaid') await api.checkout.sessions.expire(id);else if(s.status!=='expired' || s.payment_status!=='unpaid') cleanupError=true;} catch {cleanupError=true;}
}
const {error}=await supabase.from('store_checkout_attempts').delete().eq('cart_id',cartId);
if(error || cleanupError) throw Error('Checkout diagnostic cleanup requires review');
if(diagnosticError) throw diagnosticError;
console.log('CHECKOUT_STRIPE_CLEANUP',JSON.stringify({allKnownSessionsExpiredUnpaid:true,reservationRemoved:true}));
