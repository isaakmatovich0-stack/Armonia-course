// Read-only comparison of recent paid course sessions with issued codes.
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const links=await stripe.paymentLinks.list({limit:100});
if(links.has_more) throw new Error('Payment link list incomplete');
const ids=links.data.filter(x=>['https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00','https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01'].includes(x.url)).map(x=>x.id);
const sessions=await stripe.checkout.sessions.list({limit:100});
const paid=sessions.data.filter(s=>s.payment_status==='paid' && (ids.includes(s.payment_link) || s.metadata?.source==='armonia-course'));
const result=[];
for(const session of paid) {
 const {data,error}=await supabase.from('access_codes').select('stripe_session_id').eq('stripe_session_id',session.id).maybeSingle();
 if(error) throw new Error('Unable to compare code records');
 result.push({hasCode:!!data});
}
console.log('RECENT_COURSE_PAYMENTS',JSON.stringify({sessionsScanned:sessions.data.length,scanComplete:!sessions.has_more,paid:paid.length,withoutCode:result.filter(x=>!x.hasCode).length}));
