// End-to-end admin handler test with a mock Printful API and isolated local DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'armonia-mockup-check-'));
process.env.STORE_LOCAL_DB = '1';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.PRINTFUL_API_TOKEN = 'test-token';
process.env.PRINTFUL_STORE_ID = '1';
process.chdir(temp);
fs.mkdirSync('.tmp');
fs.writeFileSync('.tmp/store-db.json', JSON.stringify({ promos: {}, products: { shirt: { id:'shirt', name:'Shirt', colors:['Black','Navy'], sizes:['S'], images:{ Black:'https://existing.example/black.png' }, in_stock:true } } }));
const template = { id: 123, product_id: 71, title:'Saved shirt design', available_variant_ids:[4011,4012] };
const pf = { sync_product:{ id:1, external_id:'shirt', name:'Shirt' }, sync_variants: [
  { id: 11, variant_id: 4011, color:'Black', size:'S', product:{product_id:71}, files:[] },
  { id: 12, variant_id: 4012, color:'Navy', size:'S', product:{product_id:71}, files:[] },
] };
const mockups = [4011,4012].map((id) => ({ variant_ids:[id], placement:'front', mockup_url:`https://printful-upload.s3-accelerate.amazonaws.com/tmp/${id}.png` }));
let creates = 0, uploads = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://printful-upload.')) return new Response(Buffer.from([137,80,78,71,13,10,26,10,0]), {status:200});
  let result;
  if (u.endsWith('/store/products')) result = [{id:1}];
  else if (u.endsWith('/store/products/1')) result = pf;
  else if (u.includes('/product-templates?')) result = {items:[template]};
  else if (u.endsWith('/mockup-generator/create-task/71')) {
    creates++;
    assert.deepEqual(JSON.parse(opts.body), {product_template_id:123,variant_ids:[4011,4012],format:'png'});
    result = {task_key:'gt-1'};
  } else if (u.includes('/mockup-generator/task?')) result = { status:'completed', mockups };
  else throw new Error(`Unexpected request ${u}`);
  return {ok:true, text:async () => JSON.stringify({result, paging:{total:1}})};
};
try {
  const { supabase } = await import(`${root}/lib/supabase.js`);
  supabase.storage.from = () => ({
    upload: async () => { uploads++; return {error:null}; },
    getPublicUrl: (p) => ({data:{publicUrl:`https://storage.example/${p}`}}),
  });
  const { default: handler } = await import(`${root}/api/admin/[...slug].js`);
  const auth = jwt.sign({admin:true},process.env.SESSION_SECRET);
  const request = async (method,body = {}, token = auth) => {
    const req = {url:'/api/admin/store-mockups',method,body,headers:{authorization:`Bearer ${token}`}};
    const res = {status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await handler(req,res); return res;
  };
  assert.equal((await request('GET',{},'invalid')).code,401);
  const listing = await request('GET');
  assert.equal(listing.code,200);
  assert.equal(listing.data.products[0].templates[0].id,123);
  const start = await request('POST',{action:'start',productId:'shirt',templateId:123});
  assert.equal(start.code,200); assert.equal(creates,1);
  assert.deepEqual(JSON.parse(fs.readFileSync('.tmp/store-db.json')).products.shirt.images, {Black:'https://existing.example/black.png'}, 'render must not change the store');
  const poll = await request('POST',{action:'poll',handle:start.data.handle});
  assert.equal(poll.code,200); assert.equal(poll.data.status,'completed'); assert(poll.data.images.Navy);
  const invalid = await request('POST',{action:'save',handle:'bad',colour:'Navy'});
  assert.equal(invalid.code,400); assert.equal(uploads,0);
  const noApproval = await request('POST',{action:'save',handle:start.data.handle,colour:'Black'});
  assert.equal(noApproval.code,409); assert.equal(uploads,0);
  const done = await request('POST',{action:'save',handle:start.data.handle,colour:'Navy'});
  assert.equal(done.code,200); assert.equal(uploads,1);
  const images = JSON.parse(fs.readFileSync('.tmp/store-db.json')).products.shirt.images;
  assert.equal(images.Black,'https://existing.example/black.png');
  assert.match(images.Navy,/^https:\/\/storage\.example\/store-mockups\//);
  console.log('  ✓ mockup API — authenticated render, review, and durable per-colour save');
} finally { process.chdir(root); fs.rmSync(temp,{recursive:true,force:true}); }
