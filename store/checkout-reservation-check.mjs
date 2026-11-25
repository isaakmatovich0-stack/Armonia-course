import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STORE_LOCAL_DB='1';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'armonia-checkout-check-'));
process.chdir(dir);
const {reserveCheckoutAttempt,saveCheckoutAttempt,replaceCheckoutAttempt}=await import('../lib/store/db.js');
try {
 const cart='cart_0123456789abcdef0123456789abcdef';
 const [first,racing]=await Promise.all([reserveCheckoutAttempt(cart,'params1','key1'),reserveCheckoutAttempt(cart,'params2','key2')]);
 assert.equal(first.attempt_key,racing.attempt_key);
 assert.equal(first.params_hash,racing.params_hash);
 await Promise.all([saveCheckoutAttempt(first.attempt_key,'cs_1'),saveCheckoutAttempt(first.attempt_key,'cs_1')]);
 await assert.rejects(saveCheckoutAttempt(first.attempt_key,'cs_other'),/changed/);
 const [a,b]=await Promise.all([
   replaceCheckoutAttempt(cart,first.attempt_key,'cs_1','params3','key3','cs_1'),
   replaceCheckoutAttempt(cart,first.attempt_key,'cs_1','params4','key4','cs_1'),
 ]);
 assert.equal(a.attempt_key,b.attempt_key);
 assert.equal(a.params_hash,b.params_hash);
 assert.equal(a.previous_paid_session_id,'cs_1');
 await assert.rejects(saveCheckoutAttempt(first.attempt_key,'cs_1'),/changed/);
 await saveCheckoutAttempt(a.attempt_key,'cs_2');
 assert.equal((await reserveCheckoutAttempt(cart,'ignored','ignored')).stripe_session_id,'cs_2');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log('Checkout reservation checks passed');
