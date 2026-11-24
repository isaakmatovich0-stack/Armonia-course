import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
import {isCourseCheckout, isStoreCheckout} from '../lib/course-checkout.js';

assert.equal(isStoreCheckout({metadata:{source:'armonia-store'}}), true);
assert.equal(isStoreCheckout({payment_link:'plink_course'}), false);
const deps={stripe:{paymentLinks:{retrieve:async()=>({url:'https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01'})}}, supabase:{from(){throw new Error('not needed')}}};
assert.equal(await isCourseCheckout({metadata:{source:'armonia-store'},payment_link:'plink'},deps),false);
assert.equal(await isCourseCheckout({payment_link:'plink'},deps),true);
assert.equal(await isCourseCheckout({},deps),false);

process.env.STRIPE_SECRET_KEY='sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET='whsec_course_test';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
process.env.RESEND_API_KEY='test';
process.env.FROM_EMAIL='test@example.com';
const {supabase}=await import('../lib/supabase.js');
let row=null, sends=0, failSend=true;
supabase.from = (table) => {
  assert.equal(table,'access_codes');
  return {
    select(){return {eq(){return {maybeSingle:async()=>({data:row,error:null})}}}},
    insert:async (value)=> {if(row) return {error:{code:'23505'}}; row={...value,access_email_sent_at:null};return {error:null};},
    update(value){return {eq:async()=>{row={...row,...value};return {error:null};}}},
  };
};
globalThis.fetch=async (url,opts)=>{
  assert.match(String(url),/resend/);
  assert.equal(new Headers(opts.headers).get('Idempotency-Key'),'course-access/cs_test_course');
  sends++;
  if(failSend) return new Response(JSON.stringify({message:'temporary failure'}),{status:500,headers:{'Content-Type':'application/json'}});
  return new Response(JSON.stringify({id:'mail_test'}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {default:handler}=await import('../api/webhook.js');
const stripe=new Stripe('sk_test_dummy');
async function invoke(session) {
 const payload=JSON.stringify({id:'evt_test',object:'event',type:'checkout.session.completed',data:{object:session}});
 const req=Readable.from([Buffer.from(payload)]); req.method='POST'; req.body=JSON.parse(payload); req.complete=true;
 req.headers={'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_course_test'})};
 const res={status(n){this.statusCode=n;return this},json(x){this.result=x;return this},send(x){this.result=x;return this},end(){return this}};
 await handler(req,res); return res;
}
const session={id:'cs_test_course',metadata:{source:'armonia-course'},payment_status:'paid',customer_details:{email:'buyer@example.com',name:'Buyer'},amount_total:5000};
assert.equal((await invoke({...session,metadata:{source:'armonia-store'}})).statusCode,200);
assert.equal(row,null);
assert.equal((await invoke(session)).statusCode,500);
const code=row.code;
failSend=false;
assert.equal((await invoke(session)).statusCode,200);
assert.equal(row.code,code);
assert.ok(row.access_email_sent_at);
assert.equal((await invoke(session)).statusCode,200);
assert.equal(sends,2);
console.log('  ✓ course webhook — store events ignored, paid course email retries with one access code');
