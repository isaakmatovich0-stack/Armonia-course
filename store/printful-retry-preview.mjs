// Temporary preview-only verification of the already-retried order; no supplier mutation.
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const response = await fetch('https://api.printful.com/orders/189438251', {headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_TOKEN}`, 'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID }});
const json = await response.json();
const order = json.result;
if (!response.ok || order?.external_id !== 'AC-FVMXTA') throw new Error('Could not verify supplier order');
console.log('SUPPLIER_RECHECK', JSON.stringify({id: order.id, status: order.status, error: order.error, shipping: order.shipping}));
// Synchronize only a verified active order, and never overwrite a later status.
if (['pending','inprocess','onhold'].includes(order.status)) {
  const result = await supabase.from('store_orders').update({fulfilment_status: 'submitted', fulfilment_error: null}).eq('number', 'AC-FVMXTA').eq('supplier_order_id', 'printful:189438251').eq('fulfilment_status','failed').select('number,fulfilment_status');
  if (result.error) throw new Error('Could not update store order');
  console.log('STORE_SYNC', JSON.stringify(result.data));
}
