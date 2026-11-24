// Read-only audit for this store's three garment products. No generated images or mutations.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('preview only');
const h={Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID};
async function get(path) { const r=await fetch('https://api.printful.com'+path,{headers:h,signal:AbortSignal.timeout(15000)});let j=await r.json();if(!r.ok) throw Error(`Printful ${r.status} ${JSON.stringify(j.error||{})}`);return j.result; }
function clean(x){if(Array.isArray(x))return x.map(clean);if(x&&typeof x==='object') return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/url|thumbnail|preview|image/i.test(k)?(typeof v==='string'?'[URL]':clean(v)):clean(v)]));return x}
for(const [name,variant,template] of [['tee',5656382522,110481475],['hoodie',5656380227,110661786],['jacket',5656384205,110481369]]){
 try {let v=await get('/store/variants/'+variant), t=await get('/product-templates/'+template);console.log('AUDIT_VARIANT',name,JSON.stringify(clean(v)));console.log('AUDIT_TEMPLATE',name,JSON.stringify(clean(t)));} catch(e) {console.log('AUDIT_ERROR',name,e.message)}
}
