// Preview-only, read-only Stripe and isolated synthetic Supabase rows.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
import {checkoutGuardActivatedAt,reserveCheckoutAttempt,finishLegacyCheckout,saveCheckoutAttempt,replaceCheckoutAttempt} from '../lib/store/db.js';
import {findLegacyCheckout} from '../lib/store/legacy-checkout.js';
import {guardedCheckout} from '../lib/store/checkout-guard.js';
import handler from '../api/store/[...slug].js';
if(process.env.VERCEL_ENV!=='preview') throw Error('Preview only');
const ids=Array.from({length:2},()=>`cart_${crypto.randomBytes(16).toString('hex')}`);
try {
 assert.equal(await checkoutGuardActivatedAt(),null);
 const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
 await handler({url:'/api/store/checkout',method:'POST',headers:{},body:{}},res);
 assert.equal(res.code,503);assert.match(res.body.error,/temporarily unavailable/);
 const found=await findLegacyCheckout(new Stripe(process.env.STRIPE_SECRET_KEY),ids[0],new Date(Date.now()-48*3600*1000).toISOString());
 assert.equal(found,null);
 const key=crypto.randomBytes(32).toString('hex');
 const row=await reserveCheckoutAttempt(ids[0],'probe',key);assert.equal(row.legacy_checked,false);
 const previous=`cs_probe_${crypto.randomBytes(16).toString('hex')}`;
 const finished=await Promise.all(Array.from({length:8},()=>finishLegacyCheckout(ids[0],key,previous)));
 assert.ok(finished.every(r=>r.legacy_checked===true&&r.stripe_session_id===previous&&r.params_hash==='legacy'));
 const saved=await reserveCheckoutAttempt(ids[1],'probe2',crypto.randomBytes(32).toString('hex'));
 const done=await finishLegacyCheckout(ids[1],saved.attempt_key,null);assert.equal(done.legacy_checked,true);assert.equal(done.stripe_session_id,null);
 // Exercise new guard's legacy transition using only synthetic sessions.
 let creates=0;const list=new Map([[previous,{id:previous,status:'open',payment_status:'unpaid',url:'https://example.invalid'}]]);
 const stripe={checkout:{sessions:{retrieve:async id=>({...list.get(id)}),expire:async id=>{const s=list.get(id);s.status='expired';return {...s};},create:async()=>{creates++;const s={id:`cs_probe_${crypto.randomBytes(16).toString('hex')}`,status:'open',payment_status:'unpaid',url:'https://example.invalid'};list.set(s.id,s);return s;}}}};
 // Different hash forces expiry of the synthetic legacy session.
 const result=await guardedCheckout({stripe,cartId:ids[0],params:{mode:'payment'},reserve:reserveCheckoutAttempt,save:saveCheckoutAttempt,replace:replaceCheckoutAttempt,findLegacy:async()=>null,finishLegacy:finishLegacyCheckout});
 assert.equal(creates,1);assert.notEqual(result.id,previous);assert.equal(list.get(previous).status,'expired');
 console.log('LEGACY_DB_PREVIEW',JSON.stringify({pausedCheckout:true,realStripeReadOnlyScan:true,parallelLegacyClaims:8,syntheticLegacyTransition:true}));
} finally {
 const {error}=await supabase.from('store_checkout_attempts').delete().in('cart_id',ids);
 if(error) throw Error('Synthetic row cleanup failed');
}
