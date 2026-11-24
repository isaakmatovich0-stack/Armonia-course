// Read-only reconciliation of earlier paid course checkouts; report no customer identities.
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const links=await stripe.paymentLinks.list({limit:100});if(links.has_more) throw new Error('Link list incomplete');
const ids=links.data.filter(x=>['https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00','https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01'].includes(x.url)).map(x=>x.id);
const sessions=await stripe.checkout.sessions.list({limit:100});if(sessions.has_more) throw new Error('Session list incomplete');
const paid=sessions.data.filter(s=>s.payment_status==='paid' && (ids.includes(s.payment_link) || s.metadata?.source==='armonia-course'));
const results=[];
for(const s of paid) {
 const a=await supabase.from('access_codes').select('stripe_session_id,source,revoked').eq('stripe_session_id',s.id);
 if(a.error) throw new Error('Session comparison failed');
 if(a.data.length) {results.push({linked:true});continue;}
 const email=s.customer_details?.email||s.customer_email;
 const b=email ? await supabase.from('access_codes').select('source,revoked').ilike('email',email) : {data:[],error:null};
 if(b.error) throw new Error('Email comparison failed');
 const pi=s.payment_intent?await stripe.paymentIntents.retrieve(s.payment_intent,{expand:['latest_charge']}):null;
 results.push({linked:false,created:s.created,amount:s.amount_total,hasEmail:!!email,matchingCodes:b.data.length,matchingActiveCodes:b.data.filter(x=>!x.revoked).length,fullyRefunded:!!pi?.latest_charge?.refunded});
}
console.log('RECONCILIATION',JSON.stringify(results));
