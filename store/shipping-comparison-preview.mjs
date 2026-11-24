// Read-only comparison for the existing test order; no orders or charges.
import {supabase} from '../lib/supabase.js';
import {refreshCatalog, loadCatalog} from '../lib/store/catalog.js';
import {quoteShipping,buildOrderPayload} from '../lib/suppliers/printful.js';
if(process.env.VERCEL_ENV!=='preview') throw new Error('Preview only');
const {data:order,error}=await supabase.from('store_orders').select('*').eq('number','AC-FVMXTA').single();
if(error || order?.supplier_order_id!=='printful:189438251') throw new Error('Order mismatch');
await refreshCatalog({force:true});
const catalog=loadCatalog();
const variants=Object.assign({},...order.items.map(item=>catalog.byId.get(item.productId)?.supplierVariants||{}));
const {payload,missing}=buildOrderPayload(order,variants);
if(missing.length || payload.items.length!==1) throw new Error('Missing variant');
const rate=await quoteShipping(payload.recipient,order.items,catalog);
const response=await fetch('https://api.printful.com/orders/estimate-costs',{method:'POST',headers:{Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'Content-Type':'application/json'},body:JSON.stringify({recipient:payload.recipient,shipping:payload.shipping,items:payload.items})});
if(!response.ok) throw new Error('Estimate failed '+response.status);
const estimate=(await response.json()).result;
console.log('SHIPPING_COMPARISON',JSON.stringify({checkoutCharged:order.amount_shipping,rateCents:rate.amountCents,estimateShipping:estimate.costs?.shipping,total:estimate.costs?.total}));
