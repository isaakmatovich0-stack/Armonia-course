// Preview-only integration rehearsal; no production carts, orders or payments.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
const supa=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:rows,error}=await supa.from('store_products').select('*');
if(error)throw error;
process.env.STORE_LOCAL_DB='1';
fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/store-db.json',JSON.stringify({products:Object.fromEntries(rows.map(p=>[p.id,p])),carts:{},orders:{},sessions:{},promos:{},subscribers:{}}));
const { default:handler }=await import('../api/store/[...slug].js');
async function request(path,body,id){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/api/store/'+path;req.headers={'content-type':'application/json',host:'www.armoniaconnect.com',...(id?{'x-cart-id':id}:{})};
 const res={headers:{},code:200,setHeader(k,v){this.headers[k.toLowerCase()]=v},status(c){this.code=c;return this},json(v){this.data=v;return this},send(v){this.data=v;return this}};
 await handler(req,res);return res;
}
const addr={name:'Preview Test',line1:'11025 Westlake Drive',city:'Charlotte',state:'NC',postal_code:'28273'};
let cartId=null;
for(const item of [{productId:'unisex-classic-tee',color:'Black',size:'M',quantity:2},{productId:'hat-embroidered',color:'Black',size:'ONE SIZE',quantity:1}]){
 const r=await request('bag',{action:'add',...item},cartId);if(r.code!==200)throw new Error('bag: '+JSON.stringify(r.data));cartId=r.headers['x-cart-id'];
}
const quote=await request('shipping-quote',{address:addr},cartId);if(quote.code!==200)throw new Error('quote: '+JSON.stringify(quote.data));
const session=await request('checkout',{address:addr,fingerprint:quote.data.fingerprint},cartId);if(session.code!==200)throw new Error('checkout: '+JSON.stringify(session.data));
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2024-06-20'});
try {const detail=await stripe.checkout.sessions.retrieve(session.data.id); const items=await stripe.checkout.sessions.listLineItems(session.data.id); console.log('CHECKOUT_AUDIT',JSON.stringify({quoted:quote.data.amountCents,total:detail.amount_total,shippingLine:items.data.find(x=>x.description==='Standard shipping')?.amount_total,hasFixedAddress:detail.metadata.fixed_shipping_address,qty:items.data.length}));if(!items.data.some(x=>x.description==='Standard shipping'&&x.amount_total===quote.data.amountCents))throw new Error('Stripe shipping line mismatch');}
finally {await stripe.checkout.sessions.expire(session.data.id);console.log('CHECKOUT_AUDIT unpaid session expired');}
