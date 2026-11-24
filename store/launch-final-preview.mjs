// Harmless, signed production probes and read-only delivery checks; no purchases.
import Stripe from 'stripe';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
for(const [label,url,session] of [
  ['course-rejects-store','https://www.armoniaconnect.com/api/webhook',{id:'cs_probe',payment_status:'paid',metadata:{source:'armonia-store'}}],
  ['store-rejects-course','https://www.armoniaconnect.com/api/store/webhook',{id:'cs_probe',payment_status:'paid',metadata:{source:'armonia-course'}}],
]) {
 const payload=JSON.stringify({id:'evt_probe_ignore',object:'event',type:'checkout.session.completed',data:{object:session}});
 const sig=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':sig},body:payload,signal:AbortSignal.timeout(12000)});
 console.log('PROBE',label,r.status,(await r.text()).slice(0,200));
}
const pfurl=new URL('https://www.armoniaconnect.com/api/store/supplier-webhook');pfurl.searchParams.set('token',process.env.PRINTFUL_WEBHOOK_TOKEN);
const p=await fetch(pfurl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'armonia.noop'}),signal:AbortSignal.timeout(12000)});
console.log('PROBE','supplier-noop',p.status,(await p.text()).slice(0,200));
const m=(process.env.FROM_EMAIL||'').match(/@([^>\s]+)>?$/); const domain=m?.[1]?.toLowerCase();
const r=await fetch('https://api.resend.com/domains',{headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(12000)});
if(!r.ok) console.log('EMAIL_DOMAIN',JSON.stringify({http:r.status}));
else {const json=await r.json();const d=(json.data||[]).find(x=>x.name?.toLowerCase()===domain);console.log('EMAIL_DOMAIN',JSON.stringify({configured:!!domain,found:!!d,status:d?.status||null}));}
