import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTranscriptionCheckout, deliverTranscription, SALES_BUCKET } from '../lib/transcription-sales.js';

const catalog = JSON.parse(await readFile('public/transcription/catalog.json','utf8'));
catalog.pieces[0].sample=false;
const products = new Map([['sample-vihuela',{piece_id:'sample-vihuela', price_cents:1500, asset_path:'sample-vihuela/01234567-89ab-4cde-8f01-23456789abcd.pdf', enabled:true}]]);
const orders = new Map();
const pdf = Buffer.from('%PDF-1.7\nFake test PDF, not actual music.');
const db = {
  storage:{from(bucket){assert.equal(bucket,SALES_BUCKET);return {async download(path){return path === products.get('sample-vihuela').asset_path ? {data:new Blob([pdf]),error:null} : {error:new Error('missing')};}};}},
  from(table){
    let op='read', payload, filters=[];
    const rows=()=>table==='site_content' ? [{key:'transcription.catalog.v1',value:JSON.stringify(catalog)}] : table==='transcription_sale_products' ? [...products.values()] : [...orders.values()];
    const execute=()=>{
      const matches=rows().filter(row=>filters.every(([key,value])=>(row[key] ?? null) === value));
      if(op==='insert'){ if(orders.has(payload.id))return {data:null,error:{code:'23505'}};const row={stripe_session_id:null,...payload};orders.set(row.id,row);return {data:{...row},error:null}; }
      if(op==='update'){for(const row of matches)Object.assign(row,payload);return {data:matches[0] ? {...matches[0]} : null,error:null};}
      return {data:matches[0] ? {...matches[0]} : null,error:null};
    };
    const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},async maybeSingle(){return execute()},then(ok,bad){return Promise.resolve(execute()).then(ok,bad)}};return q;
  }
};
let creates=0;const sessions=new Map();
const stripe={checkout:{sessions:{async create(params, options){assert.equal(params.line_items[0].price_data.unit_amount,1500);assert.equal(params.metadata.source,'armonia-transcription');const key=options.idempotencyKey;if(!sessions.has(key)){creates++;sessions.set(key,{id:'cs_test_example',status:'open',url:'https://checkout.stripe.com/example'});}return sessions.get(key);},async retrieve(){return {id:'cs_test_example',status:'open',url:'https://checkout.stripe.com/example'};}}}};
const id='e92336e2-66e2-4ba4-a753-3f33f36cb82a';
const args={db,stripe,pieceId:'sample-vihuela',orderId:id,siteUrl:'https://example.test'};
await Promise.all([startTranscriptionCheckout(args),startTranscriptionCheckout(args)]);
assert.equal(creates,1,'same checkout attempt cannot create two Stripe sessions');
assert.equal(orders.get(id).stripe_session_id,'cs_test_example');
await assert.rejects(()=>startTranscriptionCheckout({...args,pieceId:'sample-guitarra'}));
const session={id:'cs_test_example',metadata:{source:'armonia-transcription',order_id:id},payment_status:'paid',amount_total:1500,currency:'usd',customer_details:{email:'buyer@example.test'}};
let sends=0;
const send=async ({to,content,idempotencyKey})=>{assert.equal(to,'buyer@example.test');assert.deepEqual(content,pdf);assert.equal(idempotencyKey,`transcription-delivery/${id}`);sends++;return {data:{id:'email_test'}};};
assert.deepEqual(await deliverTranscription({db,session:{...session,payment_status:'unpaid'},send}),{ignored:true});
await assert.rejects(()=>deliverTranscription({db,session:{...session,amount_total:1499},send}));
const concurrent=await Promise.allSettled([deliverTranscription({db,session,send}),deliverTranscription({db,session,send})]);
assert.equal(concurrent.filter(r=>r.status==='fulfilled' && r.value.sent).length,1);
assert.equal(sends,1);assert.equal(orders.get(id).state,'sent');
assert.deepEqual(await deliverTranscription({db,session,send}),{sent:true,duplicate:true});assert.equal(sends,1);
const second='ad41dcf3-38b8-4a7b-b689-847c989b1496';await startTranscriptionCheckout({...args,orderId:second});
const secondSession={...session,metadata:{...session.metadata,order_id:second}};
let uncertainSends=0;
const uncertain=async()=>{uncertainSends++;throw new Error('network timeout after provider request');};
assert.deepEqual(await deliverTranscription({db,session:secondSession,send:uncertain}),{review:true});
assert.deepEqual(await deliverTranscription({db,session:secondSession,send:uncertain}),{review:true});assert.equal(uncertainSends,1,'uncertain email must never be automatically replayed');
assert.equal(orders.get(second).state,'review');
process.stdout.write('Digital checkout and paid email delivery safety checks passed (all services mocked).\n');

// Exercise the actual raw-body webhook and Resend adapter with signed mock events.
process.env.STRIPE_SECRET_KEY='sk_test_transcription';
process.env.STRIPE_WEBHOOK_SECRET='whsec_test_transcription';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
process.env.RESEND_API_KEY='test';
process.env.FROM_EMAIL='test@example.test';
const {supabase} = await import('../lib/supabase.js');
supabase.from = db.from;
supabase.storage = db.storage;
const {default: Stripe} = await import('stripe');
const signedStripe = new Stripe('sk_test_transcription');
let providerCalls=0;
globalThis.fetch=async (url,opts)=>{
  assert.match(String(url),/resend/);providerCalls++;
  const sent=JSON.parse(opts.body);assert.equal(Array.isArray(sent.to) ? sent.to[0] : sent.to,'buyer@example.test');
  assert.equal(sent.attachments[0].content,pdf.toString('base64'));
  assert.equal(new Headers(opts.headers).get('Idempotency-Key'),`transcription-delivery/${third}`);
  return new Response(JSON.stringify({id:'resend_test'}),{status:200,headers:{'Content-Type':'application/json'}});
};
const third='70ab2600-7de5-4862-b16f-79166af1ace9';
await startTranscriptionCheckout({...args,orderId:third});
const thirdSession={...session,metadata:{...session.metadata,order_id:third}};
const {default:webhook}=await import('../api/webhook.js');
const payload=JSON.stringify({id:'evt_test_digital',object:'event',type:'checkout.session.completed',data:{object:thirdSession}});
async function invoke(signature) { const req={method:'POST',body:Buffer.from(payload),headers:{'stripe-signature':signature}};const res={status(code){this.code=code;return this},json(data){this.data=data;return this},send(data){this.data=data;return this},end(){return this}};await webhook(req,res);return res; }
assert.equal((await invoke('invalid')).code,400);
const signature=signedStripe.webhooks.generateTestHeaderString({payload,secret:'whsec_test_transcription'});
assert.equal((await invoke(signature)).code,200);assert.equal(providerCalls,1);assert.equal(orders.get(third).state,'sent');
assert.equal((await invoke(signature)).code,200);assert.equal(providerCalls,1);
process.stdout.write('Signed webhook and mocked email-attachment delivery passed.\n');
