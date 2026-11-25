import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const src="import { checkoutGuardActivatedAt } from './lib/store/db.js'; try { await checkoutGuardActivatedAt(); process.exit(1) } catch (e) { if (!/Durable checkout storage unavailable/.test(e.message)) process.exit(2); }";
for(const env of [{VERCEL:'1',NODE_ENV:'development'},{VERCEL:'',NODE_ENV:'production'}]) {
 const child=spawnSync(process.execPath,['--input-type=module','-e',src],{encoding:'utf8',env:{...process.env,...env,STORE_LOCAL_DB:'1',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''}});
 assert.equal(child.status,0,child.stderr);
}
console.log('Checkout durable storage safety checks passed');
