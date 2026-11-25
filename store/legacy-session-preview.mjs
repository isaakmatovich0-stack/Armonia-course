// Read-only preview diagnosis. No payments, order changes, or session updates.
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
if(process.env.VERCEL_ENV!=='preview') throw Error('Preview only');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const {data,error}=await supabase.from('store_checkout_sessions').select('stripe_session_id,status,created_at,cart_id');
if(error) throw Error('Cannot read session audit');
const rows=[];
for(const row of data){
 const s=await stripe.checkout.sessions.retrieve(row.stripe_session_id);
 rows.push({status:s.status,payment:s.payment_status,hasCart:Boolean(s.metadata?.cart_id),recordedStatus:row.status,expiresFuture:s.expires_at>Math.floor(Date.now()/1000)});
}
let checked=0;const counts={};let relevant=0,openRecent=0,missingCart=0;
const cutoff=Math.floor(Date.now()/1000)-48*3600;
for await(const s of stripe.checkout.sessions.list({limit:100,created:{gte:cutoff}})) {
 checked++;
 if(s.metadata?.source!=='armonia-store') continue;
 relevant++;const key=`${s.status}/${s.payment_status}`;counts[key]=(counts[key]||0)+1;
 if(s.status==='open')openRecent++;
 if(!s.metadata?.cart_id)missingCart++;
}
console.log('LEGACY_SESSION_READ_ONLY',JSON.stringify({audit:rows,recentHours:48,allSessionsScanned:checked,storeSessions:relevant,counts,openRecent,missingCart}));
