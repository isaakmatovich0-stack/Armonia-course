// Read-only launch audit. Does not create sessions, orders, charges, or messages.
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const results = {};
const links = await stripe.paymentLinks.list({limit:100});
results.courseLinks = [];
for (const [label,url] of [['regular','https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00'],['sale','https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01']]) {
  const link=links.data.find(x=>x.url===url);
  if (!link) {results.courseLinks.push({label,found:false,complete:!links.has_more});continue;}
  const items=await stripe.paymentLinks.listLineItems(link.id,{limit:100});
  results.courseLinks.push({label,active:link.active,livemode:link.livemode,currency:items.data.map(x=>x.currency),amounts:items.data.map(x=>x.price?.unit_amount),quantities:items.data.map(x=>x.quantity),complete:!items.has_more});
}
const wh = await fetch('https://api.printful.com/webhooks',{headers:{Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID},signal:AbortSignal.timeout(15000)});
const wd=await wh.json();
if (wh.ok && wd.result) {
  let u; try {u=new URL(wd.result.url)} catch {}
  results.supplierWebhook={http:wh.status,host:u?.host,path:u?.pathname,tokenMatches:!!process.env.PRINTFUL_WEBHOOK_TOKEN && u?.searchParams.get('token')===process.env.PRINTFUL_WEBHOOK_TOKEN,types:wd.result.types};
} else results.supplierWebhook={http:wh.status};
const {data,error}=await supabase.from('store_products').select('id,images').in('id',['beanie-embroidered','hat-embroidered']);
if(error) throw new Error('Catalog query failed');
results.photos=[];
for(const p of data) for(const [color,url] of Object.entries(p.images||{})) {
  try {const r=await fetch(url,{signal:AbortSignal.timeout(12000)});results.photos.push({id:p.id,color,status:r.status,type:r.headers.get('content-type')?.split(';')[0]}); await r.body?.cancel();}
  catch {results.photos.push({id:p.id,color,error:'fetch failed'});}
}
console.log('LAUNCH_AUDIT',JSON.stringify(results));
