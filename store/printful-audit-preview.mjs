// Read-only audit of the live Printful products and published-product links.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('preview only');
const h={Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID};
async function get(path){const r=await fetch('https://api.printful.com'+path,{headers:h,signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok)throw Error(`${r.status} ${JSON.stringify(j.error||{})}`);return j}
for(const [name,id] of [['tee',497028801],['hoodie',497028509],['jacket',497029019]]){
 try {let data=(await get('/store/products/'+id)).result;let variants=(data.sync_variants||[]).filter(v=>v.size==='S').map(v=>({id:v.id,catalog:v.variant_id,colour:v.color,previews:(v.files||[]).filter(f=>f.type==='preview').map(f=>({filename:f.filename,preview_url:f.preview_url,hash:f.hash})),design:(v.files||[]).filter(f=>f.type!=='preview').map(f=>({type:f.type,id:f.id,hash:f.hash}))}));console.log('PRODUCT_AUDIT',name,JSON.stringify(variants));}catch(e){console.log('PRODUCT_ERROR',name,e.message)}
}
for(const path of ['/v2/products?limit=100','/v2/product-templates/110481475','/v2/product-templates/110661786','/v2/product-templates/110481369'])try{const j=await get(path);const data=j.data;const redact=x=>{if(Array.isArray(x))return x.map(redact);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/url|href/i.test(k)?'[URL]':redact(v)]));return x};console.log('V2_AUDIT',path,JSON.stringify(redact(data)));}catch(e){console.log('V2_ERROR',path,e.message)}
