// One-time fix to the existing Printful notification URL; no order or payment changes.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const token=process.env.PRINTFUL_WEBHOOK_TOKEN;
const headers={Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'Content-Type':'application/json'};
if(!token) throw new Error('Webhook token missing');
const required=['package_shipped','order_failed','order_canceled','package_returned'].sort();
const get=async()=>{const r=await fetch('https://api.printful.com/webhooks',{headers}); if(!r.ok) throw new Error(`Webhook read failed: ${r.status}`); return (await r.json()).result};
const old=await get();
const url=new URL(old.url);
if(url.protocol!=='https:' || !['armoniaconnect.com','www.armoniaconnect.com'].includes(url.host) || url.pathname!=='/api/store/supplier-webhook' || url.searchParams.get('token')!==token || [...old.types].sort().join(',')!==required.join(',')) throw new Error('Unexpected existing webhook; no changes made');
if(url.host==='armoniaconnect.com') {
  url.host='www.armoniaconnect.com';
  const r=await fetch('https://api.printful.com/webhooks',{method:'POST',headers,body:JSON.stringify({url:url.href,types:old.types})});
  if(!r.ok) throw new Error(`Webhook update failed: ${r.status}`);
}
const updated=await get(); const actual=new URL(updated.url);
if(actual.host!=='www.armoniaconnect.com' || actual.pathname!==url.pathname || actual.searchParams.get('token')!==token || [...updated.types].sort().join(',')!==required.join(',')) throw new Error('Webhook readback mismatch');
console.log('SUPPLIER_NOTIFICATIONS',JSON.stringify({configured:true,host:actual.host,types:updated.types}));
