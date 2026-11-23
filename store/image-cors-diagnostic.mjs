if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const {supabase} = await import('../lib/supabase.js');
const {data,error} = await supabase.from('store_products').select('id,images');
if(error) throw error;
for (const row of data) {
 const image=Object.values(row.images||{})[0]; if (!image) continue;
 try { const response=await fetch(image,{method:'GET',headers:{Origin:'https://www.armoniaconnect.com'},redirect:'error',signal:AbortSignal.timeout(12000)}); console.log('IMAGE_DIAG',JSON.stringify({id:row.id,status:response.status,cors:response.headers.get('access-control-allow-origin'),type:response.headers.get('content-type'),size:response.headers.get('content-length')})); await response.body?.cancel(); }
 catch(err){console.log('IMAGE_DIAG',JSON.stringify({id:row.id,error:err.message}));}
}
