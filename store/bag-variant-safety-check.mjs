// Exercise the production-mode bag route against a mocked database only.
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.STORE_LOCAL_DB;
const { supabase } = await import('../lib/supabase.js');
const products = [{ id:'hoodie-embroidered', name:'Hoodie', price_cents:4500, supplier:'printful', in_stock:true,
  colors:['Maroon'], sizes:['M','4XL'], supplier_variants:{'hoodie-embroidered|Maroon|M':'123'} }];
const carts = new Map();
supabase.from = table => {
  let op='select', data, id;
  const result = () => {
    if (table === 'store_products') return {data:products,error:null};
    if (table === 'store_settings') return {data:null,error:null};
    if (table !== 'store_carts') throw Error(`Unexpected table ${table}`);
    if (op === 'insert') { carts.set(data.id, data); return {data, error:null}; }
    if (op === 'update') { const cart=carts.get(id); Object.assign(cart,data); return {data:cart,error:null}; }
    return {data:carts.get(id) || null,error:null};
  };
  const b={select(){return b},order(){return b},eq(k,v){if(k==='id') id=v;return b},insert(v){op='insert';data=v;return b},update(v){op='update';data=v;return b},single:async()=>result(),maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};
  return b;
};
globalThis.fetch = () => { throw Error('Unexpected network call'); };
const {default:handler}=await import('../api/store/[...slug].js');
async function add(size, cart) {
  const req={url:'/api/store/bag',method:'POST',headers:cart?{'x-cart-id':cart}:{},body:{action:'add',productId:'hoodie-embroidered',color:'Maroon',size,quantity:1}};
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}};
  await handler(req,res);return res;
}
const good=await add('M');
assert.equal(good.code,200);assert.equal(good.body.count,1);
const bad=await add('4XL',good.headers['x-cart-id']);
assert.equal(bad.code,400);assert.match(bad.body.error,/combination is currently unavailable/i);
assert.equal(carts.get(good.headers['x-cart-id']).items.length,1);
console.log('Bag rejects unmapped supplier variants before checkout');
