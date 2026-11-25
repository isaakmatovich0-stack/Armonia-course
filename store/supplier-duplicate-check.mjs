import assert from 'node:assert/strict';
import {submitOrder} from '../lib/suppliers/printful.js';
process.env.PRINTFUL_API_TOKEN='test'; process.env.PRINTFUL_STORE_ID='test';
const order={number:'AC-TEST',items:[{productId:'p',color:'Black',size:'M',quantity:1}]};
const variants={'p|Black|M':'123'};
let status='pending', calls=[];
globalThis.fetch=async (url,options)=>{
 calls.push({url:String(url),method:options.method});
 if (String(url).endsWith('/orders') && options.method==='POST') return new Response(JSON.stringify({error:{message:'Order already exists'}}),{status:400});
 if (String(url).endsWith('/orders?limit=100')) return new Response(JSON.stringify({result:[{id:42,external_id:'AC-TEST',status}]}),{status:200});
 throw new Error('unexpected supplier operation');
};
const existing=await submitOrder(order,variants);
assert.equal(existing.id,42);assert.equal(existing.adopted,true);
assert.equal(calls.filter(x=>x.method==='POST').length,1);
for(status of ['draft','failed','canceled','unknown']) {
 calls=[];
 await assert.rejects(submitOrder(order,variants),/review it before retrying/);
 assert.equal(calls.filter(x=>x.method==='POST').length,1);
 assert.ok(!calls.some(x=>x.url.endsWith('/confirm')));
}
console.log('Supplier duplicate protection checks passed');
