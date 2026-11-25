// A self-contained synthetic order: all Stripe, Printful and Resend I/O is
// intercepted. No real payment, supplier request, email, or database is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
const root=process.env.ORDER_TEST_ROOT ? path.resolve(process.env.ORDER_TEST_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'armonia-order-simulation-'));
fs.mkdirSync(path.join(tmp,'store'));fs.copyFileSync(path.join(root,'store/catalog.json'),path.join(tmp,'store/catalog.json'));
process.chdir(tmp);
Object.assign(process.env,{STORE_LOCAL_DB:'1',NODE_ENV:'test',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_WEBHOOK_SECRET:'whsec_fake',STRIPE_WEBHOOK_SECRET_STORE:'',PRINTFUL_API_TOKEN:'fake',PRINTFUL_STORE_ID:'fake',PRINTFUL_API_BASE:'https://fake-printful.invalid',RESEND_API_KEY:'fake',FROM_EMAIL:'fake@example.invalid',SITE_URL:'https://store.example.invalid'});
delete process.env.VERCEL;delete process.env.PRINTFUL_DRAFT;
const sessions=new Map(), keys=new Map(); let stripeCreates=0, stripeParams, supplierCreates=0, supplierConfirms=0, supplierPayload, emailPayloads=[];
Stripe.prototype._prepResources=function(){
 this.checkout={sessions:{
  create:async(params,opts)=>{
   if(keys.has(opts.idempotencyKey))return sessions.get(keys.get(opts.idempotencyKey));
   stripeCreates++;stripeParams=structuredClone(params);
   const id=`cs_test_mock_${stripeCreates}`;keys.set(opts.idempotencyKey,id);
   const s={id,status:'open',payment_status:'unpaid',url:`https://checkout.example.invalid/${id}`,metadata:params.metadata,created:Math.floor(Date.now()/1000)};sessions.set(id,s);return {...s};
  },
  retrieve:async id=>structuredClone(sessions.get(id)),
  expire:async id=>{const s=sessions.get(id);s.status='expired';return structuredClone(s);},
  list:async()=>({data:[],has_more:false}),
 }};
 this.paymentIntents={retrieve:async()=>({shipping:stripeParams.payment_intent_data.shipping})};
};
globalThis.fetch=async(url,opts={})=>{
 const u=String(url);
 if(u==='https://fake-printful.invalid/orders/estimate-costs')return new Response(JSON.stringify({result:{costs:{currency:'USD',shipping:'9.19'}}}),{status:200});
 if(u==='https://fake-printful.invalid/orders') {supplierCreates++;supplierPayload=JSON.parse(opts.body);return new Response(JSON.stringify({result:{id:123456}}),{status:200});}
 if(u==='https://fake-printful.invalid/orders/123456/confirm') {supplierConfirms++;return new Response(JSON.stringify({result:{id:123456,status:'pending'}}),{status:200});}
 if(u==='https://api.resend.com/emails') {emailPayloads.push(JSON.parse(opts.body));return new Response(JSON.stringify({id:'fake-email'}),{status:200,headers:{'Content-Type':'application/json'}});}
 throw Error(`Blocked unexpected network call: ${u}`);
};
try {
 const db=await import(pathToFileURL(path.join(root,'lib/store/db.js')));
 await db.updateProduct('windbreaker-embroidered',{supplierVariants:{'windbreaker-embroidered|Black|M':'12345'}});
 const {default:handler}=await import(pathToFileURL(path.join(root,'api/store/[...slug].js')));
 async function call(route,{method='POST',body={},cart,signature}={}){
  const req=route==='webhook'?Readable.from([Buffer.from(JSON.stringify(body))]):{body};
  req.url=`/api/store/${route}`;req.method=method;req.headers={host:'store.example.invalid',...(cart?{'x-cart-id':cart}:{}),...(signature?{'stripe-signature':signature}:{})};
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}};
  await handler(req,res);return res;
 }
 const added=await call('bag',{body:{action:'add',productId:'windbreaker-embroidered',color:'Black',size:'M',quantity:1}});
 assert.equal(added.code,200,JSON.stringify(added.body));const cart=added.headers['x-cart-id'];assert.ok(cart);assert.equal(added.body.subtotalCents,4500);
 const address={name:'Test Customer',line1:'1 Example Street',city:'Houston',state:'TX',postal_code:'77001'};
 const quote=await call('shipping-quote',{cart,body:{address}});assert.equal(quote.code,200,JSON.stringify(quote.body));assert.equal(quote.body.amountCents,919);
 const body={address,fingerprint:quote.body.fingerprint};const first=await call('checkout',{cart,body});assert.equal(first.code,200,JSON.stringify(first.body));
 const again=await call('checkout',{cart,body});assert.equal(again.code,200,JSON.stringify(again.body));assert.equal(first.body.id,again.body.id);assert.equal(stripeCreates,1);
 const session=sessions.get(first.body.id);Object.assign(session,{status:'complete',payment_status:'paid',payment_intent:'pi_test_fake',customer_details:{email:'buyer@example.invalid',name:'Test Customer',address:{line1:'Different billing address'}},amount_subtotal:5419,amount_total:5419,currency:'usd'});
 const processing=await call('checkout',{cart,body});assert.equal(processing.code,409);assert.equal(processing.body.code,'completed');assert.equal(stripeCreates,1);
 const event={id:'evt_test_fake',object:'event',type:'checkout.session.completed',data:{object:session}};
 const payload=JSON.stringify(event);const signature=Stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_fake'});
 const bad=await call('webhook',{body:event,signature:'bad'});assert.equal(bad.code,400);assert.equal(supplierCreates,0);assert.equal(emailPayloads.length,0);
 const paid=await call('webhook',{body:event,signature});assert.equal(paid.code,200,JSON.stringify(paid.body));
 const repeat=await call('webhook',{body:event,signature});assert.equal(repeat.code,200,JSON.stringify(repeat.body));
 const order=await db.findOrderBySession(session.id);
 assert.equal(order.amount_subtotal,4500);assert.equal(order.amount_shipping,919);assert.equal(order.amount_total,5419);assert.equal(order.shipping_address.line1,address.line1);
 assert.equal(order.items[0].productId,'windbreaker-embroidered');assert.equal(order.items[0].size,'M');assert.equal(order.fulfilment_status,'submitted');
 assert.equal(supplierCreates,1);assert.equal(supplierConfirms,1);assert.equal(supplierPayload.external_id,order.number);assert.equal(supplierPayload.items[0].sync_variant_id,12345);assert.equal(supplierPayload.recipient.address1,address.line1);
 assert.equal(emailPayloads.filter(x=>x.subject.includes('is confirmed')).length,1);assert.equal(emailPayloads.filter(x=>x.subject.includes('New order')).length,1);
 const confirmation=await call(`order?session_id=${session.id}`,{method:'GET'});assert.equal(confirmation.code,200);assert.equal(confirmation.body.pending,false);assert.equal(confirmation.body.number,order.number);
 const empty=await call('bag',{method:'GET',cart});assert.equal(empty.body.count,0);
 const nextBag=await call('bag',{cart,body:{action:'add',productId:'windbreaker-embroidered',color:'Black',size:'M',quantity:1}});assert.equal(nextBag.code,200);
 const nextQuote=await call('shipping-quote',{cart,body:{address}});assert.equal(nextQuote.code,200);
 const nextBody={address,fingerprint:nextQuote.body.fingerprint};
 const blocked=await call('checkout',{cart,body:nextBody});assert.equal(blocked.code,409);assert.equal(blocked.body.code,'paid');assert.equal(stripeCreates,1);
 const approved=await call('checkout',{cart,body:{...nextBody,restartAfterPaid:session.id}});assert.equal(approved.code,200);assert.notEqual(approved.body.id,session.id);assert.equal(stripeCreates,2);
 console.log(JSON.stringify({mode:'fully simulated',bag:'one black medium windbreaker',subtotalCents:4500,shippingCents:919,totalCents:5419,checkoutRetriesSameSession:true,processingPaymentBlocked:true,newOrderRequiresConsent:true,invalidSignatureRejected:true,paidWebhookRecorded:true,duplicateWebhookOneSupplierOrder:true,receiptAndNotificationMocked:true,shippingAddressFromPaymentIntent:true,confirmationFound:true,cartCleared:true,realCharges:0,realSupplierOrders:0,realEmails:0}));
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
