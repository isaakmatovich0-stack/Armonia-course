// Read-only monitoring remains authenticated and counts beyond the order list.
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
Object.assign(process.env,{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',SESSION_SECRET:'test-secret'});
delete process.env.STORE_LOCAL_DB;
const {supabase}=await import('../lib/supabase.js');
const queries=[];let fail=false;
supabase.from=table=>{
 assert.equal(table,'store_delivery_jobs');const q={table};queries.push(q);
 const b={select(columns,opts){q.columns=columns;q.opts=opts;return b},eq(k,v){q.state=v;return b},lt(k,v){q.lt=[k,v];return b},order(k,v){q.order=[k,v];return b},limit(n){q.limit=n;return b},then(resolve,reject){return Promise.resolve(fail?{error:{message:'offline'}}:{count:q.state==='review'?30:q.state==='running'?2:3,data:[{kind:'supplier',store_orders:{number:'AC-TEST'}}],error:null}).then(resolve,reject)}};return b;
};
const {deliveryAttention}=await import('../lib/store/delivery-recovery.js');
const status=await deliveryAttention({now:Date.parse('2026-01-01T00:15:00Z')});
assert.equal(status.review,30);assert.equal(status.expiredLeases,2);assert.equal(status.overdue,3);assert.deepEqual(status.reviewSample,[{order:'AC-TEST',kind:'supplier'}]);
assert.ok(queries.every(q=>q.opts.count==='exact'&&q.limit===10));
assert.deepEqual(queries.find(q=>q.state==='pending').lt,['next_attempt_at','2026-01-01T00:00:00.000Z']);
assert.deepEqual(queries.find(q=>q.state==='running').lt,['lease_until','2026-01-01T00:15:00.000Z']);
const {default:handler}=await import('../api/admin/[...slug].js');
async function call(method,token){const req={url:'/api/admin/store-delivery-status',method,headers:token?{authorization:`Bearer ${token}`}:{},query:{}};const res={status(n){this.code=n;return this},json(v){this.body=v;return this}};await handler(req,res);return res;}
assert.equal((await call('GET')).code,401);
const token=jwt.sign({admin:true},process.env.SESSION_SECRET);
assert.equal((await call('POST',token)).code,405);
assert.equal((await call('GET',token)).body.review,30);
fail=true;assert.equal((await call('GET',token)).code,503);
console.log('Delivery monitoring counts and admin authorization checks passed');
