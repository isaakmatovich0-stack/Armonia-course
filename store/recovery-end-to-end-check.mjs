// Isolated integration test: signed synthetic Stripe webhooks run through the
// real production-mode handler, worker and Printful/Resend adapters. Database,
// Stripe, Printful and Resend are in-memory mocks; no network is permitted.
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
Object.assign(process.env,{SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_WEBHOOK_SECRET_STORE:'whsec_fake',RESEND_API_KEY:'fake',FROM_EMAIL:'test@example.invalid',PRINTFUL_API_TOKEN:'fake',PRINTFUL_STORE_ID:'1',PRINTFUL_API_BASE:'https://printful.example.invalid',NODE_ENV:'test'});
delete process.env.STORE_LOCAL_DB; delete process.env.PRINTFUL_DRAFT;
Stripe.prototype._prepResources=function(){this.paymentIntents={retrieve:async()=>({shipping:{name:'Example Customer',address:{line1:'1 Main St',city:'Houston',state:'TX',postal_code:'77001',country:'US'}}})};};
const {supabase}=await import('../lib/supabase.js');
const orders=new Map(),jobs=[];
const products=[{id:'windbreaker-embroidered',name:'Windbreaker',price_cents:4500,supplier:'printful',in_stock:true,colors:['Black'],sizes:['M'],supplier_variants:{'windbreaker-embroidered|Black|M':'12345'}}];
supabase.from=table=>{
 let op='select',payload,filters=[];
 const matches=row=>filters.every(([key,value])=>row[key]===value);
 const result=()=>{
  if(table==='store_products')return {data:products,error:null};
  if(table==='store_settings')return {data:null,error:null};
  if(table==='store_orders'){
   if(op==='insert'){
    if(orders.has(payload.stripe_session_id))return {data:null,error:{code:'23505'}};
    const order={...structuredClone(payload),id:`order-${orders.size+1}`,created_at:new Date().toISOString()};orders.set(order.stripe_session_id,order);
    if(order.recovery_managed) for(const kind of ['receipt','supplier']) jobs.push({id:`${order.id}-${kind}`,kind,order_id:order.id,state:'pending',snapshot:structuredClone(order),started_at:null,lease_token:null});
    return {data:structuredClone(order),error:null};
   }
   const rows=[...orders.values()].filter(matches);
   if(op==='update') for(const row of rows) Object.assign(row,payload);
   return {data:rows.map(row=>structuredClone(row)),error:null};
  }
  if(table==='store_delivery_jobs'){
   const rows=jobs.filter(matches);if(op==='update')for(const row of rows)Object.assign(row,payload);
   return {data:structuredClone(rows),error:null};
  }
  throw Error(`Unexpected database table ${table}`);
 };
 const one=()=>{const r=result();return Array.isArray(r.data)?{...r,data:r.data[0]||null}:r};
 const b={select(){return b},order(){return b},eq(k,v){filters.push([k,v]);return b},insert(v){op='insert';payload=v;return b},update(v){op='update';payload=v;return b},single:async()=>one(),maybeSingle:async()=>one(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return b;
};
let leases=0;
supabase.rpc=async(name,args)=>{
 if(name==='store_claim_delivery_job'){
  const job=jobs.find(j=>(!args.p_order_id||j.order_id===args.p_order_id)&&j.state==='pending'&&(!j.next_attempt_at||Date.parse(j.next_attempt_at)<=Date.now()));
  if(!job)return {data:[],error:null};job.state='running';job.lease_token=`lease-${++leases}`;return {data:[structuredClone(job)],error:null};
 }
 if(name==='store_begin_delivery_job'){
  const job=jobs.find(j=>j.id===args.p_job_id&&j.lease_token===args.p_token&&j.state==='running');if(!job)return {data:false,error:null};
  job.started_at ||= new Date().toISOString();return {data:true,error:null};
 }
 throw Error(`Unexpected RPC ${name}`);
};
let creates=0,confirms=0,receiptAttempts=0,alerts=0,failConfirm=false,failReceipt=false,lastPayload;
globalThis.fetch=async(url,opts={})=>{
 const u=String(url);
 if(u==='https://printful.example.invalid/orders') {creates++;lastPayload=JSON.parse(opts.body);return new Response(JSON.stringify({result:{id:98765}}),{status:200});}
 if(u==='https://printful.example.invalid/orders/98765/confirm') {confirms++;if(failConfirm)throw Error('simulated lost supplier response');return new Response(JSON.stringify({result:{id:98765,status:'pending'}}),{status:200});}
 if(u==='https://api.resend.com/emails'){
  const key=new Headers(opts.headers).get('idempotency-key');if(key){receiptAttempts++;if(failReceipt)return new Response(JSON.stringify({message:'simulated email failure'}),{status:500,headers:{'Content-Type':'application/json'}});}else alerts++;
  return new Response(JSON.stringify({id:'fake-email'}),{status:200,headers:{'Content-Type':'application/json'}});
 }
 throw Error(`Blocked unexpected network call: ${u}`);
};
const {encodeCheckoutItems}=await import('../lib/store/checkout-items.js');
const {default:handler}=await import('../api/store/[...slug].js');
const stripe=new Stripe('sk_test_fake');
async function invoke(id){
 const session={id,payment_status:'paid',payment_intent:'pi_test_fake',customer_details:{name:'Example Customer',email:'buyer@example.invalid'},amount_subtotal:5419,amount_total:5419,currency:'usd',metadata:{source:'armonia-store',fixed_shipping_address:'payment_intent',quoted_shipping_cents:'919',...encodeCheckoutItems([{productId:'windbreaker-embroidered',name:'Windbreaker',color:'Black',size:'M',quantity:1,unitPriceCents:4500}])}};
 const payload=JSON.stringify({id:`evt_${id}`,object:'event',type:'checkout.session.completed',data:{object:session}});
 const req=Readable.from([Buffer.from(payload)]);req.url='/api/store/webhook';req.method='POST';req.headers={'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_fake'})};
 const res={setHeader(){},status(n){this.code=n;return this},json(x){this.body=x;return this},send(x){this.body=x;return this}};await handler(req,res);return res;
}
const first=await invoke('cs_test_success');assert.equal(first.code,200,JSON.stringify(first.body));
const order=orders.get('cs_test_success');assert.equal(order.fulfilment_status,'submitted');assert.equal(order.supplier_order_id,'printful:98765');assert.equal(order.amount_shipping,919);
assert.equal(lastPayload.external_id,order.number);assert.equal(lastPayload.items[0].sync_variant_id,12345);assert.equal(lastPayload.recipient.address1,'1 Main St');
assert.ok(jobs.filter(j=>j.order_id===order.id).every(j=>j.state==='done'));
await Promise.all(Array.from({length:20},()=>invoke('cs_test_success')));assert.equal(creates,1);assert.equal(confirms,1);assert.equal(receiptAttempts,1);assert.equal(alerts,1);
// Concurrent initial deliveries may return retryable 500 while jobs are running,
// but only one worker may send either side effect.
await Promise.all(Array.from({length:20},()=>invoke('cs_test_concurrent')));
const concurrent=orders.get('cs_test_concurrent');assert.ok(jobs.filter(j=>j.order_id===concurrent.id).every(j=>j.state==='done'));
assert.equal(creates,2);assert.equal(confirms,2);assert.equal(receiptAttempts,2);assert.equal(alerts,2);
failConfirm=true;await invoke('cs_test_uncertain');const uncertain=orders.get('cs_test_uncertain');assert.equal(jobs.find(j=>j.order_id===uncertain.id&&j.kind==='supplier').state,'review');
const beforeCreates=creates,beforeConfirms=confirms;failConfirm=false;await invoke('cs_test_uncertain');assert.equal(creates,beforeCreates);assert.equal(confirms,beforeConfirms);
failReceipt=true;const failed=await invoke('cs_test_email_retry');assert.equal(failed.code,500);const emailOrder=orders.get('cs_test_email_retry');const receiptJob=jobs.find(j=>j.order_id===emailOrder.id&&j.kind==='receipt');assert.equal(receiptJob.state,'pending');
receiptJob.next_attempt_at=new Date(0).toISOString();failReceipt=false;const retried=await invoke('cs_test_email_retry');assert.equal(retried.code,200);assert.equal(receiptJob.state,'done');
// Small local load smoke test, not a measurement of Vercel, Supabase or
// provider capacity. No endpoint or provider can be reached by this test.
const samples=[];const baseCreates=creates,baseConfirms=confirms,baseReceipts=receiptAttempts;
for(let batch=0;batch<8;batch++) {
 const results=await Promise.all(Array.from({length:25},async(_,i)=>{const start=performance.now();const response=await invoke(`cs_test_load_${batch}_${i}`);samples.push(performance.now()-start);return response;}));
 assert.ok(results.every(r=>r.code===200));
}
assert.equal(creates-baseCreates,200);assert.equal(confirms-baseConfirms,200);assert.equal(receiptAttempts-baseReceipts,200);
samples.sort((a,b)=>a-b);
console.log(`Synthetic signed webhook: receipt, supplier, duplicates and failure recovery passed; 200 local mock orders, concurrency 25, p95 ${samples[Math.floor(samples.length*0.95)].toFixed(1)} ms. All services mocked; not a platform capacity test.`);
