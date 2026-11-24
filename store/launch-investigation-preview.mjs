// One-time read-only launch investigation: estimate only, no orders or payments.
import Stripe from 'stripe';
import {supabase} from '../lib/supabase.js';
import {buildOrderPayload} from '../lib/suppliers/printful.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const links = await stripe.paymentLinks.list({limit:100});
if (links.has_more) throw new Error('Payment link list incomplete');
for (const [label,url] of [['regular','https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00'],['sale','https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01']]) {
 const link=links.data.find(x=>x.url===url);
 if(!link) {console.log('COURSE_LINK',JSON.stringify({label,found:false})); continue;}
 const items=await stripe.paymentLinks.listLineItems(link.id,{limit:100,expand:['data.price.product']});
 console.log('COURSE_LINK',JSON.stringify({label,active:link.active,livemode:link.livemode,items:items.data.map(i=>({amount:i.price?.unit_amount,currency:i.price?.currency,quantity:i.quantity,productActive:i.price?.product?.active,priceActive:i.price?.active})),complete:!items.has_more}));
}
const {data:order,error}=await supabase.from('store_orders').select('*').eq('number','AC-FVMXTA').single();
if(error || !order || order.supplier_order_id!=='printful:189438251') throw new Error('Order mismatch');
const {data:products,error:productError}=await supabase.from('store_products').select('id,supplier_variants').in('id',order.items.map(x=>x.productId));
if(productError) throw new Error('Product lookup failed');
const mappings=Object.assign({},...products.map(p=>p.supplier_variants||{}));
const {payload,missing,empty}=buildOrderPayload(order,mappings);
if(missing.length || empty || payload.items.length!==1 || payload.items[0].quantity!==1) throw new Error('Unexpected replacement variant');
const headers={Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'Content-Type':'application/json'};
const original=await fetch('https://api.printful.com/orders/189438251',{headers});
if(!original.ok) throw new Error('Original order lookup failed '+original.status);
const old=(await original.json()).result;
if(old.id!==189438251||old.external_id!=='AC-FVMXTA') throw new Error('Original order mismatch');
console.log('SUPPLIER_ORDER',JSON.stringify({status:old.status,error:old.error,updated:old.updated,shipments:old.shipments?.map(s=>({hasTracking:!!s.tracking_number,shipped:!!s.shipped_at}))}));
const estimate=await fetch('https://api.printful.com/orders/estimate-costs',{method:'POST',headers,body:JSON.stringify({recipient:payload.recipient,shipping:payload.shipping,items:payload.items})});
const result=await estimate.json();
if(!estimate.ok) console.log('REPLACEMENT_ESTIMATE',JSON.stringify({status:estimate.status,error:result.error?.message||result.message||'estimate failed'}));
else console.log('REPLACEMENT_ESTIMATE',JSON.stringify({status:estimate.status,costs:result.result?.costs,retail_costs:result.result?.retail_costs}));
