if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
for (const host of ['www.armoniaconnect.com','armoniaconnect.com']) {
 const r=await fetch(`https://${host}/api/store/checkout`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 const body=await r.text();console.log('LIVE_EMPTY_CHECKOUT',host,r.status,body.slice(0,300));
 if (r.status!==503 || !body.includes('temporarily unavailable')) throw new Error('Live checkout pause not verified');
}
