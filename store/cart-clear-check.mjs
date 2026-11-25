import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STORE_LOCAL_DB='1';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'armonia-cart-check-'));
process.chdir(dir);
const {createCart,saveCart,clearCartIfUnchanged,getCart}=await import('../lib/store/db.js');
try {
 const id='cart_0123456789abcdef0123456789abcdef';
 const cart=await createCart({id,items:[{productId:'first'}],promoCode:null});
 assert.equal(await clearCartIfUnchanged(id,cart.updated_at),true);
 assert.deepEqual((await getCart(id)).items,[]);
 const later=await saveCart(id,{items:[{productId:'new'}]});
 assert.equal(await clearCartIfUnchanged(id,'2000-01-01T00:00:00.000Z'),false);
 assert.deepEqual((await getCart(id)).items,later.items);
 assert.equal(await clearCartIfUnchanged(id,null),false);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log('Conditional cart cleanup checks passed');
