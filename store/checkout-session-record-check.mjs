import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const {supabase}=await import('../lib/supabase.js');
const {recordCheckoutSession}=await import('../lib/store/db.js');
let count=0;
supabase.from=table=>({upsert:async(record,options)=>{
 assert.equal(table,'store_checkout_sessions');
 assert.equal(record.stripe_session_id,'cs_test_1');
 assert.deepEqual(options,{onConflict:'stripe_session_id',ignoreDuplicates:true});
 count++;
 return {error:count===1?{message:'database unavailable'}:null};
}});
await assert.rejects(recordCheckoutSession({stripe_session_id:'cs_test_1'}),/database unavailable/);
await recordCheckoutSession({stripe_session_id:'cs_test_1'});
await recordCheckoutSession({stripe_session_id:'cs_test_1'});
assert.equal(count,3);
console.log('Checkout session recording checks passed');
