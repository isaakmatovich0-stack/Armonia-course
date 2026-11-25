import assert from 'node:assert/strict';
process.env.RESEND_API_KEY='test';
process.env.FROM_EMAIL='test@example.invalid';
let calls=[];
globalThis.fetch=async(url,options)=>{
 calls.push({url:String(url),headers:new Headers(options.headers),body:JSON.parse(options.body)});
 return new Response(JSON.stringify({id:'email_test'}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {sendStoreOrderConfirmation}=await import('../lib/email.js');
const payload={to:'buyer@example.invalid',name:'Buyer',orderNumber:'AC-TEST',items:[],totalCents:1000,shippingAddress:{},idempotencyKey:'store-receipt/cs_test_receipt'};
assert.ok((await sendStoreOrderConfirmation(payload)).data.id);
assert.ok((await sendStoreOrderConfirmation(payload)).data.id);
assert.equal(calls.length,2);assert.equal(calls[0].headers.get('idempotency-key'),payload.idempotencyKey);
assert.deepEqual(calls[0].body,calls[1].body);assert.equal(calls[1].headers.get('idempotency-key'),payload.idempotencyKey);
console.log('Store receipt idempotency checks passed');
