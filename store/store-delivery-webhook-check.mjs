import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
process.env.STRIPE_SECRET_KEY='sk_test_dummy';process.env.STRIPE_WEBHOOK_SECRET='whsec_test';
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
process.env.RESEND_API_KEY='test';process.env.FROM_EMAIL='test@example.invalid';
const {supabase}=await import('../lib/supabase.js');
let order=null, jobs=[], emailAttempts=0, failReceipt=true, notification=0;
supabase.from=(table)=>{
 if(table==='store_products'||table==='store_settings') throw Error('no live catalog in test');
 let operation='select',payload=null,filters=[];
 const execute=()=>{
  if(table==='store_orders'){
   if(operation==='insert') {
    if(order)return {data:null,error:{code:'23505'}};
    order={...payload,id:'fake-uuid',created_at:new Date().toISOString()};
    if(order.recovery_managed)jobs=['receipt','supplier'].map(kind=>({id:kind,kind,order_id:order.id,state:'pending',snapshot:{...order},lease_token:null}));
    return {data:order,error:null};
   }
   if(operation==='update'){if(!order)return {data:[],error:null};Object.assign(order,payload);return {data:[{...order}],error:null};}
   return {data:order?{...order}:null,error:null};
  }
  if(table==='store_delivery_jobs'){
   const matches=jobs.filter(j=>filters.every(([key,value])=>j[key]===value));
   if(operation==='update'){for(const j of matches)Object.assign(j,payload);return {data:matches.map(j=>({id:j.id})),error:null};}
   return {data:matches.map(j=>({state:j.state,kind:j.kind})),error:null};
  }
  throw Error(`unexpected table ${table}`);
 };
 const b={select(){return b},eq(key,value){filters.push([key,value]);return b},insert(v){operation='insert';payload=v;return b},update(v){operation='update';payload=v;return b},single:async()=>execute(),maybeSingle:async()=>execute(),then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}};
 return b;
};
supabase.rpc=async(name,args)=>{
 if(name==='store_claim_delivery_job'){
  const j=jobs.find(j=>j.order_id===args.p_order_id&&j.state==='pending'&&(!j.next_attempt_at||new Date(j.next_attempt_at).getTime()<=Date.now()));
  if(!j)return {data:[],error:null};j.state='running';j.lease_token='lease-'+j.id;return {data:[{...j}],error:null};
 }
 if(name==='store_begin_delivery_job')return {data:true,error:null};
 throw Error(`unexpected RPC ${name}`);
};
globalThis.fetch=async(url,options)=>{
 assert.match(String(url),/api\.resend\.com/);
 const key=new Headers(options.headers).get('idempotency-key');
 if(!key){notification++;return new Response(JSON.stringify({id:'notify'}),{status:200,headers:{'Content-Type':'application/json'}});}
 assert.equal(key,'store-receipt/cs_test_order');emailAttempts++;
 if(failReceipt)return new Response(JSON.stringify({message:'temporary failure'}),{status:500,headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify({id:'email'}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {default:handler}=await import('../api/store/[...slug].js');
const stripe=new Stripe('sk_test_dummy');
async function invoke(session) {
 const payload=JSON.stringify({id:'evt_test',object:'event',type:'checkout.session.completed',data:{object:session}});
 const req=Readable.from([Buffer.from(payload)]);req.url='/api/store/webhook';req.method='POST';req.headers={'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_test'})};
 const res={setHeader(){},status(n){this.code=n;return this},json(x){this.result=x;return this},send(x){this.result=x;return this}};
 await handler(req,res);return res;
}
const session={id:'cs_test_order',payment_status:'paid',metadata:{source:'armonia-store',items_json:JSON.stringify([{productId:'example',name:'Test',quantity:1}])},customer_details:{email:'buyer@example.invalid',name:'Buyer'},amount_total:1000,currency:'usd'};
assert.equal((await invoke(session)).code,500);assert.equal(order.recovery_managed,true);assert.equal(jobs.find(j=>j.kind==='receipt').state,'pending');assert.equal(jobs.find(j=>j.kind==='supplier').state,'review');
assert.equal(notification,1);assert.equal(emailAttempts,1);
// Simulate the retry delay elapsing; a duplicate webhook must reuse the order
// and recover the receipt without another shop alert or supplier request.
jobs.find(j=>j.kind==='receipt').next_attempt_at=new Date(0).toISOString();failReceipt=false;
assert.equal((await invoke(session)).code,200);assert.equal(jobs.find(j=>j.kind==='receipt').state,'done');assert.equal(notification,1);assert.equal(emailAttempts,2);
assert.equal((await invoke(session)).code,200);assert.equal(emailAttempts,2);
console.log('Signed store delivery webhook recovery checks passed');
