// Preview-only integration check. Creates ONE unpublished, unpaid Stripe
// Checkout Session per build, never enters payment details, and expires it.
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { guardedCheckout } from '../lib/store/checkout-guard.js';
import { reserveCheckoutAttempt, saveCheckoutAttempt } from '../lib/store/db.js';
import { supabase } from '../lib/supabase.js';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const key=crypto.randomBytes(32).toString('hex');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const params={mode:'payment',payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:100,product_data:{name:'Unpaid duplicate-protection diagnostic'}}}],success_url:'https://www.armoniaconnect.com/store/?diagnostic=success',cancel_url:'https://www.armoniaconnect.com/store/?diagnostic=cancel',metadata:{source:'diagnostic-unpaid'}};
let id,expired=false;
try {
 const args={stripe,key,params,reserve:reserveCheckoutAttempt,save:saveCheckoutAttempt};
 const one=await guardedCheckout(args); id=one.id;
 const two=await guardedCheckout(args);
 if(one.id!==two.id || one.payment_status!=='unpaid' || two.payment_status!=='unpaid') throw new Error('Unpaid retry validation failed');
 const result=await stripe.checkout.sessions.expire(id);
 if(result.status!=='expired' || result.payment_status!=='unpaid') throw new Error('Diagnostic did not expire unpaid');
 expired=true;
 let blocked=false;
 try { await guardedCheckout(args); } catch(e) { blocked=e.code==='expired'; }
 if(!blocked) throw new Error('Expired checkout was not blocked');
 console.log('CHECKOUT_GUARD_INTEGRATION',JSON.stringify({sameSession:true,payment:'unpaid',expired:true,expiredRetryBlocked:true}));
} finally {
 if(id && !expired) {
   try {const x=await stripe.checkout.sessions.retrieve(id);if(x.status==='open'&&x.payment_status==='unpaid') await stripe.checkout.sessions.expire(id);} catch(e) {console.error('Diagnostic cleanup failed:',e.message);}
 }
 const {error}=await supabase.from('store_checkout_attempts').delete().eq('attempt_key',key);
 if(error) console.error('Diagnostic reservation cleanup failed');
}
