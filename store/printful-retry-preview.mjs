// Temporary, preview-only, single-order recovery. Never creates a new order.
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const { data, error } = await supabase.from('store_orders').select('number,status,supplier_order_id').eq('number', 'AC-FVMXTA');
if (error || data?.length !== 1 || data[0].status !== 'paid' || data[0].supplier_order_id !== 'printful:189438251') throw new Error('Unexpected order; no action taken');
const url = 'https://api.printful.com/orders/189438251';
const headers = { Authorization: `Bearer ${process.env.PRINTFUL_API_TOKEN}`, 'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID };
async function lookup() {
  const response = await fetch(url, {headers});
  const body = await response.json();
  if (!response.ok || body.result?.external_id !== 'AC-FVMXTA') throw new Error('Unable to validate original supplier order');
  return body.result;
}
const order = await lookup();
console.log('ORDER_BEFORE', JSON.stringify({status: order.status, error: order.error, id: order.id}));
if (order.status === 'failed') {
  const response = await fetch(`${url}/confirm`, { method: 'POST', headers });
  const body = await response.json();
  console.log('RETRY_RESULT', JSON.stringify({ http: response.status, error: body.error?.message || body.error?.reason || body.error || null, status: body.result?.status || null }));
} else {
  console.log('RETRY_SKIPPED', JSON.stringify({status: order.status}));
}
const after = await lookup();
console.log('ORDER_AFTER', JSON.stringify({status: after.status, error: after.error, id: after.id}));
