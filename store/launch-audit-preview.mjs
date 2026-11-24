// Temporary read-only audit and signed harmless webhook probes. No orders or payments.
import Stripe from 'stripe';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpoints = await stripe.webhookEndpoints.list({limit:100});
console.log('ENDPOINTS',JSON.stringify({complete:!endpoints.has_more,endpoints:endpoints.data.map(e=>({url:e.url,status:e.status,events:e.enabled_events}))}));
const payload = JSON.stringify({id:'evt_launch_safe_probe',object:'event',type:'armonia.noop',data:{object:{}}});
for (const [label,url,key] of [['course','https://www.armoniaconnect.com/api/webhook',process.env.STRIPE_WEBHOOK_SECRET],['store','https://www.armoniaconnect.com/api/store/webhook',process.env.STRIPE_WEBHOOK_SECRET]]) {
  if (!key) {console.log('NOOP',label,'secret_missing');continue;}
  const sig = stripe.webhooks.generateTestHeaderString({payload,secret:key});
  try {const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':sig},body:payload,signal:AbortSignal.timeout(15000)});console.log('NOOP',label,r.status,(await r.text()).slice(0,250));} catch {console.log('NOOP',label,'request_failed');}
}
