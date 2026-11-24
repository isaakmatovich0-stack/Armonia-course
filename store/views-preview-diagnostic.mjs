// One-off preview-only Printful view inspection. Never touches hat artwork or catalog data.
if (process.env.VERCEL_ENV !== 'preview') throw Error('Preview only');
const headers={authorization:'Bearer '+process.env.PRINTFUL_API_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'content-type':'application/json'};
for (const path of ['/v2/catalog-products/661/mockup-styles','/products/661','/products/438','/products/146']) {
  try { const r=await fetch('https://api.printful.com'+path,{headers,signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok){console.log('DIAG_ERROR',path,r.status,JSON.stringify(j.error||j));continue;}
    if(path.includes('mockup-styles')) console.log('STYLES',JSON.stringify(j.data));
    else console.log('VARIANTS',path,JSON.stringify((j.result?.variants||[]).filter(v=>[12634,11546,11561,16424,16434,5530,5594,5586,20570,16859].includes(v.id)).map(v=>({id:v.id,color:v.color,size:v.size}))));
  } catch(e){console.log('DIAG_ERROR',path,e.message)}
}
