// Enable the previously configured course endpoint after deploying and probing its handler.
// Only the endpoint destination and event subscription are updated; no payments are created.
import Stripe from 'stripe';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const all=await stripe.webhookEndpoints.list({limit:100});
if(all.has_more) throw new Error('Endpoint list incomplete');
const matches=all.data.filter(e=>['https://armoniaconnect.com/api/webhook','https://www.armoniaconnect.com/api/webhook'].includes(e.url));
if(matches.length!==1) throw new Error('Unexpected course endpoint configuration');
const old=matches[0];
if(old.status==='disabled' && old.url==='https://armoniaconnect.com/api/webhook' && old.enabled_events.length===1 && old.enabled_events[0]==='checkout.session.completed') {
  await stripe.webhookEndpoints.update(old.id,{url:'https://www.armoniaconnect.com/api/webhook',disabled:false,enabled_events:['checkout.session.completed','checkout.session.async_payment_succeeded']});
} else if(old.status!=='enabled' || old.url!=='https://www.armoniaconnect.com/api/webhook') throw new Error('Endpoint changed since inspection; no update attempted');
const current=await stripe.webhookEndpoints.retrieve(old.id);
console.log('COURSE_ENDPOINT',JSON.stringify({url:current.url,status:current.status,events:current.enabled_events}));
